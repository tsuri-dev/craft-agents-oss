import { basename, resolve } from 'node:path'
import { CliRpcClient } from '../client.ts'
import { spawnServer, type SpawnedServer } from '../server-spawner.ts'
import type { CliArgs } from '../index.ts'
import { craftEventToAcpUpdates, terminalEventToStopReason } from './events.ts'
import type {
  AcpCancelNotification,
  AcpCloseSessionRequest,
  AcpContentBlock,
  AcpNewSessionRequest,
  AcpNewSessionResponse,
  AcpPromptRequest,
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
}

type CraftPermissionMode = 'safe' | 'ask' | 'allow-all'

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
    const workspaceId = await this.resolveWorkspace(cwd)
    const permissionMode = normalizePermissionMode(this.options.mode) ?? 'allow-all'

    const session = await client.invoke('sessions:create', workspaceId, {
      permissionMode,
      workingDirectory: cwd,
      enabledSourceSlugs: this.options.sources.length > 0 ? this.options.sources : undefined,
    }) as { id: string }

    const record: AcpSessionRecord = {
      acpSessionId: session.id,
      craftSessionId: session.id,
      workspaceId,
      cwd,
      permissionMode,
    }
    this.sessions.set(record.acpSessionId, record)

    return {
      sessionId: record.acpSessionId,
      modes: buildSessionModes(permissionMode),
    }
  }

  async prompt(request: AcpPromptRequest): Promise<AcpPromptResponse> {
    const client = await this.ensureClient()
    const record = this.getSession(request.sessionId)
    const message = promptBlocksToCraftMessage(request.prompt)

    let finished = false
    let stopReason: AcpPromptResponse['stopReason'] = 'end_turn'

    const result = new Promise<AcpPromptResponse>((resolvePrompt) => {
      const timeout = setTimeout(() => {
        if (!finished) {
          finished = true
          unsubscribe()
          resolvePrompt({ stopReason: 'refusal' })
        }
      }, this.options.sendTimeout)

      const unsubscribe = client.on('session:event', (event: unknown) => {
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
          clearTimeout(timeout)
          unsubscribe()
          resolvePrompt({ stopReason })
        }
      })
    })

    await client.invoke('sessions:sendMessage', record.craftSessionId, message)
    return result
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
    } else {
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
    }

    await this.client.connect()
    return this.client
  }

  private async resolveWorkspace(cwd: string): Promise<string> {
    const client = await this.ensureClient()

    if (this.options.workspace) {
      await client.invoke('window:switchWorkspace', this.options.workspace).catch(() => {})
      return this.options.workspace
    }

    const name = basename(cwd) || 'zed-workspace'
    try {
      const workspace = await client.invoke('workspaces:create', cwd, name) as { id: string }
      if (workspace?.id) {
        await client.invoke('window:switchWorkspace', workspace.id).catch(() => {})
        return workspace.id
      }
    } catch (error) {
      this.callbacks.log?.(`workspace create failed, falling back to existing workspace: ${error instanceof Error ? error.message : String(error)}`)
    }

    const workspaces = await client.invoke('workspaces:get') as Array<{ id: string }>
    const workspaceId = workspaces?.[0]?.id
    if (!workspaceId) throw new Error('No Craft workspace available for ACP session')
    await client.invoke('window:switchWorkspace', workspaceId).catch(() => {})
    return workspaceId
  }

  private getSession(sessionId: string): AcpSessionRecord {
    const record = this.sessions.get(sessionId)
    if (!record) throw new Error(`Unknown ACP session: ${sessionId}`)
    return record
  }
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
