import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { listAgentProfiles, readAgentProfileDetail, updateAgentProfile } from './agent-profiles'

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-profiles-'))
}

describe('agent-profiles file store', () => {
  it('returns default profiles when workspace has no files', () => {
    const workspace = tempWorkspace()
    const profiles = listAgentProfiles(workspace)
    expect(profiles.some(profile => profile.id === 'qqnews-implementation')).toBe(true)
    const detail = readAgentProfileDetail(workspace, 'qqnews-implementation')
    expect(detail?.instructions).toContain('Planning Agent')
  })

  it('writes profile metadata and instructions separately', () => {
    const workspace = tempWorkspace()
    const updated = updateAgentProfile(workspace, 'qqnews-implementation', {
      profile: {
        name: 'Orion 2',
        model: 'claude-sonnet-4-5-20250929',
        thinkingLevel: 'high',
      },
      instructions: 'Use local context first. Save durable handoff notes.',
    })

    expect(updated.name).toBe('Orion 2')
    expect(updated.model).toBe('claude-sonnet-4-5-20250929')
    expect(updated.thinkingLevel).toBe('high')
    expect(updated.instructionsPath).toBeTruthy()
    expect(updated.profilePath).toBeTruthy()
    expect(existsSync(updated.instructionsPath!)).toBe(true)
    expect(readFileSync(updated.instructionsPath!, 'utf-8')).toBe('Use local context first. Save durable handoff notes.')

    const persisted = readAgentProfileDetail(workspace, 'qqnews-implementation')
    expect(persisted?.name).toBe('Orion 2')
    expect(persisted?.instructions).toBe('Use local context first. Save durable handoff notes.')
  })

  it('keeps invalid updates from corrupting constrained fields', () => {
    const workspace = tempWorkspace()
    const updated = updateAgentProfile(workspace, 'qqnews-implementation', {
      profile: {
        // @ts-expect-error deliberate invalid payload shape for runtime guard
        thinkingLevel: 'turbo',
        // @ts-expect-error deliberate invalid payload shape for runtime guard
        permissionMode: 'root',
      },
    })

    expect(updated.thinkingLevel).toBe('medium')
    expect(updated.permissionMode).toBe('ask')
  })
})
