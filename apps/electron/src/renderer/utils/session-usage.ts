import type { SessionMeta } from '@/atoms/sessions'
import type { SessionUsageEntry, UsageStatsRange, UsageTotals } from '@craft-agent/shared/protocol'

export function formatTokenCount(value: number | undefined): string {
  const n = value ?? 0
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(Math.round(n))
}

export function formatUsd(value: number | undefined): string {
  const n = value ?? 0
  if (n <= 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

export function formatPercent(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '0%'
  return `${Math.round(value * 100)}%`
}

export function getCacheReadRatio(inputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0): number {
  const denom = inputTokens + cacheReadTokens + cacheCreationTokens
  if (denom <= 0) return 0
  return cacheReadTokens / denom
}

export function getSessionUsageTotals(session: SessionMeta): UsageTotals {
  const usage = session.tokenUsage
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
    costUsd: usage?.costUsd ?? 0,
    requests: usage?.totalTokens ? 1 : 0,
  }
}

export function buildDayUsageRange(dateValue: string): UsageStatsRange {
  const [year, month, day] = dateValue.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  const end = new Date(start)
  end.setDate(start.getDate() + 1)
  return { kind: 'day', start: start.getTime(), end: end.getTime() }
}

export function buildWeekUsageRange(weekValue: string): UsageStatsRange {
  const [yearPart, weekPart] = weekValue.split('-W')
  const year = Number(yearPart)
  const week = Number(weekPart)
  const jan4 = new Date(year, 0, 4)
  const jan4Day = jan4.getDay() || 7
  const monday = new Date(jan4)
  monday.setDate(jan4.getDate() - jan4Day + 1 + (week - 1) * 7)
  monday.setHours(0, 0, 0, 0)
  const end = new Date(monday)
  end.setDate(monday.getDate() + 7)
  return { kind: 'week', start: monday.getTime(), end: end.getTime() }
}

export function toDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = `${date.getMonth() + 1}`.padStart(2, '0')
  const d = `${date.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function toWeekInputValue(date: Date): string {
  const target = new Date(date)
  target.setHours(0, 0, 0, 0)
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7))
  const week1 = new Date(target.getFullYear(), 0, 4)
  const week = 1 + Math.round(((target.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`
}

export function summarizeUsageEntries(entries: SessionUsageEntry[]): UsageTotals {
  return entries.reduce<UsageTotals>((acc, entry) => {
    acc.inputTokens += entry.inputTokens || 0
    acc.outputTokens += entry.outputTokens || 0
    acc.totalTokens += entry.totalTokens || 0
    acc.cacheReadTokens += entry.cacheReadTokens || 0
    acc.cacheCreationTokens += entry.cacheCreationTokens || 0
    acc.costUsd += entry.costUsd || 0
    acc.requests += 1
    return acc
  }, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    requests: 0,
  })
}
