import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { AgentRun, AgentRunStatus, AgentRunTriggerType } from '@craft-agent/shared/agent-runs'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agentRuns.LIST,
] as const

const VALID_STATUSES = new Set<AgentRunStatus>(['queued', 'running', 'stopping', 'completed', 'failed', 'cancelled'])
const VALID_TRIGGER_TYPES = new Set<AgentRunTriggerType>(['mention', 'manual', 'automation', 'tapd'])

interface ListAgentRunsInput {
  agentProfileId?: string
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
