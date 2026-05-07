import * as React from "react"
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Eye, EyeOff, GripVertical, MoreHorizontal, Rocket, Tags } from "lucide-react"
import { useAtom } from "jotai"
import { cn } from "@/lib/utils"
import { storiesAtom, storyStatusById, STORY_STATUSES, type StoryItem, type StoryStatus, type StoryStatusId } from "@/atoms/stories"
import { LabelIcon } from "@/components/ui/label-icon"
import { flattenLabels, getLabelDisplayName, type LabelConfig } from "@craft-agent/shared/labels"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ColumnState = Record<string, string[]>

function buildColumns(stories: StoryItem[], statuses: StoryStatus[]): ColumnState {
  const columns: ColumnState = {}
  for (const status of statuses) {
    columns[status.id] = []
  }
  for (const story of stories) {
    if (columns[story.status]) {
      columns[story.status]!.push(story.id)
    }
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

function StoryCardContent({
  story,
  labels,
  flatLabels,
  isOverlay = false,
}: {
  story: StoryItem
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
  isOverlay?: boolean
}) {
  const status = storyStatusById.get(story.status)!
  const StatusIcon = status.icon

  return (
    <article
      className={cn(
        "group relative rounded-[8px] bg-background px-3 py-3 shadow-minimal ring-1 ring-foreground/[0.05]",
        "transition-[transform,background-color,box-shadow] duration-150 [@media(hover:hover)]:hover:bg-foreground/[0.018] active:scale-[0.99]",
        isOverlay && "shadow-[0_12px_28px_rgba(0,0,0,0.22)]",
      )}
    >
      {!isOverlay && (
        <GripVertical className="board-card-drag-handle absolute right-2 top-3 h-3.5 w-3.5 cursor-grab text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      <div className="mb-2 flex items-start gap-2">
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-foreground/[0.04]"
          style={{ color: status.tone }}
        >
          <StatusIcon className="h-3.5 w-3.5" />
        </span>
        <h3 className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground text-pretty">
          {story.title}
        </h3>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-foreground/[0.055] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-foreground/80">
          {story.priority}
        </span>
        <span className="rounded-full bg-foreground/[0.045] px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {story.scope}
        </span>
      </div>

      {story.labels.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {story.labels.slice(0, 3).map((labelId) => {
            const label = flatLabels.find(item => item.id === labelId)
            const name = label ? label.name : getLabelDisplayName(labels, labelId)
            return (
              <span
                key={labelId}
                className="inline-flex max-w-[118px] items-center gap-1 rounded-full bg-foreground/[0.045] px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {label ? <LabelIcon label={label} size="xs" /> : <Tags className="h-2.5 w-2.5 opacity-50" />}
                <span className="truncate">{name}</span>
              </span>
            )
          })}
          {story.labels.length > 3 && (
            <span className="rounded-full bg-foreground/[0.045] px-1.5 py-0.5 text-[10px] text-muted-foreground">
              +{story.labels.length - 3}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-[10px] leading-4 text-muted-foreground">
        <div className="min-w-0">
          <div className="uppercase text-muted-foreground/55">Owner</div>
          <div className="truncate text-foreground/75">{story.owner}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="uppercase text-muted-foreground/55">Cycle</div>
          <div className="truncate text-foreground/75">{story.cycle}</div>
        </div>
      </div>
    </article>
  )
}

function StoryCard({
  story,
  labels,
  flatLabels,
}: {
  story: StoryItem
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: story.id, data: { status: story.status } })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "block w-full text-left active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isDragging && "opacity-30",
      )}
      {...attributes}
      {...listeners}
    >
      <StoryCardContent story={story} labels={labels} flatLabels={flatLabels} />
    </div>
  )
}

function StoryBoardDragOverlay({
  story,
  labels,
  flatLabels,
}: {
  story: StoryItem
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
}) {
  return (
    <div className="w-[276px] rotate-1 scale-[1.02]">
      <StoryCardContent story={story} labels={labels} flatLabels={flatLabels} isOverlay />
    </div>
  )
}

function StoryColumn({
  status,
  stories,
  labels,
  flatLabels,
  onHide,
}: {
  status: StoryStatus
  stories: StoryItem[]
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
  onHide: (statusId: StoryStatusId) => void
}) {
  const StatusIcon = status.icon
  const { setNodeRef, isOver } = useDroppable({ id: status.id })

  return (
    <section className="flex w-[292px] shrink-0 flex-col rounded-[12px] bg-foreground/[0.025] p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-background shadow-minimal ring-1 ring-foreground/[0.04]"
            style={{ color: status.tone }}
          >
            <StatusIcon className="h-3.5 w-3.5" />
          </span>
          <span className="truncate text-[12px] font-semibold text-foreground">
            {status.label}
          </span>
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {stories.length}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${status.label}`}
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] active:scale-95"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onHide(status.id)}>
              <EyeOff className="h-3.5 w-3.5" />
              Hide column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[180px] flex-1 space-y-2 overflow-y-auto rounded-[10px] p-1 transition-colors",
          isOver && "bg-accent/10",
        )}
      >
        <SortableContext items={stories.map((story) => story.id)} strategy={verticalListSortingStrategy}>
          {stories.map((story) => (
            <StoryCard key={story.id} story={story} labels={labels} flatLabels={flatLabels} />
          ))}
        </SortableContext>
        {stories.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-[8px] border border-dashed border-foreground/[0.08] bg-background/60 text-[11px] text-muted-foreground">
            No stories
          </div>
        )}
      </div>
    </section>
  )
}

export function StoryBoard({ labels = [] }: { labels?: LabelConfig[] }) {
  const [stories, setStories] = useAtom(storiesAtom)
  const flatLabels = React.useMemo(() => flattenLabels(labels), [labels])
  const [activeStatusId, setActiveStatusId] = React.useState<StoryStatusId | "all">("all")
  const [hiddenStatusIds, setHiddenStatusIds] = React.useState<Set<StoryStatusId>>(() => new Set())
  const [activeStory, setActiveStory] = React.useState<StoryItem | null>(null)
  const [columns, setColumns] = React.useState<ColumnState>(() => buildColumns(stories, STORY_STATUSES))
  const columnsRef = React.useRef(columns)
  const storyMap = React.useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories])
  const storyMapRef = React.useRef(storyMap)
  const isDraggingRef = React.useRef(false)

  columnsRef.current = columns
  if (!isDraggingRef.current) storyMapRef.current = storyMap

  const handleHideStatus = React.useCallback((statusId: StoryStatusId) => {
    setHiddenStatusIds(prev => new Set(prev).add(statusId))
  }, [])

  const handleShowStatus = React.useCallback((statusId: StoryStatusId) => {
    setHiddenStatusIds(prev => {
      const next = new Set(prev)
      next.delete(statusId)
      return next
    })
  }, [])

  const visibleStatuses = React.useMemo(
    () => (activeStatusId === "all"
      ? STORY_STATUSES
      : STORY_STATUSES.filter((status) => status.id === activeStatusId))
      .filter((status) => !hiddenStatusIds.has(status.id)),
    [activeStatusId, hiddenStatusIds],
  )

  const hiddenStatuses = React.useMemo(
    () => activeStatusId === "all"
      ? STORY_STATUSES.filter((status) => hiddenStatusIds.has(status.id))
      : STORY_STATUSES.filter((status) => status.id === activeStatusId && hiddenStatusIds.has(status.id)),
    [activeStatusId, hiddenStatusIds],
  )

  const visibleStories = React.useMemo(
    () => activeStatusId === "all"
      ? stories
      : stories.filter((story) => story.status === activeStatusId),
    [activeStatusId, stories],
  )

  const groupIds = React.useMemo<Set<string>>(() => new Set(visibleStatuses.map((status) => status.id)), [visibleStatuses])

  React.useEffect(() => {
    if (!isDraggingRef.current) {
      setColumns(buildColumns(visibleStories, visibleStatuses))
    }
  }, [visibleStories, visibleStatuses])

  const collisionDetection = React.useMemo<CollisionDetection>(() => {
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

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    isDraggingRef.current = true
    setActiveStory(storyMapRef.current.get(event.active.id as string) ?? null)
  }, [])

  const handleDragOver = React.useCallback((event: DragOverEvent) => {
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

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    isDraggingRef.current = false
    setActiveStory(null)

    if (!over) {
      setColumns(buildColumns(visibleStories, visibleStatuses))
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

    const orderedVisibleIds = visibleStatuses.flatMap((status) => finalColumns[status.id] ?? [])
    const visibleIds = new Set(orderedVisibleIds)
    const now = new Date().toISOString()
    const columnByStoryId = new Map<string, StoryStatusId>()
    for (const status of visibleStatuses) {
      for (const id of finalColumns[status.id] ?? []) {
        columnByStoryId.set(id, status.id)
      }
    }

    setStories((current) => {
      const currentById = new Map(current.map((story) => [story.id, story]))
      const orderedVisibleStories = orderedVisibleIds
        .map((id) => {
          const story = currentById.get(id)
          const status = columnByStoryId.get(id)
          if (!story || !status) return null
          return {
            ...story,
            status,
            updatedAt: id === activeId ? now : story.updatedAt,
          }
        })
        .filter((story): story is StoryItem => !!story)

      return [
        ...orderedVisibleStories,
        ...current.filter((story) => !visibleIds.has(story.id)),
      ]
    })
  }, [groupIds, setStories, visibleStatuses, visibleStories])

  const counts = React.useMemo(() => {
    const next = new Map<StoryStatusId, number>()
    for (const story of stories) {
      next.set(story.status, (next.get(story.status) ?? 0) + 1)
    }
    return next
  }, [stories])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-foreground/[0.06] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-foreground/80" />
              <h2 className="text-[14px] font-semibold leading-5 text-foreground">Story Board</h2>
              <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {visibleStories.length}/{stories.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Track demand flow from review through release.
            </p>
          </div>

          <div className="flex min-w-[220px] items-center justify-end gap-2 rounded-[10px] bg-foreground/[0.025] px-2 py-1.5 ring-1 ring-foreground/[0.05]">
            <span className="text-[11px] text-muted-foreground">9 workflow states</span>
            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground shadow-minimal ring-1 ring-foreground/[0.04]">
              {stories.length} stories
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          <button
            type="button"
            onClick={() => setActiveStatusId("all")}
            aria-pressed={activeStatusId === "all"}
            className={cn(
              "h-8 shrink-0 rounded-[8px] px-2.5 text-[12px] transition-[transform,background-color,color,box-shadow] duration-150 active:scale-95",
              activeStatusId === "all"
                ? "bg-foreground text-background shadow-minimal"
                : "bg-foreground/[0.035] text-muted-foreground [@media(hover:hover)]:hover:bg-foreground/[0.06] [@media(hover:hover)]:hover:text-foreground",
            )}
          >
            All
          </button>
          {STORY_STATUSES.map((status) => {
            const StatusIcon = status.icon
            const active = activeStatusId === status.id
            return (
              <button
                key={status.id}
                type="button"
                onClick={() => setActiveStatusId(status.id)}
                aria-pressed={active}
                className={cn(
                  "flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[12px]",
                  "transition-[transform,background-color,color,box-shadow] duration-150 active:scale-95",
                  active
                    ? "bg-foreground text-background shadow-minimal"
                    : "bg-foreground/[0.035] text-muted-foreground [@media(hover:hover)]:hover:bg-foreground/[0.06] [@media(hover:hover)]:hover:text-foreground",
                )}
              >
                <StatusIcon className="h-3.5 w-3.5" style={{ color: active ? undefined : status.tone }} />
                <span>{status.label}</span>
                <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground/70")}>
                  {counts.get(status.id) ?? 0}
                </span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 py-3">
        {visibleStatuses.map((status) => (
          <StoryColumn
            key={status.id}
            status={status}
            stories={(columns[status.id] ?? [])
              .map((id) => storyMap.get(id))
              .filter((story): story is StoryItem => !!story)}
            labels={labels}
            flatLabels={flatLabels}
            onHide={handleHideStatus}
          />
        ))}

        {hiddenStatuses.length > 0 && (
          <aside className="flex w-[220px] shrink-0 flex-col rounded-[12px] bg-foreground/[0.018] p-2">
            <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hidden
            </div>
            <div className="space-y-1">
              {hiddenStatuses.map((status) => {
                const StatusIcon = status.icon
                return (
                  <button
                    key={status.id}
                    type="button"
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12px]",
                      "text-muted-foreground transition-colors hover:bg-foreground/[0.04] active:scale-[0.98]",
                    )}
                    onClick={() => handleShowStatus(status.id)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <StatusIcon className="h-3.5 w-3.5" style={{ color: status.tone }} />
                    <span className="min-w-0 flex-1 truncate">{status.label}</span>
                  </button>
                )
              })}
            </div>
          </aside>
        )}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeStory ? (
          <StoryBoardDragOverlay
            story={activeStory}
            labels={labels}
            flatLabels={flatLabels}
          />
        ) : null}
      </DragOverlay>
      </div>
    </DndContext>
  )
}
