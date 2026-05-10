import * as React from 'react'
import { BarChart3, Calendar, Check, ChevronDown, Clock, DollarSign, RefreshCw } from 'lucide-react'
import { RPC_CHANNELS, type SessionUsageEntry, type UsageSessionBreakdown, type UsageStats, type UsageStatsRange, type UsageTotals } from '@craft-agent/shared/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  buildDayUsageRange,
  buildWeekUsageRange,
  formatPercent,
  formatTokenCount,
  formatUsd,
  getCacheReadRatio,
  toDateInputValue,
  toWeekInputValue,
} from '@/utils/session-usage'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'

interface UsageStatsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string | null
}

interface UsageStatsContentProps {
  workspaceId?: string | null
  active?: boolean
  sessionsMaxHeight?: string
}

type RangeMode = 'day' | 'week' | 'all'

function MetricCard({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[72px] min-w-0 flex-col justify-between rounded-[10px] bg-foreground/[0.035] px-3 py-2.5 ring-1 ring-foreground/[0.055]">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate whitespace-nowrap">{label}</span>
      </div>
      <div className="mt-1 truncate text-[15px] font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function usageRangeFor(mode: RangeMode, dateValue: string, weekValue: string): UsageStatsRange {
  if (mode === 'day') return buildDayUsageRange(dateValue)
  if (mode === 'week') return buildWeekUsageRange(weekValue)
  return { kind: 'all' }
}

function cacheRatio(totals: UsageTotals | undefined) {
  return getCacheReadRatio(
    totals?.inputTokens ?? 0,
    totals?.cacheReadTokens ?? 0,
    totals?.cacheCreationTokens ?? 0,
  )
}

function isChannelNotFoundError(error: unknown): boolean {
  const maybe = error as { code?: unknown; message?: unknown } | null
  const message = typeof maybe?.message === 'string' ? maybe.message : String(error)
  return maybe?.code === 'CHANNEL_NOT_FOUND' || message.includes('No handler for: sessions:getUsageStats')
}

const usageUnavailableMessage = 'Usage stats are not available in the running main process yet. Restart Craft Agents after this update so the new sessions:getUsageStats handler is registered.'
const UNKNOWN_CONNECTION_SLUG = '__unknown__'

interface ConnectionUsageOption {
  slug: string
  label: string
  totalTokens: number
  requests: number
}

function entryConnectionSlug(entry: SessionUsageEntry): string {
  return entry.llmConnection || UNKNOWN_CONNECTION_SLUG
}

function createEmptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    requests: 0,
  }
}

function addEntryToTotals(totals: UsageTotals, entry: SessionUsageEntry): void {
  totals.inputTokens += entry.inputTokens || 0
  totals.outputTokens += entry.outputTokens || 0
  totals.totalTokens += entry.totalTokens || 0
  totals.cacheReadTokens += entry.cacheReadTokens || 0
  totals.cacheCreationTokens += entry.cacheCreationTokens || 0
  totals.costUsd += entry.costUsd || 0
  totals.requests += 1
}

function buildStatsFromEntries(stats: UsageStats | null, entries: SessionUsageEntry[]): Pick<UsageStats, 'totals' | 'bySession' | 'entries'> {
  const totals = createEmptyTotals()
  const originalSessions = new Map((stats?.bySession ?? []).map(session => [session.sessionId, session]))
  const bySessionMap = new Map<string, UsageSessionBreakdown>()

  for (const entry of entries) {
    addEntryToTotals(totals, entry)
    const original = originalSessions.get(entry.sessionId)
    const existing = bySessionMap.get(entry.sessionId) ?? {
      ...createEmptyTotals(),
      sessionId: entry.sessionId,
      sessionName: entry.sessionName || original?.sessionName,
      lastUsedAt: original?.lastUsedAt || entry.timestamp,
    }
    addEntryToTotals(existing, entry)
    existing.sessionName = existing.sessionName || entry.sessionName || original?.sessionName
    existing.lastUsedAt = Math.max(existing.lastUsedAt || 0, entry.timestamp)
    bySessionMap.set(entry.sessionId, existing)
  }

  return {
    totals,
    entries,
    bySession: Array.from(bySessionMap.values()).sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0)),
  }
}

export function UsageStatsContent({ workspaceId, active = true, sessionsMaxHeight = 'max-h-[260px]' }: UsageStatsContentProps) {
  const { llmConnections } = useAppShellContext()
  const today = React.useMemo(() => new Date(), [])
  const [mode, setMode] = React.useState<RangeMode>('day')
  const [dateValue, setDateValue] = React.useState(() => toDateInputValue(today))
  const [weekValue, setWeekValue] = React.useState(() => toWeekInputValue(today))
  const [stats, setStats] = React.useState<UsageStats | null>(null)
  const [selectedConnectionSlugs, setSelectedConnectionSlugs] = React.useState<string[] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadStats = React.useCallback(async () => {
    if (!workspaceId) return
    if (!window.electronAPI.isChannelAvailable(RPC_CHANNELS.sessions.GET_USAGE_STATS)) {
      setStats(null)
      setError(usageUnavailableMessage)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const range = usageRangeFor(mode, dateValue, weekValue)
      const next = await window.electronAPI.getUsageStats(workspaceId, range)
      setStats(next)
    } catch (err) {
      setError(isChannelNotFoundError(err) ? usageUnavailableMessage : err instanceof Error ? err.message : String(err))
      setStats(null)
    } finally {
      setLoading(false)
    }
  }, [dateValue, mode, weekValue, workspaceId])

  React.useEffect(() => {
    if (!active) return
    void loadStats()
  }, [active, loadStats])

  const connectionOptions = React.useMemo<ConnectionUsageOption[]>(() => {
    const usageByConnection = new Map<string, { totalTokens: number; requests: number }>()
    for (const entry of stats?.entries ?? []) {
      const slug = entryConnectionSlug(entry)
      const usage = usageByConnection.get(slug) ?? { totalTokens: 0, requests: 0 }
      usage.totalTokens += entry.totalTokens || 0
      usage.requests += 1
      usageByConnection.set(slug, usage)
    }

    const labelBySlug = new Map<string, string>()
    for (const connection of llmConnections) {
      labelBySlug.set(connection.slug, connection.name || connection.slug)
      if (!usageByConnection.has(connection.slug)) {
        usageByConnection.set(connection.slug, { totalTokens: 0, requests: 0 })
      }
    }

    return Array.from(usageByConnection.entries())
      .map(([slug, usage]) => ({
        slug,
        label: slug === UNKNOWN_CONNECTION_SLUG ? 'No connection' : labelBySlug.get(slug) || slug,
        totalTokens: usage.totalTokens,
        requests: usage.requests,
      }))
      .sort((a, b) => {
        if (a.totalTokens !== b.totalTokens) return b.totalTokens - a.totalTokens
        return a.label.localeCompare(b.label)
      })
  }, [llmConnections, stats?.entries])

  const allConnectionSlugs = React.useMemo(() => connectionOptions.map(option => option.slug), [connectionOptions])
  const selectedConnectionSet = React.useMemo(() => selectedConnectionSlugs == null ? null : new Set(selectedConnectionSlugs), [selectedConnectionSlugs])
  const filteredEntries = React.useMemo(() => {
    if (!stats) return []
    if (!selectedConnectionSet) return stats.entries
    return stats.entries.filter(entry => selectedConnectionSet.has(entryConnectionSlug(entry)))
  }, [selectedConnectionSet, stats])
  const filteredStats = React.useMemo(() => buildStatsFromEntries(stats, filteredEntries), [filteredEntries, stats])
  const totals = filteredStats.totals
  const selectedConnectionLabel = selectedConnectionSlugs == null
    ? 'All connections'
    : selectedConnectionSlugs.length === 1
      ? connectionOptions.find(option => option.slug === selectedConnectionSlugs[0])?.label ?? '1 connection'
      : `${selectedConnectionSlugs.length} connections`

  const setAllConnections = React.useCallback(() => {
    setSelectedConnectionSlugs(null)
  }, [])

  const toggleConnection = React.useCallback((slug: string, checked: boolean) => {
    setSelectedConnectionSlugs(current => {
      if (checked) {
        if (current == null) return null
        const next = Array.from(new Set([...current, slug]))
        return next.length >= allConnectionSlugs.length ? null : next
      }

      const currentSlugs = current == null ? allConnectionSlugs : current
      return currentSlugs.filter(item => item !== slug)
    })
  }, [allConnectionSlugs])

  return (
    <div className="space-y-4">
          <div className="flex max-w-full flex-wrap items-center gap-2 overflow-hidden">
            {(['day', 'week', 'all'] as RangeMode[]).map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={cn(
                  'h-8 rounded-[8px] px-3 text-[13px] font-medium transition-colors',
                  mode === item ? 'bg-foreground text-background' : 'bg-foreground/[0.04] text-foreground hover:bg-foreground/[0.07]',
                )}
              >
                {item === 'day' ? 'Day' : item === 'week' ? 'Week' : 'All'}
              </button>
            ))}
            {mode === 'day' && (
              <input
                type="date"
                value={dateValue}
                onChange={event => setDateValue(event.target.value)}
                className="h-8 w-[148px] shrink-0 rounded-[8px] bg-foreground/[0.04] px-2 text-[13px] outline-none ring-1 ring-foreground/[0.06]"
              />
            )}
            {mode === 'week' && (
              <input
                type="week"
                value={weekValue}
                onChange={event => setWeekValue(event.target.value)}
                className="h-8 w-[148px] shrink-0 rounded-[8px] bg-foreground/[0.04] px-2 text-[13px] outline-none ring-1 ring-foreground/[0.06]"
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="max-w-[220px] shrink-0 gap-1.5">
                  <span className="truncate">{selectedConnectionLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72" style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
                <DropdownMenuCheckboxItem
                  checked={selectedConnectionSlugs == null}
                  onCheckedChange={setAllConnections}
                  onSelect={event => event.preventDefault()}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span>All connections</span>
                    {selectedConnectionSlugs == null && <Check className="h-3.5 w-3.5 opacity-60" />}
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {connectionOptions.length > 0 ? connectionOptions.map(option => {
                  const checked = selectedConnectionSlugs == null || selectedConnectionSlugs.includes(option.slug)
                  return (
                    <DropdownMenuCheckboxItem
                      key={option.slug}
                      checked={checked}
                      onCheckedChange={next => toggleConnection(option.slug, Boolean(next))}
                      onSelect={event => event.preventDefault()}
                    >
                      <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                        <span className="truncate">{option.label}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatTokenCount(option.totalTokens)}</span>
                      </div>
                    </DropdownMenuCheckboxItem>
                  )
                }) : (
                  <DropdownMenuItem disabled>No connections</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="ghost" size="sm" onClick={loadStats} disabled={loading || !workspaceId} className="shrink-0 gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>

          {error && <div className="rounded-[8px] bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

          <div className="grid auto-rows-fr grid-cols-2 gap-2 md:grid-cols-4">
            <MetricCard label="Total tokens" value={formatTokenCount(totals?.totalTokens)} icon={<BarChart3 className="h-3 w-3" />} />
            <MetricCard label="Input" value={formatTokenCount(totals?.inputTokens)} />
            <MetricCard label="Output" value={formatTokenCount(totals?.outputTokens)} />
            <MetricCard label="Cost" value={formatUsd(totals?.costUsd)} icon={<DollarSign className="h-3 w-3" />} />
            <MetricCard label="Cache read" value={formatTokenCount(totals?.cacheReadTokens)} />
            <MetricCard label="Cache creation" value={formatTokenCount(totals?.cacheCreationTokens)} />
            <MetricCard label="Cache read ratio" value={formatPercent(cacheRatio(totals))} />
            <MetricCard label="Requests" value={formatTokenCount(totals?.requests)} />
          </div>

          <div className="rounded-[12px] ring-1 ring-foreground/[0.06] overflow-hidden">
            <div className="flex items-center justify-between border-b border-foreground/[0.06] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {mode === 'day' ? <Calendar className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                Sessions
              </div>
              <div className="text-[11px] text-muted-foreground">{filteredStats.bySession.length}</div>
            </div>
            <div className={cn(sessionsMaxHeight, "overflow-y-auto")}>
              {loading ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</div>
              ) : stats && filteredStats.bySession.length > 0 ? (
                filteredStats.bySession.map(session => (
                  <div key={session.sessionId} className="flex items-center gap-3 border-b border-foreground/[0.04] px-3 py-2 last:border-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{session.sessionName || session.sessionId}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Input {formatTokenCount(session.inputTokens)} · Output {formatTokenCount(session.outputTokens)} · Cache {formatPercent(cacheRatio(session))}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-semibold tabular-nums">{formatTokenCount(session.totalTokens)}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">{formatUsd(session.costUsd)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">No usage in this range.</div>
              )}
            </div>
          </div>
    </div>
  )
}

export function UsageStatsDialog({ open, onOpenChange, workspaceId }: UsageStatsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),900px)] sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Usage
          </DialogTitle>
          <DialogDescription>
            Token usage by day, week, and all time. Older sessions may be estimated from session totals.
          </DialogDescription>
        </DialogHeader>
        <UsageStatsContent workspaceId={workspaceId} active={open} />
      </DialogContent>
    </Dialog>
  )
}
