import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { CliRpcClient } from '../client.ts'
import { getRunningServer, spawnServer, type SpawnedServer } from '../server-spawner.ts'
import type { CliArgs } from '../index.ts'
import { craftEventToAcpUpdates, terminalEventToStopReason } from './events.ts'
import type {
  AcpCancelNotification,
  AcpCloseSessionRequest,
  AcpContentBlock,
  AcpListSessionsRequest,
  AcpListSessionsResponse,
  AcpLoadSessionRequest,
  AcpLoadSessionResponse,
  AcpNewSessionRequest,
  AcpNewSessionResponse,
  AcpPromptRequest,
  AcpResumeSessionRequest,
  AcpSessionInfo,
  AcpPromptResponse,
  AcpSessionModeState,
  AcpSetModeRequest,
  CraftSessionEvent,
} from './types.ts'

export interface CraftAcpAdapterOptions extends Pick<CliArgs,
  'url' | 'token' | 'workspace' | 'timeout' | 'sendTimeout' | 'sources' | 'mode' | 'serverEntry' | 'workspaceDir' | 'verbose'
> {}

export interface CraftAcpAdapterCallbacks {
  notifySessionUpdate: (params: { sessionId: string; update: Record<string, unknown> }) => void
  log?: (message: string) => void
}

interface AcpSessionRecord {
  acpSessionId: string
  craftSessionId: string
  workspaceId: string
  cwd: string
  permissionMode: CraftPermissionMode
  enabledSourceSlugs: string[]
}

type CraftPermissionMode = 'safe' | 'ask' | 'allow-all'

const ZED_LABEL_ID = 'zed'
const SESSION_LIST_PAGE_SIZE = 50

interface CraftWorkspaceInfo {
  id?: string
  name?: string
  rootPath?: string
  path?: string
}

interface CraftSessionSummary {
  id?: string
  name?: string
  preview?: string
  labels?: string[]
  workingDirectory?: string
  lastMessageAt?: number
  lastUsedAt?: number
  createdAt?: number
  messageCount?: number
  lastMessageRole?: string
  permissionMode?: string
  hidden?: boolean
  isArchived?: boolean
  enabledSourceSlugs?: string[]
}

interface CraftSessionWithMessages extends CraftSessionSummary {
  messages?: Array<{
    id?: string
    role?: string
    type?: string
    content?: string
    timestamp?: number
    isError?: boolean
  }>
}

export class CraftAcpAdapter {
  private readonly options: CraftAcpAdapterOptions
  private readonly callbacks: CraftAcpAdapterCallbacks
  private client: CliRpcClient | null = null
  private spawnedServer: SpawnedServer | null = null
  private readonly sessions = new Map<string, AcpSessionRecord>()

  constructor(options: CraftAcpAdapterOptions, callbacks: CraftAcpAdapterCallbacks) {
    this.options = options
    this.callbacks = callbacks
  }

  async initialize(): Promise<void> {
    await this.ensureClient()
  }

  async newSession(request: AcpNewSessionRequest): Promise<AcpNewSessionResponse> {
    const client = await this.ensureClient()
    const cwd = resolve(request.cwd || this.options.workspaceDir || process.cwd())
    const workspaceId = await this.resolveWorkspace(cwd, { allowCreate: true })
    const permissionMode = normalizePermissionMode(this.options.mode) ?? 'allow-all'

    await this.ensureZedLabel(workspaceId)

    const session = await client.invoke('sessions:create', workspaceId, {
      permissionMode,
      workingDirectory: cwd,
      labels: [ZED_LABEL_ID],
      enabledSourceSlugs: this.options.sources.length > 0 ? this.options.sources : undefined,
    }) as { id: string }

    const record: AcpSessionRecord = {
      acpSessionId: session.id,
      craftSessionId: session.id,
      workspaceId,
      cwd,
      permissionMode,
      enabledSourceSlugs: [...this.options.sources],
    }
    this.sessions.set(record.acpSessionId, record)

    return {
      sessionId: record.acpSessionId,
      modes: buildSessionModes(permissionMode),
    }
  }

  async listSessions(request: AcpListSessionsRequest): Promise<AcpListSessionsResponse> {
    const client = await this.ensureClient()
    const workspaceId = await this.resolveWorkspace(request.cwd ? resolve(request.cwd) : undefined, { allowCreate: false })
    const workspace = await this.getWorkspace(workspaceId)
    const cursorOffset = decodeCursor(request.cursor)

    const rawSessions = await client.invoke('sessions:get')
    const sessions = Array.isArray(rawSessions) ? rawSessions as CraftSessionSummary[] : []
    const filtered = sessions
      .filter(session => !session.hidden)
      .sort(compareSessionsByRecentActivity)

    const page = filtered.slice(cursorOffset, cursorOffset + SESSION_LIST_PAGE_SIZE)
    const nextOffset = cursorOffset + SESSION_LIST_PAGE_SIZE
    return {
      sessions: page.map(session => craftSessionToAcpInfo(session, workspace)),
      ...(nextOffset < filtered.length ? { nextCursor: encodeCursor(nextOffset) } : {}),
    }
  }

  async loadSession(request: AcpLoadSessionRequest): Promise<AcpLoadSessionResponse> {
    const { session, record } = await this.attachExistingSession(request)
    await this.replaySessionMessages(record.acpSessionId, session)
    return { modes: buildSessionModes(record.permissionMode) }
  }

  async resumeSession(request: AcpResumeSessionRequest): Promise<{ modes?: AcpSessionModeState }> {
    const { record } = await this.attachExistingSession(request)
    return { modes: buildSessionModes(record.permissionMode) }
  }

  async prompt(request: AcpPromptRequest): Promise<AcpPromptResponse> {
    const client = await this.ensureClient()
    const record = this.getSession(request.sessionId)
    const message = promptBlocksToCraftMessage(request.prompt)
    const mentions = extractCraftMentions(message)

    let finished = false
    let stopReason: AcpPromptResponse['stopReason'] = 'end_turn'
    let unsubscribe = () => {}
    let timeout: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      unsubscribe()
    }

    const result = new Promise<AcpPromptResponse>((resolvePrompt) => {
      timeout = setTimeout(() => {
        if (!finished) {
          finished = true
          cleanup()
          resolvePrompt({ stopReason: 'refusal' })
        }
      }, this.options.sendTimeout)

      unsubscribe = client.on('session:event', (event: unknown) => {
        const ev = event as CraftSessionEvent
        if (ev.sessionId !== record.craftSessionId) return

        const updates = craftEventToAcpUpdates({ ...ev, sessionId: record.acpSessionId })
        for (const update of updates) {
          this.callbacks.notifySessionUpdate(update)
        }

        const terminal = terminalEventToStopReason(ev)
        if (terminal) {
          finished = true
          stopReason = terminal
          cleanup()
          resolvePrompt({ stopReason })
        }
      })
    })

    try {
      if (mentions.sources.length > 0) {
        const sourceSlugs = uniqueStrings([...record.enabledSourceSlugs, ...mentions.sources])
        await client.invoke('sessions:command', record.craftSessionId, { type: 'setSources', sourceSlugs }).catch((error) => {
          this.callbacks.log?.(`source mention setup skipped: ${error instanceof Error ? error.message : String(error)}`)
        })
        record.enabledSourceSlugs = sourceSlugs
      }

      if (mentions.skills.length > 0) {
        await client.invoke('sessions:sendMessage', record.craftSessionId, message, undefined, undefined, { skillSlugs: mentions.skills })
      } else {
        await client.invoke('sessions:sendMessage', record.craftSessionId, message)
      }
      return await result
    } catch (error) {
      finished = true
      cleanup()
      throw error
    }
  }

  async cancel(notification: AcpCancelNotification): Promise<void> {
    const client = await this.ensureClient()
    const record = this.sessions.get(notification.sessionId)
    if (!record) return
    await client.invoke('sessions:cancel', record.craftSessionId).catch((error) => {
      this.callbacks.log?.(`cancel failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  async closeSession(request: AcpCloseSessionRequest): Promise<Record<string, never>> {
    await this.cancel({ sessionId: request.sessionId })
    this.sessions.delete(request.sessionId)
    return {}
  }

  async setMode(request: AcpSetModeRequest): Promise<Record<string, never>> {
    const client = await this.ensureClient()
    const record = this.getSession(request.sessionId)
    const mode = normalizePermissionMode(request.modeId)
    if (!mode) throw new Error(`Unsupported mode: ${request.modeId}`)
    await client.invoke('sessions:command', record.craftSessionId, { type: 'setPermissionMode', mode })
    record.permissionMode = mode
    this.callbacks.notifySessionUpdate({
      sessionId: record.acpSessionId,
      update: { sessionUpdate: 'current_mode_update', modeId: mode },
    })
    return {}
  }

  async dispose(): Promise<void> {
    this.client?.destroy()
    this.client = null
    if (this.spawnedServer) {
      await this.spawnedServer.stop().catch(() => {})
      this.spawnedServer = null
    }
  }

  private async ensureClient(): Promise<CliRpcClient> {
    if (this.client?.isConnected) return this.client

    if (this.options.url) {
      this.client = new CliRpcClient(this.options.url, {
        token: this.options.token || undefined,
        workspaceId: this.options.workspace,
        requestTimeout: this.options.timeout,
        connectTimeout: this.options.timeout,
      })
      await this.client.connect()
      return this.client
    }

    const runningServer = getRunningServer()
    if (runningServer) {
      this.callbacks.log?.(`Connecting to running Craft Agent server at ${runningServer.url}`)
      const client = new CliRpcClient(runningServer.url, {
        token: runningServer.token,
        requestTimeout: this.options.timeout,
        connectTimeout: this.options.timeout,
      })
      try {
        await client.connect()
        this.spawnedServer = runningServer
        this.client = client
        return client
      } catch (error) {
        client.destroy()
        this.callbacks.log?.(`running server attach failed, spawning local server: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    this.callbacks.log?.('Starting local Craft Agent server for ACP')
    this.spawnedServer = await spawnServer({
      serverEntry: this.options.serverEntry,
      startupTimeout: Math.max(this.options.timeout, 30_000),
      quiet: !this.options.verbose,
    })
    this.client = new CliRpcClient(this.spawnedServer.url, {
      token: this.spawnedServer.token,
      requestTimeout: this.options.timeout,
      connectTimeout: this.options.timeout,
    })

    await this.client.connect()
    return this.client
  }

  private async resolveWorkspace(cwd: string | undefined, options: { allowCreate: boolean }): Promise<string> {
    const client = await this.ensureClient()

    if (this.options.workspace) {
      await client.invoke('window:switchWorkspace', this.options.workspace).catch(() => {})
      return this.options.workspace
    }

    const existingWorkspaces = await this.listWorkspaces().catch(() => [])
    const activeWorkspaceId = readLocalActiveWorkspaceId()
    if (activeWorkspaceId && (existingWorkspaces.length === 0 || existingWorkspaces.some(workspace => workspace.id === activeWorkspaceId))) {
      await client.invoke('window:switchWorkspace', activeWorkspaceId).catch(() => {})
      return activeWorkspaceId
    }

    const fallbackCwd = cwd ? resolve(cwd) : undefined
    if (fallbackCwd) {
      const existing = existingWorkspaces.find(workspace => normalizePath(workspace.rootPath ?? workspace.path) === normalizePath(fallbackCwd))
      if (existing?.id) {
        await client.invoke('window:switchWorkspace', existing.id).catch(() => {})
        return existing.id
      }

      if (options.allowCreate) {
        const name = basename(fallbackCwd) || 'zed-workspace'
        try {
          const workspace = await client.invoke('workspaces:create', fallbackCwd, name) as { id: string }
          if (workspace?.id) {
            await client.invoke('window:switchWorkspace', workspace.id).catch(() => {})
            return workspace.id
          }
        } catch (error) {
          this.callbacks.log?.(`workspace create failed, falling back to existing workspace: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    const workspaces = existingWorkspaces.length > 0 ? existingWorkspaces : await this.listWorkspaces()
    const workspaceId = workspaces?.[0]?.id
    if (!workspaceId) throw new Error('No Craft workspace available for ACP session')
    await client.invoke('window:switchWorkspace', workspaceId).catch(() => {})
    return workspaceId
  }

  private async getWorkspace(workspaceId: string): Promise<CraftWorkspaceInfo | undefined> {
    const workspaces = await this.listWorkspaces().catch(() => [])
    return workspaces.find(workspace => workspace.id === workspaceId)
  }

  private async listWorkspaces(): Promise<CraftWorkspaceInfo[]> {
    const client = await this.ensureClient()
    const workspaces = await client.invoke('workspaces:get')
    return Array.isArray(workspaces) ? workspaces as CraftWorkspaceInfo[] : []
  }

  private async ensureZedLabel(workspaceId: string): Promise<void> {
    const client = await this.ensureClient()
    try {
      const labels = await client.invoke('labels:list', workspaceId)
      if (labelTreeHasId(labels, ZED_LABEL_ID)) return
    } catch {
      // Fall through and try to create the label; older servers may not support labels:list.
    }

    await client.invoke('labels:create', workspaceId, { name: ZED_LABEL_ID, color: 'gray' }).catch((error) => {
      this.callbacks.log?.(`zed label setup skipped: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private async attachExistingSession(request: AcpLoadSessionRequest | AcpResumeSessionRequest): Promise<{ session: CraftSessionWithMessages; record: AcpSessionRecord }> {
    const client = await this.ensureClient()
    const workspaceId = await this.resolveWorkspace(request.cwd ? resolve(request.cwd) : undefined, { allowCreate: false })
    const session = await client.invoke('sessions:getMessages', request.sessionId) as CraftSessionWithMessages | null
    if (!session?.id) throw new Error(`Craft session not found: ${request.sessionId}`)

    const cwd = resolve(request.cwd || session.workingDirectory || this.options.workspaceDir || process.cwd())
    if (!session.workingDirectory || normalizePath(session.workingDirectory) !== normalizePath(cwd)) {
      await client.invoke('sessions:command', session.id, { type: 'updateWorkingDirectory', dir: cwd }).catch((error) => {
        this.callbacks.log?.(`working directory sync skipped: ${error instanceof Error ? error.message : String(error)}`)
      })
      session.workingDirectory = cwd
    }

    const permissionMode = normalizePermissionMode(session.permissionMode ?? this.options.mode) ?? 'allow-all'
    const record: AcpSessionRecord = {
      acpSessionId: session.id,
      craftSessionId: session.id,
      workspaceId,
      cwd,
      permissionMode,
      enabledSourceSlugs: [...(session.enabledSourceSlugs ?? [])],
    }
    this.sessions.set(record.acpSessionId, record)
    return { session, record }
  }

  private replaySessionMessages(acpSessionId: string, session: CraftSessionWithMessages): void {
    for (const message of session.messages ?? []) {
      const updates = craftMessageToAcpUpdates(acpSessionId, message)
      for (const update of updates) {
        this.callbacks.notifySessionUpdate(update)
      }
    }
  }

  private getSession(sessionId: string): AcpSessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error(`Unknown ACP session: ${sessionId}`)
    return record
  }
}

function readLocalActiveWorkspaceId(): string | undefined {
  const configDir = process.env.CRAFT_CONFIG_DIR || join(homedir(), '.craft-agent')
  const configPath = join(configDir, 'config.json')
  try {
    if (!existsSync(configPath)) return undefined
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { activeWorkspaceId?: unknown }
    return typeof config.activeWorkspaceId === 'string' && config.activeWorkspaceId ? config.activeWorkspaceId : undefined
  } catch {
    return undefined
  }
}

function extractCraftMentions(message: string): { sources: string[]; skills: string[] } {
  const sources: string[] = []
  const sourcePattern = /\[source:([\w-]+)\]/g
  let match: RegExpExecArray | null
  while ((match = sourcePattern.exec(message)) !== null) {
    sources.push(match[1]!)
  }

  const skills: string[] = []
  const skillPattern = /\[skill:(?:[\w .-]+:)?([\w-]+)\]/g
  while ((match = skillPattern.exec(message)) !== null) {
    skills.push(match[1]!)
  }

  return {
    sources: uniqueStrings(sources),
    skills: uniqueStrings(skills),
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function labelTreeHasId(value: unknown, id: string): boolean {
  const labels = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { labels?: unknown }).labels)
      ? (value as { labels: unknown[] }).labels
      : []

  for (const label of labels) {
    if (!label || typeof label !== 'object') continue
    const record = label as { id?: unknown; children?: unknown }
    if (record.id === id) return true
    if (labelTreeHasId(record.children, id)) return true
  }
  return false
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as { offset?: unknown }
    const offset = typeof parsed.offset === 'number' ? parsed.offset : 0
    return Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0
  } catch {
    return 0
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64')
}

function compareSessionsByRecentActivity(a: CraftSessionSummary, b: CraftSessionSummary): number {
  return sessionTimestamp(b) - sessionTimestamp(a)
}

function sessionTimestamp(session: CraftSessionSummary): number {
  return session.lastMessageAt ?? session.lastUsedAt ?? session.createdAt ?? 0
}

function craftSessionToAcpInfo(session: CraftSessionSummary, workspace: CraftWorkspaceInfo | undefined): AcpSessionInfo {
  const timestamp = sessionTimestamp(session)
  return {
    sessionId: String(session.id ?? ''),
    cwd: normalizeAcpCwd(session.workingDirectory, workspace),
    title: session.name || session.preview || undefined,
    ...(timestamp > 0 ? { updatedAt: new Date(timestamp).toISOString() } : {}),
    _meta: {
      labels: session.labels ?? [],
      messageCount: session.messageCount ?? 0,
      archived: !!session.isArchived,
      lastMessageRole: session.lastMessageRole,
    },
  }
}

function normalizeAcpCwd(cwd: string | undefined, workspace: CraftWorkspaceInfo | undefined): string {
  if (cwd && cwd !== 'none' && cwd !== 'user_default') return normalizePath(cwd)
  const root = workspace?.rootPath ?? workspace?.path
  return root ? normalizePath(root) : process.cwd()
}

function craftMessageToAcpUpdates(
  sessionId: string,
  message: { id?: string; role?: string; type?: string; content?: string; timestamp?: number; isError?: boolean },
): Array<{ sessionId: string; update: Record<string, unknown> }> {
  const text = typeof message.content === 'string' ? message.content : ''
  if (!text) return []

  const role = message.role ?? message.type
  const messageId = message.id ?? `${role || 'message'}-${message.timestamp ?? crypto.randomUUID()}`
  const sessionUpdate = role === 'user' ? 'user_message_chunk' : 'agent_message_chunk'
  const displayText = role === 'error' || message.isError ? `Error: ${text}` : text

  return [{
    sessionId,
    update: {
      sessionUpdate,
      messageId,
      content: { type: 'text', text: displayText },
    },
  }]
}

export function promptBlocksToCraftMessage(blocks: AcpContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue

    switch (block.type) {
      case 'text':
        if (typeof block.text === 'string') parts.push(block.text)
        break
      case 'resource': {
        const resource = block.resource
        if (isTextResource(resource)) {
          parts.push(formatTextResource(resource.uri, resource.text, resource.mimeType))
        } else if (isBlobResource(resource)) {
          parts.push(`Embedded binary resource: ${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ''}`)
        } else {
          parts.push(`Unsupported embedded resource:\n${JSON.stringify(resource, null, 2)}`)
        }
        break
      }
      case 'resource_link':
        parts.push(`Resource link: ${block.name ?? block.uri}\n${block.uri}`)
        break
      case 'image':
        parts.push(`Image context omitted by Craft ACP MVP: ${block.uri ?? block.mimeType}`)
        break
      case 'audio':
        parts.push(`Audio context omitted by Craft ACP MVP: ${block.mimeType}`)
        break
      default:
        parts.push(`Unsupported ACP content block:\n${JSON.stringify(block, null, 2)}`)
    }
  }
  return parts.join('\n\n').trim()
}

function isTextResource(resource: unknown): resource is { uri: string; text: string; mimeType?: string } {
  return !!resource
    && typeof resource === 'object'
    && typeof (resource as { uri?: unknown }).uri === 'string'
    && typeof (resource as { text?: unknown }).text === 'string'
}

function isBlobResource(resource: unknown): resource is { uri: string; blob: string; mimeType?: string } {
  return !!resource
    && typeof resource === 'object'
    && typeof (resource as { uri?: unknown }).uri === 'string'
    && typeof (resource as { blob?: unknown }).blob === 'string'
}

function formatTextResource(uri: string, text: string, mimeType?: string): string {
  const path = fileUriToPath(uri) ?? uri
  const language = mimeTypeToFenceLanguage(mimeType, path)
  return [
    `Context resource: ${path}`,
    mimeType ? `MIME type: ${mimeType}` : '',
    `\`\`\`${language}`,
    text,
    '```',
  ].filter(Boolean).join('\n')
}

function fileUriToPath(uri: string): string | null {
  if (!uri.startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return null
  }
}

function mimeTypeToFenceLanguage(mimeType: string | undefined, path: string): string {
  if (mimeType?.includes('typescript')) return 'ts'
  if (mimeType?.includes('javascript')) return 'js'
  if (mimeType?.includes('python')) return 'py'
  if (mimeType?.includes('json')) return 'json'
  if (mimeType?.includes('html')) return 'html'
  if (mimeType?.includes('css')) return 'css'
  if (mimeType?.includes('markdown')) return 'md'
  const ext = path.split('.').pop()
  return ext && ext.length <= 12 ? ext : ''
}

function normalizePath(path: string | undefined): string {
  if (!path) return ''
  const expanded = path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
  return resolve(expanded)
}

function normalizePermissionMode(mode: string): CraftPermissionMode | undefined {
  switch (mode) {
    case 'safe':
    case 'read-only':
    case 'explore':
      return 'safe'
    case 'ask':
    case 'auto':
    case 'ask-to-edit':
      return 'ask'
    case 'allow-all':
    case 'execute':
    case 'full-access':
      return 'allow-all'
    default:
      return undefined
  }
}

function buildSessionModes(currentModeId: CraftPermissionMode): AcpSessionModeState {
  return {
    currentModeId,
    availableModes: [
      { id: 'safe', name: 'Explore', description: 'Read-only exploration. No file edits or shell mutations.' },
      { id: 'ask', name: 'Ask', description: 'Ask before edits or mutating actions.' },
      { id: 'allow-all', name: 'Execute', description: 'Allow the agent to execute actions autonomously.' },
    ],
  }
}
