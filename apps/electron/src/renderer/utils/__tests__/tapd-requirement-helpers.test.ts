import { describe, expect, it } from 'bun:test'
import type { AgentProfile, ExternalRequirementItem } from '../../../shared/types'
import {
  buildTapdAgentInstructionPrompt,
  buildTapdRequirementReviewPrompt,
  buildTapdRequirementTaskPrompt,
  resolveDefaultTapdAgent,
  suggestTapdGroupName,
  TAPD_GROUP_NAME_MAX_CHARS,
} from '../tapd-requirement-helpers'

function item(overrides: Partial<ExternalRequirementItem>): ExternalRequirementItem {
  return {
    id: overrides.sourceItemId ?? '1010045201134475108',
    sourceItemId: overrides.sourceItemId ?? '1010045201134475108',
    title: overrides.title ?? '【视频】评论审核链路优化需求',
    ...overrides,
  } as ExternalRequirementItem
}

function agent(overrides: Partial<AgentProfile>): AgentProfile {
  return {
    id: overrides.id ?? 'agent',
    name: overrides.name ?? 'Agent',
    description: '',
    status: 'ready',
    visibility: 'workspace',
    skillSlugs: [],
    sourceSlugs: [],
    environmentVariables: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as AgentProfile
}

describe('tapd-requirement-helpers', () => {
  it('suggests short TAPD group names from noisy titles', () => {
    const suggested = suggestTapdGroupName(item({ title: '【视频】评论审核链路优化需求' }))
    expect(Array.from(suggested).length).toBeLessThanOrEqual(TAPD_GROUP_NAME_MAX_CHARS)
    expect(suggested).toContain('视频')
    expect(suggested).toContain('评论审核')
    expect(suggested).not.toContain('需求')
  })

  it('strips TAPD ids and keeps a compact latin summary', () => {
    expect(suggestTapdGroupName(item({ title: 'TAPD-123456 - Feed Detail Performance Requirement' }))).toBe('Feed Detail')
  })

  it('prefers profiles named Tapd before skill/source fallback', () => {
    const fallback = agent({
      id: 'planner',
      name: 'Planner',
      skillSlugs: ['grill-with-docs'],
      sourceSlugs: ['tapd-mcp-http'],
    })
    const named = agent({ id: 'qqnews-implementation', name: 'Tapd' })

    expect(resolveDefaultTapdAgent([fallback, named])?.id).toBe('qqnews-implementation')
  })

  it('falls back to grill-with-docs plus tapd source when no Tapd-named profile exists', () => {
    const selected = resolveDefaultTapdAgent([
      agent({ id: 'general', name: 'General' }),
      agent({ id: 'reviewer', name: 'Reviewer', skillSlugs: ['grill-with-docs'], sourceSlugs: ['tapd-mcp-http'] }),
    ])

    expect(selected?.id).toBe('reviewer')
  })

  it('builds a delegated Tapd Agent research prompt', () => {
    const prompt = buildTapdRequirementReviewPrompt('tapd-agent', item({
      sourceItemId: '1010045201134475108',
      title: '评论审核优化',
      binding: {
        pluginId: 'tapd',
        sourceItemId: '1010045201134475108',
        groupName: '评论审核',
        createdAt: 1,
        updatedAt: 1,
        itemSnapshot: undefined,
      },
    }))

    expect(prompt).toContain('[agent:tapd-agent]')
    expect(prompt).toContain('TAPD-1010045201134475108')
    expect(prompt).toContain('grill-with-docs')
    expect(prompt).toContain('Concrete confirmation questions')
  })

  it('builds task-specific technical plan prompts with working directory context', () => {
    const prompt = buildTapdRequirementTaskPrompt('tapd-agent', item({
      sourceItemId: '1010045201134475108',
      title: '评论审核优化',
    }), 'write-technical-plan', { workingDirectory: '/Users/tsuri/repo' })

    expect(prompt).toContain('[agent:tapd-agent]')
    expect(prompt).toContain('Write technical plan')
    expect(prompt).toContain('Default working directory: /Users/tsuri/repo')
    expect(prompt).toContain('Validation checklist')
  })

  it('builds a Tapd agent instruction prompt without embedding TAPD source details', () => {
    const prompt = buildTapdAgentInstructionPrompt('tapd-agent', item({
      sourceItemId: '1010045201134475108',
      title: '评论审核优化',
      summary: '需要明确审核规则和异常路径。',
      status: '开发中',
      priority: 'High',
      sourceUrl: 'https://tapd.example/story/detail/1010045201134475108',
    }), { workingDirectory: '/Users/tsuri/repo' })

    expect(prompt).not.toContain('[agent:tapd-agent]')
    expect(prompt).toContain('Use your Agent Profile instructions')
    expect(prompt).toContain('Read the requirement snapshot')
    expect(prompt).toContain('requirement comment')
    expect(prompt).not.toContain('评论审核优化')
    expect(prompt).not.toContain('需要明确审核规则和异常路径')
    expect(prompt).not.toContain('Default working directory: /Users/tsuri/repo')
    expect(prompt).not.toContain('https://tapd.example')
  })
})
