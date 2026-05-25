import type { AgentProfile, ExternalRequirementItem } from '../../shared/types'
import { TAPD_PLUGIN_ID, TAPD_SOURCE_SLUG } from './session-requirement-link'

export const TAPD_CACHE_STORAGE_VERSION = 1
export const TAPD_REVIEW_SKILL_SLUG = 'grill-with-docs'
export const TAPD_GROUP_NAME_MAX_CHARS = 12

export type TapdRequirementAgentTaskId = 'research-requirement' | 'write-technical-plan'

export interface TapdRequirementAgentTask {
  id: TapdRequirementAgentTaskId
  label: string
  description: string
}

export interface TapdRequirementWorkContext {
  workingDirectory?: string
  updatedAt?: number
}

export const TAPD_REQUIREMENT_AGENT_TASKS: TapdRequirementAgentTask[] = [
  {
    id: 'research-requirement',
    label: 'Research requirement',
    description: 'Find unclear points, missing acceptance criteria, edge cases, dependencies, and confirmation questions.',
  },
  {
    id: 'write-technical-plan',
    label: 'Write technical plan',
    description: 'Draft a scoped implementation plan with risks, milestones, and validation checklist.',
  },
]

export interface TapdRequirementCache {
  version: 1
  itemsById: Record<string, ExternalRequirementItem>
  listOrder: string[]
  lastSyncedAt?: number
  total?: number
}

export function getTapdRequirementCacheStorageKey(workspaceId: string | null | undefined) {
  return `requirement-board.${TAPD_PLUGIN_ID}.cache.${workspaceId ?? 'default'}.manual`
}

export function emptyTapdRequirementCache(): TapdRequirementCache {
  return { version: TAPD_CACHE_STORAGE_VERSION, itemsById: {}, listOrder: [] }
}

export function readTapdRequirementCache(workspaceId: string | null | undefined): TapdRequirementCache {
  if (typeof window === 'undefined' || !window.localStorage) return emptyTapdRequirementCache()
  try {
    const raw = window.localStorage.getItem(getTapdRequirementCacheStorageKey(workspaceId))
    if (!raw) return emptyTapdRequirementCache()
    const parsed = JSON.parse(raw) as Partial<TapdRequirementCache>
    return {
      version: TAPD_CACHE_STORAGE_VERSION,
      itemsById: parsed.itemsById ?? {},
      listOrder: parsed.listOrder ?? [],
      lastSyncedAt: parsed.lastSyncedAt,
      total: parsed.total,
    }
  } catch {
    return emptyTapdRequirementCache()
  }
}

export function writeTapdRequirementCache(workspaceId: string | null | undefined, cache: TapdRequirementCache) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(getTapdRequirementCacheStorageKey(workspaceId), JSON.stringify(cache))
  } catch {
    // Cache is an optimization; ignore storage failures.
  }
}

export function upsertTapdCachedItem(workspaceId: string | null | undefined, item: ExternalRequirementItem) {
  const current = readTapdRequirementCache(workspaceId)
  const listOrder = current.listOrder.includes(item.sourceItemId) ? current.listOrder : [item.sourceItemId, ...current.listOrder]
  const next: TapdRequirementCache = {
    ...current,
    total: undefined,
    itemsById: { ...current.itemsById, [item.sourceItemId]: item },
    listOrder,
    lastSyncedAt: Date.now(),
  }
  writeTapdRequirementCache(workspaceId, next)
  return next
}

export function getTapdRequirementWorkContextStorageKey(workspaceId: string | null | undefined, sourceItemId: string) {
  return `requirement-board.${TAPD_PLUGIN_ID}.work-context.${workspaceId ?? 'default'}.${sourceItemId}`
}

export function readTapdRequirementWorkContext(workspaceId: string | null | undefined, sourceItemId: string): TapdRequirementWorkContext {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(getTapdRequirementWorkContextStorageKey(workspaceId, sourceItemId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<TapdRequirementWorkContext>
    return {
      workingDirectory: typeof parsed.workingDirectory === 'string' ? parsed.workingDirectory : undefined,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    }
  } catch {
    return {}
  }
}

export function writeTapdRequirementWorkContext(
  workspaceId: string | null | undefined,
  sourceItemId: string,
  context: TapdRequirementWorkContext,
): TapdRequirementWorkContext {
  const next: TapdRequirementWorkContext = {
    workingDirectory: context.workingDirectory?.trim() || undefined,
    updatedAt: Date.now(),
  }
  if (typeof window === 'undefined' || !window.localStorage) return next
  try {
    window.localStorage.setItem(getTapdRequirementWorkContextStorageKey(workspaceId, sourceItemId), JSON.stringify(next))
  } catch {
    // Work context is a convenience layer; ignore storage failures.
  }
  return next
}

export function defaultTapdGroupName(item: ExternalRequirementItem) {
  const title = item.title.length > 80 ? `${item.title.slice(0, 77)}…` : item.title
  return `[TAPD-${item.sourceItemId}] ${title}`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTapdTitleNoise(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\bTAPD[-_\s:：#]*\d+\b/gi, ' ')
    .replace(/\b(story|requirement|prd)[-_\s:：#]*\d*\b/gi, ' ')
    .replace(/\d{10,}/g, ' ')
    .replace(/[【】\[\]「」『』（）(){}]/g, ' ')
    .replace(/[|｜/\\]+/g, ' ')
    .replace(/[：:;；,，.。!！?？]+/g, ' ')
    .replace(/[—–-]+/g, ' ')
    .replace(/\b需求文档\b/gi, ' ')
    .replace(/\b需求\b/gi, ' ')
    .replace(/\b方案\b/gi, ' ')
    .replace(/\bPRD\b/gi, ' ')
    .replace(/需求/g, '')
    .replace(/方案/g, '')
    .replace(/设计稿/g, '')
    .replace(/设计/g, '')
    .replace(/文档/g, '')
    .replace(/链路/g, '')
    .replace(/页面/g, '页')
}

function countCjkCharacters(value: string): number {
  return Array.from(value).filter(char => /[\u3400-\u9fff\uf900-\ufaff]/u.test(char)).length
}

function clampDisplayChars(value: string, maxChars: number = TAPD_GROUP_NAME_MAX_CHARS): string {
  return Array.from(value.trim()).slice(0, maxChars).join('').trim()
}

function compactChineseTitle(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/(一期|二期|三期|第一期|第二期|第三期)$/g, '')
    .replace(/页(?=(改版|重构|优化))/g, '')
}

function compactLatinTitle(value: string): string {
  const words = normalizeWhitespace(value)
    .split(' ')
    .map(word => word.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter(Boolean)
  if (words.length === 0) return ''

  let result = ''
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word
    if (Array.from(candidate).length > TAPD_GROUP_NAME_MAX_CHARS) break
    result = candidate
  }
  return result || clampDisplayChars(words[0])
}

export function suggestTapdGroupName(item: Pick<ExternalRequirementItem, 'title' | 'sourceItemId'>): string {
  const stripped = stripTapdTitleNoise(item.title)
  const fallback = defaultTapdGroupName(item as ExternalRequirementItem)
  if (!stripped) return clampDisplayChars(fallback)

  const cjkCount = countCjkCharacters(stripped)
  const compact = cjkCount >= 2 ? compactChineseTitle(stripped) : compactLatinTitle(stripped)
  return clampDisplayChars(compact || stripped || fallback)
}

export function resolveDefaultTapdAgent(agents: readonly AgentProfile[]): AgentProfile | null {
  const byName = agents.find(agent => {
    const id = agent.id.toLowerCase()
    const name = agent.name.toLowerCase()
    return id === 'tapd' || name === 'tapd' || id.includes('tapd') || name.includes('tapd')
  })
  if (byName) return byName

  return agents.find(agent => {
    const skillSlugs = agent.skillSlugs ?? []
    const sourceSlugs = agent.sourceSlugs ?? []
    return skillSlugs.includes(TAPD_REVIEW_SKILL_SLUG) && sourceSlugs.includes(TAPD_SOURCE_SLUG)
  }) ?? null
}

export function getTapdRequirementAgentTask(taskId: TapdRequirementAgentTaskId): TapdRequirementAgentTask {
  return TAPD_REQUIREMENT_AGENT_TASKS.find(task => task.id === taskId) ?? TAPD_REQUIREMENT_AGENT_TASKS[0]!
}

function appendRequirementContext(lines: string[], item: ExternalRequirementItem, workContext?: TapdRequirementWorkContext) {
  lines.push(`Requirement title: ${item.title || 'Untitled requirement'}`)
  if (item.binding?.groupName) lines.push(`Linked group: ${item.binding.groupName}`)
  if (workContext?.workingDirectory) lines.push(`Default working directory: ${workContext.workingDirectory}`)
  if (item.status) lines.push(`Status: ${item.status}`)
  if (item.priority) lines.push(`Priority: ${item.priority}`)
  if (item.assignees?.length) lines.push(`Assignees: ${item.assignees.join(', ')}`)
  if (item.sourceUrl) lines.push(`Source URL: ${item.sourceUrl}`)
}

export function buildTapdRequirementTaskPrompt(
  agentProfileId: string,
  item: ExternalRequirementItem,
  taskId: TapdRequirementAgentTaskId,
  workContext?: TapdRequirementWorkContext,
): string {
  const task = getTapdRequirementAgentTask(taskId)
  const lines = [
    `[agent:${agentProfileId}]`,
    '',
    `${task.label} for linked TAPD requirement TAPD-${item.sourceItemId}.`,
    '',
  ]

  appendRequirementContext(lines, item, workContext)

  lines.push(
    '',
    `Use the configured ${TAPD_REVIEW_SKILL_SLUG} skill and available TAPD/docs sources when they help answer the task.`,
    'Base your work on the workspace TAPD snapshot, linked requirement context, and project documentation when available.',
  )

  if (taskId === 'research-requirement') {
    lines.push(
      '',
      'Focus on:',
      '- unclear requirement points',
      '- missing acceptance criteria',
      '- edge cases',
      '- dependencies or implementation risks',
      '- questions that need confirmation from PM / backend / frontend / QA',
      '',
      'Return a concise research report with:',
      '1. Ambiguous or missing points',
      '2. Risks and dependencies',
      '3. Concrete confirmation questions',
      '4. Recommended next steps',
    )
  } else if (taskId === 'write-technical-plan') {
    lines.push(
      '',
      'Write a scoped technical plan. Include:',
      '1. Goal and non-goals',
      '2. Proposed implementation approach',
      '3. Impacted modules/files to inspect first',
      '4. Data/API/UI changes if applicable',
      '5. Risks, open questions, and dependencies',
      '6. Validation checklist and rollout notes',
      '',
      'If important requirement details are unclear, call them out before proposing implementation details.',
    )
  }

  return lines.join('\n')
}

export function buildTapdAgentInstructionPrompt(
  agentProfileId: string,
  item: ExternalRequirementItem,
  workContext?: TapdRequirementWorkContext,
): string {
  void agentProfileId
  void workContext
  const lines = [
    `Use your Agent Profile instructions to work on TAPD-${item.sourceItemId}.`,
    'Do not rely on this message for TAPD source details. Read the requirement snapshot, shared info files, and agent-run folder paths from the requirement-scoped context provided below before working.',
    '',
    `Use configured skills such as ${TAPD_REVIEW_SKILL_SLUG} and available TAPD/docs sources when helpful.`,
    'Save requirement-specific notes and artifacts in the requirement folder when useful.',
    'Return a concise final summary that can be posted as a requirement comment.',
  ]

  return lines.join('\n')
}

export function buildTapdRequirementReviewPrompt(agentProfileId: string, item: ExternalRequirementItem): string {
  return buildTapdRequirementTaskPrompt(agentProfileId, item, 'research-requirement')
}
