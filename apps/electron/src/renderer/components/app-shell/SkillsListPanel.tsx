import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Download, RefreshCw, Store, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { SendResourceToWorkspaceDialog } from './SendResourceToWorkspaceDialog'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import type { LoadedSkill } from '../../../shared/types'
import type { StorePackageSummary, StoreReceiptsFile } from '@craft-agent/shared/protocol'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onDeleteSkill: (skillSlug: string) => void
  onSkillClick: (skill: LoadedSkill) => void
  onStoreInstalled?: () => Promise<void> | void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  className?: string
}

export function SkillsListPanel({
  skills,
  onDeleteSkill,
  onSkillClick,
  onStoreInstalled,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { workspaces, activeWorkspaceId } = useAppShellContext()
  const hasOtherWorkspaces = workspaces.length > 1
  const [storeOpen, setStoreOpen] = React.useState(false)

  // Send to Workspace dialog state
  const [sendDialogOpen, setSendDialogOpen] = React.useState(false)
  const [sendResourceSlug, setSendResourceSlug] = React.useState<string | null>(null)
  const [sendResourceLabel, setSendResourceLabel] = React.useState('')

  return (
    <>
    <div className="flex items-center justify-end px-2 pb-2">
      <button
        type="button"
        onClick={() => setStoreOpen(true)}
        className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
      >
        <Store className="h-3.5 w-3.5" />
        Store
      </button>
    </div>
    <EntityPanel<LoadedSkill>
      items={skills}
      getId={(s) => s.slug}
      selection={skillSelection}
      selectedId={selectedSkillSlug}
      onItemClick={onSkillClick}
      className={className}
      containerProps={{ 'data-list-role': 'skills' }}
      emptyState={
        <EntityListEmptyScreen
          icon={<Zap />}
          title={t('skillsList.noSkillsConfigured')}
          description={t('skillsList.emptyDescription')}
          docKey="skills"
        >
          <div className="flex items-center gap-2">
            {workspaceRootPath && (
              <EditPopover
                align="center"
                trigger={
                  <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                    {t('skillsList.addSkill')}
                  </button>
                }
                {...getEditConfig('add-skill', workspaceRootPath)}
              />
            )}
            <button
              type="button"
              onClick={() => setStoreOpen(true)}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Browse Store
            </button>
          </div>
        </EntityListEmptyScreen>
      }
      mapItem={(skill) => ({
        icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
        title: skill.metadata.name,
        badges: (
          <span className="flex items-center gap-1.5 min-w-0">
            {skill.source === 'project' && (
              <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-foreground/5 text-muted-foreground">
                {t('skillsList.projectBadge')}
              </span>
            )}
            <span className="truncate">{skill.metadata.description}</span>
          </span>
        ),
        menu: (
          <SkillMenu
            skillSlug={skill.slug}
            skillName={skill.metadata.name}
            onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
            onShowInFinder={async () => {
              if (!canRevealLocally) return
              try {
                await window.electronAPI.showInFolder(skill.path)
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err)
                toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                  description: message,
                })
              }
            }}
            canShowInFinder={canRevealLocally}
            onDelete={skill.source === 'workspace' ? () => onDeleteSkill(skill.slug) : undefined}
            canDelete={skill.source === 'workspace'}
            deleteLabel={skill.source === 'workspace' ? t('skillsList.deleteSkill') : t('skillsList.managedByProject')}
            onSendToWorkspace={hasOtherWorkspaces && skill.source === 'workspace' ? () => {
              setSendResourceSlug(skill.slug)
              setSendResourceLabel(skill.metadata.name)
              setSendDialogOpen(true)
            } : undefined}
          />
        ),
      })}
    />

    {/* Send to Workspace dialog */}
    {sendResourceSlug && (
      <SendResourceToWorkspaceDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        resourceType="skill"
        resourceIds={[sendResourceSlug]}
        resourceLabel={sendResourceLabel}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
      />
    )}

    <SkillStoreDialog
      open={storeOpen}
      onOpenChange={setStoreOpen}
      workspaceId={workspaceId}
      onInstalled={onStoreInstalled}
    />
    </>
  )
}

type InstalledPackages = StoreReceiptsFile['installedPackages']

function SkillStoreDialog({
  open,
  onOpenChange,
  workspaceId,
  onInstalled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  onInstalled?: () => Promise<void> | void
}) {
  const [registryUrl, setRegistryUrl] = React.useState(() => localStorage.getItem('craft-store-registry-url') ?? '')
  const [query, setQuery] = React.useState('')
  const [packages, setPackages] = React.useState<StorePackageSummary[]>([])
  const [installed, setInstalled] = React.useState<InstalledPackages>({})
  const [loading, setLoading] = React.useState(false)
  const [installingId, setInstallingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const registryReady = registryUrl.trim().length > 0

  const loadInstalled = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const result = await window.electronAPI.listInstalledStorePackages(workspaceId)
      setInstalled(result ?? {})
    } catch (err) {
      console.error('[Store] Failed to load installed packages:', err)
    }
  }, [workspaceId])

  const loadPackages = React.useCallback(async () => {
    if (!registryReady) {
      setError('Enter a Store registry URL first.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const normalized = registryUrl.trim()
      localStorage.setItem('craft-store-registry-url', normalized)
      const [skillPackages, agentPackages] = await Promise.all([
        window.electronAPI.listStorePackages({ registryUrl: normalized, type: 'skill', q: query.trim() || undefined }),
        window.electronAPI.listStorePackages({ registryUrl: normalized, type: 'agent', q: query.trim() || undefined }),
        loadInstalled(),
      ])
      setPackages([...skillPackages, ...agentPackages])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error('Failed to load Store packages', { description: message })
    } finally {
      setLoading(false)
    }
  }, [loadInstalled, query, registryReady, registryUrl])

  React.useEffect(() => {
    if (!open) return
    void loadInstalled()
  }, [loadInstalled, open])

  const installPackage = async (pkg: StorePackageSummary) => {
    if (!workspaceId) {
      toast.error('No active workspace')
      return
    }
    if (!registryReady) {
      setError('Enter a Store registry URL first.')
      return
    }
    setInstallingId(pkg.id)
    setError(null)
    try {
      const result = await window.electronAPI.installStorePackage(workspaceId, {
        registryUrl: registryUrl.trim(),
        packageId: pkg.id,
        version: pkg.version,
        conflictStrategy: 'copy',
      })
      toast.success(`Installed ${result.manifest.name}`, {
        description: result.warnings.length ? result.warnings.join('\n') : undefined,
      })
      await loadInstalled()
      await onInstalled?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(`Failed to install ${pkg.name}`, { description: message })
    } finally {
      setInstallingId(null)
    }
  }

  const installedKeys = React.useMemo(() => new Set(
    Object.values(installed).map((receipt) => `${receipt.packageId}@${receipt.version}`),
  ), [installed])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-4 w-4" />
            Agent Store
          </DialogTitle>
          <DialogDescription>
            Browse and install Store packages into this workspace. P0.5/P1 supports skill and agent packages.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input
              value={registryUrl}
              onChange={(event) => setRegistryUrl(event.target.value)}
              placeholder="https://your-store.example"
            />
            <Button variant="secondary" onClick={loadPackages} disabled={loading || !registryReady}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void loadPackages()
            }}
            placeholder="Search packages..."
          />

          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-border/60 overflow-hidden max-h-[420px] overflow-y-auto">
            {packages.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {loading ? 'Loading packages...' : 'Enter a registry URL and click Refresh.'}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {packages.map((pkg) => {
                  const installedSameVersion = installedKeys.has(`${pkg.id}@${pkg.version}`)
                  return (
                    <div key={`${pkg.id}@${pkg.version}`} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="font-medium truncate">{pkg.name}</div>
                          <Badge variant="secondary" className="shrink-0">{pkg.type}</Badge>
                          <span className="shrink-0 text-xs text-muted-foreground">v{pkg.version}</span>
                          {installedSameVersion && <Badge variant="outline" className="shrink-0">Installed</Badge>}
                        </div>
                        {pkg.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{pkg.description}</p>
                        )}
                        {pkg.author?.name && (
                          <p className="text-[11px] text-muted-foreground">By {pkg.author.name}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={installedSameVersion ? 'ghost' : 'secondary'}
                        disabled={installingId === pkg.id || !workspaceId}
                        onClick={() => installPackage(pkg)}
                      >
                        {installingId === pkg.id ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        {installedSameVersion ? 'Reinstall' : 'Install'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {Object.keys(installed).length > 0 && (
            <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Installed packages: {Object.values(installed).map((receipt) => `${receipt.packageId}@${receipt.version}`).join(', ')}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
