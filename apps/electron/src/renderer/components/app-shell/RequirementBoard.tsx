import * as React from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  FolderOpen,
  Info,
  Loader2,
  Link2,
  Plus,
  RefreshCw,
  Unlink2,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/NavigationContext'
import { addSessionAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { sessionHasGroup } from '@/utils/session-group-filter'
import { isTapdPluginInstalled, TAPD_PLUGIN_ID } from '@/utils/session-requirement-link'
import { useAppShellContext } from '@/context/AppShellContext'
import { formatLabelEntry } from '@craft-agent/shared/labels'
import type {
  ExternalRequirementItem,
  RequirementBinding,
  RequirementComment,
  RequirementInfoFilesResult,
  RequirementListFilters,
  RequirementPluginDescriptor,
} from '../../../shared/types'

const TAPD_CACHE_STORAGE_VERSION = 1
const TAPD_DETAIL_THEME = {
  page: 'bg-background text-foreground',
  panel: 'bg-background',
  subtlePanel: 'bg-foreground/[0.025]',
  hover: '[@media(hover:hover)]:hover:bg-foreground/[0.045]',
  border: 'border-foreground/[0.08]',
  borderSubtle: 'border-foreground/[0.06]',
  title: 'text-foreground',
  body: 'text-foreground/85',
  secondary: 'text-foreground/70',
  weak: 'text-foreground/50',
  disabled: 'text-foreground/35',
  pill: 'bg-foreground/[0.055] text-foreground/70',
  pillStrong: 'bg-foreground/[0.075] text-foreground/85',
  link: 'text-accent',
  danger: 'text-destructive',
  success: 'text-success',
  orange: 'text-info',
} as const

interface RequirementBoardCache {
  version: 1
  itemsById: Record<string, ExternalRequirementItem>
  listOrder: string[]
  lastSyncedAt?: number
  total?: number
}

interface ParsedTapdRequirementLink {
  workspaceId?: string
  sourceItemId: string
}

function parseTapdRequirementLink(value: string): ParsedTapdRequirementLink | null {
  const raw = value.trim()
  if (!raw) return null

  const decoded = (() => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })()
  const workspaceId = decoded.match(/tapd_fe\/(\d{6,})/)?.[1]
    ?? decoded.match(/https?:\/\/[^/]+\/(\d{6,})(?=\/)/)?.[1]
    ?? decoded.match(/#\/(\d{6,})(?=\/)/)?.[1]
    ?? decoded.match(/^\/?(\d{6,})(?=\/)/)?.[1]
    ?? decoded.match(/[?&]workspace_id=(\d{6,})/)?.[1]
  const detailStoryId = decoded.match(/\/story\/detail\/(\d{10,})/)?.[1]
    ?? decoded.match(/\/stories\/view\/(\d{10,})/)?.[1]
  const longNumericIds = decoded.match(/\d{10,}/g) ?? []
  const sourceItemId = detailStoryId ?? longNumericIds.at(-1)

  return sourceItemId ? { ...(workspaceId ? { workspaceId } : {}), sourceItemId } : null
}

function getCacheStorageKey(workspaceId: string | null | undefined) {
  return `requirement-board.${TAPD_PLUGIN_ID}.cache.${workspaceId ?? 'default'}.manual`
}

function emptyCache(): RequirementBoardCache {
  return { version: TAPD_CACHE_STORAGE_VERSION, itemsById: {}, listOrder: [] }
}

function readCache(workspaceId: string | null | undefined): RequirementBoardCache {
  try {
    const raw = window.localStorage.getItem(getCacheStorageKey(workspaceId))
    if (!raw) return emptyCache()
    const parsed = JSON.parse(raw) as Partial<RequirementBoardCache>
    return {
      version: TAPD_CACHE_STORAGE_VERSION,
      itemsById: parsed.itemsById ?? {},
      listOrder: parsed.listOrder ?? [],
      lastSyncedAt: parsed.lastSyncedAt,
      total: parsed.total,
    }
  } catch {
    return emptyCache()
  }
}

function writeCache(workspaceId: string | null | undefined, cache: RequirementBoardCache) {
  try {
    window.localStorage.setItem(getCacheStorageKey(workspaceId), JSON.stringify(cache))
  } catch {
    // Cache is an optimization; ignore storage failures.
  }
}

function upsertCachedItem(workspaceId: string | null | undefined, item: ExternalRequirementItem) {
  const current = readCache(workspaceId)
  const listOrder = current.listOrder.includes(item.sourceItemId) ? current.listOrder : [item.sourceItemId, ...current.listOrder]
  const next: RequirementBoardCache = {
    ...current,
    total: undefined,
    itemsById: { ...current.itemsById, [item.sourceItemId]: item },
    listOrder,
    lastSyncedAt: Date.now(),
  }
  writeCache(workspaceId, next)
  return next
}

function toDetailFilters(workspaceId: string): RequirementListFilters {
  return {
    workspaceId: workspaceId.trim(),
    page: 1,
    limit: 1,
  }
}

function getTapdWorkspaceIdFromItem(item?: ExternalRequirementItem | null) {
  if (!item) return undefined
  const sourceUrlMatch = item.sourceUrl?.match(/tapd_fe\/(\d+)/)
  if (sourceUrlMatch?.[1]) return sourceUrlMatch[1]
  if (item.project && /^\d+$/.test(item.project)) return item.project
  return undefined
}

function defaultGroupName(item: ExternalRequirementItem) {
  const title = item.title.length > 80 ? `${item.title.slice(0, 77)}…` : item.title
  return `[TAPD-${item.sourceItemId}] ${title}`
}

function statusTone(value?: string) {
  const normalized = (value ?? '').toLowerCase()
  if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('完成') || normalized.includes('发布')) return 'bg-success/[0.075] text-success/85'
  if (normalized.includes('reject') || normalized.includes('拒绝')) return 'bg-destructive/[0.075] text-destructive/85'
  if (normalized.includes('progress') || normalized.includes('开发') || normalized.includes('进行')) return 'bg-accent/[0.075] text-accent/85'
  return 'bg-foreground/[0.045] text-foreground/58'
}

function MetaPill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 max-w-full items-center rounded-[6px] px-1.5 text-[10px] font-medium leading-none', className)}>
      <span className="truncate">{children}</span>
    </span>
  )
}

function formatSyncTime(timestamp?: number) {
  if (!timestamp) return 'Not synced yet'
  return `Synced ${new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
}

function getCachedItems(cache: RequirementBoardCache): ExternalRequirementItem[] {
  return cache.listOrder.map(id => cache.itemsById[id]).filter(Boolean)
}

function RequirementCard({ item }: { item: ExternalRequirementItem }) {
  const linked = Boolean(item.binding)
  const assignee = item.assignees?.[0]
  return (
    <button
      type="button"
      onClick={() => navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'requirement', item.sourceItemId))}
      className="group flex min-h-[210px] w-full flex-col rounded-[16px] bg-background px-4 py-4 text-left shadow-minimal ring-1 ring-foreground/[0.07] transition-[transform,box-shadow,background-color] duration-150 ease-out hover:-translate-y-0.5 hover:bg-foreground/[0.012] hover:shadow-tinted active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {item.type && <MetaPill className="bg-foreground/[0.055] text-foreground/70">{item.type}</MetaPill>}
            <MetaPill className={statusTone(item.status)}>{item.status || 'Unknown'}</MetaPill>
          </div>
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 tracking-[-0.012em] text-foreground text-balance">
            {item.title}
          </h3>
        </div>
        <span className={cn('mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full', linked ? 'bg-success/10 text-success' : 'bg-foreground/[0.045] text-muted-foreground')}>
          {linked ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </span>
      </div>

      <div className="mt-3 text-[12px] tabular-nums text-muted-foreground">TAPD-{item.sourceItemId}</div>
      <div className="mt-1 truncate text-[12px] text-muted-foreground">
        {[item.project, assignee].filter(Boolean).join(' · ') || 'No owner context'}
      </div>

      <p className="mt-4 line-clamp-3 flex-1 text-[12px] leading-5 text-foreground/70 text-pretty">
        {item.summary || 'No summary available yet. Open the detail page to refresh the requirement context from TAPD.'}
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-foreground/[0.06] pt-3">
        <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium', linked ? 'bg-success/10 text-success' : 'bg-foreground/[0.04] text-muted-foreground')}>
          {linked ? 'Bound' : 'Not linked'}
        </span>
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-foreground/70 transition-colors group-hover:text-foreground">
          View details <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  )
}

function PluginUnavailableState() {
  return (
    <div className="flex h-full items-center justify-center bg-background p-8">
      <div className="max-w-md rounded-[18px] bg-foreground/[0.025] p-8 text-center ring-1 ring-foreground/[0.06]">
        <Workflow className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-3 text-base font-semibold text-foreground">TAPD plugin is not installed</h2>
        <p className="mt-1 text-sm text-muted-foreground">Install or enable the tapd-mcp-http source to load requirement board data.</p>
        <Button className="mt-4" size="sm" variant="secondary" onClick={() => navigate(routes.view.plugins())}>Back to Plugins</Button>
      </div>
    </div>
  )
}

export function RequirementBoard() {
  const { activeWorkspaceId, enabledSources } = useAppShellContext()
  const tapdInstalled = isTapdPluginInstalled(enabledSources)
  const [plugins, setPlugins] = React.useState<RequirementPluginDescriptor[]>([])
  const [cache, setCache] = React.useState<RequirementBoardCache>(() => readCache(activeWorkspaceId))
  const [error, setError] = React.useState<string | null>(null)
  const [linkInput, setLinkInput] = React.useState('')
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [addingFromLink, setAddingFromLink] = React.useState(false)

  const plugin = plugins.find(item => item.id === TAPD_PLUGIN_ID)
  const connected = plugin?.connectionStatus === 'connected'
  const visibleItems = React.useMemo(() => getCachedItems(cache), [cache])

  React.useEffect(() => {
    setCache(tapdInstalled ? readCache(activeWorkspaceId) : emptyCache())
  }, [activeWorkspaceId, tapdInstalled])

  React.useEffect(() => {
    if (!activeWorkspaceId || !tapdInstalled) return
    let stale = false
    window.electronAPI.listRequirementPlugins(activeWorkspaceId)
      .then(result => {
        if (!stale) {
          setPlugins(result)
          setError(null)
        }
      })
      .catch(err => { if (!stale) setError(err instanceof Error ? err.message : String(err)) })
    return () => { stale = true }
  }, [activeWorkspaceId, tapdInstalled])

  const addRequirementFromLink = React.useCallback(async () => {
    if (!activeWorkspaceId || !tapdInstalled) return
    const parsed = parseTapdRequirementLink(linkInput)
    if (!parsed) {
      setLinkError('Paste a full TAPD requirement link.')
      return
    }
    if (!parsed.workspaceId) {
      setLinkError('Paste the full TAPD link so the workspace_id can be detected.')
      return
    }
    if (!connected) {
      setLinkError(plugin?.connectionError || 'TAPD source is not connected. Test or enable tapd-mcp-http first.')
      return
    }

    setAddingFromLink(true)
    setLinkError(null)
    try {
      const result = await window.electronAPI.getRequirementItemDetail(activeWorkspaceId, TAPD_PLUGIN_ID, parsed.sourceItemId, toDetailFilters(parsed.workspaceId))
      const nextCache = upsertCachedItem(activeWorkspaceId, result.item)
      setCache(nextCache)
      setLinkInput('')
      toast.success('TAPD requirement saved locally')
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingFromLink(false)
    }
  }, [activeWorkspaceId, connected, linkInput, plugin?.connectionError, tapdInstalled])

  if (!tapdInstalled) return <PluginUnavailableState />

  const cachedCount = cache.listOrder.length

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-foreground/[0.06] px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-8 tracking-[-0.022em] text-foreground text-balance">TAPD Requirements</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Paste a TAPD requirement link to fetch it and keep it in the local board cache.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <MetaPill className="bg-foreground/[0.045] text-foreground/70">TAPD</MetaPill>
              <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium', connected ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                {plugin?.connectionStatus ?? 'unknown'}
              </span>
              <span className="tabular-nums">{cachedCount} saved locally</span>
              <span>{formatSyncTime(cache.lastSyncedAt)}</span>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[14px] bg-foreground/[0.025] px-3 py-3 ring-1 ring-foreground/[0.07]">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-background px-3 ring-1 ring-foreground/[0.08] focus-within:ring-accent/40">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Input
                aria-label="TAPD requirement link"
                value={linkInput}
                onChange={event => {
                  setLinkInput(event.target.value)
                  setLinkError(null)
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') void addRequirementFromLink()
                }}
                placeholder="Paste a TAPD story link, for example .../tapd_fe/10045201/story/detail/101..."
                className="h-9 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
              />
            </div>
            <Button size="sm" className="active:scale-[0.98]" onClick={() => void addRequirementFromLink()} disabled={addingFromLink || !linkInput.trim()}>
              {addingFromLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Save locally
            </Button>
          </div>
          <div className={cn('mt-2 text-[12px]', linkError ? 'text-destructive' : 'text-muted-foreground')}>
            {linkError ?? 'No list query or direct filtering. Only requirements imported from full TAPD links are saved here.'}
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-8 py-6">
          {error && (
            <div className="mb-4 rounded-[18px] bg-destructive/10 p-5 text-sm text-destructive ring-1 ring-destructive/15">
              <div className="font-medium">We couldn't load TAPD plugin status.</div>
              <div className="mt-1 text-destructive/80">{error}</div>
            </div>
          )}

          {addingFromLink && cache.listOrder.length === 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-[210px] rounded-[16px] bg-foreground/[0.035] animate-pulse" />)}
            </div>
          )}

          {!addingFromLink && cache.listOrder.length === 0 && (
            <div className="rounded-[18px] bg-foreground/[0.025] p-8 text-center ring-1 ring-foreground/[0.06]">
              <Link2 className="mx-auto h-8 w-8 text-muted-foreground" />
              <h2 className="mt-3 text-base font-semibold text-foreground">No saved requirements yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Paste a TAPD requirement link above. Craft Agent will fetch that single requirement from TAPD and save it locally.</p>
            </div>
          )}

          {visibleItems.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visibleItems.map(item => <RequirementCard key={item.sourceItemId} item={item} />)}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={cn('space-y-2.5 border-t py-4 first:border-t-0 first:pt-0', TAPD_DETAIL_THEME.borderSubtle)}>
      <h2 className={cn('text-[13px] font-semibold tracking-[-0.006em]', TAPD_DETAIL_THEME.title)}>{title}</h2>
      {children}
    </section>
  )
}

function PropertyRow({ label, value, emptyText }: { label: string; value?: React.ReactNode; emptyText?: string }) {
  const isEmpty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className="grid min-h-7 grid-cols-[92px_minmax(0,1fr)] items-center gap-3 py-1.5 text-[13px] leading-5">
      <div className={TAPD_DETAIL_THEME.weak}>{label}</div>
      <div className={cn('min-w-0', TAPD_DETAIL_THEME.secondary, isEmpty && TAPD_DETAIL_THEME.disabled)}>
        {isEmpty ? emptyText ?? 'Not set' : value}
      </div>
    </div>
  )
}

function InlineValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('block truncate', className)}>{children}</span>
}

function formatRequirementDate(value?: string) {
  if (!value) return undefined
  const normalized = value.replace(/-/g, '/').replace(/T/, ' ')
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

function OptionalPropertyRow({ label, value, emptyText }: { label: string; value?: React.ReactNode; emptyText?: string }) {
  if (value === null || value === undefined || value === '') return null
  return <PropertyRow label={label} value={value} emptyText={emptyText} />
}

const TAPD_ALLOWED_HTML_TAGS = new Set([
  'a', 'img', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'code', 'pre', 'blockquote', 'table', 'thead', 'tbody',
  'tr', 'th', 'td', 'hr', 'span', 'div', 'mark', 'markdown',
])

function normalizeTapdImageUrl(value: string) {
  const trimmed = value.trim()
  if (/^http:\/\/(file|oss\.file)\.tapd\.woa\.com\//i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://')
  }
  return trimmed
}

function isSafeTapdUrl(value: string, image = false) {
  const trimmed = image ? normalizeTapdImageUrl(value) : value.trim()
  if (!trimmed) return false
  if (image && trimmed.startsWith('data:image/')) return true
  try {
    const url = new URL(trimmed, window.location.origin)
    return image
      ? url.protocol === 'https:'
      : ['http:', 'https:', 'mailto:'].includes(url.protocol)
  } catch {
    return false
  }
}

function sanitizeTapdHtmlNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return null

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (!TAPD_ALLOWED_HTML_TAGS.has(tag)) {
    const fragment = doc.createDocumentFragment()
    element.childNodes.forEach(child => {
      const sanitized = sanitizeTapdHtmlNode(child, doc)
      if (sanitized) fragment.appendChild(sanitized)
    })
    return fragment
  }

  const next = doc.createElement(tag)
  if (tag === 'a') {
    const href = element.getAttribute('href')
    if (href && isSafeTapdUrl(href)) {
      next.setAttribute('href', href)
      next.setAttribute('rel', 'noreferrer noopener')
    }
    const title = element.getAttribute('title')
    if (title) next.setAttribute('title', title)
  }
  if (tag === 'img') {
    const src = element.getAttribute('src')
    if (src && isSafeTapdUrl(src, true)) next.setAttribute('src', normalizeTapdImageUrl(src))
    const alt = element.getAttribute('alt')
    if (alt) next.setAttribute('alt', alt)
    const title = element.getAttribute('title')
    if (title) next.setAttribute('title', title)
  }
  if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(element.getAttribute('colspan') ?? '')) {
    next.setAttribute('colspan', element.getAttribute('colspan')!)
  }
  if ((tag === 'td' || tag === 'th') && /^\d{1,2}$/.test(element.getAttribute('rowspan') ?? '')) {
    next.setAttribute('rowspan', element.getAttribute('rowspan')!)
  }

  element.childNodes.forEach(child => {
    const sanitized = sanitizeTapdHtmlNode(child, doc)
    if (sanitized) next.appendChild(sanitized)
  })
  return next
}

function sanitizeTapdRequirementHtml(input: string) {
  if (typeof window === 'undefined' || !/<[a-z][\s\S]*>/i.test(input)) return input
  const doc = new DOMParser().parseFromString(input, 'text/html')
  const fragment = doc.createDocumentFragment()
  doc.body.childNodes.forEach(child => {
    const sanitized = sanitizeTapdHtmlNode(child, doc)
    if (sanitized) fragment.appendChild(sanitized)
  })
  const container = doc.createElement('div')
  container.appendChild(fragment)
  return container.innerHTML
}

function enhancePlainRequirementMarkdown(input: string) {
  return input
    .replace(/^\s*([一二三四五六七八九十]+[、.．]\s*[^\n]{2,40})\s*$/gm, '## $1')
    .replace(/^\s*([A-Za-z0-9\u4e00-\u9fa5 /_-]{2,24}[：:])\s*$/gm, '### $1')
}

function escapeTapdRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getTapdImageSourceAliases(src: string) {
  const aliases = new Set<string>([src])
  try {
    const url = new URL(src, 'https://file.tapd.woa.com')
    const nestedSrc = url.searchParams.get('src')
    if (nestedSrc) aliases.add(nestedSrc)
  } catch {
    // Keep the original src only.
  }
  return [...aliases]
}

function replaceTapdImageSources(content: string, images?: ExternalRequirementItem['contentImages']) {
  if (!images?.length) return content
  let next = content
  for (const image of images) {
    const replacement = normalizeTapdImageUrl(image.downloadUrl || image.idcDownloadUrl || '')
    if (!image.src || !replacement) continue
    for (const alias of getTapdImageSourceAliases(image.src)) {
      next = next.replace(new RegExp(escapeTapdRegExp(alias), 'g'), replacement)
    }
  }
  return next
}

function prepareRequirementMarkdown(item: ExternalRequirementItem) {
  const source = replaceTapdImageSources(item.content || item.summary || '', item.contentImages)
  const sanitized = sanitizeTapdRequirementHtml(source)
  return enhancePlainRequirementMarkdown(sanitized).trim()
}

function prepareCommentMarkdown(comment: RequirementComment) {
  const source = replaceTapdImageSources(comment.body || comment.title || '', comment.contentImages)
  const sanitized = sanitizeTapdRequirementHtml(source)
  return sanitized.trim()
}

function TapdRequirementImage({ src, alt, title, onOpenUrl, compact = false }: { src?: string; alt?: string; title?: string; onOpenUrl: (url: string) => void; compact?: boolean }) {
  const [failed, setFailed] = React.useState(false)
  const normalizedSrc = src ? normalizeTapdImageUrl(src) : undefined
  if (!normalizedSrc || failed) {
    return (
      <div className={cn(compact ? 'my-2 max-w-[360px]' : 'my-4 max-w-[720px]', 'rounded-[12px] border px-4 py-3 text-[13px]', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border, TAPD_DETAIL_THEME.weak)}>
        <div className={cn('font-medium', TAPD_DETAIL_THEME.secondary)}>TAPD image unavailable</div>
        {normalizedSrc && (
          <button type="button" className={cn('mt-1 break-all text-left text-[12px]', TAPD_DETAIL_THEME.link)} onClick={() => onOpenUrl(normalizedSrc)}>
            {normalizedSrc}
          </button>
        )}
      </div>
    )
  }
  return (
    <img
      src={normalizedSrc}
      alt={alt ?? ''}
      title={title}
      loading="lazy"
      className={cn(compact ? 'my-2 max-h-[180px] max-w-[min(100%,360px)]' : 'my-4 max-h-[420px] max-w-[min(100%,720px)]', 'block w-auto rounded-[12px] border object-contain', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border)}
      onError={() => setFailed(true)}
    />
  )
}

function TapdMarkdownContent({ content, onOpenUrl, compact = false }: { content: string; onOpenUrl: (url: string) => void; compact?: boolean }) {
  return (
    <div className={cn(compact ? 'text-[13px] leading-6' : 'max-w-[860px] text-[14px] leading-7', 'overflow-x-auto text-pretty', TAPD_DETAIL_THEME.body)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ href, children }) => (
            <button type="button" className={cn('cursor-pointer font-medium underline-offset-2 hover:underline', TAPD_DETAIL_THEME.link)} onClick={() => href && onOpenUrl(href)}>
              {children}
            </button>
          ),
          img: ({ src, alt, title }) => <TapdRequirementImage src={src} alt={alt} title={title} onOpenUrl={onOpenUrl} compact={compact} />,
          p: ({ children }) => <p className={cn(compact ? 'my-1.5 leading-6' : 'my-3 leading-7')}>{children}</p>,
          ul: ({ children }) => <ul className={cn(compact ? 'my-1.5 space-y-1 pl-5' : 'my-3 space-y-1.5 pl-6', 'list-disc')}>{children}</ul>,
          ol: ({ children }) => <ol className={cn(compact ? 'my-1.5 space-y-1 pl-5' : 'my-3 space-y-1.5 pl-6', 'list-decimal')}>{children}</ol>,
          li: ({ children }) => <li className={compact ? 'leading-6' : 'leading-7'}>{children}</li>,
          h2: ({ children }) => <h2 className={cn(compact ? 'mb-1.5 mt-3 text-[13px]' : 'mb-3 mt-7 text-[15px] tracking-[-0.01em]', 'font-semibold', TAPD_DETAIL_THEME.title)}>{children}</h2>,
          h3: ({ children }) => <h3 className={cn(compact ? 'mb-1 mt-2 text-[13px]' : 'mb-2 mt-5 text-[14px]', 'font-semibold', TAPD_DETAIL_THEME.title)}>{children}</h3>,
          code: ({ children, className }) => {
            const isBlock = Boolean(className)
            return isBlock
              ? <code className="text-[12px]">{children}</code>
              : <code className="rounded bg-foreground/[0.06] px-1 py-0.5 text-[12px]">{children}</code>
          },
          pre: ({ children }) => <pre className={cn(compact ? 'my-2' : 'my-4', 'overflow-x-auto rounded-[12px] border p-3', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border)}>{children}</pre>,
          table: ({ children }) => <div className={cn(compact ? 'my-2' : 'my-4', 'overflow-x-auto rounded-[12px] border', TAPD_DETAIL_THEME.border)}><table className="min-w-full text-[13px]">{children}</table></div>,
          th: ({ children }) => <th className={cn('whitespace-nowrap border-b px-3 py-2 text-left font-medium', TAPD_DETAIL_THEME.border)}>{children}</th>,
          td: ({ children }) => <td className={cn('border-b px-3 py-2 align-top', TAPD_DETAIL_THEME.border)}>{children}</td>,
          blockquote: ({ children }) => <blockquote className={cn(compact ? 'my-2' : 'my-3', 'border-l-2 pl-3', TAPD_DETAIL_THEME.border, TAPD_DETAIL_THEME.secondary)}>{children}</blockquote>,
          hr: () => <hr className={cn(compact ? 'my-3' : 'my-5', 'border-0 border-t', TAPD_DETAIL_THEME.border)} />,
          strong: ({ children }) => <strong className={cn('font-semibold', TAPD_DETAIL_THEME.title)}>{children}</strong>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function RequirementContent({ item, onOpenUrl }: { item: ExternalRequirementItem; onOpenUrl: (url: string) => void }) {
  const content = React.useMemo(() => prepareRequirementMarkdown(item), [item])
  if (!content) {
    return (
      <div className={cn('rounded-[14px] px-5 py-4 text-[13px] ring-1 ring-foreground/[0.08]', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.weak)}>
        No description available. Refresh item to pull the latest TAPD details.
      </div>
    )
  }
  return <TapdMarkdownContent content={content} onOpenUrl={onOpenUrl} />
}

function formatRelativeRequirementTime(timestamp?: number) {
  if (!timestamp) return 'No activity'
  const diffMs = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diffMs < minute) return 'just now'
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function parseTapdTimestamp(value?: string) {
  if (!value) return undefined
  const parsed = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(parsed) ? parsed : undefined
}

function avatarTone(name: string) {
  const tones = [
    'bg-[#F97316] text-white',
    'bg-[#2563EB] text-white',
    'bg-[#7C3AED] text-white',
    'bg-[#059669] text-white',
    'bg-[#DB2777] text-white',
    'bg-[#D97706] text-white',
  ]
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return tones[hash % tones.length]
}

function CommentActivityRow({ comment, onOpenUrl }: { comment: RequirementComment; onOpenUrl: (url: string) => void }) {
  const body = React.useMemo(() => prepareCommentMarkdown(comment), [comment])
  const timestamp = parseTapdTimestamp(comment.createdAt)
  const initial = (comment.author.trim()[0] || '?').toUpperCase()
  return (
    <div className={cn('grid grid-cols-[18px_36px_minmax(0,1fr)] gap-3 rounded-[18px] border px-4 py-3.5', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border)}>
      <ChevronRight className={cn('mt-2 h-4 w-4', TAPD_DETAIL_THEME.weak)} />
      <div className={cn('mt-0.5 flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold', avatarTone(comment.author))}>
        {initial}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('text-[14px] font-semibold tracking-[-0.01em]', TAPD_DETAIL_THEME.title)}>{comment.author}</span>
          <span className={cn('text-[13px]', TAPD_DETAIL_THEME.weak)}>{formatRelativeRequirementTime(timestamp)}</span>
        </div>
        {body ? (
          <div className="mt-1">
            <TapdMarkdownContent content={body} onOpenUrl={onOpenUrl} compact />
          </div>
        ) : (
          <div className={cn('mt-1 text-[13px]', TAPD_DETAIL_THEME.weak)}>Comment has no visible content.</div>
        )}
      </div>
    </div>
  )
}

function RequirementActivity({ item, onOpenUrl }: { item: ExternalRequirementItem; onOpenUrl: (url: string) => void }) {
  const comments = item.comments ?? []
  return (
    <section className={cn('mt-10 border-t pt-7', TAPD_DETAIL_THEME.borderSubtle)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn('text-[17px] font-semibold tracking-[-0.015em]', TAPD_DETAIL_THEME.title)}>Activity</h2>
        <span className={cn('text-[12px]', TAPD_DETAIL_THEME.weak)}>{comments.length ? `${comments.length} comment${comments.length > 1 ? 's' : ''}` : 'No comments'}</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {comments.length ? comments.map(comment => <CommentActivityRow key={comment.id} comment={comment} onOpenUrl={onOpenUrl} />) : (
          <div className={cn('rounded-[16px] border px-4 py-3 text-[13px]', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border, TAPD_DETAIL_THEME.weak)}>
            No TAPD comments yet. Refresh item to pull the latest activity.
          </div>
        )}
      </div>
    </section>
  )
}

function formatInfoFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function RequirementInfoFileRow({ file }: { file: RequirementInfoFilesResult['files'][number] }) {
  return (
    <button
      type="button"
      onClick={() => void window.electronAPI.openFile(file.path)}
      className={cn('grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-2 py-2 text-left transition-colors', TAPD_DETAIL_THEME.hover)}
      title={file.path}
    >
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', TAPD_DETAIL_THEME.pill)}>
        <FileText className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px]', TAPD_DETAIL_THEME.secondary)}>{file.relativePath}</span>
        <span className={cn('mt-0.5 block truncate text-[12px]', TAPD_DETAIL_THEME.weak)}>{file.kind} · {formatInfoFileSize(file.size)}</span>
      </span>
      <span className={cn('whitespace-nowrap text-[12px]', TAPD_DETAIL_THEME.weak)}>{formatRelativeRequirementTime(file.updatedAt)}</span>
    </button>
  )
}

function RequirementInfoPopover({
  item,
  infoFiles,
  infoFilesError,
  onRefresh,
}: {
  item: ExternalRequirementItem
  infoFiles: RequirementInfoFilesResult | null
  infoFilesError: string | null
  onRefresh: (options?: { notifyOnError?: boolean }) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <PanelHeaderCenterButton
          icon={<Info className="h-4 w-4" />}
          tooltip={infoFiles?.files.length ? `Requirement info (${infoFiles.files.length})` : 'Requirement info'}
          aria-label="Requirement info"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        className="h-[460px] w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-[8px] bg-background p-0 text-foreground shadow-modal-small"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className={cn('flex items-center justify-between gap-3 border-b px-3 py-2.5', TAPD_DETAIL_THEME.borderSubtle)}>
          <div className="min-w-0">
            <div className={cn('truncate text-[13px] font-medium', TAPD_DETAIL_THEME.title)}>Requirement info</div>
            <div className={cn('mt-0.5 truncate text-[12px]', TAPD_DETAIL_THEME.weak)} title={infoFiles?.infoDirPath}>
              TAPD-{item.sourceItemId}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <PanelHeaderCenterButton
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              tooltip="Refresh info files"
              aria-label="Refresh info files"
              onClick={() => onRefresh({ notifyOnError: true })}
            />
            {infoFiles?.infoDirPath && (
              <PanelHeaderCenterButton
                icon={<FolderOpen className="h-3.5 w-3.5" />}
                tooltip="Open info folder"
                aria-label="Open info folder"
                onClick={() => void window.electronAPI.showInFolder(infoFiles.infoDirPath)}
              />
            )}
          </div>
        </div>
        <div className="h-[calc(460px-57px)] overflow-y-auto px-2 py-2">
          {infoFilesError ? (
            <p className={cn('rounded-[10px] px-3 py-2 text-[12px] leading-5 text-destructive', TAPD_DETAIL_THEME.subtlePanel)}>
              Could not load info files: {infoFilesError}
            </p>
          ) : infoFiles?.files.length ? (
            <div className="space-y-1">
              {infoFiles.files.map(file => <RequirementInfoFileRow key={file.relativePath} file={file} />)}
            </div>
          ) : (
            <p className={cn('rounded-[10px] px-3 py-2 text-[12px] leading-5', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.weak)}>
              Save implementation plans or handoff notes into this TAPD info folder. Any session linked to TAPD-{item.sourceItemId} can read them on the next turn.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RequirementSessionLogRow({ session }: { session: { id: string; name?: string; preview?: string; lastMessageAt?: number } }) {
  const preview = session.preview?.trim() || session.name || 'Session started'
  return (
    <button
      type="button"
      onClick={() => navigate(routes.view.allSessions(session.id))}
      className={cn('grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors', TAPD_DETAIL_THEME.hover)}
    >
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-full', TAPD_DETAIL_THEME.pill)}>
        <Bot className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0">
        <span className={cn('block truncate text-[13px]', TAPD_DETAIL_THEME.secondary)}>{session.name || 'Untitled session'}</span>
        <span className={cn('mt-0.5 block truncate text-[12px]', TAPD_DETAIL_THEME.weak)}>{preview}</span>
      </span>
      <span className={cn('whitespace-nowrap text-[12px]', TAPD_DETAIL_THEME.weak)}>{formatRelativeRequirementTime(session.lastMessageAt)}</span>
    </button>
  )
}

export function RequirementDetailPage({ sourceItemId }: { sourceItemId: string }) {
  const { activeWorkspaceId, onOpenUrl, enabledSources, onSessionLabelsChange, onSessionOptionsChange } = useAppShellContext()
  const { navigateToSession } = useNavigation()
  const tapdInstalled = isTapdPluginInstalled(enabledSources)
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const addSession = useSetAtom(addSessionAtom)
  const [item, setItem] = React.useState<ExternalRequirementItem | null>(() => readCache(activeWorkspaceId).itemsById[sourceItemId] ?? null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [groupName, setGroupName] = React.useState(() => item ? defaultGroupName(item) : '')
  const [editingGroup, setEditingGroup] = React.useState(false)
  const [infoFiles, setInfoFiles] = React.useState<RequirementInfoFilesResult | null>(null)
  const [infoFilesError, setInfoFilesError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const cached = tapdInstalled ? readCache(activeWorkspaceId).itemsById[sourceItemId] : undefined
    setItem(cached ?? null)
    setGroupName(cached ? cached.binding?.groupName ?? defaultGroupName(cached) : '')
  }, [activeWorkspaceId, sourceItemId, tapdInstalled])

  const refreshInfoFiles = React.useCallback(async (options?: { notifyOnError?: boolean }) => {
    if (!activeWorkspaceId || !tapdInstalled) {
      setInfoFiles(null)
      setInfoFilesError(null)
      return
    }
    try {
      const result = await window.electronAPI.listRequirementInfoFiles(activeWorkspaceId, TAPD_PLUGIN_ID, sourceItemId)
      setInfoFiles(result)
      setInfoFilesError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setInfoFilesError(message)
      setInfoFiles(null)
      if (options?.notifyOnError) {
        toast.error('Could not refresh TAPD info files', { description: message })
      }
    }
  }, [activeWorkspaceId, sourceItemId, tapdInstalled])

  React.useEffect(() => {
    void refreshInfoFiles()
  }, [refreshInfoFiles])

  React.useEffect(() => {
    const onFocus = () => { void refreshInfoFiles() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshInfoFiles])

  const groupSessions = React.useMemo(() => {
    if (!item?.binding) return []
    return Array.from(sessionMetaMap.values())
      .filter(meta => {
        if (activeWorkspaceId && meta.workspaceId !== activeWorkspaceId) return false
        return sessionHasGroup(meta, item.binding!.groupName)
      })
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
  }, [activeWorkspaceId, item?.binding, sessionMetaMap])
  const groupSessionCount = groupSessions.length

  const refreshDetail = React.useCallback(async () => {
    if (!activeWorkspaceId || !tapdInstalled) return
    const detailWorkspaceId = getTapdWorkspaceIdFromItem(item)
    if (!detailWorkspaceId) {
      setError('Add this requirement from a full TAPD link first so Craft Agent can detect the TAPD workspace.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.getRequirementItemDetail(activeWorkspaceId, TAPD_PLUGIN_ID, sourceItemId, toDetailFilters(detailWorkspaceId))
      setItem(result.item)
      setGroupName(result.item.binding?.groupName ?? defaultGroupName(result.item))
      upsertCachedItem(activeWorkspaceId, result.item)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, item, sourceItemId, tapdInstalled])

  const applyBinding = React.useCallback((binding: RequirementBinding) => {
    setItem(current => {
      if (!current) return current
      const next = { ...current, binding }
      upsertCachedItem(activeWorkspaceId, next)
      return next
    })
    setGroupName(binding.groupName)
    setEditingGroup(false)
  }, [activeWorkspaceId])

  const renameLinkedGroupSessions = React.useCallback((fromGroupName: string, toGroupName: string) => {
    if (!onSessionLabelsChange || fromGroupName === toGroupName) return
    const previousGroupLabel = formatLabelEntry('group', fromGroupName)
    const nextGroupLabel = formatLabelEntry('group', toGroupName)
    for (const session of groupSessions) {
      const nextLabels = (session.labels ?? []).map(label => label === previousGroupLabel ? nextGroupLabel : label)
      onSessionLabelsChange(session.id, nextLabels)
    }
  }, [groupSessions, onSessionLabelsChange])

  const handleCreateGroup = React.useCallback(async () => {
    if (!activeWorkspaceId || !item) return
    const name = groupName.trim() || defaultGroupName(item)
    const previousGroupName = item.binding?.groupName
    const binding = await window.electronAPI.createRequirementGroupFromItem(activeWorkspaceId, { pluginId: TAPD_PLUGIN_ID, item, groupName: name })
    if (previousGroupName) renameLinkedGroupSessions(previousGroupName, binding.groupName)
    applyBinding(binding)
    toast.success(previousGroupName ? 'Group renamed' : 'Requirement linked', { description: binding.groupName })
  }, [activeWorkspaceId, applyBinding, groupName, item, renameLinkedGroupSessions])

  const handleUnlink = React.useCallback(async () => {
    if (!activeWorkspaceId || !item?.binding) return
    await window.electronAPI.unlinkRequirementItemFromGroup(activeWorkspaceId, { pluginId: TAPD_PLUGIN_ID, sourceItemId: item.sourceItemId })
    const next = { ...item }
    delete next.binding
    setItem(next)
    upsertCachedItem(activeWorkspaceId, next)
    setGroupName(defaultGroupName(next))
    setEditingGroup(false)
    toast.success('Requirement unlinked')
  }, [activeWorkspaceId, item])

  const openGroup = React.useCallback(() => {
    if (!item?.binding || groupSessionCount === 0) return
    window.dispatchEvent(new CustomEvent('craft:open-session-group', { detail: { groupName: item.binding.groupName } }))
    navigate(routes.view.allSessions())
  }, [groupSessionCount, item?.binding])

  const handleCreateSession = React.useCallback(async () => {
    if (!activeWorkspaceId || !item) return
    if (!item.binding) {
      toast.error('Link a Session Group first', { description: 'Create or bind a group before creating a session from this requirement.' })
      return
    }
    const result = await window.electronAPI.createRequirementSessionForItem(activeWorkspaceId, { pluginId: TAPD_PLUGIN_ID, item, groupName: item.binding.groupName })
    // The generic session_created broadcast can arrive slightly after this RPC
    // returns. Add the session to local atoms immediately so navigation's
    // auto-selection validator can find it and the requirement detail sidebar
    // shows the new linked session without a manual refresh.
    addSession(result.session)
    // Keep the mode selector in sync with the authoritative session returned
    // by the backend. Otherwise this direct RPC path falls back to the renderer
    // default ('ask') before the session_created broadcast arrives, which can
    // make the UI and injected <session_state> disagree.
    onSessionOptionsChange(result.sessionId, { permissionMode: result.session.permissionMode ?? 'ask' })
    toast.success('Session created for requirement')
    navigateToSession(result.sessionId)
  }, [activeWorkspaceId, addSession, item, navigateToSession, onSessionOptionsChange])

  if (!tapdInstalled) return <PluginUnavailableState />

  const assigneeText = item?.assignees?.join(', ')
  const createdText = formatRequirementDate(item?.createdAt)
  const updatedText = formatRequirementDate(item?.updatedAt)
  const dueText = formatRequirementDate(item?.dueAt)
  const beginText = formatRequirementDate(item?.beginAt)

  return (
    <div className={cn('flex h-full min-h-0', TAPD_DETAIL_THEME.page)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={cn('shrink-0 border-b px-8 py-3.5', TAPD_DETAIL_THEME.panel, TAPD_DETAIL_THEME.border)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={cn('flex min-w-0 items-center gap-2 text-[13px]', TAPD_DETAIL_THEME.weak)}>
              <button
                type="button"
                onClick={() => navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'board'))}
                className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors', TAPD_DETAIL_THEME.hover, TAPD_DETAIL_THEME.weak)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                TAPD
              </button>
              <span className={TAPD_DETAIL_THEME.disabled}>›</span>
              <span className={cn('truncate', TAPD_DETAIL_THEME.secondary)}>TAPD-{sourceItemId}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {item?.sourceUrl && (
                <Button variant="ghost" size="sm" className={cn('h-7 rounded-[7px] px-2 text-[12px]', TAPD_DETAIL_THEME.secondary)} onClick={() => onOpenUrl(item.sourceUrl!)}>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Open in TAPD
                </Button>
              )}
              <PanelHeaderCenterButton
                icon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                tooltip="Refresh item"
                aria-label="Refresh item"
                onClick={() => void refreshDetail()}
                disabled={loading}
              />
              {item && (
                <RequirementInfoPopover
                  item={item}
                  infoFiles={infoFiles}
                  infoFilesError={infoFilesError}
                  onRefresh={refreshInfoFiles}
                />
              )}
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <main className="mx-auto w-full max-w-[960px] px-8 py-7">
            {error && (
              <div className="mb-6 rounded-[14px] bg-destructive/10 p-4 text-sm text-destructive ring-1 ring-destructive/15">
                <div className="font-medium">We couldn't refresh this requirement.</div>
                <div className="mt-1 text-destructive/80">{error}</div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => void refreshDetail()}>Retry refresh</Button>
                  <Button size="sm" variant="ghost" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'board'))}>Return to board</Button>
                </div>
              </div>
            )}

            {loading && !item && <div className="h-[420px] rounded-[18px] bg-foreground/[0.035] animate-pulse" />}

            {!loading && !item && !error && (
              <div className={cn('rounded-[18px] p-8 text-center ring-1 ring-foreground/[0.08]', TAPD_DETAIL_THEME.subtlePanel)}>
                <h2 className={cn('text-base font-semibold', TAPD_DETAIL_THEME.title)}>Requirement is not cached</h2>
                <p className={cn('mx-auto mt-1 max-w-md text-sm', TAPD_DETAIL_THEME.weak)}>Return to the board and paste the full TAPD link to fetch and save this requirement locally.</p>
                <Button className="mt-4 h-7 rounded-[7px] px-2 text-[12px]" size="sm" variant="secondary" onClick={() => navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'board'))}>Return to board</Button>
              </div>
            )}

            {item && (
              <article className="max-w-[860px] pb-12">
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  {item.type && <MetaPill className={TAPD_DETAIL_THEME.pill}>{item.type}</MetaPill>}
                  {item.status && <MetaPill className={TAPD_DETAIL_THEME.pillStrong}>{item.status}</MetaPill>}
                  {item.priority && <MetaPill className={TAPD_DETAIL_THEME.pill}>{item.priority}</MetaPill>}
                </div>
                <h1 className={cn('max-w-[860px] text-[18px] font-semibold leading-[1.38] tracking-[-0.01em] text-balance', TAPD_DETAIL_THEME.title)}>
                  {item.title}
                </h1>
                <div className={cn('mt-2 flex flex-wrap items-center gap-2 text-[12px]', TAPD_DETAIL_THEME.weak)}>
                  <span className="tabular-nums">TAPD-{item.sourceItemId}</span>
                  {item.project && <><span className={TAPD_DETAIL_THEME.disabled}>·</span><span>{item.project}</span></>}
                  {updatedText && <><span className={TAPD_DETAIL_THEME.disabled}>·</span><span>Updated {updatedText}</span></>}
                </div>

                <div className={cn('mt-7 border-t pt-6', TAPD_DETAIL_THEME.borderSubtle)}>
                  <h2 className="sr-only">Requirement content</h2>
                  <RequirementContent item={item} onOpenUrl={onOpenUrl} />
                  <RequirementActivity item={item} onOpenUrl={onOpenUrl} />
                </div>
              </article>
            )}
          </main>
        </ScrollArea>
      </div>

      <aside className={cn('hidden h-full min-h-0 w-[340px] shrink-0 overflow-y-auto overscroll-contain border-l px-5 py-6 lg:block', TAPD_DETAIL_THEME.panel, TAPD_DETAIL_THEME.border)}>
        {item ? (
          <div className="space-y-1">
            <DetailSection title="Properties">
              <PropertyRow label="Status" value={item.status ? <InlineValue>{item.status}</InlineValue> : undefined} emptyText="No status" />
              <PropertyRow label="Priority" value={item.priority ? <InlineValue>{item.priority}</InlineValue> : undefined} emptyText="No priority" />
              <PropertyRow label="Assignee" value={assigneeText ? <InlineValue>{assigneeText}</InlineValue> : undefined} emptyText="Unassigned" />
              <PropertyRow label="Due date" value={dueText} emptyText="No due date" />
              <PropertyRow label="Project" value={item.project ? <InlineValue>{item.project}</InlineValue> : undefined} emptyText="No project" />
              <PropertyRow label="Type" value={item.type ? <InlineValue>{item.type}</InlineValue> : undefined} emptyText="No type" />
              <OptionalPropertyRow label="Category" value={item.category ? <InlineValue>{item.category}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Version" value={item.version ? <InlineValue>{item.version}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Release" value={item.release ? <InlineValue>{item.release}</InlineValue> : undefined} />
            </DetailSection>

            <DetailSection title="Craft linkage">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className={cn('text-[12px]', TAPD_DETAIL_THEME.weak)}>Group</div>
                    <div className={cn('mt-1 truncate text-[13px] font-medium', item.binding ? TAPD_DETAIL_THEME.secondary : TAPD_DETAIL_THEME.disabled)}>
                      {item.binding ? item.binding.groupName : 'No group linked'}
                    </div>
                  </div>
                  {item.binding ? (
                    <Button size="sm" variant="ghost" className={cn('h-7 rounded-[7px] px-2 text-[12px]', TAPD_DETAIL_THEME.secondary)} onClick={() => setEditingGroup(value => !value)}>Rename</Button>
                  ) : (
                    <Button size="sm" variant="secondary" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => setEditingGroup(true)}>New group</Button>
                  )}
                </div>

                {editingGroup && (
                  <div className={cn('space-y-2 rounded-[10px] border px-3 py-3', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.borderSubtle)}>
                    <div className={cn('text-[12px] font-medium', TAPD_DETAIL_THEME.weak)}>{item.binding ? 'Rename group' : 'New group name'}</div>
                    <Input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Group name" className="h-8 rounded-[8px] text-[13px]" />
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={handleCreateGroup} disabled={!groupName.trim()}>
                        {item.binding ? 'Save name' : 'Create group'}
                      </Button>
                      <Button size="sm" variant="ghost" className={cn('h-7 rounded-[7px] px-2 text-[12px]', TAPD_DETAIL_THEME.weak)} onClick={() => setEditingGroup(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {item.binding && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={openGroup}
                        disabled={groupSessionCount === 0}
                        className={cn('text-[13px] font-medium disabled:cursor-default', groupSessionCount > 0 ? TAPD_DETAIL_THEME.secondary : TAPD_DETAIL_THEME.disabled)}
                      >
                        Sessions ({groupSessionCount})
                      </button>
                      <Button size="sm" variant="secondary" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={handleCreateSession}>New session</Button>
                    </div>

                    {groupSessionCount > 0 ? (
                      <div className="space-y-1">
                        {groupSessions.slice(0, 3).map(session => <RequirementSessionLogRow key={session.id} session={session} />)}
                      </div>
                    ) : (
                      <p className={cn('rounded-[10px] px-3 py-2 text-[12px] leading-5', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.weak)}>
                        No sessions yet. Create one to start working from this requirement.
                      </p>
                    )}

                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" className={cn('h-7 rounded-[7px] px-2 text-[12px]', TAPD_DETAIL_THEME.weak)} onClick={handleUnlink}>
                        <Unlink2 className="h-3.5 w-3.5" />
                        Unlink
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </DetailSection>


            <DetailSection title="TAPD details">
              <PropertyRow label="Created by" value={item.creator ? <InlineValue>{item.creator}</InlineValue> : undefined} emptyText="Unknown" />
              <PropertyRow label="Created" value={createdText} emptyText="Unknown" />
              <PropertyRow label="Updated" value={updatedText} emptyText="Unknown" />
              <PropertyRow label="Begin date" value={beginText} emptyText="No begin date" />
              <PropertyRow label="Source ID" value={<InlineValue>{item.sourceItemId}</InlineValue>} />
              <PropertyRow label="Workspace" value={getTapdWorkspaceIdFromItem(item) ? <InlineValue>{getTapdWorkspaceIdFromItem(item)}</InlineValue> : undefined} emptyText="Unknown" />
              {item.sourceUrl && (
                <div className="pt-2">
                  <Button className="h-7 w-full justify-start rounded-[7px] px-2 text-[12px]" variant="ghost" size="sm" onClick={() => onOpenUrl(item.sourceUrl!)}>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Open in TAPD
                  </Button>
                </div>
              )}
            </DetailSection>
          </div>
        ) : (
          <div className={cn('text-[13px]', TAPD_DETAIL_THEME.weak)}>Refresh the item to load TAPD properties.</div>
        )}
      </aside>
    </div>
  )
}
