import type { PermissionMode } from './agent/mode-types'
import type { ThinkingLevel } from './agent/thinking-levels'

export type AgentProfileStatus = 'ready' | 'draft'
export type AgentProfileVisibility = 'workspace'

export interface AgentProfile {
  id: string
  name: string
  description?: string
  status: AgentProfileStatus
  visibility: AgentProfileVisibility
  connectionSlug?: string
  model?: string
  thinkingLevel: ThinkingLevel
  permissionMode: PermissionMode
  skillSlugs: string[]
  sourceSlugs: string[]
  createdAt: number
  updatedAt: number
}

export interface AgentProfileDetail extends AgentProfile {
  instructions: string
  profilePath?: string
  instructionsPath?: string
}

export interface AgentProfileUpdateInput {
  profile?: Partial<Pick<AgentProfile,
    | 'name'
    | 'description'
    | 'status'
    | 'visibility'
    | 'connectionSlug'
    | 'model'
    | 'thinkingLevel'
    | 'permissionMode'
    | 'skillSlugs'
    | 'sourceSlugs'
  >>
  instructions?: string
}

const NOW = Date.parse('2026-05-21T15:00:00+08:00')

export const DEFAULT_AGENT_PROFILE_DETAILS: AgentProfileDetail[] = [
  {
    id: 'qqnews-implementation',
    name: 'Orion',
    description: 'Breaks down work, drafts specs, keeps the board tidy.',
    status: 'ready',
    visibility: 'workspace',
    connectionSlug: 'claude-code',
    model: 'claude-opus-4-5-20251101',
    thinkingLevel: 'medium',
    permissionMode: 'ask',
    skillSlugs: [],
    sourceSlugs: [],
    instructions: 'You are a Planning Agent. Turn loose ideas and open issues into scoped, ready-to-execute work: break them down into subtasks, write acceptance criteria, and propose owners and sequencing. Prefer clarity over speed. When blocked by missing context, ask one specific question rather than guessing.',
    createdAt: NOW - 8 * 24 * 60 * 60 * 1000,
    updatedAt: NOW - 8 * 24 * 60 * 60 * 1000,
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    description: 'Reviews diffs, calls out risks, and returns a concise review report with suggested follow-ups.',
    status: 'ready',
    visibility: 'workspace',
    connectionSlug: 'claude-code',
    model: 'claude-sonnet-4-5-20250929',
    thinkingLevel: 'medium',
    permissionMode: 'safe',
    skillSlugs: ['receiving-code-review', 'verification-before-completion'],
    sourceSlugs: [],
    instructions: 'Focus on correctness, regressions, maintainability, and test coverage. Do not rewrite code unless explicitly asked.',
    createdAt: NOW - 7 * 24 * 60 * 60 * 1000,
    updatedAt: NOW - 24 * 60 * 60 * 1000,
  },
  {
    id: 'handoff',
    name: 'Handoff Writer',
    description: 'Condenses session outcomes into durable summaries, artifact manifests, and next-step notes.',
    status: 'draft',
    visibility: 'workspace',
    connectionSlug: 'codex',
    model: 'gpt-5.1-mini',
    thinkingLevel: 'low',
    permissionMode: 'ask',
    skillSlugs: ['save-to-tapd-info'],
    sourceSlugs: [],
    instructions: 'Extract decisions, unresolved questions, changed files, commands, and next steps. Prefer writing artifacts instead of long chat replies.',
    createdAt: NOW - 6 * 24 * 60 * 60 * 1000,
    updatedAt: NOW - 2 * 24 * 60 * 60 * 1000,
  },
]

export function getDefaultAgentProfileDetail(agentId: string): AgentProfileDetail | null {
  const profile = DEFAULT_AGENT_PROFILE_DETAILS.find(item => item.id === agentId)
  return profile ? cloneAgentProfileDetail(profile) : null
}

export function listDefaultAgentProfiles(): AgentProfile[] {
  return DEFAULT_AGENT_PROFILE_DETAILS.map(({ instructions: _instructions, profilePath: _profilePath, instructionsPath: _instructionsPath, ...profile }) => ({ ...profile }))
}

export function cloneAgentProfileDetail(profile: AgentProfileDetail): AgentProfileDetail {
  return {
    ...profile,
    skillSlugs: [...profile.skillSlugs],
    sourceSlugs: [...profile.sourceSlugs],
  }
}
