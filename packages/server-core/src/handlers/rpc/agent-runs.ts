import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { AgentRun, AgentRunStatus, AgentRunTriggerType } from '@craft-agent/shared/agent-runs'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agentRuns.LIST,
  RPC_CHANNELS.agentRuns.CANCEL,
] as const

const VALID_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'stopping', 'completed', 'failed', 'cancelled'])
const VALID_TRIGGER_TYPES = new Set<AgentRunTriggerType>(['mention', 'manual', 'automation', 'tapd'])

interface ListAgentRunsInput {
  agentProfileId?: string
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
      return scanWorkspaceAgentRuns(workspace.rootPath, input.agentProfileId)
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

    return updateAgentRunStatus(run, 'cancelled', 'Cancelled from Agent Activity')
  })
}

export function cancelAgentRunManifest(workspaceRootPath: string, input: CancelAgentRunInput): AgentRun | null {
  const run = findAgentRun(workspaceRootPath, input)
  if (!run) return null
  return updateAgentRunStatus(run, 'cancelled', 'Cancelled from Agent Activity')
}

export function scanWorkspaceAgentRuns(workspaceRootPath: string, agentProfileId?: string): AgentRun[] {
  const sessionsDir = join(workspaceRootPath, 'sessions')
  if (!existsSync(sessionsDir)) return []

  const runs: AgentRun[] = []
  for (const sessionId of safeReadDir(sessionsDir)) {
    const agentRunsDir = join(sessionsDir, sessionId, 'agent-runs')
    if (!safeIsDirectory(agentRunsDir)) continue

    for (const runId of safeReadDir(agentRunsDir)) {
      const manifestPath = join(agentRunsDir, runId, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      const run = readAgentRunManifest(manifestPath, sessionId, runId)
      if (!run) continue
      if (agentProfileId && run.agentProfileId !== agentProfileId) continue
      runs.push(run)
    }
  }

  return runs.sort((a, b) => getRunSortTime(b) - getRunSortTime(a))
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
