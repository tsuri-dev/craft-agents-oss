import type { SessionMeta } from '@/atoms/sessions'
import type { LoadedProject } from '@craft-agent/shared/projects/types'

export type ProjectFilterMode = 'include' | 'exclude'

export const NO_PROJECT_FILTER_ID = '__no_project__'

export interface SessionProjectFilterOption {
  /** Official project id; __no_project__ for sessions without projectId. */
  id: string
  label: string
  projectId: string | null
  slug?: string
  color?: string
  count: number
}

export function getSessionProjectFilterId(
  session: Pick<SessionMeta, 'projectId'>,
): string {
  return session.projectId ?? NO_PROJECT_FILTER_ID
}

export function buildSessionProjectFilterOptions(
  sessions: Pick<SessionMeta, 'projectId'>[],
  projects?: readonly LoadedProject[],
): SessionProjectFilterOption[] {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    const id = getSessionProjectFilterId(session)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  const options: SessionProjectFilterOption[] = (projects ?? []).map(project => ({
    id: project.config.id,
    label: project.config.name,
    projectId: project.config.id,
    slug: project.config.slug,
    color: project.config.color,
    count: counts.get(project.config.id) ?? 0,
  }))

  // If the caller did not provide the official Project catalog, preserve a
  // best-effort projectId-only option so standalone board/list tests and any
  // isolated consumers do not silently drop project-bound sessions.
  if (!projects) {
    const knownProjectIds = new Set(options.map(option => option.id))
    for (const [id, count] of counts) {
      if (id === NO_PROJECT_FILTER_ID || knownProjectIds.has(id)) continue
      options.push({
        id,
        label: id,
        projectId: id,
        count,
      })
    }
  }

  const noProjectCount = counts.get(NO_PROJECT_FILTER_ID) ?? 0
  if (noProjectCount > 0) {
    options.push({
      id: NO_PROJECT_FILTER_ID,
      label: 'No project',
      projectId: null,
      count: noProjectCount,
    })
  }

  return options.sort((a, b) => {
    if (a.id === NO_PROJECT_FILTER_ID) return 1
    if (b.id === NO_PROJECT_FILTER_ID) return -1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
}

export function filterSessionsByProjectFilter<T extends Pick<SessionMeta, 'projectId'>>(
  sessions: T[],
  projectFilter: Map<string, ProjectFilterMode>,
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
    result = result.filter(session => includes.has(getSessionProjectFilterId(session)))
  }
  if (excludes.size > 0) {
    result = result.filter(session => !excludes.has(getSessionProjectFilterId(session)))
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
