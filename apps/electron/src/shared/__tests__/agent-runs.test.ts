import { describe, expect, it } from 'bun:test'
import {
  AGENT_RUN_MOCK_NOW,
  MOCK_AGENT_RUNS,
  getActiveAgentRuns,
  getRecentFinishedAgentRuns,
  summarizeAgentRunsLast30Days,
  type AgentRun,
} from '../agent-runs'

describe('agent-runs helpers', () => {
  it('lists active runs separately from finished runs', () => {
    const active = getActiveAgentRuns('qqnews-implementation')
    expect(active.map(run => run.id)).toEqual(['run-orion-active-1'])
  })

  it('limits recent finished runs to the latest 10 by default', () => {
    const recent = getRecentFinishedAgentRuns('qqnews-implementation')
    expect(recent).toHaveLength(10)
    expect(recent[0]?.id).toBe('run-orion-001')
    expect(recent.at(-1)?.id).toBe('run-orion-010')
  })

  it('supports an explicit recent finished run limit', () => {
    const recent = getRecentFinishedAgentRuns('qqnews-implementation', 3)
    expect(recent.map(run => run.id)).toEqual(['run-orion-001', 'run-orion-002', 'run-orion-003'])
  })

  it('summarizes finished runs in the last 30 days', () => {
    const summary = summarizeAgentRunsLast30Days('qqnews-implementation', MOCK_AGENT_RUNS, AGENT_RUN_MOCK_NOW)
    expect(summary.totalRuns).toBe(12)
    expect(summary.totalFailed).toBe(1)
    expect(summary.totalCancelled).toBe(1)
    expect(summary.successPct).toBe(83)
    expect(summary.avgDurationMs).toBeGreaterThan(0)
    expect(summary.buckets).toHaveLength(30)
  })

  it('ignores future and out-of-window finished runs', () => {
    const runs: AgentRun[] = [
      {
        id: 'old',
        agentProfileId: 'a',
        parentSessionId: 'p',
        triggerType: 'manual',
        triggerSummary: 'old',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00+08:00',
        startedAt: '2026-01-01T00:00:00+08:00',
        completedAt: '2026-01-01T00:01:00+08:00',
      },
      {
        id: 'future',
        agentProfileId: 'a',
        parentSessionId: 'p',
        triggerType: 'manual',
        triggerSummary: 'future',
        status: 'completed',
        createdAt: '2026-06-01T00:00:00+08:00',
        startedAt: '2026-06-01T00:00:00+08:00',
        completedAt: '2026-06-01T00:01:00+08:00',
      },
    ]

    const summary = summarizeAgentRunsLast30Days('a', runs, AGENT_RUN_MOCK_NOW)
    expect(summary.totalRuns).toBe(0)
  })
})
