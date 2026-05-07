import type { ReactNode } from "react"
import type { SessionMeta } from "@/atoms/sessions"
import type { SessionStatus } from "@/config/session-status-config"
import { extractLabelId, type LabelConfig } from "@craft-agent/shared/labels"
import { buildSessionProjectFilterOptions, getSessionProjectFilterId } from "@/utils/session-project-filter"

export interface SessionBoardColumnModel {
  group: SessionBoardGroup
  sessions: SessionMeta[]
}

export type SessionBoardGroupBy = "status" | "label" | "project" | "recent"

export interface SessionBoardGroup {
  id: string
  label: string
  icon?: ReactNode
  color?: string
  isDefault?: boolean
  kind: SessionBoardGroupBy
}

export function resolveBoardStatusId(
  session: Pick<SessionMeta, "sessionStatus">,
  statuses: Pick<SessionStatus, "id" | "isDefault">[],
): string {
  const validIds = new Set(statuses.map((status) => status.id))
  if (session.sessionStatus && validIds.has(session.sessionStatus)) {
    return session.sessionStatus
  }
  return statuses.find((status) => status.isDefault)?.id ?? "todo"
}

export function compareBoardSessions(a: SessionMeta, b: SessionMeta): number {
  const aPosition = a.boardPosition
  const bPosition = b.boardPosition
  if (aPosition !== undefined && bPosition !== undefined && aPosition !== bPosition) {
    return aPosition - bPosition
  }
  if (aPosition !== undefined && bPosition === undefined) return -1
  if (aPosition === undefined && bPosition !== undefined) return 1
  return (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
}

export function compareRecentBoardSessions(a: SessionMeta, b: SessionMeta): number {
  return (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
}

export function buildSessionBoardColumns(
  sessions: SessionMeta[],
  statuses: SessionStatus[],
  hiddenStatusIds: Set<string> = new Set(),
): SessionBoardColumnModel[] {
  const byStatus = new Map<string, SessionMeta[]>()
  for (const session of sessions) {
    const statusId = resolveBoardStatusId(session, statuses)
    if (!byStatus.has(statusId)) byStatus.set(statusId, [])
    byStatus.get(statusId)!.push(session)
  }

  return statuses
    .filter((status) => !hiddenStatusIds.has(status.id))
    .map((status) => ({
      group: {
        id: status.id,
        label: status.label,
        icon: status.icon,
        color: status.iconColorable ? status.resolvedColor : undefined,
        isDefault: status.isDefault,
        kind: "status",
      },
      sessions: (byStatus.get(status.id) ?? []).slice().sort(compareBoardSessions),
    }))
}

export const UNLABELED_BOARD_GROUP_ID = "__unlabeled"

export function resolveBoardLabelId(session: Pick<SessionMeta, "labels">): string {
  const first = session.labels?.[0]
  return first ? extractLabelId(first) : UNLABELED_BOARD_GROUP_ID
}

export function buildSessionBoardLabelColumns(
  sessions: SessionMeta[],
  labels: LabelConfig[],
): SessionBoardColumnModel[] {
  const groups: SessionBoardGroup[] = labels.map((label) => ({
    id: label.id,
    label: label.name,
    kind: "label",
  }))
  groups.push({ id: UNLABELED_BOARD_GROUP_ID, label: "No label", kind: "label" })

  const byLabel = new Map<string, SessionMeta[]>()
  for (const session of sessions) {
    const labelId = resolveBoardLabelId(session)
    if (!byLabel.has(labelId)) byLabel.set(labelId, [])
    byLabel.get(labelId)!.push(session)
  }

  return groups
    .filter((group) => group.id === UNLABELED_BOARD_GROUP_ID || (byLabel.get(group.id)?.length ?? 0) > 0)
    .map((group) => ({
      group,
      sessions: (byLabel.get(group.id) ?? []).slice().sort(compareBoardSessions),
    }))
}

const RECENT_SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatRecentColumnLabel(dayStart: number, todayStart: number): string {
  const diffDays = Math.round((todayStart - dayStart) / DAY_MS)
  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return new Date(dayStart).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function buildSessionBoardProjectColumns(
  sessions: SessionMeta[],
): SessionBoardColumnModel[] {
  const groups = buildSessionProjectFilterOptions(sessions).map((project) => ({
    id: project.id,
    label: project.label,
    kind: "project" as const,
  }))

  const byProject = new Map<string, SessionMeta[]>()
  for (const session of sessions) {
    const projectId = getSessionProjectFilterId(session)
    if (!byProject.has(projectId)) byProject.set(projectId, [])
    byProject.get(projectId)!.push(session)
  }

  return groups.map((group) => ({
    group,
    sessions: (byProject.get(group.id) ?? []).slice().sort(compareBoardSessions),
  }))
}

export function buildSessionBoardRecentColumns(
  sessions: SessionMeta[],
  now: number = Date.now(),
): SessionBoardColumnModel[] {
  const todayStart = startOfLocalDay(now)
  const cutoff = todayStart - (RECENT_SEVEN_DAYS_MS - DAY_MS)
  const byDay = new Map<string, SessionMeta[]>()

  for (const session of sessions) {
    const lastMessageAt = session.lastMessageAt || 0
    if (lastMessageAt < cutoff || lastMessageAt > now) continue
    const dayStart = startOfLocalDay(lastMessageAt)
    const key = String(dayStart)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key)!.push(session)
  }

  return Array.from({ length: 7 }, (_, index) => {
    const dayStart = todayStart - index * DAY_MS
    return {
      group: {
        id: `recent-${dayStart}`,
        label: formatRecentColumnLabel(dayStart, todayStart),
        kind: "recent" as const,
      },
      sessions: (byDay.get(String(dayStart)) ?? []).slice().sort(compareRecentBoardSessions),
    }
  })
}

export function computeBoardPosition(
  orderedSessions: SessionMeta[],
  activeSessionId: string,
): number {
  const index = orderedSessions.findIndex((session) => session.id === activeSessionId)
  if (index === -1) return Date.now()
  const fallbackPosition = (session: SessionMeta, fallbackIndex: number) =>
    session.boardPosition ?? fallbackIndex

  if (orderedSessions.length === 1) {
    return orderedSessions[0]?.boardPosition ?? 0
  }
  if (index === 0) {
    const next = orderedSessions[1]
    return next ? fallbackPosition(next, 1) - 1 : 0
  }
  if (index === orderedSessions.length - 1) {
    const prev = orderedSessions[index - 1]
    return prev ? fallbackPosition(prev, index - 1) + 1 : index
  }
  const prev = orderedSessions[index - 1]
  const next = orderedSessions[index + 1]
  const prevPosition = prev ? fallbackPosition(prev, index - 1) : index - 1
  const nextPosition = next ? fallbackPosition(next, index + 1) : index + 1
  return (prevPosition + nextPosition) / 2
}
