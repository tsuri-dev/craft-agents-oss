import type { SessionMeta } from '@/atoms/sessions'
import { parseLabelEntry } from '@craft-agent/shared/labels'

export type ProjectFilterMode = 'include' | 'exclude'

export const PROJECT_LABEL_ID = 'project'
export const NO_PROJECT_FILTER_ID = '__no_project__'

export interface SessionProjectFilterOption {
  /** Project label value; __no_project__ for sessions without project::value. */
  id: string
  label: string
  value: string | null
  count: number
}

export function getSessionProjectValue(
  session: Pick<SessionMeta, 'labels'>,
  projectLabelId: string = PROJECT_LABEL_ID,
): string | null {
  for (const entry of session.labels ?? []) {
    const parsed = parseLabelEntry(entry)
    if (parsed.id === projectLabelId && parsed.rawValue?.trim()) {
      return parsed.rawValue.trim()
    }
  }
  return null
}

export function getSessionProjectFilterId(
  session: Pick<SessionMeta, 'labels'>,
  projectLabelId: string = PROJECT_LABEL_ID,
): string {
  return getSessionProjectValue(session, projectLabelId) ?? NO_PROJECT_FILTER_ID
}

export function buildSessionProjectFilterOptions(
  sessions: Pick<SessionMeta, 'labels'>[],
  projectLabelId: string = PROJECT_LABEL_ID,
): SessionProjectFilterOption[] {
  const counts = new Map<string, number>()

  for (const session of sessions) {
    const id = getSessionProjectFilterId(session, projectLabelId)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const options = Array.from(counts, ([id, count]): SessionProjectFilterOption => ({
    id,
    label: id === NO_PROJECT_FILTER_ID ? 'No Project' : id,
    value: id === NO_PROJECT_FILTER_ID ? null : id,
    count,
  }))

  return options.sort((a, b) => {
    if (a.id === NO_PROJECT_FILTER_ID) return 1
    if (b.id === NO_PROJECT_FILTER_ID) return -1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
}

export function filterSessionsByProjectFilter<T extends Pick<SessionMeta, 'labels'>>(
  sessions: T[],
  projectFilter: Map<string, ProjectFilterMode>,
  projectLabelId: string = PROJECT_LABEL_ID,
): T[] {
  if (projectFilter.size === 0) return sessions

  const includes = new Set<string>()
  const excludes = new Set<string>()
  for (const [id, mode] of projectFilter) {
    if (mode === 'include') includes.add(id)
    else excludes.add(id)
  }

  let result = sessions
  if (includes.size > 0) {
    result = result.filter(session => includes.has(getSessionProjectFilterId(session, projectLabelId)))
  }
  if (excludes.size > 0) {
    result = result.filter(session => !excludes.has(getSessionProjectFilterId(session, projectLabelId)))
  }

  return result
}

export function filterSessionProjectOptions(
  options: SessionProjectFilterOption[],
  query: string,
): SessionProjectFilterOption[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return options

  return options.filter(option => option.label.toLowerCase().includes(normalizedQuery))
}
