import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import { Eye } from "lucide-react"
import type { SessionMeta } from "@/atoms/sessions"
import type { SessionStatus } from "@/config/session-status-config"
import { cn } from "@/lib/utils"
import type { LabelConfig } from "@craft-agent/shared/labels"
import { SessionBoardColumn } from "./SessionBoardColumn"
import { SessionBoardDragOverlay } from "./SessionBoardCard"
import {
  buildSessionBoardLabelColumns,
  buildSessionBoardColumns,
  buildSessionBoardRecentColumns,
  computeBoardPosition,
  resolveBoardLabelId,
  resolveBoardStatusId,
  UNLABELED_BOARD_GROUP_ID,
  type SessionBoardGroupBy,
} from "./session-board-utils"

type ColumnState = Record<string, string[]>

function buildColumns(
  sessions: SessionMeta[],
  statuses: SessionStatus[],
  hidden: Set<string>,
  groupBy: SessionBoardGroupBy,
  labels: LabelConfig[],
): ColumnState {
  const columns: ColumnState = {}
  const models = groupBy === "recent"
    ? buildSessionBoardRecentColumns(sessions)
    : groupBy === "label"
      ? buildSessionBoardLabelColumns(sessions, labels)
      : buildSessionBoardColumns(sessions, statuses, hidden)
  for (const column of models) {
    columns[column.group.id] = column.sessions.map((session) => session.id)
  }
  return columns
}

function findColumn(columns: ColumnState, id: string, statusIds: Set<string>): string | null {
  if (statusIds.has(id)) return id
  for (const [statusId, ids] of Object.entries(columns)) {
    if (ids.includes(id)) return statusId
  }
  return null
}

export function SessionBoard({
  sessions,
  statuses,
  hiddenStatusIds,
  labels,
  groupBy = "status",
  onLabelsChange,
  onHideStatus,
  onShowStatus,
  selectedSessionId,
  onSelectSession,
  onSessionStatusChange,
  onSessionBoardPositionChange,
}: {
  sessions: SessionMeta[]
  statuses: SessionStatus[]
  hiddenStatusIds: Set<string>
  labels?: LabelConfig[]
  groupBy?: SessionBoardGroupBy
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  onHideStatus: (statusId: string) => void
  onShowStatus: (statusId: string) => void
  selectedSessionId?: string | null
  onSelectSession?: (sessionId: string) => void
  onSessionStatusChange: (sessionId: string, statusId: string) => void
  onSessionBoardPositionChange: (sessionId: string, position: number) => void
}) {
  const hiddenStatuses = useMemo(
    () => statuses.filter((status) => hiddenStatusIds.has(status.id)),
    [statuses, hiddenStatusIds],
  )
  const sessionMap = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  const flatLabels = labels ?? []
  const boardColumns = useMemo(
    () => groupBy === "recent"
      ? buildSessionBoardRecentColumns(sessions)
      : groupBy === "label"
        ? buildSessionBoardLabelColumns(sessions, flatLabels)
        : buildSessionBoardColumns(sessions, statuses, hiddenStatusIds),
    [flatLabels, groupBy, hiddenStatusIds, sessions, statuses],
  )
  const groupIds = useMemo(() => new Set(boardColumns.map((column) => column.group.id)), [boardColumns])
  const sessionMapRef = useRef(sessionMap)

  const [activeSession, setActiveSession] = useState<SessionMeta | null>(null)
  const [columns, setColumns] = useState<ColumnState>(() => buildColumns(sessions, statuses, hiddenStatusIds, groupBy, flatLabels))
  const columnsRef = useRef(columns)
  const isDraggingRef = useRef(false)

  columnsRef.current = columns
  if (!isDraggingRef.current) sessionMapRef.current = sessionMap

  useEffect(() => {
    if (!isDraggingRef.current) {
      setColumns(buildColumns(sessions, statuses, hiddenStatusIds, groupBy, flatLabels))
    }
  }, [flatLabels, groupBy, sessions, statuses, hiddenStatusIds])

  const collisionDetection = useMemo<CollisionDetection>(() => {
    const columnIds = groupIds
    return (args) => {
      const pointer = pointerWithin(args)
      if (pointer.length > 0) {
        const cards = pointer.filter((collision) => !columnIds.has(collision.id as string))
        if (cards.length > 0) return cards
      }
      return closestCenter(args)
    }
  }, [groupIds])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true
    setActiveSession(sessionMapRef.current.get(event.active.id as string) ?? null)
  }, [])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeId = active.id as string
    const overId = over.id as string

    setColumns((prev) => {
      const activeColumn = findColumn(prev, activeId, groupIds)
      const overColumn = findColumn(prev, overId, groupIds)
      if (!activeColumn || !overColumn || activeColumn === overColumn) return prev

      const oldIds = prev[activeColumn]!.filter((id) => id !== activeId)
      const newIds = [...prev[overColumn]!]
      const overIndex = newIds.indexOf(overId)
      newIds.splice(overIndex >= 0 ? overIndex : newIds.length, 0, activeId)
      return { ...prev, [activeColumn]: oldIds, [overColumn]: newIds }
    })
  }, [groupIds])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    isDraggingRef.current = false
    setActiveSession(null)

    if (!over) {
      setColumns(buildColumns(sessions, statuses, hiddenStatusIds, groupBy, flatLabels))
      return
    }

    const activeId = active.id as string
    const overId = over.id as string
    const currentColumns = columnsRef.current
    const activeColumn = findColumn(currentColumns, activeId, groupIds)
    const overColumn = findColumn(currentColumns, overId, groupIds)
    if (!activeColumn || !overColumn) return

    let finalColumns = currentColumns
    if (activeColumn === overColumn) {
      const ids = currentColumns[activeColumn]!
      const oldIndex = ids.indexOf(activeId)
      const newIndex = ids.indexOf(overId)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        finalColumns = { ...currentColumns, [activeColumn]: arrayMove(ids, oldIndex, newIndex) }
        setColumns(finalColumns)
      }
    }

    const finalColumn = findColumn(finalColumns, activeId, groupIds)
    if (!finalColumn) return
    const orderedSessions = (finalColumns[finalColumn] ?? [])
      .map((id) => sessionMapRef.current.get(id))
      .filter((session): session is SessionMeta => !!session)
    const nextPosition = computeBoardPosition(orderedSessions, activeId)
    const current = sessionMapRef.current.get(activeId)
    const currentGroup = current
      ? groupBy === "label" ? resolveBoardLabelId(current) : resolveBoardStatusId(current, statuses)
      : undefined

    if (groupBy === "status" && currentGroup !== finalColumn) {
      onSessionStatusChange(activeId, finalColumn)
    }
    if (groupBy === "label" && current && currentGroup !== finalColumn && onLabelsChange) {
      const currentLabels = current.labels ?? []
      const nextLabels = currentLabels.filter((label) => resolveBoardLabelId({ labels: [label] }) !== currentGroup)
      if (finalColumn !== UNLABELED_BOARD_GROUP_ID && !nextLabels.some((label) => resolveBoardLabelId({ labels: [label] }) === finalColumn)) {
        nextLabels.unshift(finalColumn)
      }
      onLabelsChange(activeId, nextLabels)
    }
    if (groupBy !== "recent" && current?.boardPosition !== nextPosition) {
      onSessionBoardPositionChange(activeId, nextPosition)
    }
  }, [flatLabels, groupBy, groupIds, hiddenStatusIds, onLabelsChange, onSessionBoardPositionChange, onSessionStatusChange, sessions, statuses])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
        {boardColumns.map((column) => (
          <SessionBoardColumn
            key={column.group.id}
            group={column.group}
            sessions={(columns[column.group.id] ?? [])
              .map((id) => sessionMap.get(id))
              .filter((session): session is SessionMeta => !!session)}
            labels={labels}
            statuses={statuses}
            onLabelsChange={onLabelsChange}
            onHide={onHideStatus}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onSessionStatusChange={onSessionStatusChange}
          />
        ))}

        {groupBy === "status" && hiddenStatuses.length > 0 && (
          <aside className="flex w-[220px] shrink-0 flex-col rounded-[12px] bg-foreground/[0.018] p-2">
            <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hidden
            </div>
            <div className="space-y-1">
              {hiddenStatuses.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12px]",
                    "text-muted-foreground transition-colors hover:bg-foreground/[0.04] active:scale-[0.98]",
                  )}
                  onClick={() => onShowStatus(status.id)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{status.label}</span>
                </button>
              ))}
            </div>
          </aside>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeSession ? (
          <SessionBoardDragOverlay
            item={activeSession}
            labels={labels}
            onLabelsChange={onLabelsChange}
            selectedSessionId={selectedSessionId}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
