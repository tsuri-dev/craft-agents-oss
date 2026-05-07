import type { SessionMeta } from '@/atoms/sessions'
import { formatLabelEntry, parseLabelEntry } from '@craft-agent/shared/labels'

export type GroupFilterMode = 'include' | 'exclude'

export const GROUP_LABEL_ID = 'group'

export interface SessionGroupFilterOption {
  /** Group label value. */
  id: string
  label: string
  value: string
  count: number
}

export function normalizeSessionGroupName(name: string): string {
  return name.trim()
}

export function formatSessionGroupLabel(name: string, groupLabelId: string = GROUP_LABEL_ID): string {
  const normalized = normalizeSessionGroupName(name)
  if (!normalized) throw new Error('Group name cannot be empty')
  return formatLabelEntry(groupLabelId, normalized)
}

export function getSessionGroupValues(
  session: Pick<SessionMeta, 'labels'>,
  groupLabelId: string = GROUP_LABEL_ID,
): string[] {
  const values: string[] = []
  const seen = new Set<string>()
  for (const entry of session.labels ?? []) {
    const parsed = parseLabelEntry(entry)
    const value = parsed.rawValue?.trim()
    if (parsed.id === groupLabelId && value && !seen.has(value)) {
      seen.add(value)
      values.push(value)
    }
  }
  return values
}

export function sessionHasGroup(
  session: Pick<SessionMeta, 'labels'>,
  groupName: string,
  groupLabelId: string = GROUP_LABEL_ID,
): boolean {
  const normalized = normalizeSessionGroupName(groupName)
  return getSessionGroupValues(session, groupLabelId).includes(normalized)
}

export function buildSessionGroupFilterOptions(
  sessions: Pick<SessionMeta, 'labels'>[],
  groupLabelId: string = GROUP_LABEL_ID,
): SessionGroupFilterOption[] {
  const counts = new Map<string, number>()

  for (const session of sessions) {
    for (const group of getSessionGroupValues(session, groupLabelId)) {
      counts.set(group, (counts.get(group) ?? 0) + 1)
    }
  }

  return Array.from(counts, ([id, count]): SessionGroupFilterOption => ({
    id,
    label: id,
    value: id,
    count,
  })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

export function filterSessionsByGroupFilter<T extends Pick<SessionMeta, 'labels'>>(
  sessions: T[],
  groupFilter: Map<string, GroupFilterMode>,
  groupLabelId: string = GROUP_LABEL_ID,
): T[] {
  if (groupFilter.size === 0) return sessions

  const includes = new Set<string>()
  const excludes = new Set<string>()
  for (const [id, mode] of groupFilter) {
    if (mode === 'include') includes.add(id)
    else excludes.add(id)
  }

  let result = sessions
  if (includes.size > 0) {
    result = result.filter(session => getSessionGroupValues(session, groupLabelId).some(group => includes.has(group)))
  }
  if (excludes.size > 0) {
    result = result.filter(session => !getSessionGroupValues(session, groupLabelId).some(group => excludes.has(group)))
  }

  return result
}

export function filterSessionGroupOptions(
  options: SessionGroupFilterOption[],
  query: string,
): SessionGroupFilterOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return options

  return options.filter(option => option.label.toLowerCase().includes(normalizedQuery))
}

export function addSessionGroupLabel(
  labels: string[] | undefined,
  groupName: string,
  groupLabelId: string = GROUP_LABEL_ID,
): string[] {
  const current = labels ?? []
  const normalized = normalizeSessionGroupName(groupName)
  if (!normalized) return current
  if (current.some(entry => {
    const parsed = parseLabelEntry(entry)
    return parsed.id === groupLabelId && parsed.rawValue?.trim() === normalized
  })) {
    return current
  }
  return [...current, formatSessionGroupLabel(normalized, groupLabelId)]
}

export function removeSessionGroupLabel(
  labels: string[] | undefined,
  groupName: string,
  groupLabelId: string = GROUP_LABEL_ID,
): string[] {
  const normalized = normalizeSessionGroupName(groupName)
  return (labels ?? []).filter(entry => {
    const parsed = parseLabelEntry(entry)
    return !(parsed.id === groupLabelId && parsed.rawValue?.trim() === normalized)
  })
}

export function renameSessionGroupLabel(
  labels: string[] | undefined,
  oldName: string,
  newName: string,
  groupLabelId: string = GROUP_LABEL_ID,
): string[] {
  const withoutOld = removeSessionGroupLabel(labels, oldName, groupLabelId)
  return addSessionGroupLabel(withoutOld, newName, groupLabelId)
}

export function resolveUniqueSessionGroupName(
  requestedName: string,
  existingNames: Iterable<string>,
  currentName?: string,
): string {
  const trimmed = normalizeSessionGroupName(requestedName)
  if (!trimmed) throw new Error('Group name cannot be empty')

  const current = currentName ? normalizeSessionGroupName(currentName) : undefined
  const existing = new Set(
    Array.from(existingNames)
      .map(normalizeSessionGroupName)
      .filter(Boolean)
      .filter(name => name !== current),
  )

  if (!existing.has(trimmed)) return trimmed

  const suffixMatch = trimmed.match(/^(.*) \((\d+)\)$/)
  const baseName = suffixMatch ? suffixMatch[1].trim() : trimmed
  let next = suffixMatch ? Number(suffixMatch[2]) + 1 : 2
  let candidate = `${baseName} (${next})`
  while (existing.has(candidate)) {
    next += 1
    candidate = `${baseName} (${next})`
  }
  return candidate
}
