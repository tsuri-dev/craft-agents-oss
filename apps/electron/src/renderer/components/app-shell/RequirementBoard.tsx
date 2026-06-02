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
  Columns3,
  Filter,
  Link2,
  List,
  Loader2,
  MoreHorizontal,
  Pin,
  Plus,
  RefreshCw,
  Square,
  Workflow,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DocumentFormattedMarkdownOverlay, Spinner } from '@craft-agent/ui'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { WorkingDirectoryBadge } from './input/FreeFormInput'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import { InfoPopoverShell, InfoPopoverTriggerButton } from './SessionInfoPopover'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useNavigation } from '@/contexts/NavigationContext'
import { addSessionAtom, sessionMetaMapAtom } from '@/atoms/sessions'
import { sessionHasGroup } from '@/utils/session-group-filter'
import { TAPD_PLUGIN_ID } from '@/utils/session-requirement-link'
import {
  defaultTapdGroupName,
  emptyTapdRequirementCache,
  addTapdRequirementAgentId,
  buildTapdAgentInstructionPrompt,
  readTapdRequirementAgentSelection,
  readTapdRequirementCache,
  readTapdRequirementWorkContext,
  resolveTapdRequirementAgents,
  suggestTapdGroupName,
  upsertTapdCachedItem,
  writeTapdRequirementCache,
  writeTapdRequirementWorkContext,
  type TapdRequirementCache,
  type TapdRequirementWorkContext,
} from '@/utils/tapd-requirement-helpers'
import { useAppShellContext } from '@/context/AppShellContext'
import { formatLabelEntry } from '@craft-agent/shared/labels'
import { hasAgentTaskLabel } from '@craft-agent/shared/agent-runs'
import { formatTokenCount, getSessionUsageTotals } from '@/utils/session-usage'
import type {
  ExternalRequirementItem,
  RequirementBinding,
  RequirementComment,
  RequirementInfoFilesResult,
  RequirementListFilters,
  SessionFile,
  RequirementPluginDescriptor,
  AgentProfile,
  AgentRun,
} from '../../../shared/types'

const DIALOG_SELECT_CONTENT_STYLE: React.CSSProperties = { zIndex: 'calc(var(--z-modal, 200) + 1)' }
const ACTIVE_AGENT_RUN_STATUSES = new Set<AgentRun['status']>(['queued', 'running', 'stopping'])
const TRIGGER_MASK_STYLE: React.CSSProperties = {
  maskImage: 'linear-gradient(to right, black calc(100% - 12px), transparent)',
  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 12px), transparent)',
}
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

const emptyCache = emptyTapdRequirementCache
const readCache = readTapdRequirementCache
const writeCache = writeTapdRequirementCache
const upsertCachedItem = upsertTapdCachedItem
const defaultGroupName = defaultTapdGroupName

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

function withoutRequirementBinding(item: ExternalRequirementItem): ExternalRequirementItem {
  const { binding: _binding, ...snapshot } = item
  return snapshot
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

function getCachedItems(cache: TapdRequirementCache): ExternalRequirementItem[] {
  return cache.listOrder.map(id => cache.itemsById[id]).filter(Boolean)
}

type TapdPluginViewMode = 'list' | 'board'

type TapdFilterKind = 'status' | 'priority' | 'creator'

type TapdHomeFilters = Record<TapdFilterKind, string[]>

const EMPTY_TAPD_HOME_FILTERS: TapdHomeFilters = { status: [], priority: [], creator: [] }

interface TapdOpenRequirementTab {
  sourceItemId: string
  pinned?: boolean
}

interface TapdHomeUiState {
  viewMode?: TapdPluginViewMode
  /** @deprecated legacy single status filter. Migrated into filters.status. */
  statusFilter?: string
  filters?: TapdHomeFilters
  collapsedStatuses?: string[]
  expandedDefaultCollapsedStatuses?: string[]
  tabs?: TapdOpenRequirementTab[]
}

const TAPD_HOME_TAB_ID = 'tapd-home'
const TAPD_HOME_STATUS = 'Backlog'
const TAPD_UI_STORAGE_VERSION = 1
const TAPD_STATUS_ORDER = ['in progress', '开发中', '进行中', 'todo', 'backlog', 'in review', 'blocked', 'done', '已上线']
const TAPD_HOME_CACHE_TTL_MS = 30 * 60 * 1000
const TAPD_SYNC_PAGE_LIMIT = 100
const TAPD_SYNC_MAX_PAGES = 50

function tapdUiStorageKey(workspaceId?: string | null) {
  return `craft.tapd-plugin.ui.${workspaceId ?? 'default'}.v${TAPD_UI_STORAGE_VERSION}`
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

function normalizeTapdHomeFilters(value: unknown, legacyStatusFilter?: string): TapdHomeFilters {
  const record = value && typeof value === 'object' ? value as Partial<Record<TapdFilterKind, unknown>> : {}
  const status = normalizeStringArray(record.status)
  const legacyStatus = legacyStatusFilter && legacyStatusFilter !== 'all' ? [legacyStatusFilter] : []
  return {
    status: status.length > 0 ? status : legacyStatus,
    priority: normalizeStringArray(record.priority),
    creator: normalizeStringArray(record.creator),
  }
}

function readTapdHomeUiState(workspaceId?: string | null): TapdHomeUiState {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(tapdUiStorageKey(workspaceId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as TapdHomeUiState
    const legacyStatusFilter = typeof parsed.statusFilter === 'string' ? parsed.statusFilter : undefined
    return {
      viewMode: parsed.viewMode === 'list' || parsed.viewMode === 'board' ? parsed.viewMode : undefined,
      statusFilter: legacyStatusFilter,
      filters: normalizeTapdHomeFilters(parsed.filters, legacyStatusFilter),
      collapsedStatuses: normalizeStringArray(parsed.collapsedStatuses),
      expandedDefaultCollapsedStatuses: normalizeStringArray(parsed.expandedDefaultCollapsedStatuses),
      tabs: Array.isArray(parsed.tabs)
        ? parsed.tabs
          .filter(tab => typeof tab?.sourceItemId === 'string' && tab.sourceItemId.trim())
          .map(tab => ({ sourceItemId: tab.sourceItemId.trim(), pinned: Boolean(tab.pinned) }))
        : undefined,
    }
  } catch {
    return {}
  }
}

function writeTapdHomeUiState(workspaceId: string | null | undefined, patch: TapdHomeUiState) {
  if (typeof window === 'undefined') return
  const current = readTapdHomeUiState(workspaceId)
  const next: TapdHomeUiState = { ...current, ...patch }
  window.localStorage.setItem(tapdUiStorageKey(workspaceId), JSON.stringify(next))
}

function getRequirementTabTitle(item?: ExternalRequirementItem | null, sourceItemId?: string) {
  const raw = item?.title?.trim()
  if (raw) return raw.length > 34 ? `${raw.slice(0, 32)}…` : raw
  return sourceItemId ? `TAPD-${sourceItemId}` : 'Requirement'
}

function getRequirementShortId(item: Pick<ExternalRequirementItem, 'sourceItemId'>) {
  const id = item.sourceItemId || ''
  return id.length > 8 ? id.slice(-8) : id
}

function getIssueStatusLabel(item: ExternalRequirementItem) {
  return item.status?.trim() || TAPD_HOME_STATUS
}

function normalizeIssueStatus(status: string) {
  return status.trim().toLowerCase()
}

function isInProgressStatus(status: string) {
  const normalized = normalizeIssueStatus(status)
  return normalized.includes('progress') || normalized.includes('开发中') || normalized.includes('进行中') || normalized === '开发'
}

function isLaunchedStatus(status?: string) {
  const normalized = normalizeIssueStatus(status ?? '')
  return normalized.includes('已上线') || normalized === '上线' || normalized.includes('online')
}

function isDefaultCollapsedStatus(status: string) {
  return isLaunchedStatus(status)
}

function getStatusRank(status: string) {
  const normalized = normalizeIssueStatus(status)
  if (isInProgressStatus(status)) return 0
  const exact = TAPD_STATUS_ORDER.indexOf(normalized)
  if (exact >= 0) return exact + 1
  if (normalized.includes('todo') || normalized.includes('待')) return 2
  if (normalized.includes('backlog')) return 3
  if (normalized.includes('review') || normalized.includes('验收') || normalized.includes('评审')) return 4
  if (normalized.includes('block') || normalized.includes('阻塞')) return 5
  if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('完成') || normalized.includes('发布') || isLaunchedStatus(status)) return 6
  return 20
}

function sortStatusLabels(statuses: string[]) {
  return [...statuses].sort((a, b) => {
    const rank = getStatusRank(a) - getStatusRank(b)
    if (rank !== 0) return rank
    return a.localeCompare(b)
  })
}

function getStatusPresentation(status: string) {
  const normalized = normalizeIssueStatus(status)
  if (normalized.includes('done') || normalized.includes('closed') || normalized.includes('完成') || normalized.includes('发布')) {
    return { dot: 'border-success bg-success', ring: 'ring-success/20', column: 'bg-success/[0.045]', text: 'text-success/90' }
  }
  if (normalized.includes('block') || normalized.includes('拒绝') || normalized.includes('reject') || normalized.includes('阻塞')) {
    return { dot: 'border-destructive bg-destructive', ring: 'ring-destructive/20', column: 'bg-destructive/[0.035]', text: 'text-destructive/90' }
  }
  if (normalized.includes('review') || normalized.includes('验收') || normalized.includes('评审')) {
    return { dot: 'border-success bg-transparent', ring: 'ring-success/20', column: 'bg-success/[0.035]', text: 'text-success/90' }
  }
  if (normalized.includes('progress') || normalized.includes('开发') || normalized.includes('进行')) {
    return { dot: 'border-warning bg-transparent', ring: 'ring-warning/20', column: 'bg-warning/[0.045]', text: 'text-warning/90' }
  }
  if (normalized.includes('todo') || normalized.includes('待')) {
    return { dot: 'border-muted-foreground bg-transparent', ring: 'ring-foreground/[0.08]', column: 'bg-foreground/[0.025]', text: 'text-foreground' }
  }
  return { dot: 'border-muted-foreground/70 bg-transparent border-dotted', ring: 'ring-foreground/[0.08]', column: 'bg-foreground/[0.025]', text: 'text-foreground' }
}

function getUniqueSortedValues(values: Array<string | undefined>): string[] {
  const unique = Array.from(new Set(values.map(value => value?.trim()).filter((value): value is string => Boolean(value))))
  return unique.sort((a, b) => a.localeCompare(b))
}

function hasActiveTapdFilters(filters: TapdHomeFilters) {
  return filters.status.length > 0 || filters.priority.length > 0 || filters.creator.length > 0
}

function applyTapdHomeFilters(items: ExternalRequirementItem[], filters: TapdHomeFilters) {
  return items.filter(item => {
    if (filters.status.length > 0 && !filters.status.includes(getIssueStatusLabel(item))) return false
    if (filters.priority.length > 0 && !filters.priority.includes(item.priority?.trim() || 'No priority')) return false
    if (filters.creator.length > 0 && !filters.creator.includes(item.creator?.trim() || 'No creator')) return false
    return true
  })
}

function groupRequirementsByStatus(items: ExternalRequirementItem[], statuses: string[]) {
  return statuses.map(status => ({
    status,
    items: items.filter(item => getIssueStatusLabel(item) === status),
  }))
}

function RequirementTabStrip({
  tabs,
  activeTabId,
  itemsById,
  onActivateHome,
  onActivateRequirement,
  onCloseRequirement,
  onTogglePinned,
}: {
  tabs: TapdOpenRequirementTab[]
  activeTabId: string
  itemsById: Record<string, ExternalRequirementItem>
  onActivateHome: () => void
  onActivateRequirement: (sourceItemId: string) => void
  onCloseRequirement: (sourceItemId: string) => void
  onTogglePinned: (sourceItemId: string) => void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-foreground/[0.06] bg-foreground/[0.025] px-3">
      <button
        type="button"
        onClick={onActivateHome}
        className={cn(
          'group flex h-9 min-w-[190px] max-w-[240px] items-center gap-2 rounded-[10px] px-3 text-left text-[13px] font-medium transition-colors',
          activeTabId === TAPD_HOME_TAB_ID ? 'bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]' : 'text-foreground/70 hover:bg-background/70 hover:text-foreground',
        )}
      >
        <Pin className="h-3.5 w-3.5 shrink-0 text-foreground/70" />
        <span className="truncate">Tapd</span>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map(tab => {
          const item = itemsById[tab.sourceItemId]
          const active = activeTabId === tab.sourceItemId
          return (
            <button
              key={tab.sourceItemId}
              type="button"
              onClick={() => onActivateRequirement(tab.sourceItemId)}
              className={cn(
                'group flex h-9 min-w-[160px] max-w-[260px] items-center gap-2 rounded-[10px] px-2.5 text-left text-[13px] transition-colors',
                active ? 'bg-background text-foreground shadow-sm ring-1 ring-foreground/[0.06]' : 'text-foreground/65 hover:bg-background/70 hover:text-foreground',
                tab.pinned && 'min-w-[120px]',
              )}
              title={item?.title ?? `TAPD-${tab.sourceItemId}`}
            >
              {tab.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-accent" /> : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/35" />}
              <span className="min-w-0 flex-1 truncate">{getRequirementTabTitle(item, tab.sourceItemId)}</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/70 xl:inline">{getRequirementShortId(item ?? { sourceItemId: tab.sourceItemId } as ExternalRequirementItem)}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onTogglePinned(tab.sourceItemId)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    onTogglePinned(tab.sourceItemId)
                  }
                }}
                className={cn('rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100', tab.pinned && 'opacity-100 text-accent')}
                aria-label={tab.pinned ? 'Unpin tab' : 'Pin tab'}
                title={tab.pinned ? 'Unpin tab' : 'Pin tab'}
              >
                <Pin className="h-3 w-3" />
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onCloseRequirement(tab.sourceItemId)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    onCloseRequirement(tab.sourceItemId)
                  }
                }}
                className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/[0.06] hover:text-foreground group-hover:opacity-100"
                aria-label="Close tab"
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function IssueStatusDot({ status }: { status: string }) {
  const presentation = getStatusPresentation(status)
  return <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full border-2', presentation.dot)} />
}

function IssueRow({ item, onOpen }: { item: ExternalRequirementItem; onOpen: (item: ExternalRequirementItem) => void }) {
  const assignee = item.assignees?.[0]
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group grid w-full grid-cols-[22px_minmax(86px,120px)_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] px-4 py-3 text-left transition-colors hover:bg-foreground/[0.035]"
    >
      <span className="text-center text-muted-foreground">—</span>
      <span className="font-mono text-[13px] text-muted-foreground tabular-nums">TAPD-{getRequirementShortId(item)}</span>
      <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{item.title}</span>
      <span className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        {item.priority && <MetaPill className="bg-foreground/[0.045] text-foreground/60">{item.priority}</MetaPill>}
        {item.binding && <MetaPill className="bg-success/10 text-success">Bound</MetaPill>}
        {assignee && <span className="hidden max-w-[120px] truncate sm:inline">{assignee}</span>}
        <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
    </button>
  )
}

function IssueListSection({ status, items, collapsed, onToggleCollapsed, onOpen }: { status: string; items: ExternalRequirementItem[]; collapsed: boolean; onToggleCollapsed: (status: string) => void; onOpen: (item: ExternalRequirementItem) => void }) {
  return (
    <section className="rounded-[14px]">
      <button
        type="button"
        onClick={() => onToggleCollapsed(status)}
        className="flex h-11 w-full items-center gap-3 rounded-[12px] bg-foreground/[0.025] px-4 text-left ring-1 ring-foreground/[0.035] transition-colors hover:bg-foreground/[0.04]"
      >
        <span className="h-4 w-4 rounded-[4px] border border-foreground/35" />
        <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
        <IssueStatusDot status={status} />
        <span className="font-semibold text-foreground">{status}</span>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">{items.length}</span>
      </button>
      {!collapsed && (items.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-[14px] text-muted-foreground">No issues</div>
      ) : (
        <div className="py-2">
          {items.map(item => <IssueRow key={item.sourceItemId} item={item} onOpen={onOpen} />)}
        </div>
      ))}
    </section>
  )
}

function BoardIssueCard({ item, onOpen }: { item: ExternalRequirementItem; onOpen: (item: ExternalRequirementItem) => void }) {
  const assignee = item.assignees?.[0]
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group w-full rounded-[14px] bg-background p-4 text-left shadow-sm ring-1 ring-foreground/[0.08] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span>—</span>
        <span className="font-mono tabular-nums">TAPD-{getRequirementShortId(item)}</span>
      </div>
      <h3 className="mt-3 line-clamp-2 text-[15px] font-semibold leading-5 text-foreground">{item.title}</h3>
      {item.summary && <p className="mt-2 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{item.summary}</p>}
      <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
        {assignee && <span className="truncate">{assignee}</span>}
        {item.binding && <MetaPill className="bg-success/10 text-success">Bound</MetaPill>}
        {item.priority && <MetaPill className="bg-foreground/[0.045] text-foreground/60">{item.priority}</MetaPill>}
      </div>
    </button>
  )
}

function IssueBoardColumn({ status, items, collapsed, onToggleCollapsed, onOpen }: { status: string; items: ExternalRequirementItem[]; collapsed: boolean; onToggleCollapsed: (status: string) => void; onOpen: (item: ExternalRequirementItem) => void }) {
  const presentation = getStatusPresentation(status)
  return (
    <section className={cn('flex h-full min-h-[520px] shrink-0 flex-col rounded-[18px] p-4 transition-[width]', collapsed ? 'w-[220px]' : 'w-[310px]', presentation.column)}>
      <div className="mb-4 flex h-7 items-center gap-2 px-1">
        <button type="button" onClick={() => onToggleCollapsed(status)} className="rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground" aria-label={collapsed ? 'Expand column' : 'Collapse column'}>
          <ChevronRight className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-90')} />
        </button>
        <IssueStatusDot status={status} />
        <span className={cn('truncate font-semibold', presentation.text)}>{status}</span>
        <span className="font-mono text-sm text-muted-foreground tabular-nums">{items.length}</span>
        <button type="button" className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground" aria-label="Column menu">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>
      {!collapsed && (items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[14px] text-muted-foreground">No issues</div>
      ) : (
        <div className="space-y-3">
          {items.map(item => <BoardIssueCard key={item.sourceItemId} item={item} onOpen={onOpen} />)}
        </div>
      ))}
    </section>
  )
}

function TapdFilterSubMenu({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string
  values: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="h-9 text-[14px]">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected.length > 0 && <span className="ml-auto mr-1 font-mono text-xs text-muted-foreground tabular-nums">{selected.length}</span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[220px]">
        {values.length === 0 ? (
          <DropdownMenuItem disabled className="text-muted-foreground">No values</DropdownMenuItem>
        ) : values.map(value => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.includes(value)}
            onCheckedChange={() => onToggle(value)}
            onSelect={event => event.preventDefault()}
            className="h-8 text-[13px]"
          >
            <span className="min-w-0 flex-1 truncate">{value}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function TapdFilterMenu({
  filters,
  statusOptions,
  priorityOptions,
  creatorOptions,
  onToggle,
  onReset,
}: {
  filters: TapdHomeFilters
  statusOptions: string[]
  priorityOptions: string[]
  creatorOptions: string[]
  onToggle: (kind: TapdFilterKind, value: string) => void
  onReset: () => void
}) {
  const active = hasActiveTapdFilters(filters)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn('relative h-9 w-9 rounded-[10px] text-muted-foreground ring-1 ring-foreground/[0.08] transition-colors hover:bg-foreground/[0.035] hover:text-foreground', active && 'bg-foreground/[0.055] text-foreground')}
          title="Filter"
          aria-label="Filter"
        >
          <Filter className="mx-auto h-4 w-4" />
          {active && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-success ring-2 ring-background" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px] p-1">
        <DropdownMenuLabel className="px-2 py-1.5 text-[12px] text-muted-foreground">Filter</DropdownMenuLabel>
        <TapdFilterSubMenu label="Status" values={statusOptions} selected={filters.status} onToggle={value => onToggle('status', value)} />
        <TapdFilterSubMenu label="Priority" values={priorityOptions} selected={filters.priority} onToggle={value => onToggle('priority', value)} />
        <TapdFilterSubMenu label="Creator" values={creatorOptions} selected={filters.creator} onToggle={value => onToggle('creator', value)} />
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onSelect={onReset} className="h-8 text-[13px]">Reset all filters</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

function TapdLinkImportDialog({
  open,
  onOpenChange,
  linkInput,
  onLinkInputChange,
  linkError,
  addingFromLink,
  connected,
  connectionError,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  linkInput: string
  onLinkInputChange: (value: string) => void
  linkError: string | null
  addingFromLink: boolean
  connected: boolean
  connectionError?: string
  onSubmit: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add TAPD requirement</DialogTitle>
          <DialogDescription>Paste a full TAPD requirement link. Craft Agent will fetch and save that requirement locally.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <div className="flex items-center gap-2 rounded-[10px] border border-foreground/[0.08] bg-background px-3 focus-within:ring-2 focus-within:ring-accent/30">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              aria-label="TAPD requirement link"
              autoFocus
              value={linkInput}
              onChange={event => onLinkInputChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') onSubmit()
              }}
              placeholder="https://www.tapd.cn/.../tapd_fe/.../story/detail/..."
              className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
          {!connected && <p className="text-[12px] text-warning">{connectionError || 'TAPD source is not connected.'}</p>}
          {linkError && <p className="text-[12px] text-destructive">{linkError}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={addingFromLink}>Cancel</Button>
          <Button onClick={onSubmit} disabled={addingFromLink || !linkInput.trim()}>
            {addingFromLink ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add requirement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RequirementBoard({ initialSourceItemId }: { initialSourceItemId?: string }) {
  const { activeWorkspaceId } = useAppShellContext()
  // TAPD Requirements is a built-in plugin view. A live tapd-mcp-http source is
  // only required for importing/refreshing from TAPD; synced local cache should
  // remain visible even when the source is absent or disconnected in this workspace.
  const tapdInstalled = true
  const [plugins, setPlugins] = React.useState<RequirementPluginDescriptor[]>([])
  const [cache, setCache] = React.useState<TapdRequirementCache>(() => readCache(activeWorkspaceId))
  const [error, setError] = React.useState<string | null>(null)
  const [linkInput, setLinkInput] = React.useState('')
  const [linkError, setLinkError] = React.useState<string | null>(null)
  const [addingFromLink, setAddingFromLink] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const initialUiState = React.useMemo(() => readTapdHomeUiState(activeWorkspaceId), [activeWorkspaceId])
  const [viewMode, setViewMode] = React.useState<TapdPluginViewMode>(() => initialUiState.viewMode ?? 'list')
  const [filters, setFilters] = React.useState<TapdHomeFilters>(() => initialUiState.filters ?? EMPTY_TAPD_HOME_FILTERS)
  const [collapsedStatuses, setCollapsedStatuses] = React.useState<Set<string>>(() => new Set(initialUiState.collapsedStatuses ?? []))
  const [expandedDefaultCollapsedStatuses, setExpandedDefaultCollapsedStatuses] = React.useState<Set<string>>(() => new Set(initialUiState.expandedDefaultCollapsedStatuses ?? []))
  const [syncingHome, setSyncingHome] = React.useState(false)
  const [openTabs, setOpenTabs] = React.useState<TapdOpenRequirementTab[]>(() => initialUiState.tabs ?? [])
  const [activeTabId, setActiveTabId] = React.useState(initialSourceItemId ?? TAPD_HOME_TAB_ID)

  const plugin = plugins.find(item => item.id === TAPD_PLUGIN_ID)
  const connected = plugin?.connectionStatus === 'connected'
  const allItems = React.useMemo(() => getCachedItems(cache), [cache])
  const tapdWorkspaceId = React.useMemo(() => allItems.map(getTapdWorkspaceIdFromItem).find((value): value is string => Boolean(value)), [allItems])
  const statusLabels = React.useMemo(() => sortStatusLabels(Array.from(new Set(allItems.map(getIssueStatusLabel)))), [allItems])
  const priorityOptions = React.useMemo(() => getUniqueSortedValues(allItems.map(item => item.priority ?? 'No priority')), [allItems])
  const creatorOptions = React.useMemo(() => getUniqueSortedValues(allItems.map(item => item.creator ?? 'No creator')), [allItems])
  const visibleItems = React.useMemo(() => applyTapdHomeFilters(allItems, filters), [allItems, filters])
  const visibleStatuses = React.useMemo(() => {
    if (filters.status.length > 0) return sortStatusLabels(filters.status)
    return sortStatusLabels(Array.from(new Set(visibleItems.map(getIssueStatusLabel))))
  }, [filters.status, visibleItems])
  const groupedItems = React.useMemo(() => groupRequirementsByStatus(visibleItems, visibleStatuses), [visibleItems, visibleStatuses])
  const workingCount = React.useMemo(() => visibleItems.filter(item => isInProgressStatus(getIssueStatusLabel(item))).length, [visibleItems])
  const filterActive = hasActiveTapdFilters(filters)

  const persistTabs = React.useCallback((tabs: TapdOpenRequirementTab[]) => {
    writeTapdHomeUiState(activeWorkspaceId, { tabs })
  }, [activeWorkspaceId])

  const openRequirementTab = React.useCallback((sourceItemId: string) => {
    setOpenTabs(current => {
      const existing = current.find(tab => tab.sourceItemId === sourceItemId)
      const next = existing ? current : [...current, { sourceItemId }]
      persistTabs(next)
      return next
    })
    setActiveTabId(sourceItemId)
    navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'requirement', sourceItemId))
  }, [persistTabs])

  const activateHome = React.useCallback(() => {
    setActiveTabId(TAPD_HOME_TAB_ID)
    navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'board'))
  }, [])

  const closeRequirementTab = React.useCallback((sourceItemId: string) => {
    setOpenTabs(current => {
      const index = current.findIndex(tab => tab.sourceItemId === sourceItemId)
      const next = current.filter(tab => tab.sourceItemId !== sourceItemId)
      persistTabs(next)
      if (activeTabId === sourceItemId) {
        const fallback = next[index - 1] ?? next[index] ?? null
        if (fallback) {
          setActiveTabId(fallback.sourceItemId)
          navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'requirement', fallback.sourceItemId))
        } else {
          setActiveTabId(TAPD_HOME_TAB_ID)
          navigate(routes.view.plugins(TAPD_PLUGIN_ID, 'board'))
        }
      }
      return next
    })
  }, [activeTabId, persistTabs])

  const toggleRequirementTabPinned = React.useCallback((sourceItemId: string) => {
    setOpenTabs(current => {
      const next = current.map(tab => tab.sourceItemId === sourceItemId ? { ...tab, pinned: !tab.pinned } : tab)
      const ordered = [...next].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      persistTabs(ordered)
      return ordered
    })
  }, [persistTabs])

  React.useEffect(() => {
    const stored = readTapdHomeUiState(activeWorkspaceId)
    setViewMode(stored.viewMode ?? 'list')
    setFilters(stored.filters ?? EMPTY_TAPD_HOME_FILTERS)
    setCollapsedStatuses(new Set(stored.collapsedStatuses ?? []))
    setExpandedDefaultCollapsedStatuses(new Set(stored.expandedDefaultCollapsedStatuses ?? []))
    setOpenTabs(stored.tabs ?? [])
    setActiveTabId(initialSourceItemId ?? TAPD_HOME_TAB_ID)
  }, [activeWorkspaceId, initialSourceItemId])

  React.useEffect(() => {
    if (!initialSourceItemId) {
      setActiveTabId(TAPD_HOME_TAB_ID)
      return
    }
    setOpenTabs(current => {
      const existing = current.some(tab => tab.sourceItemId === initialSourceItemId)
      const next = existing ? current : [...current, { sourceItemId: initialSourceItemId }]
      persistTabs(next)
      return next
    })
    setActiveTabId(initialSourceItemId)
  }, [initialSourceItemId, persistTabs])

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

  React.useEffect(() => {
    if (!activeWorkspaceId || !tapdInstalled) return
    let stale = false
    window.electronAPI.listRequirementItems(activeWorkspaceId, TAPD_PLUGIN_ID, { localOnly: true })
      .then(result => {
        if (stale || result.items.length === 0) return
        const current = readCache(activeWorkspaceId)
        const itemsById = { ...current.itemsById }
        const listOrder = [...current.listOrder]
        for (const item of result.items) {
          itemsById[item.sourceItemId] = item
          if (!listOrder.includes(item.sourceItemId)) listOrder.unshift(item.sourceItemId)
        }
        const next: TapdRequirementCache = {
          ...current,
          itemsById,
          listOrder,
          total: result.total,
          lastSyncedAt: Date.now(),
        }
        writeCache(activeWorkspaceId, next)
        setCache(next)
      })
      .catch(() => {
        // Local cache hydration is best-effort; live import errors are surfaced separately.
      })
    return () => { stale = true }
  }, [activeWorkspaceId, tapdInstalled])

  const persistRequirementBindingSnapshot = React.useCallback(async (item: ExternalRequirementItem): Promise<ExternalRequirementItem> => {
    if (!activeWorkspaceId || !item.binding?.groupName) return item
    const binding = await window.electronAPI.createRequirementGroupFromItem(activeWorkspaceId, {
      pluginId: TAPD_PLUGIN_ID,
      item: withoutRequirementBinding(item),
      groupName: item.binding.groupName,
    })
    return { ...item, binding }
  }, [activeWorkspaceId])

  const syncTapdHome = React.useCallback(async (options?: { manual?: boolean }) => {
    if (!activeWorkspaceId || !tapdInstalled) return
    if (!connected) {
      if (options?.manual) toast.error(plugin?.connectionError || 'TAPD source is not connected.')
      return
    }
    if (!tapdWorkspaceId) {
      if (options?.manual) toast.error('Open or add a TAPD requirement first so the workspace_id can be detected.')
      return
    }
    if (syncingHome) return

    setSyncingHome(true)
    try {
      const current = readCache(activeWorkspaceId)
      const itemsById = { ...current.itemsById }
      const syncedIds: string[] = []
      let total: number | undefined
      let page = 1
      let hasMore = true

      while (hasMore && page <= TAPD_SYNC_MAX_PAGES) {
        const result = await window.electronAPI.listRequirementItems(activeWorkspaceId, TAPD_PLUGIN_ID, {
          workspaceId: tapdWorkspaceId,
          page,
          limit: TAPD_SYNC_PAGE_LIMIT,
        })
        total = result.total ?? total
        for (const liveItem of result.items) {
          const existing = itemsById[liveItem.sourceItemId]
          const launched = isLaunchedStatus(liveItem.status)
          if (launched && !existing) continue

          let nextItem: ExternalRequirementItem = {
            ...existing,
            ...liveItem,
            binding: liveItem.binding ?? existing?.binding,
          }
          if (nextItem.binding) {
            nextItem = await persistRequirementBindingSnapshot(nextItem)
          }
          itemsById[nextItem.sourceItemId] = nextItem
          syncedIds.push(nextItem.sourceItemId)
        }
        hasMore = result.hasMore === true
        page += 1
      }

      const listOrder = [
        ...syncedIds,
        ...current.listOrder.filter(id => !syncedIds.includes(id)),
      ].filter((id, index, arr) => Boolean(itemsById[id]) && arr.indexOf(id) === index)
      const now = Date.now()
      const next: TapdRequirementCache = {
        ...current,
        itemsById,
        listOrder,
        total,
        lastSyncedAt: now,
        homeSyncedAt: now,
      }
      writeCache(activeWorkspaceId, next)
      setCache(next)
      if (options?.manual) toast.success('TAPD requirements synced', { description: `${syncedIds.length} updated` })
    } catch (err) {
      if (options?.manual) toast.error(err instanceof Error ? err.message : String(err))
      else console.warn('[TAPD] Background sync failed:', err)
    } finally {
      setSyncingHome(false)
    }
  }, [activeWorkspaceId, connected, persistRequirementBindingSnapshot, plugin?.connectionError, syncingHome, tapdInstalled, tapdWorkspaceId])

  React.useEffect(() => {
    if (activeTabId !== TAPD_HOME_TAB_ID || !tapdWorkspaceId || syncingHome) return
    const homeSyncedAt = cache.homeSyncedAt ?? 0
    if (Date.now() - homeSyncedAt < TAPD_HOME_CACHE_TTL_MS) return
    void syncTapdHome({ manual: false })
  }, [activeTabId, cache.homeSyncedAt, syncTapdHome, syncingHome, tapdWorkspaceId])

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
      let item = result.item
      let linkedGroupName = item.binding?.groupName

      if (!item.binding) {
        const groupName = suggestTapdGroupName(item)
        const binding = await window.electronAPI.createRequirementGroupFromItem(activeWorkspaceId, {
          pluginId: TAPD_PLUGIN_ID,
          item,
          groupName,
        })
        item = { ...item, binding }
        linkedGroupName = binding.groupName
      }

      const nextCache = upsertCachedItem(activeWorkspaceId, item)
      setCache(nextCache)
      setLinkInput('')
      setImportDialogOpen(false)
      openRequirementTab(item.sourceItemId)
      if (linkedGroupName) {
        toast.success('TAPD requirement saved and linked', { description: `Group: ${linkedGroupName}` })
      } else {
        toast.success('TAPD requirement saved locally')
      }
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err))
    } finally {
      setAddingFromLink(false)
    }
  }, [activeWorkspaceId, connected, linkInput, openRequirementTab, plugin?.connectionError, tapdInstalled])

  const updateViewMode = React.useCallback((mode: TapdPluginViewMode) => {
    setViewMode(mode)
    writeTapdHomeUiState(activeWorkspaceId, { viewMode: mode })
  }, [activeWorkspaceId])

  const updateFilters = React.useCallback((updater: (current: TapdHomeFilters) => TapdHomeFilters) => {
    setFilters(current => {
      const next = updater(current)
      writeTapdHomeUiState(activeWorkspaceId, { filters: next, statusFilter: next.status[0] ?? 'all' })
      return next
    })
  }, [activeWorkspaceId])

  const toggleFilterValue = React.useCallback((kind: TapdFilterKind, value: string) => {
    updateFilters(current => {
      const currentValues = current[kind]
      const nextValues = currentValues.includes(value)
        ? currentValues.filter(entry => entry !== value)
        : [...currentValues, value]
      return { ...current, [kind]: nextValues }
    })
  }, [updateFilters])

  const resetFilters = React.useCallback(() => {
    updateFilters(() => EMPTY_TAPD_HOME_FILTERS)
  }, [updateFilters])

  const toggleStatusCollapsed = React.useCallback((status: string) => {
    setCollapsedStatuses(current => {
      const next = new Set(current)
      const shouldExpand = next.has(status)
      if (shouldExpand) next.delete(status)
      else next.add(status)
      setExpandedDefaultCollapsedStatuses(currentExpanded => {
        const nextExpanded = new Set(currentExpanded)
        if (isDefaultCollapsedStatus(status)) {
          if (shouldExpand) nextExpanded.add(status)
          else nextExpanded.delete(status)
        }
        writeTapdHomeUiState(activeWorkspaceId, {
          collapsedStatuses: Array.from(next),
          expandedDefaultCollapsedStatuses: Array.from(nextExpanded),
        })
        return nextExpanded
      })
      return next
    })
  }, [activeWorkspaceId])

  React.useEffect(() => {
    const validStatus = new Set(statusLabels)
    const validPriority = new Set(priorityOptions)
    const validCreator = new Set(creatorOptions)
    const next: TapdHomeFilters = {
      status: filters.status.filter(value => validStatus.has(value)),
      priority: filters.priority.filter(value => validPriority.has(value)),
      creator: filters.creator.filter(value => validCreator.has(value)),
    }
    if (
      next.status.length !== filters.status.length ||
      next.priority.length !== filters.priority.length ||
      next.creator.length !== filters.creator.length
    ) {
      setFilters(next)
      writeTapdHomeUiState(activeWorkspaceId, { filters: next, statusFilter: next.status[0] ?? 'all' })
    }
  }, [activeWorkspaceId, creatorOptions, filters, priorityOptions, statusLabels])

  React.useEffect(() => {
    setCollapsedStatuses(current => {
      let changed = false
      const next = new Set(Array.from(current).filter(status => statusLabels.includes(status)))
      for (const status of statusLabels) {
        if (isDefaultCollapsedStatus(status) && !expandedDefaultCollapsedStatuses.has(status) && !next.has(status)) {
          next.add(status)
          changed = true
        }
      }
      if (next.size !== current.size) changed = true
      if (changed) writeTapdHomeUiState(activeWorkspaceId, { collapsedStatuses: Array.from(next) })
      return changed ? next : current
    })
  }, [activeWorkspaceId, expandedDefaultCollapsedStatuses, statusLabels])

  if (!tapdInstalled) return <PluginUnavailableState />

  const activeRequirementId = activeTabId === TAPD_HOME_TAB_ID ? null : activeTabId

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <RequirementTabStrip
        tabs={openTabs}
        activeTabId={activeTabId}
        itemsById={cache.itemsById}
        onActivateHome={activateHome}
        onActivateRequirement={openRequirementTab}
        onCloseRequirement={closeRequirementTab}
        onTogglePinned={toggleRequirementTabPinned}
      />

      {activeRequirementId ? (
        <div className="min-h-0 flex-1">
          <RequirementDetailPage
            sourceItemId={activeRequirementId}
            onItemUpdated={() => setCache(readCache(activeWorkspaceId))}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 bg-foreground/[0.018] p-4">
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[18px] bg-background shadow-sm ring-1 ring-foreground/[0.08]">
            <div className="flex h-[64px] shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-6">
              {viewMode === 'list' && (
                <PanelHeaderCenterButton
                  icon={syncingHome ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  tooltip="Sync TAPD requirements"
                  aria-label="Sync TAPD requirements"
                  onClick={() => void syncTapdHome({ manual: true })}
                  disabled={syncingHome}
                  className="h-9 w-9 rounded-[10px] p-0 opacity-100 ring-1 ring-foreground/[0.08]"
                />
              )}
              <button
                type="button"
                onClick={resetFilters}
                className={cn('h-9 rounded-[10px] px-4 text-[14px] font-medium ring-1 ring-foreground/[0.08] transition-colors', !filterActive ? 'bg-foreground/[0.055] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground')}
              >
                All
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
                {statusLabels.map(status => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleFilterValue('status', status)}
                    className={cn('inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[14px] font-medium ring-1 ring-foreground/[0.08] transition-colors', filters.status.includes(status) ? 'bg-foreground/[0.055] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground')}
                  >
                    <IssueStatusDot status={status} />
                    {status}
                    <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{allItems.filter(item => getIssueStatusLabel(item) === status).length}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setLinkError(null)
                    setImportDialogOpen(true)
                  }}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground ring-1 ring-foreground/[0.08] transition-colors hover:bg-foreground/[0.035] hover:text-foreground"
                  aria-label="Add TAPD requirement"
                  title="Add TAPD requirement"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span className="hidden h-9 items-center rounded-[10px] px-3 text-[14px] text-muted-foreground ring-1 ring-foreground/[0.08] sm:inline-flex">{workingCount} working</span>
                <TapdFilterMenu
                  filters={filters}
                  statusOptions={statusLabels}
                  priorityOptions={priorityOptions}
                  creatorOptions={creatorOptions}
                  onToggle={toggleFilterValue}
                  onReset={resetFilters}
                />
                <div className="flex h-9 overflow-hidden rounded-[10px] ring-1 ring-foreground/[0.08]">
                  <button
                    type="button"
                    onClick={() => updateViewMode('list')}
                    className={cn('w-9 transition-colors', viewMode === 'list' ? 'bg-foreground/[0.055] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground')}
                    aria-label="List view"
                    title="List view"
                  >
                    <List className="mx-auto h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => updateViewMode('board')}
                    className={cn('w-9 border-l border-foreground/[0.06] transition-colors', viewMode === 'board' ? 'bg-foreground/[0.055] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground')}
                    aria-label="Board view"
                    title="Board view"
                  >
                    <Columns3 className="mx-auto h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mx-6 mt-4 rounded-[14px] bg-destructive/10 p-4 text-sm text-destructive ring-1 ring-destructive/15">
                <div className="font-medium">We couldn't load TAPD plugin status.</div>
                <div className="mt-1 text-destructive/80">{error}</div>
              </div>
            )}

            {addingFromLink && cache.listOrder.length === 0 ? (
              <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-[210px] rounded-[16px] bg-foreground/[0.035] animate-pulse" />)}
              </div>
            ) : cache.listOrder.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <Link2 className="mx-auto h-8 w-8 text-muted-foreground" />
                  <h2 className="mt-3 text-base font-semibold text-foreground">No issues</h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Use the + button beside filters to add a TAPD requirement link.</p>
                </div>
              </div>
            ) : viewMode === 'list' ? (
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 p-4">
                  {groupedItems.map(group => (
                    <IssueListSection
                      key={group.status}
                      status={group.status}
                      items={group.items}
                      collapsed={collapsedStatuses.has(group.status)}
                      onToggleCollapsed={toggleStatusCollapsed}
                      onOpen={item => openRequirementTab(item.sourceItemId)}
                    />
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="flex min-h-full w-max gap-5 p-6">
                  {groupedItems.map(group => (
                    <IssueBoardColumn
                      key={group.status}
                      status={group.status}
                      items={group.items}
                      collapsed={collapsedStatuses.has(group.status)}
                      onToggleCollapsed={toggleStatusCollapsed}
                      onOpen={item => openRequirementTab(item.sourceItemId)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <TapdLinkImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        linkInput={linkInput}
        onLinkInputChange={(value) => {
          setLinkInput(value)
          setLinkError(null)
        }}
        linkError={linkError}
        addingFromLink={addingFromLink}
        connected={connected}
        connectionError={plugin?.connectionError}
        onSubmit={() => void addRequirementFromLink()}
      />
    </div>
  )
}

function SidebarSectionHeader({
  title,
  open,
  onOpenChange,
  trailing,
  className,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trailing?: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        'mb-2 flex w-full items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-accent/70',
        !open && 'text-muted-foreground hover:text-foreground',
        className,
      )}
      onClick={() => onOpenChange(!open)}
    >
      {title}
      <ChevronRight className={cn('h-3 w-3 shrink-0 stroke-[2.5] text-muted-foreground transition-transform', open && 'rotate-90')} />
      {trailing}
    </button>
  )
}

function DetailSection({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <div>
      <SidebarSectionHeader title={title} open={open} onOpenChange={onOpenChange} />
      {open && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
          {children}
        </div>
      )}
    </div>
  )
}

function PropertyRow({
  label,
  value,
  emptyText,
  interactive = true,
}: {
  label: string
  value?: React.ReactNode
  emptyText?: string
  interactive?: boolean
}) {
  const isEmpty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
  return (
    <div className={cn('-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid items-center rounded-md px-2', interactive && 'transition-colors hover:bg-accent/50')}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={cn('flex min-w-0 items-center gap-1.5 truncate text-xs', isEmpty && 'text-muted-foreground/60')}>
        {isEmpty ? emptyText ?? 'Not set' : value}
      </div>
    </div>
  )
}

function InlineValue({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('block min-w-0 truncate', className)}>{children}</span>
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

function HubPropertyRow({
  label,
  children,
  interactive = true,
  align = 'center',
  valueClassName,
}: {
  label: string
  children: React.ReactNode
  interactive?: boolean
  align?: 'center' | 'start'
  valueClassName?: string
}) {
  return (
    <div className={cn(
      '-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid rounded-md px-2 text-xs',
      align === 'start' ? 'items-start py-1.5' : 'items-center',
      interactive && 'transition-colors hover:bg-accent/50',
    )}>
      <span className={cn('text-muted-foreground', align === 'start' && 'pt-1')}>{label}</span>
      <div className={cn(
        'min-w-0',
        align === 'start' ? 'flex flex-col gap-1' : 'flex items-center gap-1.5 truncate',
        valueClassName,
      )}>{children}</div>
    </div>
  )
}

function RequirementSessionsSection({
  open,
  onOpenChange,
  sessions,
  hasBinding,
  onCreateSession,
  onNavigateSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessions: Array<{ id: string; name?: string | null }>
  hasBinding: boolean
  onCreateSession: () => void
  onNavigateSession: (sessionId: string) => void
}) {
  return (
    <div className="col-span-2 mt-1">
      <div className="mb-2 flex items-center gap-1">
        <SidebarSectionHeader
          title="Sessions"
          open={open}
          onOpenChange={onOpenChange}
          className="mb-0 min-w-0 flex-1"
          trailing={<span className="ml-auto font-mono tabular-nums text-muted-foreground/70">{sessions.length}</span>}
        />
        {hasBinding && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            onClick={onCreateSession}
            title="Create session"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        )}
      </div>
      {open && (
        <div className="max-h-[168px] space-y-0.5 overflow-y-auto pl-2 pr-1">
          {!hasBinding ? (
            <p className="px-1 py-1.5 text-xs text-muted-foreground/60">No group linked</p>
          ) : sessions.length === 0 ? (
            <p className="px-1 py-1.5 text-xs italic text-muted-foreground/60">No sessions yet. Create one to start a requirement chat.</p>
          ) : sessions.map((session, index) => (
            <button
              key={session.id}
              type="button"
              className={cn('flex w-full items-center gap-1.5 rounded px-1 py-1.5 text-left text-xs transition-colors hover:bg-accent/40', index === 0 ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => onNavigateSession(session.id)}
              title={session.name || 'Untitled session'}
            >
              <span className="truncate">{session.name || 'Untitled session'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TokenUsageSection({
  open,
  onOpenChange,
  totals,
  runsCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  totals: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
  runsCount: number
}) {
  const totalTokens = totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens
  return (
    <div>
      <SidebarSectionHeader
        title="Token usage"
        open={open}
        onOpenChange={onOpenChange}
        trailing={<span className="ml-auto font-mono tabular-nums text-muted-foreground/70">{formatTokenCount(totalTokens)}</span>}
      />
      {open && (
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-2">
          <PropertyRow label="Input" value={<InlineValue className="text-muted-foreground">{formatTokenCount(totals.inputTokens)}</InlineValue>} interactive={false} />
          <PropertyRow label="Output" value={<InlineValue className="text-muted-foreground">{formatTokenCount(totals.outputTokens)}</InlineValue>} interactive={false} />
          <PropertyRow label="Cache" value={<InlineValue className="text-muted-foreground">{formatTokenCount(totals.cacheReadTokens)} read / {formatTokenCount(totals.cacheCreationTokens)} write</InlineValue>} interactive={false} />
          <PropertyRow label="Runs" value={<InlineValue className="text-muted-foreground">{runsCount}</InlineValue>} interactive={false} />
        </div>
      )}
    </div>
  )
}

function getRunTimestamp(run: AgentRun): number | undefined {
  const parsed = Date.parse(run.completedAt ?? run.startedAt ?? run.createdAt)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getRunTitle(run: AgentRun): string {
  if (run.triggerType === 'tapd') return 'Initial run'
  if (run.triggerType === 'follow-up') return 'Follow-up'
  const firstLine = run.triggerSummary.split('\n').map(line => line.trim()).find(Boolean)
  return firstLine ? firstLine.slice(0, 64) : 'Agent run'
}

function getRunStatusPresentation(status: AgentRun['status']): { label: string; tone: string } {
  switch (status) {
    case 'queued': return { label: 'Queued', tone: 'text-warning' }
    case 'running': return { label: 'Working', tone: 'text-info' }
    case 'stopping': return { label: 'Stopping', tone: 'text-info' }
    case 'completed': return { label: 'Completed', tone: 'text-success' }
    case 'failed': return { label: 'Failed', tone: 'text-destructive' }
    case 'cancelled': return { label: 'Cancelled', tone: 'text-muted-foreground' }
    default: return { label: status, tone: 'text-muted-foreground' }
  }
}

function RunRowActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-0.5 bg-gradient-to-l from-accent/95 via-accent/80 to-transparent pl-6 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {children}
    </div>
  )
}

function AgentRunRow({
  run,
  agent,
  onOpenAgent,
  onCancel,
  cancelling,
  showAgentName = false,
}: {
  run: AgentRun
  agent?: AgentProfile | null
  onOpenAgent: () => void
  onCancel: (run: AgentRun) => void
  cancelling: boolean
  showAgentName?: boolean
}) {
  const isActive = ACTIVE_AGENT_RUN_STATUSES.has(run.status)
  const status = getRunStatusPresentation(run.status)
  const isStopping = cancelling || run.status === 'stopping'
  const timestamp = getRunTimestamp(run)
  return (
    <div
      role="button"
      tabIndex={0}
      className="group relative flex items-center gap-2 rounded px-1 py-1.5 transition-colors hover:bg-accent/40"
      onClick={onOpenAgent}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpenAgent()
      }}
      title="Open agent Activity"
    >
      <span className="relative shrink-0">
        <AgentAvatar agent={agent ?? { id: run.agentProfileId, name: run.agentProfileId }} className="h-5 w-5 text-[8px]" />
        {isActive && <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-info ring-1 ring-background animate-pulse" />}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs text-muted-foreground" style={TRIGGER_MASK_STYLE}>
        {showAgentName && <span className="mr-1 font-medium text-foreground/70">{agent?.name ?? run.agentProfileId}</span>}
        {getRunTitle(run)}
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs">
        <span className={status.tone}>{status.label}</span>
        {timestamp && <span className="text-muted-foreground"> · {formatRelativeRequirementTime(timestamp)}</span>}
      </span>
      {isActive && (
        <RunRowActions>
          <button
            type="button"
            className="flex items-center justify-center rounded p-1 text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isStopping}
            aria-label="Cancel run"
            title="Cancel run"
            onClick={event => {
              event.stopPropagation()
              onCancel(run)
            }}
          >
            {isStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        </RunRowActions>
      )}
    </div>
  )
}

function AgentStarterRow({ agent, agentName, isWorking, onOpenAgent, onRun }: { agent?: AgentProfile | null; agentName: string; isWorking: boolean; onOpenAgent: () => void; onRun: () => void }) {
  return (
    <div className="group relative flex items-center gap-2 rounded px-1 py-1.5 transition-colors hover:bg-accent/40">
      <AgentAvatar agent={agent ?? { id: agentName, name: agentName }} className="h-5 w-5 text-[8px]" />
      <button
        type="button"
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left text-xs text-muted-foreground hover:text-foreground"
        style={TRIGGER_MASK_STYLE}
        onClick={onOpenAgent}
        disabled={!agent}
        title={agent ? `Open ${agentName} Activity` : undefined}
      >
        {agentName}
      </button>
      {isWorking && (
        <span className="shrink-0 whitespace-nowrap text-xs text-info">Working</span>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-6 rounded px-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        disabled={!agent || isWorking}
        onClick={event => {
          event.stopPropagation()
          onRun()
        }}
      >
        {isWorking ? <Spinner className="text-[10px]" /> : 'Run'}
      </Button>
    </div>
  )
}

function AddRequirementAgentRow({ agents, onAddAgent }: { agents: AgentProfile[]; onAddAgent: (agentId: string) => void }) {
  const [value, setValue] = React.useState('')
  if (agents.length === 0) return null

  return (
    <div className="flex items-center gap-2 rounded px-1 py-1.5 text-xs text-muted-foreground">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Plus className="h-3 w-3" />
      </span>
      <Select
        value={value}
        onValueChange={agentId => {
          onAddAgent(agentId)
          setValue('')
        }}
      >
        <SelectTrigger className="h-7 min-w-0 flex-1 rounded border-border/60 bg-transparent px-2 text-xs">
          <SelectValue placeholder="Add agent…" />
        </SelectTrigger>
        <SelectContent style={DIALOG_SELECT_CONTENT_STYLE}>
          {agents.map(agent => (
            <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function ExecutionLogSection({
  open,
  onOpenChange,
  pastRunsOpen,
  onPastRunsOpenChange,
  agents,
  availableAgents,
  runs,
  startingAgentId,
  cancellingRunId,
  onRun,
  onAddAgent,
  onCancelRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pastRunsOpen: boolean
  onPastRunsOpenChange: (open: boolean) => void
  agents: AgentProfile[]
  availableAgents: AgentProfile[]
  runs: AgentRun[]
  startingAgentId?: string | null
  cancellingRunId?: string | null
  onRun: (agent: AgentProfile) => void
  onAddAgent: (agentId: string) => void
  onCancelRun: (run: AgentRun) => void
}) {
  const activeRuns = runs.filter(run => ACTIVE_AGENT_RUN_STATUSES.has(run.status))
  const pastRuns = runs.filter(run => !ACTIVE_AGENT_RUN_STATUSES.has(run.status))
  const runsByAgentId = React.useMemo(() => {
    const map = new Map<string, AgentRun[]>()
    for (const run of runs) {
      const current = map.get(run.agentProfileId) ?? []
      current.push(run)
      map.set(run.agentProfileId, current)
    }
    return map
  }, [runs])
  const agentsById = React.useMemo(() => new Map(agents.map(agent => [agent.id, agent])), [agents])
  const openAgentActivity = React.useCallback((agentId?: string) => {
    if (agentId) navigate(routes.view.agents(agentId))
  }, [])

  return (
    <div>
      <SidebarSectionHeader
        title="Execution log"
        open={open}
        onOpenChange={onOpenChange}
        trailing={activeRuns.length > 0 ? (
          <span className="ml-auto inline-flex items-center gap-1 text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info animate-pulse" />
            <span className="font-mono tabular-nums">{activeRuns.length}</span>
          </span>
        ) : null}
      />
      {open && (
        <div className="space-y-0.5 pl-2">
          {agents.map(agent => {
            const agentRuns = runsByAgentId.get(agent.id) ?? []
            const agentActiveRuns = agentRuns.filter(run => ACTIVE_AGENT_RUN_STATUSES.has(run.status))
            const isWorking = startingAgentId === agent.id || agentActiveRuns.length > 0
            return (
              <React.Fragment key={agent.id}>
                <AgentStarterRow
                  agent={agent}
                  agentName={agent.name}
                  isWorking={isWorking}
                  onOpenAgent={() => openAgentActivity(agent.id)}
                  onRun={() => onRun(agent)}
                />
                {agentActiveRuns.map(run => (
                  <AgentRunRow
                    key={run.id}
                    run={run}
                    agent={agent}
                    onOpenAgent={() => openAgentActivity(run.agentProfileId)}
                    onCancel={onCancelRun}
                    cancelling={cancellingRunId === run.id}
                  />
                ))}
              </React.Fragment>
            )
          })}

          <AddRequirementAgentRow agents={availableAgents} onAddAgent={onAddAgent} />

          {pastRuns.length > 0 && (
            <>
              {activeRuns.length > 0 && <div className="my-1.5 border-t border-border/60" />}
              <button
                type="button"
                onClick={() => onPastRunsOpenChange(!pastRunsOpen)}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
              >
                <ChevronRight className={cn('h-3 w-3 shrink-0 stroke-[2.5] transition-transform', pastRunsOpen && 'rotate-90')} />
                {pastRunsOpen ? 'Hide' : 'Show'} past runs ({pastRuns.length})
              </button>
              {pastRunsOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {pastRuns.map(run => (
                    <AgentRunRow
                      key={run.id}
                      run={run}
                      agent={agentsById.get(run.agentProfileId)}
                      onOpenAgent={() => openAgentActivity(run.agentProfileId)}
                      onCancel={onCancelRun}
                      cancelling={false}
                      showAgentName
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
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

function isExternalHref(href: string): boolean {
  return /^(https?:|mailto:|craftagents:)/i.test(href.trim())
}

function stripHrefDecorations(value: string): string {
  return value.split('#')[0]!.split('?')[0]!.trim()
}

function decodeLocalHref(href: string): string | null {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  if (/^file:\/\//i.test(trimmed)) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname)
    } catch {
      return decodeURIComponent(stripHrefDecorations(trimmed.replace(/^file:\/\//i, '')))
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null
  return decodeURIComponent(stripHrefDecorations(trimmed))
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)
}

function normalizeJoinedLocalPath(path: string): string {
  const usesRoot = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${usesRoot ? '/' : ''}${parts.join('/')}`
}

function joinLocalPath(baseDir: string, relativePath: string): string {
  if (isAbsoluteLocalPath(relativePath)) return normalizeJoinedLocalPath(relativePath)
  return normalizeJoinedLocalPath(`${baseDir.replace(/[\\/]+$/g, '')}/${relativePath.replace(/^\.\//, '')}`)
}

function looksLikeFilePath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop() ?? ''
  return /\.[a-zA-Z0-9]{1,12}$/.test(name)
}

function dirnameLocalPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!looksLikeFilePath(normalized)) return normalized
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : normalized
}

function getRequirementBaseDirFromPath(path?: string): string | undefined {
  if (!path) return undefined
  const normalized = path.replace(/\\/g, '/')
  const marker = '/agent-runs/'
  const markerIndex = normalized.indexOf(marker)
  return markerIndex > 0 ? normalized.slice(0, markerIndex) : undefined
}

function getCommentLinkBaseDirs(comment: RequirementComment): string[] {
  const dirs = new Set<string>()
  const paths = [comment.summaryPath, comment.transcriptPath, ...(comment.artifactPaths ?? [])].filter((value): value is string => Boolean(value))
  for (const path of paths) {
    dirs.add(dirnameLocalPath(path))
    const requirementBase = getRequirementBaseDirFromPath(path)
    if (requirementBase) {
      dirs.add(requirementBase)
      dirs.add(`${requirementBase}/info`)
    }
  }
  return Array.from(dirs)
}

function getCommentLinkCandidates(comment: RequirementComment, localHref: string): string[] {
  const candidates = new Set<string>()
  if (isAbsoluteLocalPath(localHref)) candidates.add(normalizeJoinedLocalPath(localHref))
  for (const baseDir of getCommentLinkBaseDirs(comment)) {
    candidates.add(joinLocalPath(baseDir, localHref))
  }
  if (!candidates.size) candidates.add(localHref)
  return Array.from(candidates)
}

async function openRequirementCommentHref(comment: RequirementComment, href: string, onOpenUrl: (url: string) => void) {
  if (isExternalHref(href)) {
    onOpenUrl(href)
    return
  }

  const localHref = decodeLocalHref(href)
  if (!localHref) {
    onOpenUrl(href)
    return
  }

  const candidates = getCommentLinkCandidates(comment, localHref)
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      await window.electronAPI.openFile(candidate)
      return
    } catch (error) {
      lastError = error
    }
  }

  toast.error('Failed to open file', {
    description: lastError instanceof Error ? lastError.message : candidates[0] ?? href,
  })
}

function AgentCommentMarkdownBlock({ content, comment, onOpenUrl }: { content: string; comment: RequirementComment; onOpenUrl: (url: string) => void }) {
  const [expanded, setExpanded] = React.useState(true)
  const [markdownOpen, setMarkdownOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 180)
  const openCommentHref = React.useCallback((href: string) => {
    void openRequirementCommentHref(comment, href, onOpenUrl)
  }, [comment, onOpenUrl])
  const copyMarkdown = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      toast.success('Copied Markdown')
      window.setTimeout(() => setCopied(false), 1200)
    } catch (error) {
      toast.error('Could not copy Markdown', { description: error instanceof Error ? error.message : String(error) })
    }
  }, [content])

  return (
    <div className="mt-2 rounded-[12px] border border-foreground/[0.08] bg-background/70">
      <div className="flex items-center justify-between gap-2 border-b border-foreground/[0.06] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="text-[12px] font-medium text-accent transition-colors hover:text-accent/80"
            onClick={() => void copyMarkdown()}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="text-[12px] font-medium text-accent transition-colors hover:text-accent/80"
            onClick={() => setMarkdownOpen(true)}
          >
            Markdown
          </button>
        </div>
        <Button size="sm" variant="ghost" className="h-6 rounded-[6px] px-1.5 text-[11px] text-muted-foreground" onClick={() => setExpanded(open => !open)}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>
      {expanded ? (
        <div className="max-h-[320px] overflow-y-auto px-3 py-2">
          <TapdMarkdownContent content={content} onOpenUrl={openCommentHref} compact />
        </div>
      ) : (
        <button
          type="button"
          className="block w-full truncate px-3 py-2 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpanded(true)}
          title={preview}
        >
          {preview || 'Markdown output collapsed.'}
        </button>
      )}
      <DocumentFormattedMarkdownOverlay
        isOpen={markdownOpen}
        onClose={() => setMarkdownOpen(false)}
        content={content}
        onOpenUrl={openCommentHref}
      />
    </div>
  )
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

function CommentActivityRow({
  comment,
  onOpenUrl,
  onReplyToAgent,
}: {
  comment: RequirementComment
  onOpenUrl: (url: string) => void
  onReplyToAgent?: (comment: RequirementComment, message: string) => Promise<void>
}) {
  const body = React.useMemo(() => prepareCommentMarkdown(comment), [comment])
  const timestamp = parseTapdTimestamp(comment.updatedAt ?? comment.createdAt)
  const initial = comment.origin === 'agent' ? null : (comment.author.trim()[0] || '?').toUpperCase()
  const [commentOpen, setCommentOpen] = React.useState(true)
  const [replyOpen, setReplyOpen] = React.useState(false)
  const [replyText, setReplyText] = React.useState('')
  const [replying, setReplying] = React.useState(false)
  const canReply = comment.origin === 'agent' && Boolean(comment.agentProfileId && comment.childSessionId && onReplyToAgent)
  const statusTone = comment.status === 'completed'
    ? 'bg-success/[0.08] text-success/90'
    : comment.status === 'failed'
      ? 'bg-destructive/[0.08] text-destructive/90'
      : comment.status === 'cancelled'
        ? 'bg-foreground/[0.06] text-foreground/55'
        : 'bg-accent/[0.08] text-accent/90'

  const submitReply = async () => {
    const message = replyText.trim()
    if (!message || !onReplyToAgent) return
    setReplying(true)
    try {
      await onReplyToAgent(comment, message)
      setReplyText('')
      setReplyOpen(false)
    } finally {
      setReplying(false)
    }
  }

  return (
    <div className={cn('grid grid-cols-[28px_36px_minmax(0,1fr)] gap-2 rounded-[18px] border px-4 py-3.5', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border)}>
      <button
        type="button"
        className={cn('mt-1.5 flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-foreground/[0.055]', TAPD_DETAIL_THEME.weak)}
        onClick={() => setCommentOpen(open => !open)}
        aria-label={commentOpen ? 'Collapse comment' : 'Expand comment'}
        title={commentOpen ? 'Collapse comment' : 'Expand comment'}
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform', commentOpen && 'rotate-90')} />
      </button>
      <div className={cn('mt-0.5 flex h-9 w-9 items-center justify-center rounded-full text-[14px] font-semibold', comment.origin === 'agent' ? 'bg-foreground/[0.07] text-foreground/70' : avatarTone(comment.author))}>
        {comment.origin === 'agent' ? <Bot className="h-4 w-4" /> : initial}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('text-[14px] font-semibold tracking-[-0.01em]', TAPD_DETAIL_THEME.title)}>{comment.author}</span>
          {comment.status && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize leading-none', statusTone)}>{comment.status}</span>}
          <span className={cn('text-[13px]', TAPD_DETAIL_THEME.weak)}>{formatRelativeRequirementTime(timestamp)}</span>
        </div>
        {commentOpen && (
          <>
            {body ? (
              comment.origin === 'agent'
                ? <AgentCommentMarkdownBlock content={body} comment={comment} onOpenUrl={onOpenUrl} />
                : (
                  <div className="mt-1">
                    <TapdMarkdownContent content={body} onOpenUrl={onOpenUrl} compact />
                  </div>
                )
            ) : (
              <div className={cn('mt-1 text-[13px]', TAPD_DETAIL_THEME.weak)}>Comment has no visible content.</div>
            )}
            {comment.origin === 'agent' && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {canReply && <Button size="sm" variant="ghost" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => setReplyOpen(open => !open)}>Reply to Agent</Button>}
                {comment.summaryPath && <Button size="sm" variant="ghost" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => void window.electronAPI.openFile(comment.summaryPath!)}>Open summary</Button>}
                {comment.artifactPaths?.[0] && <Button size="sm" variant="ghost" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => void window.electronAPI.showInFolder(comment.artifactPaths![0])}>Show files</Button>}
              </div>
            )}
          </>
        )}
        {commentOpen && replyOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={replyText}
              onChange={event => setReplyText(event.target.value)}
              placeholder="Reply to this agent…"
              className={cn('min-h-[72px] w-full resize-none rounded-[10px] border bg-background px-3 py-2 text-[13px] outline-none focus:ring-1 focus:ring-foreground/20', TAPD_DETAIL_THEME.border)}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => setReplyOpen(false)} disabled={replying}>Cancel</Button>
              <Button size="sm" variant="secondary" className="h-7 rounded-[7px] px-2 text-[12px]" onClick={() => void submitReply()} disabled={replying || !replyText.trim()}>{replying ? 'Sending…' : 'Send'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RequirementActivity({ item, localComments, onOpenUrl, onReplyToAgent }: { item: ExternalRequirementItem; localComments: RequirementComment[]; onOpenUrl: (url: string) => void; onReplyToAgent: (comment: RequirementComment, message: string) => Promise<void> }) {
  const comments = React.useMemo(() => [
    ...(item.comments ?? []).map(comment => ({ ...comment, origin: comment.origin ?? 'source' as const })),
    ...localComments,
  ].sort((a, b) => (parseTapdTimestamp(b.updatedAt ?? b.createdAt) ?? 0) - (parseTapdTimestamp(a.updatedAt ?? a.createdAt) ?? 0)), [item.comments, localComments])
  return (
    <section className={cn('mt-10 border-t pt-7', TAPD_DETAIL_THEME.borderSubtle)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn('text-[17px] font-semibold tracking-[-0.015em]', TAPD_DETAIL_THEME.title)}>Activity</h2>
        <span className={cn('text-[12px]', TAPD_DETAIL_THEME.weak)}>{comments.length ? `${comments.length} comment${comments.length > 1 ? 's' : ''}` : 'No comments'}</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {comments.length ? comments.map(comment => <CommentActivityRow key={comment.id} comment={comment} onOpenUrl={onOpenUrl} onReplyToAgent={onReplyToAgent} />) : (
          <div className={cn('rounded-[16px] border px-4 py-3 text-[13px]', TAPD_DETAIL_THEME.subtlePanel, TAPD_DETAIL_THEME.border, TAPD_DETAIL_THEME.weak)}>
            No TAPD comments yet. Refresh item to pull the latest activity.
          </div>
        )}
      </div>
    </section>
  )
}

function buildRequirementInfoFileTree(files: RequirementInfoFilesResult['files'] = [], infoDirPath?: string): SessionFile[] {
  const root: SessionFile = {
    name: 'info',
    path: infoDirPath ?? '',
    type: 'directory',
    children: [],
  }
  const directories = new Map<string, SessionFile>()
  directories.set('', root)

  for (const file of files) {
    const parts = file.relativePath.split('/').filter(Boolean)
    let currentChildren = root.children ?? []
    let currentPath = ''

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i]
      const isLeaf = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (isLeaf) {
        currentChildren.push({
          name: part,
          path: file.path,
          type: 'file',
          size: file.size,
        })
        continue
      }

      let directory = directories.get(currentPath)
      if (!directory) {
        directory = {
          name: part,
          path: infoDirPath ? `${infoDirPath}/${currentPath}` : currentPath,
          type: 'directory',
          children: [],
        }
        directories.set(currentPath, directory)
        currentChildren.push(directory)
      }
      currentChildren = directory.children ?? []
    }
  }

  return [root]
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
  const fileTree = React.useMemo(() => buildRequirementInfoFileTree(infoFiles?.files ?? [], infoFiles?.infoDirPath), [infoFiles?.files, infoFiles?.infoDirPath])

  return (
    <InfoPopoverShell
      side="bottom"
      align="end"
      sideOffset={8}
      trigger={(
        <InfoPopoverTriggerButton
          label="Info"
          aria-label={infoFiles?.files.length ? `Requirement info (${infoFiles.files.length})` : 'Requirement info'}
        />
      )}
    >
      {infoFilesError ? (
        <div className="h-full min-h-0 p-3">
          <p className="rounded-[10px] bg-destructive/10 px-3 py-2 text-[12px] leading-5 text-destructive">
            Could not load info files: {infoFilesError}
          </p>
        </div>
      ) : (
        <SessionFilesSection
          filesOverride={fileTree}
          sessionFolderPath={infoFiles?.infoDirPath}
          title="Requirement info"
          emptyText={`Save implementation plans or handoff notes here. Any session linked to TAPD-${item.sourceItemId} can read them on the next turn.`}
          className="h-full min-h-0"
        />
      )}
    </InfoPopoverShell>
  )
}

export function RequirementDetailPage({ sourceItemId, onItemUpdated }: { sourceItemId: string; onItemUpdated?: (item: ExternalRequirementItem) => void }) {
  const { activeWorkspaceId, onOpenUrl, onSessionLabelsChange, onSessionOptionsChange } = useAppShellContext()
  const { navigateToSession } = useNavigation()
  // Keep synced cached requirements readable even when tapd-mcp-http is not enabled in this workspace.
  const tapdInstalled = true
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const addSession = useSetAtom(addSessionAtom)
  const [item, setItem] = React.useState<ExternalRequirementItem | null>(() => readCache(activeWorkspaceId).itemsById[sourceItemId] ?? null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [groupName, setGroupName] = React.useState(() => item ? defaultGroupName(item) : '')
  const [editingGroup, setEditingGroup] = React.useState(false)
  const [infoFiles, setInfoFiles] = React.useState<RequirementInfoFilesResult | null>(null)
  const [infoFilesError, setInfoFilesError] = React.useState<string | null>(null)
  const [localComments, setLocalComments] = React.useState<RequirementComment[]>([])
  const [creatingSession, setCreatingSession] = React.useState(false)
  const [workContext, setWorkContext] = React.useState<TapdRequirementWorkContext>(() => readTapdRequirementWorkContext(activeWorkspaceId, sourceItemId))
  const [requirementAgentIds, setRequirementAgentIds] = React.useState<string[]>(() => readTapdRequirementAgentSelection(activeWorkspaceId, sourceItemId).agentIds)
  const [agents, setAgents] = React.useState<AgentProfile[]>([])
  const [agentRuns, setAgentRuns] = React.useState<AgentRun[]>([])
  const [startingTapdAgentId, setStartingTapdAgentId] = React.useState<string | null>(null)
  const [propertiesOpen, setPropertiesOpen] = React.useState(true)
  const [workOpen, setWorkOpen] = React.useState(true)
  const [sessionsOpen, setSessionsOpen] = React.useState(true)
  const [executionLogOpen, setExecutionLogOpen] = React.useState(true)
  const [pastRunsOpen, setPastRunsOpen] = React.useState(false)
  const [tokenUsageOpen, setTokenUsageOpen] = React.useState(false)
  const [cancellingRunId, setCancellingRunId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const cached = tapdInstalled ? readCache(activeWorkspaceId).itemsById[sourceItemId] : undefined
    setItem(cached ?? null)
    setGroupName(cached ? cached.binding?.groupName ?? defaultGroupName(cached) : '')
    const nextWorkContext = readTapdRequirementWorkContext(activeWorkspaceId, sourceItemId)
    setWorkContext(nextWorkContext)
    setRequirementAgentIds(readTapdRequirementAgentSelection(activeWorkspaceId, sourceItemId).agentIds)
  }, [activeWorkspaceId, sourceItemId, tapdInstalled])

  React.useEffect(() => {
    if (!activeWorkspaceId || !tapdInstalled) return
    let stale = false
    window.electronAPI.getRequirementItemDetail(activeWorkspaceId, TAPD_PLUGIN_ID, sourceItemId, { localOnly: true })
      .then(result => {
        if (stale) return
        setItem(result.item)
        setGroupName(result.item.binding?.groupName ?? defaultGroupName(result.item))
        upsertCachedItem(activeWorkspaceId, result.item)
        onItemUpdated?.(result.item)
      })
      .catch(() => {
        // Missing local cache is fine; the live refresh action will surface TAPD/source errors.
      })
    return () => { stale = true }
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

  const loadLocalComments = React.useCallback(async () => {
    if (!activeWorkspaceId || typeof window === 'undefined' || !window.electronAPI?.listRequirementComments) {
      setLocalComments([])
      return
    }
    try {
      const comments = await window.electronAPI.listRequirementComments(activeWorkspaceId, TAPD_PLUGIN_ID, sourceItemId)
      setLocalComments(comments)
    } catch {
      setLocalComments([])
    }
  }, [activeWorkspaceId, sourceItemId])

  React.useEffect(() => {
    void loadLocalComments()
  }, [loadLocalComments])

  React.useEffect(() => {
    const onFocus = () => {
      void refreshInfoFiles()
      void loadLocalComments()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [loadLocalComments, refreshInfoFiles])

  React.useEffect(() => {
    let cancelled = false
    if (!activeWorkspaceId || typeof window === 'undefined' || !window.electronAPI?.listAgentProfiles) return
    window.electronAPI.listAgentProfiles(activeWorkspaceId)
      .then(profiles => { if (!cancelled) setAgents(profiles) })
      .catch(() => { if (!cancelled) setAgents([]) })
    return () => { cancelled = true }
  }, [activeWorkspaceId])

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
  const mainSession = React.useMemo(
    () => groupSessions.find(session => !hasAgentTaskLabel(session.labels)) ?? null,
    [groupSessions],
  )
  const sessionsForDisplay = React.useMemo(
    () => mainSession ? [mainSession, ...groupSessions.filter(session => session.id !== mainSession.id)] : [],
    [groupSessions, mainSession],
  )
  const workSessionsForDisplay = React.useMemo(
    () => mainSession ? [mainSession, ...groupSessions.filter(session => session.id !== mainSession.id && !hasAgentTaskLabel(session.labels))] : [],
    [groupSessions, mainSession],
  )
  const requirementAgents = React.useMemo(() => resolveTapdRequirementAgents(agents, requirementAgentIds), [agents, requirementAgentIds])
  const requirementAgentIdsSet = React.useMemo(() => new Set(requirementAgents.map(agent => agent.id)), [requirementAgents])
  const availableRequirementAgents = React.useMemo(
    () => agents.filter(agent => !requirementAgentIdsSet.has(agent.id)),
    [agents, requirementAgentIdsSet],
  )
  const mainSessionIds = React.useMemo(() => new Set(sessionsForDisplay.map(session => session.id)), [sessionsForDisplay])
  const relevantAgentRuns = React.useMemo(() => agentRuns.filter(run => {
    if (run.target?.type === 'requirement') {
      return run.target.pluginId === TAPD_PLUGIN_ID && run.target.sourceItemId === sourceItemId
    }
    if (!mainSessionIds.has(run.parentSessionId)) return false
    const summary = run.triggerSummary.toLowerCase()
    return summary.includes(sourceItemId.toLowerCase()) || summary.includes(`tapd-${sourceItemId}`.toLowerCase())
  }), [agentRuns, mainSessionIds, sourceItemId])
  const activeTapdRun = React.useMemo(() => relevantAgentRuns.find(run => ACTIVE_AGENT_RUN_STATUSES.has(run.status)) ?? null, [relevantAgentRuns])
  const usageTotals = React.useMemo(() => groupSessions.reduce((totals, session) => {
    const usage = getSessionUsageTotals(session)
    totals.inputTokens += usage.inputTokens
    totals.outputTokens += usage.outputTokens
    totals.cacheReadTokens += usage.cacheReadTokens
    totals.cacheCreationTokens += usage.cacheCreationTokens
    return totals
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }), [groupSessions])

  const loadAgentRuns = React.useCallback(async () => {
    if (!activeWorkspaceId || typeof window === 'undefined' || !window.electronAPI?.listAgentRuns) {
      setAgentRuns([])
      return
    }
    try {
      const runs = await window.electronAPI.listAgentRuns(activeWorkspaceId, { target: { type: 'requirement', pluginId: TAPD_PLUGIN_ID, sourceItemId } })
      setAgentRuns(runs)
    } catch {
      setAgentRuns([])
    }
  }, [activeWorkspaceId, sourceItemId])

  React.useEffect(() => {
    void loadAgentRuns()
  }, [loadAgentRuns])

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      void loadAgentRuns()
      void loadLocalComments()
    }, activeTapdRun ? 2500 : 5000)
    return () => window.clearInterval(interval)
  }, [activeTapdRun, loadAgentRuns, loadLocalComments])

  const persistDetailItem = React.useCallback(async (nextItem: ExternalRequirementItem): Promise<ExternalRequirementItem> => {
    if (!activeWorkspaceId) return nextItem
    let itemToCache = nextItem
    if (nextItem.binding?.groupName) {
      const binding = await window.electronAPI.createRequirementGroupFromItem(activeWorkspaceId, {
        pluginId: TAPD_PLUGIN_ID,
        item: withoutRequirementBinding(nextItem),
        groupName: nextItem.binding.groupName,
      })
      itemToCache = { ...nextItem, binding }
    }
    upsertCachedItem(activeWorkspaceId, itemToCache)
    onItemUpdated?.(itemToCache)
    return itemToCache
  }, [activeWorkspaceId, onItemUpdated])

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
      const nextItem = await persistDetailItem(result.item)
      setItem(nextItem)
      setGroupName(nextItem.binding?.groupName ?? defaultGroupName(nextItem))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeWorkspaceId, item, persistDetailItem, sourceItemId, tapdInstalled])

  const applyBinding = React.useCallback((binding: RequirementBinding) => {
    setItem(current => {
      if (!current) return current
      const next = { ...current, binding }
      upsertCachedItem(activeWorkspaceId, next)
      onItemUpdated?.(next)
      return next
    })
    setGroupName(binding.groupName)
    setEditingGroup(false)
  }, [activeWorkspaceId, onItemUpdated])

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
    const binding = await window.electronAPI.createRequirementGroupFromItem(activeWorkspaceId, { pluginId: TAPD_PLUGIN_ID, item: withoutRequirementBinding(item), groupName: name })
    if (previousGroupName) renameLinkedGroupSessions(previousGroupName, binding.groupName)
    applyBinding(binding)
    toast.success(previousGroupName ? 'Group renamed' : 'Requirement linked', { description: binding.groupName })
  }, [activeWorkspaceId, applyBinding, groupName, item, renameLinkedGroupSessions])

  const saveWorkContext = React.useCallback((value: string) => {
    const next = writeTapdRequirementWorkContext(activeWorkspaceId, sourceItemId, { workingDirectory: value })
    setWorkContext(next)
    toast.success(next.workingDirectory ? 'Working directory saved' : 'Working directory cleared')
  }, [activeWorkspaceId, sourceItemId])

  const addRequirementAgent = React.useCallback((agentId: string) => {
    const next = addTapdRequirementAgentId(activeWorkspaceId, sourceItemId, agentId)
    setRequirementAgentIds(next.agentIds)
    const added = agents.find(agent => agent.id === agentId)
    toast.success('Agent added to requirement', { description: added?.name ?? agentId })
  }, [activeWorkspaceId, agents, sourceItemId])

  const runRequirementAgent = React.useCallback(async (agent: AgentProfile) => {
    if (!activeWorkspaceId || !item || startingTapdAgentId === agent.id) return
    if (relevantAgentRuns.some(run => run.agentProfileId === agent.id && ACTIVE_AGENT_RUN_STATUSES.has(run.status))) return
    const prompt = buildTapdAgentInstructionPrompt(agent.id, item, workContext)
    setStartingTapdAgentId(agent.id)
    try {
      const result = await window.electronAPI.startRequirementAgentRun(activeWorkspaceId, {
        pluginId: TAPD_PLUGIN_ID,
        item,
        agentProfileId: agent.id,
        prompt,
        workingDirectory: workContext.workingDirectory,
        groupName: item.binding?.groupName,
      })
      setLocalComments(current => [
        ...current.filter(comment => comment.id !== result.comment.id),
        result.comment,
      ])
      await Promise.all([loadAgentRuns(), loadLocalComments()])
    } catch (err) {
      toast.error(`Could not start ${agent.name}`, { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setStartingTapdAgentId(current => current === agent.id ? null : current)
    }
  }, [activeWorkspaceId, item, loadAgentRuns, loadLocalComments, relevantAgentRuns, startingTapdAgentId, workContext])

  const replyToAgentComment = React.useCallback(async (comment: RequirementComment, message: string) => {
    if (!activeWorkspaceId || !comment.agentProfileId || !comment.childSessionId) return
    try {
      const result = await window.electronAPI.replyToRequirementAgent(activeWorkspaceId, {
        pluginId: TAPD_PLUGIN_ID,
        sourceItemId,
        agentProfileId: comment.agentProfileId,
        childSessionId: comment.childSessionId,
        runId: comment.agentRunId,
        message,
        workingDirectory: workContext.workingDirectory,
      })
      setLocalComments(current => [
        ...current.filter(existing => existing.id !== result.comment.id),
        result.comment,
      ])
      await Promise.all([loadAgentRuns(), loadLocalComments()])
    } catch (err) {
      toast.error('Could not reply to Tapd Agent', { description: err instanceof Error ? err.message : String(err) })
    }
  }, [activeWorkspaceId, loadAgentRuns, loadLocalComments, sourceItemId, workContext.workingDirectory])

  const cancelTapdAgentRun = React.useCallback(async (run: AgentRun) => {
    if (!activeWorkspaceId || !window.electronAPI?.cancelAgentRun || cancellingRunId) return
    setCancellingRunId(run.id)
    try {
      const cancelledRun = await window.electronAPI.cancelAgentRun(activeWorkspaceId, {
        runId: run.id,
        parentSessionId: run.parentSessionId,
        childSessionId: run.childSessionId,
      })
      if (cancelledRun) {
        setAgentRuns(current => current.map(candidate => candidate.id === cancelledRun.id ? cancelledRun : candidate))
      }
      await Promise.all([loadAgentRuns(), loadLocalComments()])
    } catch (err) {
      toast.error('Could not cancel Agent run', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setCancellingRunId(null)
    }
  }, [activeWorkspaceId, cancellingRunId, loadAgentRuns, loadLocalComments])

  const openCreateSessionDialog = React.useCallback(() => {
    if (!item?.binding) {
      toast.error('Link a Session Group first', { description: 'Create or bind a group before creating a session from this requirement.' })
      return
    }
    setCreatingSession(true)
  }, [item?.binding])

  const handleCreateSession = React.useCallback(async (options: { sessionName: string; llmConnection?: string; model?: string; workingDirectory?: string }) => {
    if (!activeWorkspaceId || !item) return
    if (!item.binding) {
      toast.error('Link a Session Group first', { description: 'Create or bind a group before creating a session from this requirement.' })
      return
    }
    const result = await window.electronAPI.createRequirementSessionForItem(activeWorkspaceId, {
      pluginId: TAPD_PLUGIN_ID,
      item,
      groupName: item.binding.groupName,
      sessionName: options.sessionName,
      llmConnection: options.llmConnection,
      model: options.model,
      workingDirectory: options.workingDirectory,
    })
    // The generic session_created broadcast can arrive slightly after this RPC
    // returns. Add the session to local atoms immediately so navigation's
    // auto-selection validator can find it and the requirement detail sidebar
    // shows the new linked session without a manual refresh.
    addSession(result.session)
    // Keep the mode selector in sync with the authoritative session returned
    // by the backend. Otherwise this direct RPC path falls back to the renderer
    // default ('ask') before the session_created broadcast arrives, which can
    // make the UI and injected <session_state> disagree.
    onSessionOptionsChange(result.sessionId, {
      permissionMode: result.session.permissionMode ?? 'ask',
    })
    if (options.workingDirectory !== undefined) {
      const next = writeTapdRequirementWorkContext(activeWorkspaceId, item.sourceItemId, { workingDirectory: options.workingDirectory })
      setWorkContext(next)
    }
    toast.success('Session created')
    setCreatingSession(false)
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
                  <RequirementActivity item={item} localComments={localComments} onOpenUrl={onOpenUrl} onReplyToAgent={replyToAgentComment} />
                </div>
              </article>
            )}
          </main>
        </ScrollArea>
      </div>

      <aside className={cn('hidden h-full min-h-0 w-80 shrink-0 overflow-y-auto overscroll-contain border-l p-4 lg:block', TAPD_DETAIL_THEME.panel, TAPD_DETAIL_THEME.border)}>
        {item ? (
          <div className="space-y-5">
            <DetailSection title="Properties" open={propertiesOpen} onOpenChange={setPropertiesOpen}>
              <OptionalPropertyRow label="Status" value={item.status ? <MetaPill className={statusTone(item.status)}>{item.status}</MetaPill> : undefined} />
              <OptionalPropertyRow label="Priority" value={item.priority ? <MetaPill className={TAPD_DETAIL_THEME.pill}>{item.priority}</MetaPill> : undefined} />
              <OptionalPropertyRow label="Assignee" value={assigneeText ? <InlineValue>{assigneeText}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Due date" value={dueText} />
              <OptionalPropertyRow label="Project" value={item.project ? <InlineValue>{item.project}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Type" value={item.type ? <InlineValue>{item.type}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Category" value={item.category ? <InlineValue>{item.category}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Version" value={item.version ? <InlineValue>{item.version}</InlineValue> : undefined} />
              <OptionalPropertyRow label="Release" value={item.release ? <InlineValue>{item.release}</InlineValue> : undefined} />
            </DetailSection>

            <DetailSection title="Work" open={workOpen} onOpenChange={setWorkOpen}>
              <HubPropertyRow label="Group">
                {editingGroup ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <Input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Group name" className="h-7 min-w-0 rounded-md px-2 text-[12px]" />
                    <Button size="sm" variant="secondary" className="h-7 rounded-md px-2 text-[12px]" onClick={handleCreateGroup} disabled={!groupName.trim()}>Save</Button>
                    <Button size="sm" variant="ghost" className={cn('h-7 rounded-md px-2 text-[12px]', TAPD_DETAIL_THEME.weak)} onClick={() => setEditingGroup(false)}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={cn('-ml-1 max-w-full truncate rounded-md px-1.5 py-1 text-left transition-colors', TAPD_DETAIL_THEME.hover, item.binding ? 'text-foreground/80' : TAPD_DETAIL_THEME.disabled)}
                    onClick={() => setEditingGroup(true)}
                    title={item.binding?.groupName}
                  >
                    {item.binding ? item.binding.groupName : 'not linked'}
                  </button>
                )}
              </HubPropertyRow>

              <HubPropertyRow label="Context" valueClassName="overflow-visible">
                <WorkingDirectoryBadge
                  workingDirectory={workContext.workingDirectory}
                  onWorkingDirectoryChange={saveWorkContext}
                  workspaceId={activeWorkspaceId ?? undefined}
                />
              </HubPropertyRow>

              <RequirementSessionsSection
                open={sessionsOpen}
                onOpenChange={setSessionsOpen}
                sessions={workSessionsForDisplay}
                hasBinding={Boolean(item.binding)}
                onCreateSession={openCreateSessionDialog}
                onNavigateSession={navigateToSession}
              />

            </DetailSection>

            <ExecutionLogSection
              open={executionLogOpen}
              onOpenChange={setExecutionLogOpen}
              pastRunsOpen={pastRunsOpen}
              onPastRunsOpenChange={setPastRunsOpen}
              agents={requirementAgents}
              availableAgents={availableRequirementAgents}
              runs={relevantAgentRuns}
              startingAgentId={startingTapdAgentId}
              cancellingRunId={cancellingRunId}
              onRun={runRequirementAgent}
              onAddAgent={addRequirementAgent}
              onCancelRun={cancelTapdAgentRun}
            />

            {requirementAgents.length === 0 && (
              <div className="px-8 pb-1 text-[11px] leading-4 text-destructive">No requirement agents found. Create or add an Agent profile to run on this requirement.</div>
            )}

            <TokenUsageSection
              open={tokenUsageOpen}
              onOpenChange={setTokenUsageOpen}
              totals={usageTotals}
              runsCount={relevantAgentRuns.length}
            />
          </div>
        ) : (
          <div className={cn('px-5 py-6 text-[13px]', TAPD_DETAIL_THEME.weak)}>Refresh the item to load TAPD properties.</div>
        )}
      </aside>

      {creatingSession && item?.binding && (
        <RequirementCreateSessionDialog
          item={item}
          defaultName={item.binding.groupName}
          defaultWorkingDirectory={workContext.workingDirectory}
          onClose={() => setCreatingSession(false)}
          onCreate={handleCreateSession}
        />
      )}
    </div>
  )
}

function RequirementCreateSessionDialog({
  item,
  defaultName,
  defaultWorkingDirectory,
  onClose,
  onCreate,
}: {
  item: ExternalRequirementItem
  defaultName: string
  defaultWorkingDirectory?: string
  onClose: () => void
  onCreate: (options: { sessionName: string; llmConnection?: string; model?: string; workingDirectory?: string }) => Promise<void>
}) {
  const { llmConnections, workspaceDefaultLlmConnection } = useAppShellContext()
  const connectionOptions = React.useMemo(() => {
    return (llmConnections ?? []).map(connection => {
      const models = (connection.models ?? []).map(model => {
        if (typeof model === 'string') return { id: model, name: model }
        return { id: model.id, name: model.name || model.shortName || model.id }
      }).filter(model => model.id)
      const dedupedModels = Array.from(new Map([
        ...(connection.defaultModel ? [[connection.defaultModel, { id: connection.defaultModel, name: connection.defaultModel }] as const] : []),
        ...models.map(model => [model.id, model] as const),
      ]).values())
      return {
        slug: connection.slug,
        name: connection.name || connection.slug,
        defaultModel: connection.defaultModel,
        models: dedupedModels,
      }
    })
  }, [llmConnections])
  const initialConnectionSlug = React.useMemo(() => {
    if (workspaceDefaultLlmConnection && connectionOptions.some(connection => connection.slug === workspaceDefaultLlmConnection)) return workspaceDefaultLlmConnection
    return connectionOptions[0]?.slug ?? 'workspace-default'
  }, [connectionOptions, workspaceDefaultLlmConnection])
  const [name, setName] = React.useState(defaultName)
  const [connectionSlug, setConnectionSlug] = React.useState(initialConnectionSlug)
  const selectedConnection = connectionOptions.find(connection => connection.slug === connectionSlug) ?? connectionOptions[0] ?? null
  const modelOptions = selectedConnection?.models.length
    ? selectedConnection.models
    : [{ id: 'connection-default', name: selectedConnection?.defaultModel ?? 'Connection default' }]
  const [model, setModel] = React.useState(modelOptions[0]?.id ?? 'connection-default')
  const [workingDirectory, setWorkingDirectory] = React.useState(defaultWorkingDirectory ?? '')
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setName(defaultName)
  }, [defaultName])

  React.useEffect(() => {
    setWorkingDirectory(defaultWorkingDirectory ?? '')
  }, [defaultWorkingDirectory])

  React.useEffect(() => {
    if (connectionOptions.length === 0) {
      setConnectionSlug('workspace-default')
      setModel('connection-default')
      return
    }
    if (!connectionOptions.some(connection => connection.slug === connectionSlug)) {
      const nextConnection = connectionOptions.find(connection => connection.slug === initialConnectionSlug) ?? connectionOptions[0]!
      setConnectionSlug(nextConnection.slug)
      setModel(nextConnection.defaultModel ?? nextConnection.models[0]?.id ?? 'connection-default')
    }
  }, [connectionOptions, connectionSlug, initialConnectionSlug])

  const handleConnectionChange = React.useCallback((value: string) => {
    setConnectionSlug(value)
    const nextConnection = connectionOptions.find(connection => connection.slug === value)
    setModel(nextConnection?.defaultModel ?? nextConnection?.models[0]?.id ?? 'connection-default')
  }, [connectionOptions])

  const handleSubmit = async () => {
    if (!name.trim() || creating) return
    setCreating(true)
    setError(null)
    try {
      await onCreate({
        sessionName: name.trim(),
        llmConnection: selectedConnection?.slug,
        model: model === 'connection-default' ? undefined : model,
        workingDirectory: workingDirectory.trim(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create main session')
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !creating) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create session</DialogTitle>
          <DialogDescription>
            Create a linked TAPD-{item.sourceItemId} chat session. No prompt will be sent yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Session name"
              className="mt-1"
              onKeyDown={event => { if (event.key === 'Enter') void handleSubmit() }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-muted-foreground">Connection</label>
              <Select value={connectionSlug} onValueChange={handleConnectionChange}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Workspace default" />
                </SelectTrigger>
                <SelectContent style={DIALOG_SELECT_CONTENT_STYLE}>
                  {connectionOptions.length === 0 ? (
                    <SelectItem value="workspace-default">Workspace default</SelectItem>
                  ) : connectionOptions.map(connection => (
                    <SelectItem key={connection.slug} value={connection.slug}>{connection.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Connection default" />
                </SelectTrigger>
                <SelectContent style={DIALOG_SELECT_CONTENT_STYLE}>
                  {modelOptions.map(option => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Working directory</label>
            <Input
              value={workingDirectory}
              onChange={event => setWorkingDirectory(event.target.value)}
              placeholder="Workspace default, or /Users/name/path/to/repo"
              className="mt-1"
              onKeyDown={event => { if (event.key === 'Enter') void handleSubmit() }}
            />
            <p className="mt-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
              This creates a linked requirement chat session only. Use Agent tasks from the Execution log.
            </p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
