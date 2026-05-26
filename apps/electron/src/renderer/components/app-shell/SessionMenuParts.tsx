import * as React from 'react'
import { useTranslation } from "react-i18next"
import { Check, Globe, Copy, RefreshCw, Link2Off, FolderOpen, Plus } from 'lucide-react'
import type { MenuComponents } from '@/components/ui/menu-context'
import { getStatusIconStyle, type SessionStatusId, type SessionStatus } from '@/config/session-status-config'
import { sortLabelsForDisplay, type LabelConfig } from '@craft-agent/shared/labels'
import { LabelIcon } from '@/components/ui/label-icon'
import { NO_PROJECT_FILTER_ID, PROJECT_LABEL_ID, type SessionProjectFilterOption } from '@/utils/session-project-filter'

export interface ShareMenuItemsProps {
  /** Open the published share URL in the system browser. */
  onOpenInBrowser: () => void
  /** Copy the published share URL to the clipboard. */
  onCopyLink: () => void | Promise<void>
  /** Re-publish the share (bumps the snapshot). */
  onUpdateShare: () => void | Promise<void>
  /** Revoke the share. */
  onRevokeShare: () => void | Promise<void>
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator'>
}

/**
 * Render-only — side effects come from `useSessionMenuActions`. Both the
 * desktop dropdown and the compact drawer wire the same hook callbacks
 * through this component (compact uses its own row primitives, but the
 * action set is identical).
 */
export function ShareMenuItems({
  onOpenInBrowser,
  onCopyLink,
  onUpdateShare,
  onRevokeShare,
  menu,
}: ShareMenuItemsProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator } = menu

  return (
    <>
      <MenuItem onClick={onOpenInBrowser}>
        <Globe className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.openInBrowser")}</span>
      </MenuItem>
      <MenuItem onClick={onCopyLink}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.copyLink")}</span>
      </MenuItem>
      <MenuItem onClick={onUpdateShare}>
        <RefreshCw className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.updateShare")}</span>
      </MenuItem>
      <Separator />
      <MenuItem onClick={onRevokeShare} variant="destructive">
        <Link2Off className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.stopSharing")}</span>
      </MenuItem>
    </>
  )
}

export interface StatusMenuItemsProps {
  sessionStatuses: SessionStatus[]
  activeStateId?: SessionStatusId | null
  onSelect: (stateId: SessionStatusId) => void
  menu: Pick<MenuComponents, 'MenuItem'>
}

export function StatusMenuItems({
  sessionStatuses,
  activeStateId,
  onSelect,
  menu,
}: StatusMenuItemsProps) {
  const { MenuItem } = menu

  return (
    <>
      {sessionStatuses.map((state) => {
        const bareIcon = React.isValidElement(state.icon)
          ? React.cloneElement(state.icon as React.ReactElement<{ bare?: boolean }>, { bare: true })
          : state.icon
        return (
          <MenuItem
            key={state.id}
            onClick={() => onSelect(state.id)}
            className={activeStateId === state.id ? 'bg-foreground/5' : ''}
          >
            <span style={getStatusIconStyle(state)}>
              {bareIcon}
            </span>
            <span className="flex-1">{state.label}</span>
          </MenuItem>
        )
      })}
    </>
  )
}

export interface LabelMenuItemsProps {
  labels: LabelConfig[]
  appliedLabelIds: Set<string>
  onToggle: (labelId: string) => void
  /** Existing project values across the current workspace, used by the built-in Project label shortcut. */
  projectOptions?: SessionProjectFilterOption[]
  /** Current project value for the target session. */
  activeProjectValue?: string | null
  /** Selects an existing project value, or null to clear the Project label. */
  onProjectSelect?: (projectValue: string | null) => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator' | 'Sub' | 'SubTrigger' | 'SubContent'>
}

/**
 * Count how many labels in a subtree (including the root) are currently applied.
 * Used to show selection counts on parent SubTriggers so users can see
 * where in the tree their selections are.
 */
function countAppliedInSubtree(label: LabelConfig, appliedIds: Set<string>): number {
  let count = appliedIds.has(label.id) ? 1 : 0
  if (label.children) {
    for (const child of label.children) {
      count += countAppliedInSubtree(child, appliedIds)
    }
  }
  return count
}

/**
 * LabelMenuItems - Recursive component for rendering label tree as nested sub-menus.
 *
 * Labels with children render as nested Sub/SubTrigger/SubContent menus (the parent
 * itself appears as the first toggleable item inside its submenu, followed by children).
 * Leaf labels render as simple toggleable menu items with checkmarks.
 * Parent triggers show a count of applied descendants so users can see where selections are.
 */
export function LabelMenuItems({
  labels,
  appliedLabelIds,
  onToggle,
  projectOptions = [],
  activeProjectValue,
  onProjectSelect,
  menu,
}: LabelMenuItemsProps) {
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = menu
  const displayLabels = React.useMemo(() => sortLabelsForDisplay(labels), [labels])
  const existingProjectOptions = React.useMemo(
    () => projectOptions.filter(option => option.id !== NO_PROJECT_FILTER_ID && option.value),
    [projectOptions],
  )

  const renderItems = (nodes: LabelConfig[]): React.ReactNode => (
    <>
      {nodes.map(label => {
        const hasChildren = label.children && label.children.length > 0
        const isApplied = appliedLabelIds.has(label.id)
        const isProjectLabel = label.id === PROJECT_LABEL_ID && label.valueType === 'string' && !!onProjectSelect

        if (isProjectLabel) {
          const options = activeProjectValue && !existingProjectOptions.some(option => option.value === activeProjectValue)
            ? [{ id: activeProjectValue, label: activeProjectValue, value: activeProjectValue, count: 1 }, ...existingProjectOptions]
            : existingProjectOptions

          return (
            <Sub key={label.id}>
              <SubTrigger className="pr-2">
                <LabelIcon label={label} size="sm" hasChildren />
                <span className="flex-1">{label.name}</span>
                {activeProjectValue && (
                  <span className="ml-3 max-w-[120px] truncate text-[10px] text-foreground/50">
                    {activeProjectValue}
                  </span>
                )}
              </SubTrigger>
              <SubContent>
                <MenuItem
                  onClick={() => onProjectSelect(null)}
                  className={!activeProjectValue ? 'bg-foreground/5' : ''}
                >
                  <LabelIcon label={label} size="sm" />
                  <span className="flex-1">No Project</span>
                  <span className="w-3.5 ml-4">
                    {!activeProjectValue && <Check className="h-3.5 w-3.5 text-foreground" />}
                  </span>
                </MenuItem>
                {options.length > 0 ? (
                  <>
                    <Separator />
                    {options.map(option => {
                      const isSelected = option.value === activeProjectValue
                      return (
                        <MenuItem
                          key={option.id}
                          onClick={() => onProjectSelect(option.value)}
                          className={isSelected ? 'bg-foreground/5' : ''}
                        >
                          <LabelIcon label={label} size="sm" />
                          <span className="flex-1 truncate">{option.label}</span>
                          <span className="text-[10px] tabular-nums text-muted-foreground">{option.count}</span>
                          <span className="w-3.5 ml-2">
                            {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                          </span>
                        </MenuItem>
                      )
                    })}
                  </>
                ) : (
                  <>
                    <Separator />
                    <MenuItem disabled>
                      <span className="flex-1 text-muted-foreground">No existing projects</span>
                    </MenuItem>
                  </>
                )}
              </SubContent>
            </Sub>
          )
        }

        if (hasChildren) {
          const subtreeCount = countAppliedInSubtree(label, appliedLabelIds)

          return (
            <Sub key={label.id}>
              <SubTrigger className="pr-2">
                <LabelIcon label={label} size="sm" hasChildren />
                <span className="flex-1">{label.name}</span>
                {subtreeCount > 0 && (
                  <span className="text-[10px] text-foreground/50 tabular-nums -mr-2.5">
                    {subtreeCount}
                  </span>
                )}
              </SubTrigger>
              <SubContent>
                <MenuItem
                  onSelect={(e: Event) => {
                    e.preventDefault()
                    onToggle(label.id)
                  }}
                >
                  <LabelIcon label={label} size="sm" hasChildren />
                  <span className="flex-1">{label.name}</span>
                  <span className="w-3.5 ml-4">
                    {isApplied && <Check className="h-3.5 w-3.5 text-foreground" />}
                  </span>
                </MenuItem>
                <Separator />
                {renderItems(label.children!)}
              </SubContent>
            </Sub>
          )
        }

        return (
          <MenuItem
            key={label.id}
            onSelect={(e: Event) => {
              e.preventDefault()
              onToggle(label.id)
            }}
          >
            <LabelIcon label={label} size="sm" />
            <span className="flex-1">{label.name}</span>
            <span className="w-3.5 ml-4">
              {isApplied && <Check className="h-3.5 w-3.5 text-foreground" />}
            </span>
          </MenuItem>
        )
      })}
    </>
  )

  return renderItems(displayLabels)
}

export interface ProjectMenuItemsProps {
  /** Existing project values across the current workspace. */
  projectOptions?: SessionProjectFilterOption[]
  /** Current project value for the target session. */
  activeProjectValue?: string | null
  /** Selects an existing project value, or null to clear the Project label. */
  onProjectSelect: (projectValue: string | null) => void
  /** Opens project creation and applies the new project to the target session. */
  onCreateProject?: () => void
  menu: Pick<MenuComponents, 'MenuItem' | 'Separator'>
}

/**
 * ProjectMenuItems - first-class Project selector for moving a session between projects.
 *
 * Project is stored as the valued label entry `project::value`, but the UI treats it
 * as its own organization axis instead of hiding it under Labels.
 */
export function ProjectMenuItems({
  projectOptions = [],
  activeProjectValue,
  onProjectSelect,
  onCreateProject,
  menu,
}: ProjectMenuItemsProps) {
  const { MenuItem, Separator } = menu
  const existingProjectOptions = React.useMemo(
    () => projectOptions.filter(option => option.id !== NO_PROJECT_FILTER_ID && option.value),
    [projectOptions],
  )
  const options = activeProjectValue && !existingProjectOptions.some(option => option.value === activeProjectValue)
    ? [{ id: activeProjectValue, label: activeProjectValue, value: activeProjectValue, count: 1 }, ...existingProjectOptions]
    : existingProjectOptions
  const hasProjectActions = Boolean(onCreateProject || activeProjectValue)

  return (
    <>
      {onCreateProject && (
        <MenuItem onClick={onCreateProject}>
          <Plus className="h-3.5 w-3.5" />
          <span className="flex-1">New Project…</span>
        </MenuItem>
      )}
      {activeProjectValue && (
        <MenuItem onClick={() => onProjectSelect(null)}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="flex-1">Remove Project</span>
        </MenuItem>
      )}
      {options.length > 0 ? (
        <>
          {hasProjectActions && <Separator />}
          {options.map(option => {
            const isSelected = option.value === activeProjectValue
            return (
              <MenuItem
                key={option.id}
                onClick={() => onProjectSelect(option.value)}
                className={isSelected ? 'bg-foreground/5' : ''}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="flex-1 truncate">{option.label}</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{option.count}</span>
                <span className="w-3.5 ml-2">
                  {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                </span>
              </MenuItem>
            )
          })}
        </>
      ) : (
        <>
          {hasProjectActions && <Separator />}
          <MenuItem disabled>
            <span className="flex-1 text-muted-foreground">No existing projects</span>
          </MenuItem>
        </>
      )}
    </>
  )
}
