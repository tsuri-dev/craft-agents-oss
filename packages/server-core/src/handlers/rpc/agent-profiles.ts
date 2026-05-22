import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import {
  DEFAULT_AGENT_PROFILE_DETAILS,
  cloneAgentProfileDetail,
  getDefaultAgentProfileDetail,
  type AgentProfile,
  type AgentProfileCreateInput,
  type AgentProfileDetail,
  type AgentProfileStatus,
  type AgentProfileUpdateInput,
} from '@craft-agent/shared/agent-profiles'
import { isValidThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.agentProfiles.LIST,
  RPC_CHANNELS.agentProfiles.GET,
  RPC_CHANNELS.agentProfiles.CREATE,
  RPC_CHANNELS.agentProfiles.UPDATE,
] as const

const PROFILE_FILENAME = 'profile.json'
const INSTRUCTIONS_FILENAME = 'instructions.md'
const VALID_PROFILE_STATUSES = new Set<AgentProfileStatus>(['ready', 'draft'])
const VALID_PERMISSION_MODES = new Set(['safe', 'ask', 'allow-all'])

export function registerAgentProfilesHandlers(server: RpcServer, _deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.agentProfiles.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return listAgentProfiles(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.agentProfiles.GET, async (_ctx, workspaceId: string, agentProfileId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const profile = readAgentProfileDetail(workspace.rootPath, agentProfileId)
    if (!profile) throw new Error(`Agent profile not found: ${agentProfileId}`)
    return profile
  })

  server.handle(RPC_CHANNELS.agentProfiles.CREATE, async (_ctx, workspaceId: string, input: AgentProfileCreateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return createAgentProfile(workspace.rootPath, input)
  })

  server.handle(RPC_CHANNELS.agentProfiles.UPDATE, async (_ctx, workspaceId: string, agentProfileId: string, input: AgentProfileUpdateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return updateAgentProfile(workspace.rootPath, agentProfileId, input)
  })
}

export function listAgentProfiles(workspaceRootPath: string): AgentProfile[] {
  const byId = new Map<string, AgentProfileDetail>()
  for (const profile of DEFAULT_AGENT_PROFILE_DETAILS) {
    byId.set(profile.id, cloneAgentProfileDetail(profile))
  }

  const agentsDir = getAgentsDir(workspaceRootPath)
  for (const id of safeReadDir(agentsDir)) {
    const detail = readAgentProfileDetail(workspaceRootPath, id)
    if (detail) byId.set(detail.id, detail)
  }

  return Array.from(byId.values())
    .map(stripInstructions)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function readAgentProfileDetail(workspaceRootPath: string, agentProfileId: string): AgentProfileDetail | null {
  const dir = getAgentProfileDir(workspaceRootPath, agentProfileId)
  const profilePath = join(dir, PROFILE_FILENAME)
  const instructionsPath = join(dir, INSTRUCTIONS_FILENAME)
  const fallback = getDefaultAgentProfileDetail(agentProfileId)

  if (!existsSync(profilePath) && !fallback) return null

  let profile: AgentProfileDetail = fallback ?? createBlankProfile(agentProfileId)
  if (existsSync(profilePath)) {
    try {
      const parsed = JSON.parse(readFileSync(profilePath, 'utf-8')) as Partial<AgentProfile>
      profile = normalizeProfile({ ...profile, ...parsed, id: parsed.id || agentProfileId }, fallback ?? profile)
    } catch {
      profile = fallback ?? profile
    }
  }

  const instructions = existsSync(instructionsPath)
    ? readFileSync(instructionsPath, 'utf-8')
    : profile.instructions

  return {
    ...profile,
    instructions,
    profilePath,
    instructionsPath,
  }
}

export function createAgentProfile(workspaceRootPath: string, input: AgentProfileCreateInput): AgentProfileDetail {
  const id = uniqueAgentProfileId(workspaceRootPath, slugifyAgentProfileId(input.name || 'agent'))
  return updateAgentProfile(workspaceRootPath, id, {
    profile: {
      name: input.name,
      description: input.description ?? '',
      status: 'draft',
      visibility: 'workspace',
      connectionSlug: input.connectionSlug,
      model: input.model,
      thinkingLevel: input.thinkingLevel ?? 'medium',
      permissionMode: input.permissionMode ?? 'ask',
      skillSlugs: input.skillSlugs ?? [],
      sourceSlugs: input.sourceSlugs ?? [],
      environmentVariables: input.environmentVariables ?? {},
    },
    instructions: input.instructions ?? '',
  })
}

export function updateAgentProfile(workspaceRootPath: string, agentProfileId: string, input: AgentProfileUpdateInput): AgentProfileDetail {
  const existing = readAgentProfileDetail(workspaceRootPath, agentProfileId) ?? createBlankProfile(agentProfileId)
  const now = Date.now()
  const merged = normalizeProfile({
    ...existing,
    ...input.profile,
    id: agentProfileId,
    updatedAt: now,
    createdAt: existing.createdAt || now,
  }, existing)
  const instructions = input.instructions ?? existing.instructions
  const dir = getAgentProfileDir(workspaceRootPath, agentProfileId)
  mkdirSync(dir, { recursive: true })
  const profilePath = join(dir, PROFILE_FILENAME)
  const instructionsPath = join(dir, INSTRUCTIONS_FILENAME)
  writeFileSync(profilePath, `${JSON.stringify(stripInstructions(merged), null, 2)}\n`, 'utf-8')
  writeFileSync(instructionsPath, instructions, 'utf-8')
  return {
    ...merged,
    instructions,
    profilePath,
    instructionsPath,
  }
}

function normalizeProfile(candidate: AgentProfileDetail | (Partial<AgentProfile> & { instructions?: string }), fallback: AgentProfileDetail): AgentProfileDetail {
  return {
    id: typeof candidate.id === 'string' && candidate.id ? candidate.id : fallback.id,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : fallback.name,
    description: typeof candidate.description === 'string' ? candidate.description : fallback.description,
    status: VALID_PROFILE_STATUSES.has(candidate.status as AgentProfileStatus) ? candidate.status as AgentProfileStatus : fallback.status,
    visibility: 'workspace',
    connectionSlug: typeof candidate.connectionSlug === 'string' ? candidate.connectionSlug : fallback.connectionSlug,
    model: typeof candidate.model === 'string' ? candidate.model : fallback.model,
    thinkingLevel: isValidThinkingLevel(candidate.thinkingLevel) ? candidate.thinkingLevel : fallback.thinkingLevel,
    permissionMode: VALID_PERMISSION_MODES.has(candidate.permissionMode as string) ? candidate.permissionMode as AgentProfile['permissionMode'] : fallback.permissionMode,
    skillSlugs: Array.isArray(candidate.skillSlugs) ? candidate.skillSlugs.filter(isNonEmptyString) : [...fallback.skillSlugs],
    sourceSlugs: Array.isArray(candidate.sourceSlugs) ? candidate.sourceSlugs.filter(isNonEmptyString) : [...fallback.sourceSlugs],
    environmentVariables: normalizeEnvironmentVariables(candidate.environmentVariables, fallback.environmentVariables),
    instructions: typeof candidate.instructions === 'string' ? candidate.instructions : fallback.instructions,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : fallback.createdAt,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : fallback.updatedAt,
  }
}

function createBlankProfile(agentProfileId: string): AgentProfileDetail {
  const now = Date.now()
  return {
    id: agentProfileId,
    name: agentProfileId,
    description: '',
    status: 'draft',
    visibility: 'workspace',
    thinkingLevel: 'medium',
    permissionMode: 'ask',
    skillSlugs: [],
    sourceSlugs: [],
    environmentVariables: {},
    instructions: '',
    createdAt: now,
    updatedAt: now,
  }
}

function stripInstructions(detail: AgentProfileDetail): AgentProfile {
  const { instructions: _instructions, profilePath: _profilePath, instructionsPath: _instructionsPath, ...profile } = detail
  return profile
}

function getAgentsDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'agents')
}

function getAgentProfileDir(workspaceRootPath: string, agentProfileId: string): string {
  return join(getAgentsDir(workspaceRootPath), sanitizeFileName(agentProfileId))
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'agent'
}

function slugifyAgentProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

function uniqueAgentProfileId(workspaceRootPath: string, baseId: string): string {
  let id = baseId
  let suffix = 2
  while (readAgentProfileDetail(workspaceRootPath, id)) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  return id
}

function safeReadDir(path: string): string[] {
  try {
    if (!safeIsDirectory(path)) return []
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

function normalizeEnvironmentVariables(candidate: unknown, fallback: Record<string, string>): Record<string, string> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ...fallback }
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(candidate)) {
    const trimmedKey = key.trim()
    if (!trimmedKey) continue
    result[trimmedKey] = typeof value === 'string' ? value : String(value ?? '')
  }
  return result
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
