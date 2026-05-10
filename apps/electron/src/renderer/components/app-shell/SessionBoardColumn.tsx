import { EyeOff, MoreHorizontal } from "lucide-react"
import { useDroppable } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { cn } from "@/lib/utils"
import type { SessionMeta } from "@/atoms/sessions"
import type { SessionStatus } from "@/config/session-status-config"
import type { SessionBoardGroup } from "./session-board-utils"
import type { LabelConfig } from "@craft-agent/shared/labels"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SessionBoardCard } from "./SessionBoardCard"

export function SessionBoardColumn({
  group,
  sessions,
  labels,
  statuses,
  onLabelsChange,
  onHide,
  selectedSessionId,
  onSelectSession,
  onSessionStatusChange,
  showCardStatus = true,
}: {
  group: SessionBoardGroup
  sessions: SessionMeta[]
  labels?: LabelConfig[]
  statuses?: SessionStatus[]
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  onHide: (statusId: string) => void
  selectedSessionId?: string | null
  onSelectSession?: (sessionId: string) => void
  onSessionStatusChange?: (sessionId: string, statusId: string) => void
  showCardStatus?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id })

  return (
    <section className="flex w-[288px] shrink-0 flex-col rounded-[12px] bg-foreground/[0.025] p-2">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="flex h-5 w-5 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4"
            style={group.color ? { color: group.color } : undefined}
          >
            {group.icon}
          </span>
          <span className="truncate text-[12px] font-semibold text-foreground">
            {group.label}
          </span>
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {sessions.length}
          </span>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${group.label}`}
              className="flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] active:scale-95"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onHide(group.id)} disabled={group.kind !== "status"}>
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
        <SortableContext items={sessions.map((session) => session.id)} strategy={verticalListSortingStrategy}>
          {sessions.map((session) => (
            <SessionBoardCard
              key={session.id}
              item={session}
              labels={labels}
              onLabelsChange={onLabelsChange}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              statuses={statuses}
              onSessionStatusChange={onSessionStatusChange}
              showStatus={showCardStatus}
            />
          ))}
        </SortableContext>
        {sessions.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-[8px] border border-dashed border-foreground/[0.08] text-[11px] text-muted-foreground">
            No sessions
          </div>
        )}
      </div>
    </section>
  )
}
