import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Bot, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { toast } from 'sonner'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { TAPD_PLUGIN_ID, getTapdRequirementId } from '@/utils/session-requirement-link'
import {
  buildTapdAgentInstructionPrompt,
  readTapdRequirementCache,
  readTapdRequirementWorkContext,
  resolveDefaultTapdAgent,
  upsertTapdCachedItem,
} from '@/utils/tapd-requirement-helpers'
import { SessionFilesSection } from '../right-sidebar/SessionFilesSection'
import type { AgentProfile, AgentRun, ExternalRequirementItem } from '../../../shared/types'

interface SessionInfoPopoverProps {
  sessionId: string
  sessionFolderPath?: string
  trigger: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  presentation?: 'popover' | 'drawer'
}

export const INFO_POPOVER_CONTENT_CLASS = 'w-[360px] h-[460px] min-w-[200px] max-w-[420px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small p-0'
const DEFAULT_DRAWER_CONTENT_CLASS = [
  'data-[vaul-drawer-direction=bottom]:inset-x-2',
  'data-[vaul-drawer-direction=bottom]:bottom-2',
  'data-[vaul-drawer-direction=bottom]:mt-0',
  'data-[vaul-drawer-direction=bottom]:max-h-[min(82vh,42rem)]',
  'overflow-hidden rounded-[14px] border border-border/60 bg-background shadow-modal-small',
].join(' ')

export const InfoPopoverTriggerButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string; icon?: React.ReactNode }
>(function InfoPopoverTriggerButton({
  label = 'Info',
  icon = <Info className="h-3.5 w-3.5 shrink-0" />,
  className,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "h-[30px] pl-[12px] pr-[14px] text-xs font-medium rounded-[8px] flex items-center gap-1.5 shrink-0",
        "outline-none select-none transition-colors shadow-minimal",
        "hover:bg-foreground/5 data-[state=open]:bg-foreground/5",
        "bg-[color-mix(in_srgb,var(--background)_97%,var(--foreground)_3%)]",
        "text-foreground/80",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
})

export function InfoPopoverShell({
  trigger,
  children,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  onOpenChange,
}: {
  trigger: React.ReactElement
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  contentClassName?: string
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? INFO_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function SessionInfoPopover({
  sessionId,
  sessionFolderPath,
  trigger,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  contentClassName,
  presentation = 'popover',
}: SessionInfoPopoverProps) {
  const [open, setOpen] = React.useState(false)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)

    if (!nextOpen) {
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent('craft:focus-input', {
          detail: { sessionId },
        }))
      })
    }
  }, [sessionId])

  if (presentation === 'drawer') {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} direction="bottom">
        <DrawerTrigger asChild>
          {trigger}
        </DrawerTrigger>
        <DrawerContent
          className={cn(DEFAULT_DRAWER_CONTENT_CLASS, contentClassName)}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
          }}
        >
          <DrawerHeader className="border-b border-border/50 px-4 py-3 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
            <DrawerTitle className="text-sm font-medium">Session info</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden">
            <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={contentClassName ?? INFO_POPOVER_CONTENT_CLASS}
        side={side}
        align={align}
        sideOffset={sideOffset}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        <SessionInfoPopoverContent sessionId={sessionId} sessionFolderPath={sessionFolderPath} />
      </PopoverContent>
    </Popover>
  )
}

const ACTIVE_AGENT_RUN_STATUSES = new Set<AgentRun['status']>(['queued', 'running', 'stopping'])

function isTapdTaskRunForSession(run: AgentRun, sessionId: string, requirementId: string): boolean {
  if (run.target?.type === 'requirement') {
    return run.target.pluginId === TAPD_PLUGIN_ID && run.target.sourceItemId === requirementId
  }
  if (run.parentSessionId !== sessionId) return false
  const summary = run.triggerSummary.toLowerCase()
  return summary.includes(requirementId.toLowerCase()) || summary.includes(`tapd-${requirementId}`.toLowerCase())
}

function formatRunTime(value?: string) {
  if (!value) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TapdRequirementHubCard({
  sessionId,
  requirementId,
  sessionIsProcessing: _sessionIsProcessing,
}: {
  sessionId: string
  requirementId: string
  sessionIsProcessing?: boolean
}) {
  const { activeWorkspaceId } = useAppShellContext()
  const [requirement, setRequirement] = React.useState<ExternalRequirementItem | null>(() => readTapdRequirementCache(activeWorkspaceId).itemsById[requirementId] ?? null)
  const [workContext, setWorkContext] = React.useState(() => readTapdRequirementWorkContext(activeWorkspaceId, requirementId))
  const [requirementError, setRequirementError] = React.useState<string | null>(null)
  const [isLoadingRequirement, setIsLoadingRequirement] = React.useState(false)
  const [agents, setAgents] = React.useState<AgentProfile[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = React.useState(false)
  const [runs, setRuns] = React.useState<AgentRun[]>([])
  const [submitting, setSubmitting] = React.useState(false)

  const tapdAgent = React.useMemo(() => resolveDefaultTapdAgent(agents), [agents])

  React.useEffect(() => {
    const cached = readTapdRequirementCache(activeWorkspaceId).itemsById[requirementId]
    if (cached) setRequirement(cached)
    setWorkContext(readTapdRequirementWorkContext(activeWorkspaceId, requirementId))
  }, [activeWorkspaceId, requirementId])

  React.useEffect(() => {
    let cancelled = false
    if (!activeWorkspaceId || typeof window === 'undefined' || !window.electronAPI?.getRequirementItemDetail) return

    setIsLoadingRequirement(true)
    setRequirementError(null)
    window.electronAPI.getRequirementItemDetail(activeWorkspaceId, TAPD_PLUGIN_ID, requirementId, { localOnly: true })
      .then(result => {
        if (cancelled) return
        setRequirement(result.item)
        upsertTapdCachedItem(activeWorkspaceId, result.item)
      })
      .catch(err => {
        if (cancelled) return
        setRequirementError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingRequirement(false)
      })

    return () => { cancelled = true }
  }, [activeWorkspaceId, requirementId])

  React.useEffect(() => {
    let cancelled = false
    if (!activeWorkspaceId || typeof window === 'undefined' || !window.electronAPI?.listAgentProfiles) return

    setIsLoadingAgents(true)
    window.electronAPI.listAgentProfiles(activeWorkspaceId)
      .then(profiles => { if (!cancelled) setAgents(profiles) })
      .catch(() => { if (!cancelled) setAgents([]) })
      .finally(() => { if (!cancelled) setIsLoadingAgents(false) })

    return () => { cancelled = true }
  }, [activeWorkspaceId])

  const loadRuns = React.useCallback(async () => {
    if (!activeWorkspaceId || !tapdAgent || typeof window === 'undefined' || !window.electronAPI?.listAgentRuns) {
      setRuns([])
      return
    }
    try {
      const nextRuns = await window.electronAPI.listAgentRuns(activeWorkspaceId, { agentProfileId: tapdAgent.id, target: { type: 'requirement', pluginId: TAPD_PLUGIN_ID, sourceItemId: requirementId } })
      setRuns(nextRuns)
    } catch {
      setRuns([])
    }
  }, [activeWorkspaceId, requirementId, tapdAgent])

  React.useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  const tapdRuns = React.useMemo(() => runs.filter(run => isTapdTaskRunForSession(run, sessionId, requirementId)), [requirementId, runs, sessionId])
  const activeRun = React.useMemo(() => tapdRuns.find(run => ACTIVE_AGENT_RUN_STATUSES.has(run.status)) ?? null, [tapdRuns])
  const lastCompletedRun = React.useMemo(() => tapdRuns
    .filter(run => run.status === 'completed')
    .sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt))[0] ?? null, [tapdRuns])

  React.useEffect(() => {
    if (!activeRun) return
    const interval = window.setInterval(() => { void loadRuns() }, 2500)
    return () => window.clearInterval(interval)
  }, [activeRun, loadRuns])

  const handleTapdAgent = React.useCallback(async () => {
    if (!activeWorkspaceId || !tapdAgent || !requirement || submitting || activeRun) return
    const prompt = buildTapdAgentInstructionPrompt(tapdAgent.id, requirement, workContext)
    try {
      setSubmitting(true)
      await window.electronAPI.startRequirementAgentRun(activeWorkspaceId, {
        pluginId: TAPD_PLUGIN_ID,
        item: requirement,
        agentProfileId: tapdAgent.id,
        prompt,
        workingDirectory: workContext.workingDirectory,
        groupName: requirement.binding?.groupName,
      })
      await loadRuns()
    } catch (err) {
      toast.error('Could not start Tapd Agent', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }, [activeRun, activeWorkspaceId, loadRuns, requirement, submitting, tapdAgent, workContext])

  const title = requirement?.binding?.groupName ?? requirement?.title ?? `TAPD-${requirementId}`
  const lastRunTime = formatRunTime(lastCompletedRun?.completedAt)
  const disabled = isLoadingAgents || !tapdAgent || !requirement || Boolean(activeRun) || submitting || isLoadingRequirement

  return (
    <div className="shrink-0 border-b border-border/50 p-3">
      <div className="space-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
            TAPD
            {lastCompletedRun && !activeRun ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : null}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-foreground/85" title={title}>{title}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={workContext.workingDirectory}>
            {workContext.workingDirectory || 'Workspace default / not set'}
          </div>
        </div>

        {requirementError && (
          <div className="rounded-[7px] bg-destructive/10 px-2 py-1.5 text-[11px] leading-4 text-destructive">Could not load local requirement context: {requirementError}</div>
        )}
        {isLoadingAgents && !tapdAgent && (
          <div className="text-[11px] text-muted-foreground">Loading agent profiles…</div>
        )}
        {!isLoadingAgents && !tapdAgent && (
          <div className="text-[11px] text-destructive">No Tapd Agent profile found.</div>
        )}

        <Button
          size="sm"
          className="h-8 w-full justify-start rounded-[8px] px-2.5 text-[12px]"
          variant="secondary"
          disabled={disabled}
          onClick={handleTapdAgent}
        >
          {submitting || activeRun ? <Spinner className="text-[10px]" /> : isLoadingRequirement ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
          {submitting || activeRun ? `${tapdAgent?.name ?? 'Tapd'}…` : tapdAgent?.name ?? 'Tapd'}
        </Button>
        {lastRunTime && !activeRun && (
          <div className="text-[11px] text-muted-foreground">Last completed {lastRunTime}</div>
        )}
      </div>
    </div>
  )
}

function SessionInfoPopoverContent({ sessionId, sessionFolderPath }: { sessionId: string; sessionFolderPath?: string }) {
  const { t } = useTranslation()
  const session = useSession(sessionId)
  const { onRenameSession } = useAppShellContext()
  const tapdRequirementId = React.useMemo(() => getTapdRequirementId(session?.labels), [session?.labels])
  const [name, setName] = React.useState('')
  const renameTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNameRef = React.useRef('')

  React.useEffect(() => {
    setName(session?.name || '')
    pendingNameRef.current = session?.name || ''
  }, [session?.name])

  const commitName = React.useCallback((value: string) => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== session?.name) {
      onRenameSession(sessionId, trimmed)
    }
  }, [onRenameSession, session?.name, sessionId])

  React.useEffect(() => {
    return () => {
      if (renameTimeoutRef.current) {
        clearTimeout(renameTimeoutRef.current)
        commitName(pendingNameRef.current)
      }
    }
  }, [commitName])

  const handleNameChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value
    setName(newName)
    pendingNameRef.current = newName

    if (renameTimeoutRef.current) {
      clearTimeout(renameTimeoutRef.current)
    }

    renameTimeoutRef.current = setTimeout(() => {
      renameTimeoutRef.current = null
      commitName(newName)
    }, 500)
  }, [commitName])

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="shrink-0 p-3 border-b border-border/50">
        <label className="text-xs font-medium text-muted-foreground block mb-1.5 select-none">
          {t("chat.title")}
        </label>
        <div className="rounded-lg bg-foreground-2 has-[:focus]:bg-background shadow-minimal transition-colors">
          <Input
            value={name}
            onChange={handleNameChange}
            onBlur={() => {
              if (renameTimeoutRef.current) {
                clearTimeout(renameTimeoutRef.current)
                renameTimeoutRef.current = null
              }
              commitName(pendingNameRef.current)
            }}
            placeholder={t("chat.titlePlaceholder")}
            className="h-9 py-2 text-sm border-0 shadow-none bg-transparent focus-visible:ring-0"
          />
        </div>
      </div>
      {tapdRequirementId && (
        <TapdRequirementHubCard
          sessionId={sessionId}
          requirementId={tapdRequirementId}
          sessionIsProcessing={session?.isProcessing}
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionFilesSection
          sessionId={sessionId}
          sessionFolderPath={sessionFolderPath}
          hideHeader={false}
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}
