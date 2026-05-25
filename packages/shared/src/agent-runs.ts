export type AgentRunStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled'

export type AgentRunTriggerType = 'mention' | 'follow-up' | 'manual' | 'automation' | 'tapd'

export type AgentRunTarget =
  | { type: 'session'; sessionId: string }
  | { type: 'requirement'; pluginId: string; sourceItemId: string }

export const AGENT_TASK_LABEL_ID = 'agent-task'

export function hasAgentTaskLabel(labels?: readonly string[]): boolean {
  return labels?.some(label => label === AGENT_TASK_LABEL_ID || label.startsWith(`${AGENT_TASK_LABEL_ID}::`)) ?? false
}

export function withAgentTaskLabel(labels?: readonly string[]): string[] {
  const existing = labels ? [...labels] : []
  return hasAgentTaskLabel(existing) ? existing : [...existing, AGENT_TASK_LABEL_ID]
}

export interface AgentRun {
  id: string
  agentProfileId: string
  /** Backward-compatible parent session id for session-scoped runs. Requirement-scoped runs use a synthetic id and `target`. */
  parentSessionId: string
  target?: AgentRunTarget
  childSessionId?: string
  triggerType: AgentRunTriggerType
  triggerSummary: string
  status: AgentRunStatus
  failureReason?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  toolCount?: number
  artifactCount?: number
  summaryPath?: string
  manifestPath?: string
  transcriptPath?: string
}

export interface AgentRunBucket {
  date: string
  completed: number
  failed: number
  cancelled: number
}

export interface AgentRunSummary {
  totalRuns: number
  totalFailed: number
  totalCancelled: number
  successPct: number
  avgDurationMs: number
  buckets: AgentRunBucket[]
}

export const AGENT_RUN_MOCK_NOW = Date.parse('2026-05-21T15:00:00+08:00')

export const MOCK_AGENT_RUNS: AgentRun[] = [
  {
    id: 'run-orion-active-1',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260506-fresh-pond',
    childSessionId: '260521-agent-orion-active',
    triggerType: 'mention',
    triggerSummary: 'Draft implementation steps for linked TAPD requirement',
    status: 'running',
    createdAt: '2026-05-21T14:42:00+08:00',
    startedAt: '2026-05-21T14:43:10+08:00',
    toolCount: 4,
    artifactCount: 1,
    transcriptPath: 'sessions/260506-fresh-pond/agent-runs/run-orion-active-1/transcript.jsonl',
  },
  {
    id: 'run-orion-001',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260506-fresh-pond',
    childSessionId: '260521-agent-orion-001',
    triggerType: 'tapd',
    triggerSummary: 'CTA-12 电商优惠券 implementation plan',
    status: 'completed',
    createdAt: '2026-05-21T10:18:00+08:00',
    startedAt: '2026-05-21T10:19:12+08:00',
    completedAt: '2026-05-21T10:27:44+08:00',
    toolCount: 9,
    artifactCount: 3,
    summaryPath: 'sessions/260506-fresh-pond/agent-runs/run-orion-001/summary.md',
    manifestPath: 'sessions/260506-fresh-pond/agent-runs/run-orion-001/manifest.json',
    transcriptPath: 'sessions/260506-fresh-pond/agent-runs/run-orion-001/transcript.jsonl',
  },
  {
    id: 'run-orion-002',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260506-fresh-pond',
    childSessionId: '260521-agent-orion-002',
    triggerType: 'mention',
    triggerSummary: 'Review TAPD handoff notes and produce code-change checklist',
    status: 'completed',
    createdAt: '2026-05-20T18:02:00+08:00',
    startedAt: '2026-05-20T18:02:31+08:00',
    completedAt: '2026-05-20T18:08:19+08:00',
    toolCount: 6,
    artifactCount: 2,
  },
  {
    id: 'run-orion-003',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260421-quiet-harbor',
    childSessionId: '260520-agent-orion-003',
    triggerType: 'manual',
    triggerSummary: 'Summarize requirement risks before implementation',
    status: 'failed',
    failureReason: 'Missing linked requirement snapshot',
    createdAt: '2026-05-20T09:31:00+08:00',
    startedAt: '2026-05-20T09:31:20+08:00',
    completedAt: '2026-05-20T09:33:01+08:00',
    toolCount: 2,
    artifactCount: 0,
  },
  {
    id: 'run-orion-004',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260410-green-river',
    childSessionId: '260519-agent-orion-004',
    triggerType: 'automation',
    triggerSummary: 'Prepare daily implementation handoff from open tasks',
    status: 'completed',
    createdAt: '2026-05-19T19:00:00+08:00',
    startedAt: '2026-05-19T19:00:12+08:00',
    completedAt: '2026-05-19T19:03:48+08:00',
    toolCount: 3,
    artifactCount: 1,
  },
  {
    id: 'run-orion-005',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260401-blue-field',
    childSessionId: '260518-agent-orion-005',
    triggerType: 'tapd',
    triggerSummary: 'Break down feed ranking plugin requirement into subtasks',
    status: 'completed',
    createdAt: '2026-05-18T15:16:00+08:00',
    startedAt: '2026-05-18T15:17:05+08:00',
    completedAt: '2026-05-18T15:23:40+08:00',
    toolCount: 8,
    artifactCount: 2,
  },
  {
    id: 'run-orion-006',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260330-silver-moon',
    childSessionId: '260517-agent-orion-006',
    triggerType: 'mention',
    triggerSummary: 'Convert session notes into acceptance criteria',
    status: 'completed',
    createdAt: '2026-05-17T11:08:00+08:00',
    startedAt: '2026-05-17T11:08:37+08:00',
    completedAt: '2026-05-17T11:12:21+08:00',
    toolCount: 4,
    artifactCount: 1,
  },
  {
    id: 'run-orion-007',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260328-warm-valley',
    childSessionId: '260516-agent-orion-007',
    triggerType: 'manual',
    triggerSummary: 'Draft release checklist for TAPD-linked sessions',
    status: 'cancelled',
    createdAt: '2026-05-16T17:30:00+08:00',
    startedAt: '2026-05-16T17:31:00+08:00',
    completedAt: '2026-05-16T17:32:14+08:00',
    toolCount: 1,
    artifactCount: 0,
  },
  {
    id: 'run-orion-008',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260322-little-cloud',
    childSessionId: '260515-agent-orion-008',
    triggerType: 'tapd',
    triggerSummary: 'Identify impacted modules from requirement snapshot',
    status: 'completed',
    createdAt: '2026-05-15T13:04:00+08:00',
    startedAt: '2026-05-15T13:04:32+08:00',
    completedAt: '2026-05-15T13:10:18+08:00',
    toolCount: 5,
    artifactCount: 2,
  },
  {
    id: 'run-orion-009',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260315-soft-meadow',
    childSessionId: '260514-agent-orion-009',
    triggerType: 'mention',
    triggerSummary: 'Write implementation handoff for coupon state machine',
    status: 'completed',
    createdAt: '2026-05-14T16:20:00+08:00',
    startedAt: '2026-05-14T16:21:04+08:00',
    completedAt: '2026-05-14T16:28:39+08:00',
    toolCount: 7,
    artifactCount: 2,
  },
  {
    id: 'run-orion-010',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260301-tall-pine',
    childSessionId: '260513-agent-orion-010',
    triggerType: 'automation',
    triggerSummary: 'Collect open implementation blockers for standup',
    status: 'completed',
    createdAt: '2026-05-13T09:00:00+08:00',
    startedAt: '2026-05-13T09:00:18+08:00',
    completedAt: '2026-05-13T09:02:49+08:00',
    toolCount: 3,
    artifactCount: 1,
  },
  {
    id: 'run-orion-011',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260228-blue-hill',
    childSessionId: '260512-agent-orion-011',
    triggerType: 'manual',
    triggerSummary: 'Draft smoke-test scenarios from linked requirement',
    status: 'completed',
    createdAt: '2026-05-12T20:41:00+08:00',
    startedAt: '2026-05-12T20:41:34+08:00',
    completedAt: '2026-05-12T20:46:22+08:00',
    toolCount: 4,
    artifactCount: 1,
  },
  {
    id: 'run-orion-012',
    agentProfileId: 'qqnews-implementation',
    parentSessionId: '260220-red-bridge',
    childSessionId: '260511-agent-orion-012',
    triggerType: 'tapd',
    triggerSummary: 'Create rollout plan for eligibility rules change',
    status: 'completed',
    createdAt: '2026-05-11T14:11:00+08:00',
    startedAt: '2026-05-11T14:11:56+08:00',
    completedAt: '2026-05-11T14:19:33+08:00',
    toolCount: 6,
    artifactCount: 2,
  },
  {
    id: 'run-reviewer-001',
    agentProfileId: 'reviewer',
    parentSessionId: '260506-fresh-pond',
    childSessionId: '260521-agent-reviewer-001',
    triggerType: 'mention',
    triggerSummary: 'Review Agent Profiles UI route changes',
    status: 'completed',
    createdAt: '2026-05-21T11:10:00+08:00',
    startedAt: '2026-05-21T11:10:31+08:00',
    completedAt: '2026-05-21T11:14:52+08:00',
    toolCount: 3,
    artifactCount: 1,
  },
  {
    id: 'run-handoff-001',
    agentProfileId: 'handoff',
    parentSessionId: '260506-fresh-pond',
    childSessionId: '260521-agent-handoff-001',
    triggerType: 'manual',
    triggerSummary: 'Summarize TAPD plugin cache hydration changes',
    status: 'completed',
    createdAt: '2026-05-20T22:00:00+08:00',
    startedAt: '2026-05-20T22:01:04+08:00',
    completedAt: '2026-05-20T22:04:14+08:00',
    toolCount: 2,
    artifactCount: 2,
  },
]

const ACTIVE_AGENT_RUN_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'stopping'])
const FINISHED_AGENT_RUN_STATUSES = new Set<AgentRunStatus>(['completed', 'failed', 'cancelled'])
const DAY_MS = 24 * 60 * 60 * 1000
const LAST_30_DAYS_MS = 30 * DAY_MS

export function listAgentRuns(agentProfileId: string, runs: readonly AgentRun[] = MOCK_AGENT_RUNS): AgentRun[] {
  return runs
    .filter(run => run.agentProfileId === agentProfileId)
    .sort((a, b) => getRunSortTime(b) - getRunSortTime(a))
}

export function getActiveAgentRuns(agentProfileId: string, runs: readonly AgentRun[] = MOCK_AGENT_RUNS): AgentRun[] {
  return listAgentRuns(agentProfileId, runs)
    .filter(run => ACTIVE_AGENT_RUN_STATUSES.has(run.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function getRecentFinishedAgentRuns(
  agentProfileId: string,
  limit = 10,
  runs: readonly AgentRun[] = MOCK_AGENT_RUNS,
): AgentRun[] {
  return listAgentRuns(agentProfileId, runs)
    .filter(run => FINISHED_AGENT_RUN_STATUSES.has(run.status) && !!run.completedAt)
    .slice(0, limit)
}

export function summarizeAgentRunsLast30Days(
  agentProfileId: string,
  runs: readonly AgentRun[] = MOCK_AGENT_RUNS,
  now = Date.now(),
): AgentRunSummary {
  const windowStart = now - LAST_30_DAYS_MS
  const buckets = createEmptyBuckets(now)
  const bucketMap = new Map(buckets.map(bucket => [bucket.date, bucket]))
  let totalRuns = 0
  let totalFailed = 0
  let totalCancelled = 0
  let durationSum = 0
  let durationCount = 0

  for (const run of listAgentRuns(agentProfileId, runs)) {
    if (!run.completedAt || !FINISHED_AGENT_RUN_STATUSES.has(run.status)) continue
    const completedAt = Date.parse(run.completedAt)
    if (!Number.isFinite(completedAt) || completedAt < windowStart || completedAt > now) continue

    totalRuns += 1
    if (run.status === 'failed') totalFailed += 1
    if (run.status === 'cancelled') totalCancelled += 1

    const bucket = bucketMap.get(toDateKey(completedAt))
    if (bucket) {
      if (run.status === 'completed') bucket.completed += 1
      if (run.status === 'failed') bucket.failed += 1
      if (run.status === 'cancelled') bucket.cancelled += 1
    }

    const duration = getRunDurationMs(run)
    if (duration > 0) {
      durationSum += duration
      durationCount += 1
    }
  }

  const successPct = totalRuns > 0
    ? Math.round(((totalRuns - totalFailed - totalCancelled) / totalRuns) * 100)
    : 100

  return {
    totalRuns,
    totalFailed,
    totalCancelled,
    successPct,
    avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    buckets,
  }
}

export function getRunDurationMs(run: AgentRun, now = Date.now()): number {
  const startedAt = Date.parse(run.startedAt ?? run.createdAt)
  const endedAt = run.completedAt ? Date.parse(run.completedAt) : now
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0
  return Math.max(0, endedAt - startedAt)
}

function getRunSortTime(run: AgentRun): number {
  return Date.parse(run.completedAt ?? run.startedAt ?? run.createdAt)
}

function createEmptyBuckets(now: number): AgentRunBucket[] {
  const today = startOfLocalDay(now)
  return Array.from({ length: 30 }, (_, index) => {
    const timestamp = today - (29 - index) * DAY_MS
    return { date: toDateKey(timestamp), completed: 0, failed: 0, cancelled: 0 }
  })
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
