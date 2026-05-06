import { formatDistanceToNowStrict } from "date-fns"
import { Flag, GripVertical, Inbox } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { cn } from "@/lib/utils"
import type { SessionMeta } from "@/atoms/sessions"
import { getSessionPreviewText, getSessionTitle, hasUnreadMeta } from "@/utils/session"
import { useOptionalSessionListContext } from "@/context/SessionListContext"
import { SessionBadges } from "./SessionBadges"
import type { LabelConfig } from "@craft-agent/shared/labels"
import type { SessionStatus } from "@/config/session-status-config"
import { getStatusIconStyle } from "@/config/session-status-config"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function SessionBoardCardContent({
  item,
  labels,
  onLabelsChange,
  selectedSessionId,
  statuses,
  onSessionStatusChange,
  isOverlay = false,
}: {
  item: SessionMeta
  labels?: LabelConfig[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  selectedSessionId?: string | null
  statuses?: SessionStatus[]
  onSessionStatusChange?: (sessionId: string, statusId: string) => void
  isOverlay?: boolean
}) {
  const ctx = useOptionalSessionListContext()
  const title = getSessionTitle(item)
  const preview = getSessionPreviewText(item)
  const selected = (selectedSessionId ?? ctx?.selectedSessionId) === item.id
  const hasUnread = hasUnreadMeta(item)
  const flatLabels = labels ?? ctx?.flatLabels ?? []
  const hasLabels = !!(item.labels && item.labels.length > 0 && flatLabels.length > 0)

  return (
    <div
      className={cn(
        "group relative rounded-[8px] bg-background px-3 py-3 shadow-minimal",
        "transition-[transform,background-color,box-shadow] duration-150",
        "border border-foreground/[0.05] hover:bg-foreground/[0.018]",
        selected && "bg-accent/10 shadow-[0_0_0_1px_var(--accent),0_4px_14px_rgba(0,0,0,0.12)]",
        isOverlay && "shadow-[0_12px_28px_rgba(0,0,0,0.22)]",
      )}
    >
      {!isOverlay && (
        <GripVertical className="board-card-drag-handle absolute right-2 top-3 h-3.5 w-3.5 cursor-grab text-muted-foreground/35 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
      <div className="min-w-0 pr-4">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground">
            {title}
          </p>
          {hasUnread ? (
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread" />
          ) : item.isFlagged ? (
            <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
          ) : item.lastMessageAt ? (
            <span className="shrink-0 whitespace-nowrap text-[10px] leading-5 text-muted-foreground/60">
              {formatDistanceToNowStrict(new Date(item.lastMessageAt), { roundingMethod: "floor" })}
            </span>
          ) : null}
        </div>

        {preview && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {preview}
          </p>
        )}

        {hasLabels && (
          <div className="mt-2 flex flex-wrap gap-1">
            <SessionBadges item={item} labels={flatLabels} onLabelsChange={onLabelsChange} />
          </div>
        )}

        {!isOverlay && statuses && statuses.length > 0 && onSessionStatusChange && (
          <div className="mt-2 flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Change session status"
                  className="flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground active:scale-95"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <Inbox className="h-3 w-3" />
                  Status
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {statuses.map((status) => (
                  <DropdownMenuItem
                    key={status.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSessionStatusChange(item.id, status.id)
                    }}
                  >
                    <span
                      className="flex h-4 w-4 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5"
                      style={getStatusIconStyle(status)}
                    >
                      {status.icon}
                    </span>
                    <span>{status.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}

export function SessionBoardCard({
  item,
  labels,
  onLabelsChange,
  selectedSessionId,
  onSelectSession,
  statuses,
  onSessionStatusChange,
}: {
  item: SessionMeta
  labels?: LabelConfig[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  selectedSessionId?: string | null
  onSelectSession?: (sessionId: string) => void
  statuses?: SessionStatus[]
  onSessionStatusChange?: (sessionId: string, statusId: string) => void
}) {
  const ctx = useOptionalSessionListContext()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { status: item.sessionStatus } })

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
      onClick={() => (onSelectSession ?? ctx?.onSelectSessionById)?.(item.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          ;(onSelectSession ?? ctx?.onSelectSessionById)?.(item.id)
        }
      }}
      {...attributes}
      {...listeners}
    >
      <SessionBoardCardContent
        item={item}
        labels={labels}
        onLabelsChange={onLabelsChange}
        selectedSessionId={selectedSessionId}
        statuses={statuses}
        onSessionStatusChange={onSessionStatusChange}
      />
    </div>
  )
}

export function SessionBoardDragOverlay({
  item,
  labels,
  onLabelsChange,
  selectedSessionId,
}: {
  item: SessionMeta
  labels?: LabelConfig[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  selectedSessionId?: string | null
}) {
  return (
    <div className="w-[272px] rotate-1 scale-[1.02]">
      <SessionBoardCardContent
        item={item}
        labels={labels}
        onLabelsChange={onLabelsChange}
        selectedSessionId={selectedSessionId}
        isOverlay
      />
    </div>
  )
}
