import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS, type RequirementComment } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { AgentRun, AgentRunStatus, AgentRunTriggerType } from '@craft-agent/shared/agent-runs'
import { getTapdRequirementBaseDir, upsertTapdRequirementLocalComment } from '../../requirements/tapd-storage'
import { readAgentProfileDetail } from './agent-profiles'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agentRuns.LIST,
  RPC_CHANNELS.agentRuns.CANCEL,
] as const

const VALID_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'stopping', 'completed', 'failed', 'cancelled'])
const VALID_TRIGGER_TYPES = new Set<AgentRunTriggerType>(['mention', 'follow-up', 'manual', 'automation', 'tapd'])

interface ListAgentRunsInput {
  agentProfileId?: string
  target?: { type: 'requirement'; pluginId: string; sourceItemId: string } | { type: 'session'; sessionId: string }
}

interface CancelAgentRunInput {
  runId: string
  parentSessionId?: string
  childSessionId?: string
}

export function registerAgentRunsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.agentRuns.LIST, async (_ctx, workspaceId: string, input: ListAgentRunsInput = {}) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

    try {
      return scanWorkspaceAgentRuns(workspace.rootPath, input.agentProfileId, input.target)
    } catch (error) {
      log.warn?.('[agent-runs] failed to scan workspace agent runs', {
        workspaceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  })

  server.handle(RPC_CHANNELS.agentRuns.CANCEL, async (_ctx, workspaceId: string, input: CancelAgentRunInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    if (!input?.runId) throw new Error('runId is required')

    const run = findAgentRun(workspace.rootPath, input)
    if (!run) return null

    if (run.childSessionId) {
      try {
        await deps.sessionManager.cancelProcessing(run.childSessionId, false)
      } catch (error) {
        log.warn?.('[agent-runs] failed to cancel child session for run', {
          workspaceId,
          runId: run.id,
          childSessionId: run.childSessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const updated = updateAgentRunStatus(run, 'cancelled', 'Cancelled by user')
    upsertRequirementAgentRunComment(workspace.rootPath, updated)
    return updated
  })
}

export function cancelAgentRunManifest(workspaceRootPath: string, input: CancelAgentRunInput): AgentRun | null {
  const run = findAgentRun(workspaceRootPath, input)
  if (!run) return null
  const updated = updateAgentRunStatus(run, 'cancelled', 'Cancelled by user')
  upsertRequirementAgentRunComment(workspaceRootPath, updated)
  return updated
}

export function scanWorkspaceAgentRuns(workspaceRootPath: string, agentProfileId?: string, target?: ListAgentRunsInput['target']): AgentRun[] {
  const runs: AgentRun[] = []
  const sessionsDir = join(workspaceRootPath, 'sessions')

  for (const sessionId of safeReadDir(sessionsDir)) {
    const agentRunsDir = join(sessionsDir, sessionId, 'agent-runs')
    if (!safeIsDirectory(agentRunsDir)) continue

    for (const runId of safeReadDir(agentRunsDir)) {
      const manifestPath = join(agentRunsDir, runId, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      const run = readAgentRunManifest(manifestPath, sessionId, runId)
      if (!run) continue
      if (agentProfileId && run.agentProfileId !== agentProfileId) continue
      if (target && !agentRunMatchesTarget(run, target)) continue
      runs.push(run)
    }
  }

  const requirementsDir = join(workspaceRootPath, 'requirements', 'tapd')
  if (existsSync(requirementsDir)) {
    for (const sourceItemId of safeReadDir(requirementsDir)) {
      const agentRunsDir = join(requirementsDir, sourceItemId, 'agent-runs')
      if (!safeIsDirectory(agentRunsDir)) continue
      for (const runId of safeReadDir(agentRunsDir)) {
        const manifestPath = join(agentRunsDir, runId, 'manifest.json')
        if (!existsSync(manifestPath)) continue
        const run = readAgentRunManifest(manifestPath, `requirement:tapd:${sourceItemId}`, runId)
        if (!run) continue
        if (agentProfileId && run.agentProfileId !== agentProfileId) continue
        if (target && !agentRunMatchesTarget(run, target)) continue
        runs.push(run)
      }
    }
  }

  return runs.sort((a, b) => getRunSortTime(b) - getRunSortTime(a))
}

function agentRunMatchesTarget(run: AgentRun, target: NonNullable<ListAgentRunsInput['target']>): boolean {
  if (target.type === 'session') {
    return run.target?.type === 'session'
      ? run.target.sessionId === target.sessionId
      : run.parentSessionId === target.sessionId
  }
  return run.target?.type === 'requirement'
    && run.target.pluginId === target.pluginId
    && run.target.sourceItemId === target.sourceItemId
}

function upsertRequirementAgentRunComment(workspaceRootPath: string, run: AgentRun): void {
  if (run.target?.type !== 'requirement') return
  const profile = readAgentProfileDetail(workspaceRootPath, run.agentProfileId)
  const profileName = profile?.name ?? run.agentProfileId
  const now = new Date().toISOString()
  const artifactPaths = [
    join(getTapdRequirementBaseDir(workspaceRootPath, run.target.sourceItemId), 'agent-runs', run.id),
    run.summaryPath,
    run.transcriptPath,
  ].filter((value): value is string => Boolean(value))
  const statusLabel = run.status === 'cancelled' ? 'was cancelled' : run.status
  const body = run.failureReason
    ? `${profileName} ${statusLabel}: ${run.failureReason}`
    : `${profileName} ${statusLabel}.`
  const comment: RequirementComment = {
    id: `agent-run-${run.id}`,
    origin: 'agent',
    author: profileName,
    title: `${profileName} ${statusLabel}`,
    body,
    createdAt: run.createdAt,
    updatedAt: now,
    agentRunId: run.id,
    agentProfileId: run.agentProfileId,
    status: run.status,
    childSessionId: run.childSessionId,
    artifactPaths,
    ...(run.summaryPath ? { summaryPath: run.summaryPath } : {}),
    ...(run.transcriptPath ? { transcriptPath: run.transcriptPath } : {}),
    raw: { runId: run.id, target: run.target, manifestPath: run.manifestPath },
  }
  upsertTapdRequirementLocalComment(workspaceRootPath, run.target.sourceItemId, comment)
}

function readAgentRunManifest(manifestPath: string, parentSessionIdFallback: string, runIdFallback: string): AgentRun | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Partial<AgentRun>
    if (!parsed.agentProfileId || !parsed.triggerSummary || !parsed.status) return null
    if (!VALID_STATUSES.has(parsed.status)) return null
    const triggerType = VALID_TRIGGER_TYPES.has(parsed.triggerType as AgentRunTriggerType)
      ? parsed.triggerType as AgentRunTriggerType
      : 'manual'

    return {
      id: parsed.id || runIdFallback,
      agentProfileId: parsed.agentProfileId,
      parentSessionId: parsed.parentSessionId || parentSessionIdFallback,
      target: parsed.target,
      childSessionId: parsed.childSessionId,
      triggerType,
      triggerSummary: parsed.triggerSummary,
      status: parsed.status,
      failureReason: parsed.failureReason,
      createdAt: parsed.createdAt || new Date(0).toISOString(),
      startedAt: parsed.startedAt,
      completedAt: parsed.completedAt,
      toolCount: parsed.toolCount,
      artifactCount: parsed.artifactCount,
      summaryPath: parsed.summaryPath,
      manifestPath: parsed.manifestPath || manifestPath,
      transcriptPath: parsed.transcriptPath,
    }
  } catch {
    return null
  }
}

function findAgentRun(workspaceRootPath: string, input: CancelAgentRunInput): AgentRun | null {
  const run = scanWorkspaceAgentRuns(workspaceRootPath).find(candidate => {
    if (candidate.id !== input.runId) return false
    if (input.parentSessionId && candidate.parentSessionId !== input.parentSessionId) return false
    if (input.childSessionId && candidate.childSessionId !== input.childSessionId) return false
    return true
  })
  return run ?? null
}

function updateAgentRunStatus(run: AgentRun, status: AgentRunStatus, failureReason?: string): AgentRun {
  const manifestPath = run.manifestPath
  if (!manifestPath) throw new Error(`AgentRun ${run.id} has no manifestPath`)

  const now = new Date().toISOString()
  const completedAt = status === 'queued' || status === 'running' || status === 'stopping'
    ? run.completedAt
    : now
  const updated: AgentRun = {
    ...run,
    status,
    failureReason,
    completedAt,
  }

  writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8')

  const transcriptPath = run.transcriptPath || join(dirname(manifestPath), 'transcript.jsonl')
  appendFileSync(transcriptPath, `${JSON.stringify({
    timestamp: now,
    type: 'agent_run_cancelled',
    runId: run.id,
    childSessionId: run.childSessionId,
    status,
    failureReason,
  })}\n`, 'utf-8')

  return updated
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path)
  } catch {
    return []
  }
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function getRunSortTime(run: AgentRun): number {
  return Date.parse(run.completedAt ?? run.startedAt ?? run.createdAt)
}
