import * as React from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import type { RequirementPluginDescriptor } from '../../../shared/types'

interface PluginCard {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  installed?: boolean
}

function PluginRow({ plugin, onOpen }: { plugin: PluginCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-16 w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition-[background-color,transform] duration-150 ease-out active:scale-[0.99] [@media(hover:hover)]:hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-foreground/[0.06] text-lg">
        {plugin.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-foreground">{plugin.name}</span>
        <span className="mt-0.5 block truncate text-[12px] leading-5 text-muted-foreground">{plugin.description}</span>
      </span>
      {plugin.installed ? (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground" aria-label="Installed">
          <Check className="h-4 w-4" />
        </span>
      ) : (
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-foreground/[0.06] px-2.5 text-[12px] font-medium text-foreground transition-colors group-hover:bg-foreground/[0.09]">
          <Plus className="h-3.5 w-3.5" />
          Install
        </span>
      )}
    </button>
  )
}

export function PluginsHub() {
  const { activeWorkspaceId, enabledSources } = useAppShellContext()
  const [plugins, setPlugins] = React.useState<RequirementPluginDescriptor[]>([])
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    if (!activeWorkspaceId) return
    let stale = false
    window.electronAPI.listRequirementPlugins(activeWorkspaceId)
      .then(result => { if (!stale) setPlugins(result) })
      .catch(() => { if (!stale) setPlugins([]) })
    return () => { stale = true }
  }, [activeWorkspaceId])

  const tapd = plugins.find(plugin => plugin.id === 'tapd')
  const tapdInstalled = (enabledSources ?? []).some(source => source.config.slug === 'tapd-mcp-http' && source.config.enabled !== false)
  const featuredPlugins: PluginCard[] = [
    {
      id: 'tapd',
      name: 'TAPD',
      description: tapdInstalled
        ? 'Installed requirement board for TAPD workspaces'
        : 'Browse TAPD requirements after installing the plugin',
      icon: tapd?.icon ?? '📋',
      installed: tapdInstalled,
    },
  ]

  const filtered = featuredPlugins.filter(plugin => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return plugin.name.toLowerCase().includes(q) || plugin.description.toLowerCase().includes(q)
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10">
        <div className="mb-8">
          <h1 className="max-w-2xl text-[32px] font-light leading-tight tracking-[-0.022em] text-foreground text-balance">
            Make Craft Agent work your way
          </h1>
          <p className="mt-2 max-w-[60ch] text-sm leading-6 text-muted-foreground text-pretty">
            Install focused plugins that add source-specific surfaces to Craft Agent.
          </p>
        </div>

        <div className="mb-8 max-w-2xl">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search plugins" className="pl-9" />
          </div>
        </div>

        <section className="max-w-3xl">
          <div className="mb-2 text-[13px] font-medium text-foreground">Featured</div>
          <div className="border-y border-foreground/[0.07] py-1">
            {filtered.map(plugin => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                onOpen={() => navigate(routes.view.plugins('tapd'))}
              />
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-8 text-sm text-muted-foreground">No plugins match your search.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export function PluginIntroPage() {
  return <div className="h-full min-h-0 bg-background" />
}
