import * as React from 'react'
import { useAtom } from 'jotai'
import { format, isToday, isYesterday, startOfDay } from 'date-fns'
import { Check, MoreHorizontal, Tags } from 'lucide-react'
import { LabelIcon } from '@/components/ui/label-icon'
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuSub,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
  StyledDropdownMenuSubTrigger,
  StyledDropdownMenuSubContent,
} from '@/components/ui/styled-dropdown'
import { LabelMenuItems } from './SessionMenuParts'
import { cn } from '@/lib/utils'
import {
  selectedStoryIdAtom,
  storyFilterAtom,
  storiesAtom,
  storyStatusById,
  STORY_STATUSES,
  type StoryItem,
  type StoryStatusId,
} from '@/atoms/stories'
import { flattenLabels, getLabelDisplayName, type LabelConfig } from '@craft-agent/shared/labels'

interface StoryListPanelProps {
  labels?: LabelConfig[]
}

interface StoryListRow {
  item: StoryItem
}

function getStoryUpdatedTime(story: StoryItem) {
  const time = new Date(story.updatedAt).getTime()
  return Number.isFinite(time) ? time : 0
}

function formatDateGroupLabel(date: Date) {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'MMM d')
}

function StoryLabels({
  story,
  labels,
  flatLabels,
}: {
  story: StoryItem
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
}) {
  if (story.labels.length === 0) {
    return <span className="text-[10px] text-muted-foreground/60">No labels</span>
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {story.labels.slice(0, 3).map((labelId) => {
        const label = flatLabels.find(item => item.id === labelId)
        const name = label ? label.name : getLabelDisplayName(labels, labelId)
        return (
          <span
            key={labelId}
            className="inline-flex max-w-[110px] items-center gap-1 rounded-full bg-foreground/[0.045] px-1.5 py-0.5 text-[10px] text-muted-foreground"
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
  )
}

function StoryRow({
  story,
  labels,
  flatLabels,
  selected,
  onSelect,
  onStatusChange,
  onToggleLabel,
}: {
  story: StoryItem
  labels: LabelConfig[]
  flatLabels: LabelConfig[]
  selected: boolean
  onSelect: () => void
  onStatusChange: (status: StoryStatusId) => void
  onToggleLabel: (labelId: string) => void
}) {
  const status = storyStatusById.get(story.status)!
  const StatusIcon = status.icon
  const appliedLabelIds = React.useMemo(() => new Set(story.labels), [story.labels])

  return (
    <div
      className={cn(
        "group mx-3 mb-2 rounded-[10px] bg-background/70 shadow-minimal ring-1 transition-[background-color,box-shadow,ring-color] duration-150",
        selected
          ? "ring-foreground/[0.16]"
          : "ring-foreground/[0.055] [@media(hover:hover)]:hover:bg-background [@media(hover:hover)]:hover:ring-foreground/[0.1]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex w-full min-w-0 flex-col items-stretch gap-2 px-3 py-2.5 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-foreground/[0.045]"
            style={{ color: status.tone }}
          >
            <StatusIcon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[12px] font-medium leading-4 text-foreground">
              {story.title}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
              <span className="shrink-0 tabular-nums">{story.priority}</span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="truncate">{story.owner}</span>
              <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" />
              <span className="truncate">{story.cycle}</span>
            </div>
          </div>
        </div>

        <StoryLabels story={story} labels={labels} flatLabels={flatLabels} />
      </button>

      <div className="flex items-center justify-between border-t border-foreground/[0.05] px-2 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-[7px] px-2 text-[11px] text-muted-foreground transition-[background-color,color,transform] duration-150 [@media(hover:hover)]:hover:bg-foreground/[0.055] [@media(hover:hover)]:hover:text-foreground active:scale-95"
            >
              <StatusIcon className="h-3 w-3" style={{ color: status.tone }} />
              <span className="truncate">{status.label}</span>
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="start" className="w-36">
            {STORY_STATUSES.map((item) => {
              const ItemIcon = item.icon
              return (
                <StyledDropdownMenuItem
                  key={item.id}
                  onClick={() => onStatusChange(item.id)}
                  className={cn(item.id === story.status && "bg-foreground/[0.03]")}
                >
                  <ItemIcon className="h-3.5 w-3.5" style={{ color: item.tone }} />
                  <span className="flex-1">{item.label}</span>
                  {item.id === story.status && <Check className="h-3.5 w-3.5" />}
                </StyledDropdownMenuItem>
              )
            })}
          </StyledDropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-[background-color,color,transform] duration-150 [@media(hover:hover)]:hover:bg-foreground/[0.055] [@media(hover:hover)]:hover:text-foreground active:scale-95"
              aria-label="Edit story labels"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <StyledDropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">Labels</div>
            <StyledDropdownMenuSeparator />
            {labels.length > 0 ? (
              <LabelMenuItems
                labels={labels}
                appliedLabelIds={appliedLabelIds}
                onToggle={onToggleLabel}
                menu={{
                  MenuItem: StyledDropdownMenuItem,
                  Separator: StyledDropdownMenuSeparator,
                  Sub: DropdownMenuSub,
                  SubTrigger: StyledDropdownMenuSubTrigger,
                  SubContent: StyledDropdownMenuSubContent,
                }}
              />
            ) : (
              <StyledDropdownMenuItem disabled>
                <Tags className="h-3.5 w-3.5" />
                <span className="flex-1">No labels configured</span>
              </StyledDropdownMenuItem>
            )}
          </StyledDropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

export function StoryListPanel({ labels = [] }: StoryListPanelProps) {
  const [stories, setStories] = useAtom(storiesAtom)
  const [selectedStoryId, setSelectedStoryId] = useAtom(selectedStoryIdAtom)
  const [activeFilter] = useAtom(storyFilterAtom)
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => new Set())
  const flatLabels = React.useMemo(() => flattenLabels(labels), [labels])

  const updateStoryStatus = React.useCallback((storyId: string, status: StoryStatusId) => {
    setStories((current) =>
      current.map((story) => story.id === storyId ? { ...story, status, updatedAt: new Date().toISOString() } : story),
    )
  }, [setStories])

  const toggleStoryLabel = React.useCallback((storyId: string, labelId: string) => {
    setStories((current) =>
      current.map((story) => {
        if (story.id !== storyId) return story
        const exists = story.labels.includes(labelId)
        const nextLabels = exists
          ? story.labels.filter(item => item !== labelId)
          : [...story.labels, labelId]
        return { ...story, labels: nextLabels, updatedAt: new Date().toISOString() }
      }),
    )
  }, [setStories])

  const filteredStories = React.useMemo(() => {
    const next = activeFilter === 'all'
      ? stories
      : stories.filter(story => story.status === activeFilter)
    return [...next].sort((a, b) => getStoryUpdatedTime(b) - getStoryUpdatedTime(a))
  }, [activeFilter, stories])

  const groups = React.useMemo((): EntityListGroup<StoryListRow>[] => {
    const groupsByKey = new Map<string, EntityListGroup<StoryListRow>>()
    const groupDates = new Map<string, Date>()

    for (const story of filteredStories) {
      const day = startOfDay(new Date(getStoryUpdatedTime(story)))
      const key = day.toISOString()
      if (!groupsByKey.has(key)) {
        groupsByKey.set(key, {
          key,
          label: formatDateGroupLabel(day),
          items: collapsedGroups.has(key) ? [] : [],
          collapsible: true,
          ...(collapsedGroups.has(key) ? { collapsedCount: 0 } : {}),
        })
        groupDates.set(key, day)
      }
      const group = groupsByKey.get(key)!
      if (collapsedGroups.has(key)) {
        group.collapsedCount = (group.collapsedCount ?? 0) + 1
      } else {
        group.items.push({ item: story })
      }
    }

    const orderedKeys = Array.from(groupDates.entries())
      .sort(([, a], [, b]) => b.getTime() - a.getTime())
      .map(([key]) => key)

    const orderedGroups = orderedKeys.map(key => groupsByKey.get(key)!)
    if (orderedGroups.length === 1) {
      orderedGroups[0].collapsible = false
    }
    return orderedGroups
  }, [collapsedGroups, filteredStories])

  const toggleGroupCollapse = React.useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])

  const collapseAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set(groups.filter(group => group.collapsible).map(group => group.key)))
  }, [groups])

  const expandAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EntityList<StoryListRow>
        groups={groups}
        getKey={(row) => row.item.id}
        collapsedGroups={collapsedGroups}
        onToggleCollapse={toggleGroupCollapse}
        onCollapseAll={collapseAllGroups}
        onExpandAll={expandAllGroups}
        scrollAreaClassName="min-h-0"
        emptyState={
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-5 text-muted-foreground">
            No stories match this filter.
          </div>
        }
        renderItem={(row) => (
          <StoryRow
            story={row.item}
            labels={labels}
            flatLabels={flatLabels}
            selected={selectedStoryId === row.item.id}
            onSelect={() => setSelectedStoryId(row.item.id)}
            onStatusChange={(status) => updateStoryStatus(row.item.id, status)}
            onToggleLabel={(labelId) => toggleStoryLabel(row.item.id, labelId)}
          />
        )}
      />
    </div>
  )
}
