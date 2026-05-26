/**
 * MainContentPanel - Right panel component for displaying content
 *
 * Renders content based on the unified NavigationState:
 * - Chats navigator: ChatPage for selected session, or empty state
 * - Sources navigator: SourceInfoPage for selected source, or empty state
 * - Settings navigator: Settings, Preferences, or Shortcuts page
 *
 * The NavigationState is the single source of truth for what to display.
 *
 * In focused mode (single window), wraps content with StoplightProvider
 * so PanelHeader components automatically compensate for macOS traffic lights.
 *
 * When multiple sessions are selected (multi-select mode), shows the
 * MultiSelectPanel with batch action buttons instead of a single chat.
 */

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Panel } from './Panel'
import { MultiSelectPanel } from './MultiSelectPanel'
import { SessionBoard } from './SessionBoard'
import { RequirementBoard, RequirementDetailPage } from './RequirementBoard'
import { AgentProfileDetailPage, AgentProfilesOverviewPage } from './AgentProfiles'
import { PluginIntroPage, PluginsHub } from './PluginsHub'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom, type SessionMeta } from '@/atoms/sessions'
import { StoplightProvider } from '@/context/StoplightContext'
import {
  routes,
  useNavigationState,
  useNavigation,
  isSessionsNavigation,
  isSourcesNavigation,
  isSettingsNavigation,
  isSkillsNavigation,
  isAutomationsNavigation,
  isAgentsNavigation,
  isPluginsNavigation,
} from '@/contexts/NavigationContext'
import { useSessionSelection, useIsMultiSelectActive, useSelectedIds, useSelectionCount } from '@/hooks/useSession'
import { sourceSelection, skillSelection, automationSelection } from '@/hooks/useEntitySelection'
import { extractLabelId, flattenLabels, getDescendantIds } from '@craft-agent/shared/labels'
import type { SessionStatusId } from '@/config/session-status-config'
import { SourceInfoPage, ChatPage } from '@/pages'
import SkillInfoPage from '@/pages/SkillInfoPage'
import { getSettingsPageComponent } from '@/pages/settings/settings-pages'
import { AutomationInfoPage } from '../automations/AutomationInfoPage'
import type { ExecutionEntry } from '../automations/types'
import { automationsAtom } from '@/atoms/automations'
import { SendResourceToWorkspaceDialog, type SendResourceType } from './SendResourceToWorkspaceDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  addSessionGroupLabel,
  buildSessionGroupFilterOptions,
  resolveUniqueSessionGroupName,
} from '@/utils/session-group-filter'

class SourceDetailErrorBoundary extends React.Component<{
  sourceSlug: string
  children: React.ReactNode
}, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[SourceDetailErrorBoundary] Source detail crashed:', error, info)
  }

  componentDidUpdate(prevProps: { sourceSlug: string }) {
    if (prevProps.sourceSlug !== this.props.sourceSlug && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-md rounded-lg border border-border bg-background p-5 shadow-sm">
          <div className="text-sm font-medium text-foreground">Source failed to open</div>
          <div className="mt-2 text-xs leading-5 text-muted-foreground">
            {this.state.error.message || 'The source detail page crashed while rendering.'}
          </div>
          <Button size="sm" variant="outline" className="mt-4" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    )
  }
}

export interface MainContentPanelProps {
  /** Whether both sidebar and navigator are hidden (focus mode / CMD+.) */
  isSidebarAndNavigatorHidden?: boolean
  /** Optional className for the container */
  className?: string
  /**
   * Override the navigation state for this panel.
   * When provided, this panel renders based on the override instead of the global NavigationState.
   * Used by PanelSlot to render panels in the panel stack.
   */
  navStateOverride?: import('../../../shared/types').NavigationState | null
}

export function MainContentPanel({
  isSidebarAndNavigatorHidden = false,
  className,
  navStateOverride,
}: MainContentPanelProps) {
  const { t } = useTranslation()
  const globalNavState = useNavigationState()
  const { navigate, navigateToSession } = useNavigation()
  const navState = navStateOverride ?? globalNavState
  const {
    activeWorkspaceId,
    workspaces,
    onSessionStatusChange,
    onSessionBoardPositionChange,
    onArchiveSession,
    onSessionLabelsChange,
    sessionStatuses,
    labels,
    sessionBoardViewMode,
    sessionBoardGroupBy,
    sessionBoardSessions,
    onSessionBoardViewModeChange,
    hiddenBoardStatusIds,
    onHideBoardStatus,
    onShowBoardStatus,
    onTestAutomation,
    onToggleAutomation,
    onDuplicateAutomation,
    onDeleteAutomation,
    onReplayAutomation,
    automationTestResults,
    getAutomationHistory,
    activeSessionWorkingDirectory,
  } = useAppShellContext()

  // Session multi-select state
  const isMultiSelectActive = useIsMultiSelectActive()
  const selectedIds = useSelectedIds()
  const selectionCount = useSelectionCount()
  const { clearMultiSelect } = useSessionSelection()
  const sessionMetaMap = useAtomValue(sessionMetaMapAtom)
  const automations = useAtomValue(automationsAtom)

  // Execution history for the selected automation
  const selectedAutomationId = isAutomationsNavigation(navState) ? navState.details?.automationId : undefined
  const [executions, setExecutions] = useState<ExecutionEntry[]>([])

  useEffect(() => {
    if (!selectedAutomationId || !getAutomationHistory) {
      setExecutions([])
      return
    }
    let stale = false

    // Initial fetch
    getAutomationHistory(selectedAutomationId).then(entries => {
      if (!stale) setExecutions(entries)
    })

    // Re-fetch on automation changes (live updates when automations fire)
    const cleanup = window.electronAPI.onAutomationsChanged(() => {
      if (!stale) {
        getAutomationHistory(selectedAutomationId).then(entries => {
          if (!stale) setExecutions(entries)
        })
      }
    })

    return () => { stale = true; cleanup() }
  }, [selectedAutomationId, getAutomationHistory])

  // Source multi-select state
  const isSourceMultiSelectActive = sourceSelection.useIsMultiSelectActive()
  const sourceSelectionCount = sourceSelection.useSelectionCount()
  const selectedSourceIds = sourceSelection.useSelectedIds()
  const { clearMultiSelect: clearSourceSelection } = sourceSelection.useSelection()

  // Skill multi-select state
  const isSkillMultiSelectActive = skillSelection.useIsMultiSelectActive()
  const skillSelectionCount = skillSelection.useSelectionCount()
  const selectedSkillIds = skillSelection.useSelectedIds()
  const { clearMultiSelect: clearSkillSelection } = skillSelection.useSelection()

  // Automation multi-select state
  const isAutomationMultiSelectActive = automationSelection.useIsMultiSelectActive()
  const automationSelectionCount = automationSelection.useSelectionCount()
  const selectedAutomationIds = automationSelection.useSelectedIds()
  const { clearMultiSelect: clearAutomationSelection } = automationSelection.useSelection()

  // Send to Workspace dialog state (shared across resource types)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendResourceType, setSendResourceType] = useState<SendResourceType>('source')
  const [sendResourceIds, setSendResourceIds] = useState<string[]>([])
  const [sendResourceLabel, setSendResourceLabel] = useState('')
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const hasOtherWorkspaces = workspaces.length > 1

  const openSendDialog = useCallback((type: SendResourceType, ids: Set<string>) => {
    const count = ids.size
    setSendResourceType(type)
    setSendResourceIds([...ids])
    setSendResourceLabel(`${count} ${type}${count !== 1 ? 's' : ''}`)
    setSendDialogOpen(true)
  }, [])

  const selectedMetas = useMemo(() => {
    const metas: SessionMeta[] = []
    selectedIds.forEach((id) => {
      const meta = sessionMetaMap.get(id)
      if (meta) metas.push(meta)
    })
    return metas
  }, [selectedIds, sessionMetaMap])

  const boardSessions = useMemo(() => {
    if (sessionBoardSessions) return sessionBoardSessions
    if (!activeWorkspaceId) return []
    const activeSessions = Array.from(sessionMetaMap.values()).filter(meta =>
      meta.workspaceId === activeWorkspaceId &&
      !meta.hidden &&
      !meta.isArchived
    )
    if (!isSessionsNavigation(navState)) return activeSessions
    const filter = navState.filter
    if (!filter || filter.kind === 'allSessions') return activeSessions
    if (filter.kind === 'flagged') return activeSessions.filter(meta => meta.isFlagged)
    if (filter.kind === 'state') return activeSessions.filter(meta => (meta.sessionStatus || 'todo') === filter.stateId)
    if (filter.kind === 'label') {
      if (filter.labelId === '__all__') return activeSessions.filter(meta => (meta.labels?.length ?? 0) > 0)
      const labelIds = new Set([filter.labelId, ...getDescendantIds(labels ?? [], filter.labelId)])
      return activeSessions.filter(meta => meta.labels?.some(label => labelIds.has(extractLabelId(label))))
    }
    if (filter.kind === 'view') return activeSessions
    return activeSessions
  }, [activeWorkspaceId, labels, navState, sessionBoardSessions, sessionMetaMap])

  const flatLabels = useMemo(() => flattenLabels(labels ?? []), [labels])

  const groupOptions = useMemo(() => {
    const workspaceSessions = Array.from(sessionMetaMap.values()).filter(meta =>
      (!activeWorkspaceId || meta.workspaceId === activeWorkspaceId) &&
      !meta.hidden &&
      !meta.isArchived
    )
    return buildSessionGroupFilterOptions(workspaceSessions)
  }, [activeWorkspaceId, sessionMetaMap])

  const handleBoardSelectSession = useCallback((sessionId: string) => {
    onSessionBoardViewModeChange?.('list')
    navigateToSession(sessionId)
  }, [navigateToSession, onSessionBoardViewModeChange])

  const activeStatusId = useMemo((): SessionStatusId | null => {
    if (selectedMetas.length === 0) return null
    const first = (selectedMetas[0].sessionStatus || 'todo') as SessionStatusId
    const allSame = selectedMetas.every(meta => (meta.sessionStatus || 'todo') === first)
    return allSame ? first : null
  }, [selectedMetas])

  const appliedLabelIds = useMemo(() => {
    if (selectedMetas.length === 0) return new Set<string>()
    const toLabelSet = (meta: SessionMeta) =>
      new Set((meta.labels || []).map(entry => extractLabelId(entry)))
    const [first, ...rest] = selectedMetas.map(toLabelSet)
    const intersection = new Set(first)
    for (const labelSet of rest) {
      for (const id of [...intersection]) {
        if (!labelSet.has(id)) intersection.delete(id)
      }
    }
    return intersection
  }, [selectedMetas])

  // Batch operations for multi-select
  const handleBatchSetStatus = useCallback((status: SessionStatusId) => {
    selectedIds.forEach(sessionId => {
      onSessionStatusChange(sessionId, status)
    })
  }, [selectedIds, onSessionStatusChange])

  const handleBatchArchive = useCallback(() => {
    selectedIds.forEach(sessionId => {
      onArchiveSession(sessionId)
    })
    clearMultiSelect()
  }, [selectedIds, onArchiveSession, clearMultiSelect])

  const handleBatchToggleLabel = useCallback((labelId: string) => {
    if (!onSessionLabelsChange) return
    const allHaveLabel = selectedMetas.every(meta =>
      (meta.labels || []).some(entry => extractLabelId(entry) === labelId)
    )

    selectedMetas.forEach(meta => {
      const labels = meta.labels || []
      const hasLabel = labels.some(entry => extractLabelId(entry) === labelId)
      const filtered = labels.filter(entry => extractLabelId(entry) !== labelId)
      const nextLabels = allHaveLabel
        ? filtered
        : (hasLabel ? labels : [...labels, labelId])
      onSessionLabelsChange(meta.id, nextLabels)
    })
  }, [selectedMetas, onSessionLabelsChange])

  const addSelectedSessionsToGroup = useCallback((groupName: string) => {
    if (!onSessionLabelsChange) return
    selectedMetas.forEach(meta => {
      const nextLabels = addSessionGroupLabel(meta.labels, groupName)
      if (nextLabels !== meta.labels) {
        onSessionLabelsChange(meta.id, nextLabels)
      }
    })
  }, [onSessionLabelsChange, selectedMetas])

  const handleCreateGroup = useCallback(() => {
    setNewGroupName('')
    setGroupDialogOpen(true)
  }, [])

  const handleConfirmCreateGroup = useCallback(() => {
    const trimmed = newGroupName.trim()
    if (!trimmed) return
    const groupName = resolveUniqueSessionGroupName(trimmed, groupOptions.map(option => option.value))
    addSelectedSessionsToGroup(groupName)
    setGroupDialogOpen(false)
    setNewGroupName('')
    toast.success(`Added ${selectionCount} session${selectionCount === 1 ? '' : 's'} to “${groupName}”`)
  }, [addSelectedSessionsToGroup, groupOptions, newGroupName, selectionCount])

  // Wrap content with StoplightProvider so PanelHeaders auto-compensate in focused mode.
  // Also renders the Send to Workspace dialog (portal-based, so it overlays regardless of position).
  const wrapWithStoplight = (content: React.ReactNode) => (
    <StoplightProvider value={isSidebarAndNavigatorHidden}>
      {content}
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType={sendResourceType}
        resourceIds={sendResourceIds}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId || ''}
      />
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Group</DialogTitle>
            <DialogDescription>
              Add {selectionCount} selected session{selectionCount === 1 ? '' : 's'} to a new group.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              handleConfirmCreateGroup()
            }}
          >
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGroupDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!newGroupName.trim()}>
                Create Group
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </StoplightProvider>
  )

  // Settings navigator - uses component map from settings-pages.ts.
  // Bare `settings` route (subpage === null) means navigator-only view in compact mode;
  // PanelStackContainer hides the content panel entirely. On desktop the panel still
  // mounts, so fall back to the App page so it isn't empty.
  if (isSettingsNavigation(navState)) {
    const subpage = navState.subpage ?? 'app'
    const SettingsPageComponent = getSettingsPageComponent(subpage)
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <SettingsPageComponent />
      </Panel>
    )
  }

  // Sources navigator - show source info, multi-select panel, or empty state
  if (isSourcesNavigation(navState)) {
    if (isSourceMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={sourceSelectionCount}
            entityType="source"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('source', selectedSourceIds) : undefined}
            onClearSelection={clearSourceSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SourceDetailErrorBoundary sourceSlug={navState.details.sourceSlug}>
            <SourceInfoPage
              sourceSlug={navState.details.sourceSlug}
              workspaceId={activeWorkspaceId || ''}
            />
          </SourceDetailErrorBoundary>
        </Panel>
      )
    }
    // No source selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("sourcesList.noSourcesConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Skills navigator - show skill info, multi-select panel, or empty state
  if (isSkillsNavigation(navState)) {
    if (isSkillMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={skillSelectionCount}
            entityType="skill"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('skill', selectedSkillIds) : undefined}
            onClearSelection={clearSkillSelection}
          />
        </Panel>
      )
    }
    if (navState.details?.type === 'skill') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <SkillInfoPage
            skillSlug={navState.details.skillSlug}
            workspaceId={activeWorkspaceId || ''}
            workingDirectory={activeSessionWorkingDirectory}
          />
        </Panel>
      )
    }
    // No skill selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("skillsList.noSkillsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  // Automations navigator - show automation info, multi-select panel, or empty state
  if (isAutomationsNavigation(navState)) {
    if (isAutomationMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={automationSelectionCount}
            entityType="automation"
            onSendToWorkspace={hasOtherWorkspaces ? () => openSendDialog('automation', selectedAutomationIds) : undefined}
            onClearSelection={clearAutomationSelection}
          />
        </Panel>
      )
    }
    if (navState.details) {
      const automation = automations.find(h => h.id === navState.details!.automationId)
      if (automation) {
        return wrapWithStoplight(
          <Panel variant="grow" className={className}>
            <AutomationInfoPage
              automation={automation}
              executions={executions}
              testResult={automationTestResults?.[automation.id]}
              onTest={onTestAutomation ? () => onTestAutomation(automation.id) : undefined}
              onToggleEnabled={onToggleAutomation ? () => onToggleAutomation(automation.id) : undefined}
              onDuplicate={onDuplicateAutomation ? () => onDuplicateAutomation(automation.id) : undefined}
              onDelete={onDeleteAutomation ? () => onDeleteAutomation(automation.id) : undefined}
              onReplay={onReplayAutomation}
            />
          </Panel>
        )
      }
    }
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("automations.noAutomationsConfigured")}</p>
        </div>
      </Panel>
    )
  }

  if (isAgentsNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        {navState.details?.type === 'agent'
          ? <AgentProfileDetailPage agentId={navState.details.agentId} onBack={() => navigate(routes.view.agents())} />
          : <AgentProfilesOverviewPage onAgentClick={(agentId) => navigate(routes.view.agents(agentId))} />}
      </Panel>
    )
  }

  if (isPluginsNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        {navState.details?.pluginId === 'tapd'
          ? (navState.details.page === 'requirement' && navState.details.sourceItemId
            ? <RequirementDetailPage sourceItemId={navState.details.sourceItemId} />
            : navState.details.page === 'board'
              ? <RequirementBoard />
              : <PluginIntroPage />)
          : <PluginsHub />}
      </Panel>
    )
  }

  // Chats navigator - show chat, multi-select panel, or empty state
  if (isSessionsNavigation(navState)) {
    // Multi-select mode: show batch actions panel
    if (isMultiSelectActive) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <MultiSelectPanel
            count={selectionCount}
            sessionStatuses={sessionStatuses}
            activeStatusId={activeStatusId}
            onSetStatus={handleBatchSetStatus}
            labels={labels}
            appliedLabelIds={appliedLabelIds}
            onToggleLabel={handleBatchToggleLabel}
            groupOptions={groupOptions}
            onCreateGroup={handleCreateGroup}
            onAddToGroup={addSelectedSessionsToGroup}
            onArchive={handleBatchArchive}
            onClearSelection={clearMultiSelect}
          />
        </Panel>
      )
    }

    if (!navState.details && navState.filter?.kind !== 'archived' && sessionBoardViewMode === 'board') {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <div className="flex h-full min-h-0 flex-col bg-background">
            <SessionBoard
              sessions={boardSessions}
              statuses={sessionStatuses ?? []}
              hiddenStatusIds={hiddenBoardStatusIds ?? new Set()}
              labels={flatLabels}
              groupBy={sessionBoardGroupBy ?? 'status'}
              onLabelsChange={onSessionLabelsChange}
              onHideStatus={onHideBoardStatus ?? (() => {})}
              onShowStatus={onShowBoardStatus ?? (() => {})}
              onSelectSession={handleBoardSelectSession}
              onSessionStatusChange={onSessionStatusChange}
              onSessionBoardPositionChange={onSessionBoardPositionChange}
            />
          </div>
        </Panel>
      )
    }

    if (navState.details) {
      return wrapWithStoplight(
        <Panel variant="grow" className={className}>
          <ChatPage sessionId={navState.details.sessionId} />
        </Panel>
      )
    }

    // No session selected - empty state
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <div className="flex items-center justify-center h-full text-muted-foreground">
          <p className="text-sm">{t("session.noSessionSelected")}</p>
        </div>
      </Panel>
    )
  }

  // Fallback (should not happen with proper NavigationState)
  return wrapWithStoplight(
    <Panel variant="grow" className={className}>
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">{t("session.selectConversation")}</p>
      </div>
    </Panel>
  )
}
