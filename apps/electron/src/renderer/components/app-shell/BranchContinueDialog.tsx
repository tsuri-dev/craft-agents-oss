import * as React from "react"
import { Check, GitBranch, Shuffle } from "lucide-react"
import type { Session } from "../../../shared/types"
import type { LlmConnectionWithStatus } from "../../../shared/types"
import { ConnectionIcon } from "@/components/icons/ConnectionIcon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { resolveEffectiveConnectionSlug } from "@config/llm-connections"

type BranchMode = "exact" | "handoff"

function ConnectionRow({
  connection,
  selected,
  disabled = false,
  onSelect,
}: {
  connection: LlmConnectionWithStatus
  selected: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-lg px-2.5 text-left text-sm transition-colors active:scale-95",
        selected ? "bg-foreground/5 text-foreground" : "text-foreground hover:bg-foreground/[0.035]",
        disabled && "cursor-default opacity-100 active:scale-100",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ConnectionIcon connection={connection} size={16} />
        <span className="truncate font-medium">{connection.name}</span>
      </span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
    </button>
  )
}

export interface BranchContinueSelection {
  mode: BranchMode
  connection?: string
}

interface BranchContinueDialogProps {
  open: boolean
  session: Session | null
  branchMessageId: string | null
  llmConnections: LlmConnectionWithStatus[]
  workspaceDefaultLlmConnection?: string
  onOpenChange: (open: boolean) => void
  onConfirm: (selection: BranchContinueSelection) => void | Promise<void>
}

export function BranchContinueDialog({
  open,
  session,
  branchMessageId,
  llmConnections,
  workspaceDefaultLlmConnection,
  onOpenChange,
  onConfirm,
}: BranchContinueDialogProps) {
  const parentConnectionSlug = React.useMemo(
    () => resolveEffectiveConnectionSlug(session?.llmConnection, workspaceDefaultLlmConnection, llmConnections),
    [llmConnections, session?.llmConnection, workspaceDefaultLlmConnection],
  )
  const parentConnection = React.useMemo(
    () => llmConnections.find((connection) => connection.slug === parentConnectionSlug) ?? null,
    [llmConnections, parentConnectionSlug],
  )
  const authenticatedConnections = React.useMemo(
    () => llmConnections.filter((connection) => connection.isAuthenticated),
    [llmConnections],
  )

  const [mode, setMode] = React.useState<BranchMode>("exact")
  const [connectionSlug, setConnectionSlug] = React.useState<string>("")

  React.useEffect(() => {
    if (!open) return
    const initialConnection = parentConnectionSlug || authenticatedConnections[0]?.slug || ""
    setMode(authenticatedConnections.length > 1 ? "handoff" : "exact")
    setConnectionSlug(initialConnection)
  }, [authenticatedConnections, open, parentConnectionSlug])

  const selectedConnectionSlug = mode === "exact" ? parentConnectionSlug || connectionSlug : connectionSlug
  const canConfirm = !!session && !!branchMessageId && !!selectedConnectionSlug

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Continue from this message</DialogTitle>
          <DialogDescription>
            Create a new session from this branch point and choose how much context to carry forward.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode("exact")}
              className={cn(
                "rounded-[8px] border p-3 text-left transition-colors",
                mode === "exact" ? "border-foreground/30 bg-foreground/[0.04]" : "border-foreground/10 hover:bg-foreground/[0.025]",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <GitBranch className="h-4 w-4" />
                Exact branch
              </div>
              <div className="text-xs leading-snug text-muted-foreground">
                Preserve SDK branch context. Same connection only.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("handoff")}
              className={cn(
                "rounded-[8px] border p-3 text-left transition-colors",
                mode === "handoff" ? "border-foreground/30 bg-foreground/[0.04]" : "border-foreground/10 hover:bg-foreground/[0.025]",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                <Shuffle className="h-4 w-4" />
                Handoff package
              </div>
              <div className="text-xs leading-snug text-muted-foreground">
                Write context to notes, then start fresh. Any connection.
              </div>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Connection</label>
            {mode === "exact" ? (
              parentConnection ? (
                <ConnectionRow connection={parentConnection} selected disabled />
              ) : (
                <div className="flex h-10 items-center rounded-lg px-2.5 text-sm text-muted-foreground">
                  {parentConnectionSlug || "Current connection"}
                </div>
              )
            ) : (
              <div className="space-y-1">
                {authenticatedConnections.map((connection) => (
                  <ConnectionRow
                    key={connection.slug}
                    connection={connection}
                    selected={connection.slug === connectionSlug}
                    onSelect={() => setConnectionSlug(connection.slug)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm({ mode, connection: selectedConnectionSlug || undefined })}
          >
            Create branch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
