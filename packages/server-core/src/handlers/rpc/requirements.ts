import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { formatLabelEntry } from '@craft-agent/shared/labels'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type {
  ExternalRequirementItem,
  RequirementBindInput,
  RequirementBinding,
  RequirementCreateSessionInput,
  RequirementInfoFile,
  RequirementListFilters,
  RequirementListResult,
  RequirementPluginConnectionStatus,
  RequirementUnlinkInput,
  RequirementPluginDescriptor,
} from '@craft-agent/shared/protocol'
import type { LoadedSource } from '@craft-agent/shared/sources'

const TAPD_PLUGIN_ID = 'tapd'
const TAPD_SOURCE_SLUG = 'tapd-mcp-http'
const BINDINGS_FILENAME = 'requirement-bindings.json'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.requirementPlugins.LIST,
  RPC_CHANNELS.requirements.LIST_ITEMS,
  RPC_CHANNELS.requirements.GET_ITEM_DETAIL,
  RPC_CHANNELS.requirements.LIST_INFO_FILES,
  RPC_CHANNELS.requirements.CREATE_GROUP_FROM_ITEM,
  RPC_CHANNELS.requirements.BIND_ITEM_TO_GROUP,
  RPC_CHANNELS.requirements.UNLINK_ITEM_FROM_GROUP,
  RPC_CHANNELS.requirements.CREATE_SESSION_FOR_ITEM,
] as const

interface BindingStore {
  version: 1
  bindings: Record<string, RequirementBinding>
}

function bindingKey(pluginId: string, sourceItemId: string): string {
  return `${pluginId}:${sourceItemId}`
}

function getBindingsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, BINDINGS_FILENAME)
}

function readBindingStore(workspaceRootPath: string): BindingStore {
  const path = getBindingsPath(workspaceRootPath)
  if (!existsSync(path)) return { version: 1, bindings: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<BindingStore>
    return { version: 1, bindings: parsed.bindings ?? {} }
  } catch {
    return { version: 1, bindings: {} }
  }
}

function writeBindingStore(workspaceRootPath: string, store: BindingStore): void {
  writeFileSync(getBindingsPath(workspaceRootPath), JSON.stringify(store, null, 2))
}

function getTapdPlugin(source?: LoadedSource): RequirementPluginDescriptor {
  let connectionStatus: RequirementPluginConnectionStatus = 'disconnected'
  let connectionError: string | undefined

  if (source) {
    const status = source.config.connectionStatus
    if (source.config.enabled === false) connectionStatus = 'disconnected'
    else if (status === 'connected') connectionStatus = 'connected'
    else if (status === 'needs_auth') connectionStatus = 'needs_auth'
    else if (status === 'failed') connectionStatus = 'failed'
    else connectionStatus = 'untested'
    connectionError = source.config.connectionError
  }

  return {
    id: TAPD_PLUGIN_ID,
    sourceSlug: TAPD_SOURCE_SLUG,
    displayName: 'TAPD',
    icon: '📋',
    connectionStatus,
    connectionError,
    capabilities: {
      search: true,
      filters: ['type', 'status', 'project', 'assignee', 'binding'],
      pagination: true,
      detailRefresh: true,
      sourceLinks: true,
    },
  }
}

function getTapdSource(workspaceRootPath: string): LoadedSource | undefined {
  return loadWorkspaceSources(workspaceRootPath).find(source => source.config.slug === TAPD_SOURCE_SLUG)
}

async function createMcpClient(source: LoadedSource): Promise<CraftMcpClient> {
  const mcp = source.config.mcp
  if (!mcp) throw new Error('TAPD MCP source is missing MCP config')

  if (mcp.transport === 'stdio') {
    if (!mcp.command) throw new Error('TAPD MCP stdio source is missing command')
    return new CraftMcpClient({
      transport: 'stdio',
      command: mcp.command,
      args: mcp.args,
      env: mcp.env,
    })
  }

  if (!mcp.url) throw new Error('TAPD MCP HTTP source is missing URL')

  const headers: Record<string, string> = { ...(mcp.headers ?? {}) }
  if (mcp.authType === 'oauth' || mcp.authType === 'bearer') {
    const credentialManager = getCredentialManager()
    const credential = await credentialManager.get({
      type: mcp.authType === 'oauth' ? 'source_oauth' : 'source_bearer',
      workspaceId: source.workspaceId,
      sourceId: source.config.slug,
    })
    if (credential?.value) headers.Authorization = `Bearer ${credential.value}`
  }

  return new CraftMcpClient({
    transport: 'http',
    url: mcp.url,
    headers,
  })
}

async function callTapdTool(source: LoadedSource, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await createMcpClient(source)
  try {
    const result = await client.callTool('proxy_execute_tool', {
      tool_name: toolName,
      tool_args: args,
    }) as { content?: Array<{ type: string; text?: unknown }> }
    const text = result.content
      ?.filter(part => part.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string)
      .join('\n')
      .trim()
    if (!text) return result
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } finally {
    await client.close()
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function extractRows(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const obj = asRecord(payload)
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) return value
    const nested = asRecord(value)
    for (const nestedKey of keys) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[]
    }
  }
  return []
}

function extractStoryRows(payload: unknown): unknown[] {
  return extractRows(payload, ['data', 'stories', 'items', 'result', 'results'])
}

function extractCommentRows(payload: unknown): unknown[] {
  return extractRows(payload, ['data', 'comments', 'items', 'result', 'results'])
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const result = String(value).trim()
  return result || undefined
}

function splitPeople(value: unknown): string[] {
  const raw = text(value)
  if (!raw) return []
  return raw.split(/[;,，、\s]+/).map(item => item.trim()).filter(Boolean)
}

function stripHtml(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  const cleaned = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 1600) : undefined
}

function normalizeTapdStory(
  row: unknown,
  tapdWorkspaceId?: string | number,
  binding?: RequirementBinding,
  contentImages?: ExternalRequirementItem['contentImages'],
  comments?: ExternalRequirementItem['comments'],
): ExternalRequirementItem {
  const rowObj = asRecord(row)
  const raw = asRecord(rowObj.Story ?? rowObj.story ?? rowObj)
  const sourceItemId = text(raw.id ?? raw.story_id ?? raw.sourceItemId) ?? 'unknown'
  const title = text(raw.name ?? raw.title ?? raw.summary) ?? `TAPD ${sourceItemId}`
  const status = text(raw.v_status ?? raw.status_name ?? raw.status)
  const type = text(raw.workitem_type_name ?? raw.type ?? raw.label)
  const category = text(raw.category_name ?? raw.category)
  const project = text(raw.workspace_name ?? raw.project_name ?? raw.project ?? raw.workspace_id ?? tapdWorkspaceId)
  const assignees = [
    ...splitPeople(raw.owner),
    ...splitPeople(raw.developer),
  ].filter((person, index, arr) => arr.indexOf(person) === index)
  const priority = text(raw.priority_name ?? raw.priority_label ?? raw.v_priority ?? raw.priority)
  const dueAt = text(raw.due ?? raw.due_date ?? raw.release_time ?? raw.release_date ?? raw.completed)
  const beginAt = text(raw.begin ?? raw.begin_date)
  const createdAt = text(raw.created ?? raw.created_at)
  const updatedAt = text(raw.modified ?? raw.modified_at ?? raw.updated_at)
  const creator = text(raw.creator ?? raw.created_by)
  const version = text(raw.version_name ?? raw.version)
  const release = text(raw.release_name ?? raw.release_id)
  const sourceUrl = tapdWorkspaceId && sourceItemId !== 'unknown'
    ? `https://tapd.woa.com/tapd_fe/${tapdWorkspaceId}/story/detail/${sourceItemId}`
    : undefined
  const content = text(raw.description ?? raw.detail ?? raw.description_text)
  const summary = stripHtml(content)

  return {
    pluginId: TAPD_PLUGIN_ID,
    source: 'tapd',
    sourceItemId,
    title,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(project ? { project } : {}),
    ...(assignees.length ? { assignees } : {}),
    ...(priority ? { priority } : {}),
    ...(dueAt ? { dueAt } : {}),
    ...(beginAt ? { beginAt } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(creator ? { creator } : {}),
    ...(category ? { category } : {}),
    ...(version ? { version } : {}),
    ...(release ? { release } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(summary ? { summary } : {}),
    ...(content ? { content } : {}),
    ...(contentImages?.length ? { contentImages } : {}),
    ...(comments?.length ? { comments } : {}),
    raw,
    ...(binding ? { binding } : {}),
  }
}

function normalizeTapdImageUrl(value: string): string {
  if (/^http:\/\/(file|oss\.file)\.tapd\.woa\.com\//i.test(value)) {
    return value.replace(/^http:\/\//i, 'https://')
  }
  return value
}

function normalizeTapdComment(row: unknown): NonNullable<ExternalRequirementItem['comments']>[number] | null {
  const rowObj = asRecord(row)
  const raw = asRecord(rowObj.Comment ?? rowObj.comment ?? rowObj)
  const id = text(raw.id ?? raw.comment_id)
  if (!id) return null
  const author = text(raw.author ?? raw.creator ?? raw.created_by ?? raw.user ?? raw.username) ?? 'unknown'
  const body = text(raw.description ?? raw.content ?? raw.body ?? raw.comment)
  const title = text(raw.title)
  const createdAt = text(raw.created ?? raw.created_at)
  const updatedAt = text(raw.modified ?? raw.modified_at ?? raw.updated_at)
  return {
    id,
    author,
    ...(body ? { body } : {}),
    ...(title ? { title } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    raw,
  }
}

function normalizeTapdComments(payload: unknown): NonNullable<ExternalRequirementItem['comments']> {
  return extractCommentRows(payload)
    .map(normalizeTapdComment)
    .filter((comment): comment is NonNullable<ExternalRequirementItem['comments']>[number] => Boolean(comment))
}

function extractTapdImageAliases(src: string): string[] {
  const aliases = new Set<string>([src])
  try {
    const url = new URL(src, 'https://file.tapd.woa.com')
    const nestedSrc = url.searchParams.get('src')
    if (nestedSrc) aliases.add(nestedSrc)
  } catch {
    // Ignore malformed image URLs; original src remains usable as an alias.
  }
  return [...aliases]
}

function extractDescImages(payload: unknown): ExternalRequirementItem['contentImages'] {
  const obj = asRecord(payload)
  const images = Array.isArray(obj.images) ? obj.images : []
  const result: ExternalRequirementItem['contentImages'] = []
  for (const entry of images) {
    const record = asRecord(entry)
    for (const [src, value] of Object.entries(record)) {
      const valueObj = asRecord(value)
      const downloadUrl = text(valueObj.download_url ?? valueObj.downloadUrl ?? valueObj.url)
      if (!downloadUrl) continue
      const idcDownloadUrl = text(valueObj.idc_download_url ?? valueObj.idcDownloadUrl)
      const normalizedDownloadUrl = normalizeTapdImageUrl(downloadUrl)
      const normalizedIdcDownloadUrl = idcDownloadUrl ? normalizeTapdImageUrl(idcDownloadUrl) : undefined
      for (const alias of extractTapdImageAliases(src)) {
        result.push({
          src: alias,
          downloadUrl: normalizedDownloadUrl,
          ...(normalizedIdcDownloadUrl ? { idcDownloadUrl: normalizedIdcDownloadUrl } : {}),
        })
      }
    }
  }
  return result
}

function storyMayHaveDescImages(row: unknown, content?: string): boolean {
  const raw = asRecord(asRecord(row).Story ?? asRecord(row).story ?? row)
  return Boolean(raw.has_tapd_image) || Boolean(content && (/!\[[^\]]*\]\(\/tfl\//.test(content) || /<img[^>]+src=["']\/tfl\//i.test(content)))
}

function extractTotal(payload: unknown): number | undefined {
  const obj = asRecord(payload)
  const candidates = [
    obj.count,
    obj.total,
    obj.data && asRecord(obj.data).count,
    obj.data && asRecord(obj.data).total,
    obj.result && asRecord(obj.result).count,
    obj.result && asRecord(obj.result).total,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value)) return value
  }
  return undefined
}

function buildTapdArgs(filters: RequirementListFilters, detailId?: string): Record<string, unknown> {
  if (!filters.workspaceId) throw new Error('TAPD workspace_id is required')
  const args: Record<string, unknown> = {
    workspace_id: filters.workspaceId,
    with_v_status: '1',
    limit: filters.limit ?? 30,
    page: filters.page ?? 1,
    order: 'modified desc',
    fields: 'id,name,status,v_status,owner,developer,creator,begin,due,due_date,workspace_id,created,modified,priority,workitem_type_id,category_id,category_name,label,description,version,version_name,release_id,release_name',
  }
  if (detailId) {
    args.id = detailId
    args.limit = 1
    args.page = 1
    return args
  }
  if (filters.keyword?.trim()) {
    const keyword = filters.keyword.trim()
    if (/^\d{10,}$/.test(keyword)) args.id = keyword
    else args.name = keyword
  }
  if (filters.status?.trim()) args.v_status = filters.status.trim()
  if (filters.type?.trim()) args.label = filters.type.trim()
  if (filters.assignee?.trim()) args.owner = filters.assignee.trim()
  return args
}

function applyClientFilters(items: ExternalRequirementItem[], filters: RequirementListFilters): ExternalRequirementItem[] {
  return items.filter(item => {
    if (filters.project && item.project !== filters.project) return false
    if (filters.bindingState === 'bound' && !item.binding) return false
    if (filters.bindingState === 'unbound' && item.binding) return false
    return true
  })
}

function defaultGroupName(item: ExternalRequirementItem): string {
  const title = item.title.length > 80 ? `${item.title.slice(0, 77)}…` : item.title
  return `[TAPD-${item.sourceItemId}] ${title}`
}

function buildRequirementLabels(item: ExternalRequirementItem, groupName: string): string[] {
  const entries = [
    formatLabelEntry('group', groupName),
    formatLabelEntry('source', 'tapd'),
    formatLabelEntry('tapd', item.sourceItemId),
  ]
  if (item.project) entries.push(formatLabelEntry('project', item.project))
  if (item.type) entries.push(formatLabelEntry('type', item.type))
  return entries
}

function sanitizeRequirementFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function getTapdRequirementBaseDir(workspaceRootPath: string, sourceItemId: string): string {
  return join(workspaceRootPath, 'requirements', 'tapd', sanitizeRequirementFileName(sourceItemId))
}

function getTapdRequirementInfoDir(workspaceRootPath: string, sourceItemId: string): string {
  return join(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), 'info')
}

function getTapdRequirementSnapshotPath(workspaceRootPath: string, sourceItemId: string): string {
  return join(workspaceRootPath, 'requirements', 'tapd', `${sanitizeRequirementFileName(sourceItemId)}.md`)
}

function ensureTapdRequirementInfoDir(workspaceRootPath: string, sourceItemId: string): string {
  const infoDir = getTapdRequirementInfoDir(workspaceRootPath, sourceItemId)
  mkdirSync(infoDir, { recursive: true })
  return infoDir
}

function getRequirementInfoFileKind(path: string): RequirementInfoFile['kind'] {
  const ext = extname(path).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.json') return 'json'
  if (['.txt', '.log', '.yaml', '.yml'].includes(ext)) return 'text'
  return 'file'
}

function listRequirementInfoFiles(workspaceRootPath: string, sourceItemId: string): RequirementInfoFile[] {
  const infoDir = ensureTapdRequirementInfoDir(workspaceRootPath, sourceItemId)
  const files: RequirementInfoFile[] = []

  const visit = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      const stats = statSync(absolutePath)
      files.push({
        name: entry.name,
        relativePath,
        path: absolutePath,
        size: stats.size,
        updatedAt: stats.mtimeMs,
        kind: getRequirementInfoFileKind(entry.name),
      })
    }
  }

  visit(infoDir)
  return files.sort((a, b) => {
    const kindScore = (file: RequirementInfoFile) => file.kind === 'markdown' ? 0 : file.kind === 'text' ? 1 : file.kind === 'json' ? 2 : 3
    return kindScore(a) - kindScore(b) || a.relativePath.localeCompare(b.relativePath)
  })
}

function compactValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function formatRequirementSnapshotMarkdown(item: ExternalRequirementItem): string {
  const lines: string[] = []
  lines.push(`# TAPD-${item.sourceItemId}: ${item.title}`)
  lines.push('')
  lines.push('> Workspace-level shared TAPD requirement snapshot. Sessions reference this file through their `tapd::<id>` label. Refreshing the requirement updates this single file for every linked session.')
  lines.push('')
  lines.push('## Metadata')
  lines.push('')
  const metadata: Array<[string, string | undefined]> = [
    ['TAPD ID', item.sourceItemId],
    ['Title', item.title],
    ['Status', item.status],
    ['Type', item.type],
    ['Priority', item.priority],
    ['Project', item.project],
    ['Assignees', item.assignees?.join(', ')],
    ['Category', item.category],
    ['Version', item.version],
    ['Release', item.release],
    ['Begin date', item.beginAt],
    ['Due date', item.dueAt],
    ['Created by', item.creator],
    ['Created', item.createdAt],
    ['Updated', item.updatedAt],
    ['Source URL', item.sourceUrl],
    ['Linked group', item.binding?.groupName],
  ]
  for (const [label, value] of metadata) {
    const compact = compactValue(value)
    if (compact) lines.push(`- ${label}: ${compact}`)
  }

  if (item.summary) {
    lines.push('', '## Summary', '', item.summary.trim())
  }

  if (item.content) {
    lines.push('', '## Description', '', item.content.trim())
  }

  if (item.contentImages?.length) {
    lines.push('', '## Description images', '')
    for (const image of item.contentImages) {
      lines.push(`- ${image.src} → ${image.downloadUrl}`)
    }
  }

  if (item.comments?.length) {
    lines.push('', '## Comments', '')
    for (const comment of item.comments) {
      const timestamp = comment.updatedAt ?? comment.createdAt ?? ''
      lines.push(`### ${comment.author}${timestamp ? ` · ${timestamp}` : ''}`)
      if (comment.title) lines.push('', `**${comment.title}**`)
      lines.push('', comment.body?.trim() || '_No visible content._', '')
    }
  }

  lines.push('', '---', `Snapshot saved at ${new Date().toISOString()}`)
  return `${lines.join('\n')}\n`
}

function writeTapdRequirementSnapshot(workspaceRootPath: string, item: ExternalRequirementItem): string {
  const filePath = getTapdRequirementSnapshotPath(workspaceRootPath, item.sourceItemId)
  mkdirSync(join(workspaceRootPath, 'requirements', 'tapd'), { recursive: true })
  ensureTapdRequirementInfoDir(workspaceRootPath, item.sourceItemId)
  writeFileSync(filePath, formatRequirementSnapshotMarkdown(item), 'utf-8')
  return filePath
}

function upsertBinding(workspaceRootPath: string, input: RequirementBindInput): RequirementBinding {
  const now = Date.now()
  const store = readBindingStore(workspaceRootPath)
  const key = bindingKey(input.pluginId, input.item.sourceItemId)
  const existing = store.bindings[key]
  const binding: RequirementBinding = {
    pluginId: input.pluginId,
    sourceItemId: input.item.sourceItemId,
    groupName: input.groupName.trim() || defaultGroupName(input.item),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    itemSnapshot: input.item,
  }
  store.bindings[key] = binding
  writeBindingStore(workspaceRootPath, store)
  writeTapdRequirementSnapshot(workspaceRootPath, { ...input.item, binding })
  return binding
}

function removeBinding(workspaceRootPath: string, input: RequirementUnlinkInput): boolean {
  const store = readBindingStore(workspaceRootPath)
  const key = bindingKey(input.pluginId, input.sourceItemId)
  const existing = store.bindings[key]
  const existed = Boolean(existing)
  if (existed) {
    delete store.bindings[key]
    writeBindingStore(workspaceRootPath, store)
    if (existing?.itemSnapshot) {
      const item = { ...existing.itemSnapshot }
      delete item.binding
      writeTapdRequirementSnapshot(workspaceRootPath, item)
    }
  }
  return existed
}

export function registerRequirementsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.requirementPlugins.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    const source = getTapdSource(workspace.rootPath)
    return [getTapdPlugin(source)] satisfies RequirementPluginDescriptor[]
  })

  server.handle(RPC_CHANNELS.requirements.LIST_ITEMS, async (_ctx, workspaceId: string, pluginId: string, filters: RequirementListFilters = {}) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (pluginId !== TAPD_PLUGIN_ID) throw new Error(`Unknown requirement plugin: ${pluginId}`)

    const source = getTapdSource(workspace.rootPath)
    if (!source) throw new Error('TAPD source is not configured')
    if (source.config.connectionStatus && source.config.connectionStatus !== 'connected') {
      throw new Error(source.config.connectionError || `TAPD source is ${source.config.connectionStatus}`)
    }

    const args = buildTapdArgs(filters)
    const [listPayload, countPayload] = await Promise.all([
      callTapdTool(source, 'stories_get', args),
      callTapdTool(source, 'stories_count', { ...args, limit: undefined, page: undefined, fields: undefined, order: undefined }).catch(error => {
        log.warn('TAPD stories_count failed:', error)
        return null
      }),
    ])
    const bindings = readBindingStore(workspace.rootPath).bindings
    let items: ExternalRequirementItem[] = extractStoryRows(listPayload).map(row => {
      const item = normalizeTapdStory(row, filters.workspaceId)
      const binding = bindings[bindingKey(pluginId, item.sourceItemId)]
      return binding ? { ...item, binding } : item
    })
    items = applyClientFilters(items, filters)
    const total = extractTotal(countPayload)
    const page = filters.page ?? 1
    const limit = filters.limit ?? 30
    const result: RequirementListResult = {
      items,
      ...(total !== undefined ? { total } : {}),
      page,
      limit,
      hasMore: total !== undefined ? page * limit < total : items.length >= limit,
    }
    return result
  })

  server.handle(RPC_CHANNELS.requirements.GET_ITEM_DETAIL, async (_ctx, workspaceId: string, pluginId: string, sourceItemId: string, filters: RequirementListFilters = {}) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (pluginId !== TAPD_PLUGIN_ID) throw new Error(`Unknown requirement plugin: ${pluginId}`)
    const source = getTapdSource(workspace.rootPath)
    if (!source) throw new Error('TAPD source is not configured')
    const payload = await callTapdTool(source, 'stories_get', buildTapdArgs(filters, sourceItemId))
    const row = extractStoryRows(payload)[0]
    const binding = readBindingStore(workspace.rootPath).bindings[bindingKey(pluginId, sourceItemId)]
    const baseItem = normalizeTapdStory(row ?? { id: sourceItemId }, filters.workspaceId, binding)
    let contentImages: ExternalRequirementItem['contentImages'] = []
    let comments: ExternalRequirementItem['comments'] = []
    if (filters.workspaceId) {
      const [imagePayload, commentsPayload] = await Promise.all([
        storyMayHaveDescImages(row, baseItem.content)
          ? callTapdTool(source, 'get_workitem_desc_images', {
            workspace_id: filters.workspaceId,
            type: 'story',
            id: sourceItemId,
          }).catch(error => {
            log.warn('TAPD get_workitem_desc_images failed:', error)
            return null
          })
          : Promise.resolve(null),
        callTapdTool(source, 'comments_get', {
          workspace_id: filters.workspaceId,
          entry_type: 'stories',
          entry_id: sourceItemId,
          page: 1,
          limit: 50,
        }).catch(error => {
          log.warn('TAPD comments_get failed:', error)
          return null
        }),
      ])
      contentImages = extractDescImages(imagePayload)
      comments = normalizeTapdComments(commentsPayload)
    }
    const item = normalizeTapdStory(row ?? { id: sourceItemId }, filters.workspaceId, binding, contentImages, comments)
    writeTapdRequirementSnapshot(workspace.rootPath, item)
    return { item }
  })

  server.handle(RPC_CHANNELS.requirements.LIST_INFO_FILES, async (_ctx, workspaceId: string, pluginId: string, sourceItemId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (pluginId !== TAPD_PLUGIN_ID) throw new Error(`Unknown requirement plugin: ${pluginId}`)
    return {
      sourceItemId,
      snapshotPath: getTapdRequirementSnapshotPath(workspace.rootPath, sourceItemId),
      infoDirPath: ensureTapdRequirementInfoDir(workspace.rootPath, sourceItemId),
      files: listRequirementInfoFiles(workspace.rootPath, sourceItemId),
    }
  })

  server.handle(RPC_CHANNELS.requirements.CREATE_GROUP_FROM_ITEM, async (_ctx, workspaceId: string, input: RequirementBindInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return upsertBinding(workspace.rootPath, input)
  })

  server.handle(RPC_CHANNELS.requirements.BIND_ITEM_TO_GROUP, async (_ctx, workspaceId: string, input: RequirementBindInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return upsertBinding(workspace.rootPath, input)
  })

  server.handle(RPC_CHANNELS.requirements.UNLINK_ITEM_FROM_GROUP, async (_ctx, workspaceId: string, input: RequirementUnlinkInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return { removed: removeBinding(workspace.rootPath, input) }
  })

  server.handle(RPC_CHANNELS.requirements.CREATE_SESSION_FOR_ITEM, async (_ctx, workspaceId: string, input: RequirementCreateSessionInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const groupName = input.groupName.trim() || defaultGroupName(input.item)
    upsertBinding(workspace.rootPath, { pluginId: input.pluginId, item: input.item, groupName })
    const session = await deps.sessionManager.createSession(workspaceId, {
      name: groupName,
      labels: buildRequirementLabels(input.item, groupName),
      // TAPD-created sessions are work sessions, not read-only exploration sessions.
      // Pin them to Ask so the visible mode and the agent prompt agree even when
      // the workspace default is Explore/safe.
      permissionMode: 'ask',
      // The TAPD requirement snapshot is stored once at workspace scope and the
      // session references it through its tapd::<id> label. Do not enable
      // tapd-mcp-http by default here; the session can read the shared snapshot
      // file instead of carrying TAPD MCP tool schemas/context.
      enabledSourceSlugs: [],
    })
    return { sessionId: session.id, session }
  })
}
