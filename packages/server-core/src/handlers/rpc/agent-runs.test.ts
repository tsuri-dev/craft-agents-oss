import { describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { scanWorkspaceAgentRuns } from './agent-runs'

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-runs-'))
}

describe('agent-runs RPC scanner', () => {
  it('scans agent run manifests under session agent-runs folders', () => {
    const workspace = tempWorkspace()
    const runDir = join(workspace, 'sessions', 'parent-1', 'agent-runs', 'run-1')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'manifest.json'), JSON.stringify({
      agentProfileId: 'orion',
      triggerType: 'mention',
      triggerSummary: 'Do the thing',
      status: 'completed',
      createdAt: '2026-05-20T10:00:00+08:00',
      startedAt: '2026-05-20T10:00:30+08:00',
      completedAt: '2026-05-20T10:02:00+08:00',
      artifactCount: 2,
    }))

    const runs = scanWorkspaceAgentRuns(workspace, 'orion')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      id: 'run-1',
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      triggerSummary: 'Do the thing',
      status: 'completed',
      artifactCount: 2,
    })
    expect(runs[0]?.manifestPath).toContain('manifest.json')
  })

  it('filters by agent profile id and ignores invalid manifests', () => {
    const workspace = tempWorkspace()
    const validDir = join(workspace, 'sessions', 'parent-1', 'agent-runs', 'run-valid')
    const otherDir = join(workspace, 'sessions', 'parent-1', 'agent-runs', 'run-other')
    const invalidDir = join(workspace, 'sessions', 'parent-1', 'agent-runs', 'run-invalid')
    mkdirSync(validDir, { recursive: true })
    mkdirSync(otherDir, { recursive: true })
    mkdirSync(invalidDir, { recursive: true })
    writeFileSync(join(validDir, 'manifest.json'), JSON.stringify({
      agentProfileId: 'orion',
      triggerSummary: 'Valid',
      status: 'completed',
      createdAt: '2026-05-20T10:00:00+08:00',
      completedAt: '2026-05-20T10:02:00+08:00',
    }))
    writeFileSync(join(otherDir, 'manifest.json'), JSON.stringify({
      agentProfileId: 'reviewer',
      triggerSummary: 'Other',
      status: 'completed',
      createdAt: '2026-05-20T10:00:00+08:00',
      completedAt: '2026-05-20T10:02:00+08:00',
    }))
    writeFileSync(join(invalidDir, 'manifest.json'), JSON.stringify({
      agentProfileId: 'orion',
      triggerSummary: 'Invalid',
      status: 'not-a-status',
      createdAt: '2026-05-20T10:00:00+08:00',
    }))

    const runs = scanWorkspaceAgentRuns(workspace, 'orion')
    expect(runs.map(run => run.id)).toEqual(['run-valid'])
  })
})
