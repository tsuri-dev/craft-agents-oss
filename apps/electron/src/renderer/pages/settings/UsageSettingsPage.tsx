import { BarChart3 } from 'lucide-react'

import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { UsageStatsContent } from '@/components/app-shell/UsageStatsDialog'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppShellContext } from '@/context/AppShellContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import { routes } from '@/lib/navigate'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'usage',
}

export default function UsageSettingsPage() {
  const { activeWorkspaceId, workspaces } = useAppShellContext()
  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId)
  const usageWorkspaceId = activeWorkspace?.remoteServer?.remoteWorkspaceId ?? activeWorkspaceId

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Usage" actions={<HeaderMenu route={routes.view.settings('usage')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-4xl mx-auto">
            <div className="mb-6 flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.04] ring-1 ring-foreground/[0.06]">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-foreground">Usage</h2>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
                  Token usage by day, week, and all time. Older sessions may be estimated from session totals.
                </p>
              </div>
            </div>
            <UsageStatsContent workspaceId={usageWorkspaceId} sessionsMaxHeight="max-h-[420px]" />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
