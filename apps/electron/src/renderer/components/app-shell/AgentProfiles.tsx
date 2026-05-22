import * as React from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BookOpenText,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Clock3,
  Code2,
  Eye,
  EyeOff,
  FileText,
  Filter,
  GitPullRequest,
  Hash,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  MoreHorizontal,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TiptapMarkdownEditor } from '@craft-agent/ui'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { getModelDisplayName } from '@config/models'
import { DEFAULT_THINKING_LEVEL, type ThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import {
  AGENT_RUN_MOCK_NOW,
  getActiveAgentRuns,
  getRecentFinishedAgentRuns,
  getRunDurationMs,
  summarizeAgentRunsLast30Days,
  type AgentRun,
  type AgentRunBucket,
} from '../../../shared/agent-runs'
import type { AgentProfile, AgentProfileCreateInput, AgentProfileDetail, AgentProfileUpdateInput } from '../../../shared/agent-profiles'
import type { LoadedSkill } from '../../../shared/types'

export interface AgentProfileMock {
  id: string
  name: string
  description: string
  instruction: string
  icon: typeof Bot
  tone: string
  status: 'ready' | 'draft'
  model: string
  thinkingLevel: ThinkingLevel
  permissionMode: string
  skillSlugs: string[]
  sourceSlugs: string[]
  connectionName: string
  availability: 'online' | 'unstable' | 'offline'
  workload: string
  recentRuns: number
  lastRun: string
}

type AgentConnectionOption = {
  slug: string
  name: string
  models: string[]
  defaultModel?: string
  isAuthenticated?: boolean
}

const FALLBACK_AGENT_CONNECTIONS: AgentConnectionOption[] = [
  {
    slug: 'claude-code',
    name: 'Claude Code',
    defaultModel: 'claude-opus-4-5-20251101',
    models: ['claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'],
    isAuthenticated: true,
  },
  {
    slug: 'codex',
    name: 'Codex',
    defaultModel: 'gpt-5.1-codex',
    models: ['gpt-5.1-codex', 'gpt-5.1', 'gpt-5.1-mini'],
    isAuthenticated: true,
  },
]

const THINKING_OPTIONS: Array<{ value: ThinkingLevel; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
]

const INSTRUCTIONS_PLACEHOLDER = `Define this agent's role, expertise, and working style.

# Example
You are a frontend engineer specializing in React and TypeScript.

## Working Style
- Write small, focused changes
- Verify behavior before reporting completion
- Save durable handoff notes when useful

## Constraints
- Do not modify shared contracts without explicit approval
- Ask one focused question when blocked by missing context`

type EnvEntry = {
  id: number
  key: string
  value: string
  visible: boolean
}

let nextEnvEntryId = 0

export const MOCK_AGENT_PROFILES: AgentProfileMock[] = [
  {
    id: 'qqnews-implementation',
    name: 'Orion',
    description: 'Breaks down work, drafts specs, keeps the board tidy.',
    instruction: 'You are a Planning Agent. Turn loose ideas and open issues into scoped, ready-to-execute work: break them down into subtasks, write acceptance criteria, and propose owners and sequencing. Prefer clarity over speed. When blocked by missing context, ask one specific question rather than guessing.',
    icon: Code2,
    tone: 'Planning agent',
    status: 'ready',
    model: 'Default',
    thinkingLevel: 'medium',
    permissionMode: 'Ask',
    skillSlugs: [],
    sourceSlugs: [],
    connectionName: 'Claude Code',
    availability: 'online',
    workload: 'Idle',
    recentRuns: 12,
    lastRun: '8d ago',
  },
  {
    id: 'reviewer',
    name: 'Code Reviewer',
    description: 'Reviews diffs, calls out risks, and returns a concise review report with suggested follow-ups.',
    instruction: 'Focus on correctness, regressions, maintainability, and test coverage. Do not rewrite code unless explicitly asked.',
    icon: GitPullRequest,
    tone: 'Review agent',
    status: 'ready',
    model: 'Claude Sonnet',
    thinkingLevel: 'medium',
    permissionMode: 'Safe',
    skillSlugs: ['receiving-code-review', 'verification-before-completion'],
    sourceSlugs: [],
    connectionName: 'Claude Code',
    availability: 'online',
    workload: 'Idle',
    recentRuns: 1,
    lastRun: 'Yesterday',
  },
  {
    id: 'handoff',
    name: 'Handoff Writer',
    description: 'Condenses session outcomes into durable summaries, artifact manifests, and next-step notes.',
    instruction: 'Extract decisions, unresolved questions, changed files, commands, and next steps. Prefer writing artifacts instead of long chat replies.',
    icon: FileText,
    tone: 'Documentation agent',
    status: 'draft',
    model: 'GPT Mini',
    thinkingLevel: 'low',
    permissionMode: 'Ask',
    skillSlugs: ['save-to-tapd-info'],
    sourceSlugs: [],
    connectionName: 'Codex',
    availability: 'unstable',
    workload: 'Queued 1',
    recentRuns: 1,
    lastRun: 'This week',
  },
]

export function getMockAgentProfile(agentId?: string | null): AgentProfileMock | null {
  if (!agentId) return null
  return MOCK_AGENT_PROFILES.find(agent => agent.id === agentId) ?? null
}

function createFallbackAgentProfile(agentId?: string | null): AgentProfileMock {
  const base = getMockAgentProfile(agentId) ?? MOCK_AGENT_PROFILES[0]!
  if (!agentId || base.id === agentId) return base
  return {
    ...base,
    id: agentId,
    name: agentId,
    description: '',
    instruction: '',
    icon: Bot,
    tone: 'Workspace agent',
    status: 'draft',
    model: 'Connection default',
    skillSlugs: [],
    sourceSlugs: [],
    availability: 'offline',
    workload: 'Idle',
    recentRuns: 0,
    lastRun: 'Never',
  }
}

function agentProfileToView(profile: AgentProfile, connectionOptions: AgentConnectionOption[]): AgentProfileMock {
  const base = getMockAgentProfile(profile.id) ?? createFallbackAgentProfile(profile.id)
  const connection = profile.connectionSlug
    ? connectionOptions.find(option => option.slug === profile.connectionSlug)
    : undefined
  return {
    ...base,
    id: profile.id,
    name: profile.name,
    description: profile.description ?? '',
    status: profile.status,
    model: profile.model ? getModelDisplayName(profile.model) : 'Connection default',
    thinkingLevel: profile.thinkingLevel,
    permissionMode: profile.permissionMode === 'safe' ? 'Safe' : profile.permissionMode === 'allow-all' ? 'Execute' : 'Ask',
    skillSlugs: [...profile.skillSlugs],
    sourceSlugs: [...profile.sourceSlugs],
    connectionName: connection?.name ?? profile.connectionSlug ?? base.connectionName,
  }
}

function useAgentProfileViews(): AgentProfileMock[] {
  const appShell = useOptionalAppShellContext()
  const connectionOptions = React.useMemo(
    () => buildAgentConnectionOptions(appShell?.llmConnections),
    [appShell?.llmConnections],
  )
  const [workspaceProfiles, setWorkspaceProfiles] = React.useState<AgentProfile[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const workspaceId = appShell?.activeWorkspaceId
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.listAgentProfiles) {
      setWorkspaceProfiles(null)
      return
    }

    window.electronAPI.listAgentProfiles(workspaceId)
      .then(profiles => {
        if (!cancelled) setWorkspaceProfiles(profiles)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceProfiles(null)
      })

    return () => { cancelled = true }
  }, [appShell?.activeWorkspaceId])

  return React.useMemo(
    () => workspaceProfiles?.map(profile => agentProfileToView(profile, connectionOptions)) ?? MOCK_AGENT_PROFILES,
    [workspaceProfiles, connectionOptions],
  )
}

export function AgentProfilesOverviewPage({ onAgentClick }: { onAgentClick: (agentId: string) => void }) {
  const appShell = useOptionalAppShellContext()
  const agents = useAgentProfileViews()
  const connectionOptions = React.useMemo(
    () => buildAgentConnectionOptions(appShell?.llmConnections),
    [appShell?.llmConnections],
  )
  const [query, setQuery] = React.useState('')
  const [showCreate, setShowCreate] = React.useState(false)
  const [scope, setScope] = React.useState<'mine' | 'all'>('mine')
  const [availability, setAvailability] = React.useState<'all' | AgentProfileMock['availability']>('all')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return agents.filter(agent => {
      if (availability !== 'all' && agent.availability !== availability) return false
      if (!q) return true
      return agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q)
    })
  }, [agents, query, availability])

  const counts = React.useMemo(() => ({
    all: agents.length,
    online: agents.filter(agent => agent.availability === 'online').length,
    unstable: agents.filter(agent => agent.availability === 'unstable').length,
    offline: agents.filter(agent => agent.availability === 'offline').length,
  }), [agents])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Agents</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{agents.length}</span>
          <span className="ml-2 hidden truncate text-xs text-muted-foreground md:inline">
            Reusable agent presets for delegated work. Learn more →
          </span>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3 w-3" />
          New agent
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search agents…"
                className="h-8 w-64 pl-8 text-sm"
              />
            </div>
            <SegmentedControl
              items={[
                { id: 'mine', label: 'Mine', count: agents.length },
                { id: 'all', label: 'All', count: agents.length },
              ]}
              value={scope}
              onChange={value => setScope(value as 'mine' | 'all')}
            />
            <div className="ml-auto flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{filtered.length} of {agents.length}</span>
              <span className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground">
                <ArrowUpDown className="h-3 w-3" />
                Recent activity
              </span>
            </div>
          </div>

          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
            <FilterChip active={availability === 'all'} onClick={() => setAvailability('all')}>All {counts.all}</FilterChip>
            <FilterChip active={availability === 'online'} dot="bg-success" onClick={() => setAvailability('online')}>Online {counts.online}</FilterChip>
            <FilterChip active={availability === 'unstable'} dot="bg-warning" onClick={() => setAvailability('unstable')}>Unstable {counts.unstable}</FilterChip>
            <FilterChip active={availability === 'offline'} dot="bg-muted-foreground/50" onClick={() => setAvailability('offline')}>Offline {counts.offline}</FilterChip>
          </div>

          <div className="grid h-8 shrink-0 grid-cols-[minmax(240px,1.7fr)_120px_140px_minmax(200px,1.2fr)_100px_64px_60px] border-b border-border bg-muted/30 px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
            <div>Agent</div>
            <div>Status</div>
            <div>Workload</div>
            <div>Connection</div>
            <div>Activity (7d)</div>
            <div className="text-right">Runs</div>
            <div />
          </div>

          <div className="min-h-0 flex-1 divide-y divide-border overflow-auto">
            {filtered.map(agent => (
              <AgentTableRow key={agent.id} agent={agent} onClick={() => onAgentClick(agent.id)} />
            ))}
            {filtered.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-muted-foreground">No agents match this filter.</div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateAgentProfileDialog
          connectionOptions={connectionOptions}
          defaultConnectionSlug={appShell?.workspaceDefaultLlmConnection}
          onClose={() => setShowCreate(false)}
          onCreated={(profileId) => {
            setShowCreate(false)
            onAgentClick(profileId)
          }}
        />
      )}
    </div>
  )
}

function CreateAgentProfileDialog({
  connectionOptions,
  defaultConnectionSlug,
  onClose,
  onCreated,
}: {
  connectionOptions: AgentConnectionOption[]
  defaultConnectionSlug?: string
  onClose: () => void
  onCreated: (profileId: string) => void
}) {
  const appShell = useOptionalAppShellContext()
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [connectionSlug, setConnectionSlug] = React.useState(() => {
    if (defaultConnectionSlug && connectionOptions.some(option => option.slug === defaultConnectionSlug)) return defaultConnectionSlug
    return connectionOptions[0]?.slug ?? FALLBACK_AGENT_CONNECTIONS[0]!.slug
  })
  const selectedConnection = connectionOptions.find(option => option.slug === connectionSlug) ?? connectionOptions[0] ?? FALLBACK_AGENT_CONNECTIONS[0]!
  const modelOptions = selectedConnection.models.length > 0
    ? selectedConnection.models
    : [selectedConnection.defaultModel ?? 'connection-default']
  const [model, setModel] = React.useState(modelOptions[0] ?? 'connection-default')
  const [thinkingLevel, setThinkingLevel] = React.useState<ThinkingLevel>('medium')
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!connectionOptions.some(option => option.slug === connectionSlug)) {
      setConnectionSlug(connectionOptions[0]?.slug ?? FALLBACK_AGENT_CONNECTIONS[0]!.slug)
    }
  }, [connectionOptions, connectionSlug])

  React.useEffect(() => {
    if (!modelOptions.includes(model)) setModel(modelOptions[0] ?? 'connection-default')
  }, [modelOptions, model])

  const handleCreate = async () => {
    const trimmedName = name.trim()
    if (!trimmedName || creating) return
    const workspaceId = appShell?.activeWorkspaceId
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.createAgentProfile) {
      setError('Workspace is not ready')
      return
    }

    const input: AgentProfileCreateInput = {
      name: trimmedName,
      description: description.trim(),
      connectionSlug,
      model: model === 'connection-default' ? undefined : model,
      thinkingLevel,
      permissionMode: 'ask',
      instructions: `You are ${trimmedName}. Describe your role, working style, and constraints here.`,
    }

    setCreating(true)
    setError(null)
    try {
      const created = await window.electronAPI.createAgentProfile(workspaceId, input)
      onCreated(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>
            Create a reusable workspace agent profile. Visibility is fixed to workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="e.g. Research Agent"
              className="mt-1"
              onKeyDown={event => { if (event.key === 'Enter') void handleCreate() }}
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Description</label>
            <Input
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder="What does this agent help with?"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Connection</label>
              <Select value={connectionSlug} onValueChange={setConnectionSlug}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connectionOptions.map(option => (
                    <SelectItem key={option.slug} value={option.slug}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Thinking</label>
              <Select value={thinkingLevel} onValueChange={value => setThinkingLevel(normalizeAgentThinking(value))}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_OPTIONS.map(option => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map(modelId => (
                  <SelectItem key={modelId} value={modelId}>{modelId === 'connection-default' ? 'Connection default' : getModelDisplayName(modelId)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            <div className="text-xs font-medium text-foreground">Visibility</div>
            <div className="mt-1 text-xs text-muted-foreground">Workspace — visible and reusable by this workspace.</div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SegmentedControl({
  items,
  value,
  onChange,
}: {
  items: Array<{ id: string; label: string; count: number }>
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === item.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <span>{item.label}</span>
          <span className={cn('font-mono tabular-nums', value === item.id ? 'text-muted-foreground/80' : 'text-muted-foreground/50')}>{item.count}</span>
        </button>
      ))}
    </div>
  )
}

function FilterChip({
  active,
  dot,
  children,
  onClick,
}: {
  active: boolean
  dot?: string
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground hover:bg-accent/80' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
      {children}
    </button>
  )
}

function AgentTableRow({ agent, onClick }: { agent: AgentProfileMock; onClick: () => void }) {
  const Icon = agent.icon
  const statusColor = agent.availability === 'online' ? 'text-success' : agent.availability === 'unstable' ? 'text-warning' : 'text-muted-foreground'
  const statusDot = agent.availability === 'online' ? 'bg-success' : agent.availability === 'unstable' ? 'bg-warning' : 'bg-muted-foreground/50'

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[minmax(240px,1.7fr)_120px_140px_minmax(200px,1.2fr)_100px_64px_60px] items-center px-4 py-2 text-left text-sm transition-colors hover:bg-muted/50"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4 text-foreground/80" />
          <span className={cn('absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background', statusDot)} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate font-medium text-foreground">{agent.name}</span>
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground">You</span>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{agent.description || <span className="italic text-muted-foreground/50">No description</span>}</div>
        </div>
      </div>
      <div className={cn('flex items-center gap-1.5 text-xs capitalize', statusColor)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
        {agent.availability}
      </div>
      <div className="text-xs text-muted-foreground">{agent.workload}</div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Monitor className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{agent.connectionName}</span>
      </div>
      <div className="h-px w-20 bg-border" />
      <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">{agent.recentRuns}</div>
      <div className="flex justify-end text-muted-foreground">
        <MoreHorizontal className="h-4 w-4" />
      </div>
    </button>
  )
}

export function AgentProfilesListPanel({
  selectedAgentId,
  onAgentClick,
}: {
  selectedAgentId: string | null
  onAgentClick: (agentId: string) => void
}) {
  const agents = useAgentProfileViews()
  const [query, setQuery] = React.useState('')
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return agents
    return agents.filter(agent =>
      agent.name.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q) ||
      agent.skillSlugs.some(skill => skill.toLowerCase().includes(q)) ||
      agent.sourceSlugs.some(source => source.toLowerCase().includes(q)),
    )
  }, [agents, query])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-foreground/[0.06] px-3 py-3">
        <div className="flex items-center gap-2 rounded-[10px] bg-foreground/[0.035] px-2 ring-1 ring-foreground/[0.07] focus-within:ring-accent/35">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            aria-label="Search agents"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search agents"
            className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-2">
          {filtered.map(agent => (
            <AgentProfileRow
              key={agent.id}
              agent={agent}
              selected={selectedAgentId === agent.id}
              onClick={() => onAgentClick(agent.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

function AgentProfileRow({ agent, selected, onClick }: { agent: AgentProfileMock; selected: boolean; onClick: () => void }) {
  const Icon = agent.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full flex-col rounded-[12px] px-3 py-3 text-left transition-colors',
        selected ? 'bg-foreground/[0.075] text-foreground' : 'hover:bg-foreground/[0.045] text-foreground',
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <div className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ring-1 ring-foreground/[0.08]',
          selected ? 'bg-background' : 'bg-foreground/[0.035]',
        )}>
          <Icon className="h-4 w-4 text-foreground/80" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium">{agent.name}</span>
            <span className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              agent.status === 'ready' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
            )}>
              {agent.status}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-muted-foreground">{agent.description}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 pl-[42px]">
        <MiniBadge>{agent.skillSlugs.length} skills</MiniBadge>
        <MiniBadge>{agent.sourceSlugs.length} sources</MiniBadge>
        <MiniBadge>{getThinkingLabel(agent.thinkingLevel)}</MiniBadge>
      </div>
    </button>
  )
}

function MiniBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-foreground/[0.045] px-1.5 py-0.5 text-[10px] text-muted-foreground">{children}</span>
}

export function AgentProfileDetailPage({
  agentId,
  onBack,
}: {
  agentId?: string | null
  onBack?: () => void
}) {
  const agent = React.useMemo(() => createFallbackAgentProfile(agentId), [agentId])
  const profileState = useAgentProfileDetail(agent)
  const statusLabel = agent.availability === 'online' ? 'Online' : agent.availability === 'unstable' ? 'Unstable' : 'Offline'

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            disabled={!onBack}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Agents
          </button>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="truncate text-sm font-medium">{profileState.profile.name}</h1>
          <AvailabilityBadge availability={agent.availability}>{statusLabel}</AvailabilityBadge>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Agent actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:grid md:grid-cols-[320px_minmax(0,1fr)] md:gap-4 md:overflow-hidden md:p-6">
        <AgentDetailInspectorCard agent={agent} profile={profileState.profile} onProfileUpdate={profileState.saveProfilePatch} />
        <AgentOverviewPaneMock
          agent={agent}
          profile={profileState.profile}
          onInstructionsSave={profileState.saveInstructions}
          onEnvironmentSave={profileState.saveEnvironmentVariables}
          onProfileUpdate={profileState.saveProfilePatch}
        />
      </div>
    </div>
  )
}

function createFallbackProfileDetail(agent: AgentProfileMock): AgentProfileDetail {
  const now = Date.parse('2026-05-21T15:00:00+08:00')
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    status: agent.status,
    visibility: 'workspace',
    connectionSlug: agent.connectionName.toLowerCase().replace(/\s+/g, '-'),
    model: agent.model,
    thinkingLevel: agent.thinkingLevel,
    permissionMode: agent.permissionMode.toLowerCase() === 'safe' ? 'safe' : 'ask',
    skillSlugs: [...agent.skillSlugs],
    sourceSlugs: [...agent.sourceSlugs],
    environmentVariables: {},
    instructions: agent.instruction,
    createdAt: now - 8 * 24 * 60 * 60 * 1000,
    updatedAt: now - 8 * 24 * 60 * 60 * 1000,
  }
}

function useAgentProfileDetail(agent: AgentProfileMock) {
  const appShell = useOptionalAppShellContext()
  const fallback = React.useMemo(() => createFallbackProfileDetail(agent), [agent])
  const [profile, setProfile] = React.useState<AgentProfileDetail>(fallback)

  React.useEffect(() => {
    setProfile(fallback)
  }, [fallback])

  React.useEffect(() => {
    let cancelled = false
    const workspaceId = appShell?.activeWorkspaceId
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.getAgentProfile) return

    window.electronAPI.getAgentProfile(workspaceId, agent.id)
      .then(detail => {
        if (!cancelled) setProfile(detail)
      })
      .catch(() => {
        if (!cancelled) setProfile(fallback)
      })

    return () => { cancelled = true }
  }, [agent.id, appShell?.activeWorkspaceId, fallback])

  const updateProfile = React.useCallback(async (input: AgentProfileUpdateInput) => {
    const workspaceId = appShell?.activeWorkspaceId
    setProfile(current => ({
      ...current,
      ...input.profile,
      instructions: input.instructions ?? current.instructions,
      environmentVariables: input.profile?.environmentVariables ?? current.environmentVariables,
      updatedAt: Date.now(),
    }))

    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.updateAgentProfile) return

    const updated = await window.electronAPI.updateAgentProfile(workspaceId, agent.id, input)
    setProfile(updated)
  }, [agent.id, appShell?.activeWorkspaceId])

  const saveInstructions = React.useCallback(async (instructions: string) => {
    await updateProfile({ instructions })
  }, [updateProfile])

  const saveEnvironmentVariables = React.useCallback(async (environmentVariables: Record<string, string>) => {
    await updateProfile({ profile: { environmentVariables } })
  }, [updateProfile])

  const saveProfilePatch = React.useCallback(async (patch: NonNullable<AgentProfileUpdateInput['profile']>) => {
    await updateProfile({ profile: patch })
  }, [updateProfile])

  return { profile, saveInstructions, saveEnvironmentVariables, saveProfilePatch }
}

function AgentDetailInspectorCard({
  agent,
  profile,
  onProfileUpdate,
}: {
  agent: AgentProfileMock
  profile: AgentProfileDetail
  onProfileUpdate: (patch: NonNullable<AgentProfileUpdateInput['profile']>) => Promise<void>
}) {
  const Icon = agent.icon
  const appShell = useOptionalAppShellContext()
  const connectionOptions = React.useMemo(
    () => buildAgentConnectionOptions(appShell?.llmConnections),
    [appShell?.llmConnections],
  )
  const defaultConnectionSlug = React.useMemo(() => {
    const workspaceDefault = appShell?.workspaceDefaultLlmConnection
    if (workspaceDefault && connectionOptions.some(connection => connection.slug === workspaceDefault)) return workspaceDefault
    return connectionOptions[0]?.slug ?? FALLBACK_AGENT_CONNECTIONS[0]!.slug
  }, [appShell?.workspaceDefaultLlmConnection, connectionOptions])
  const [connectionSlug, setConnectionSlug] = React.useState(profile.connectionSlug ?? defaultConnectionSlug)
  const selectedConnection = connectionOptions.find(connection => connection.slug === connectionSlug) ?? connectionOptions[0] ?? FALLBACK_AGENT_CONNECTIONS[0]!
  const availableModels = selectedConnection.models.length > 0
    ? selectedConnection.models
    : [selectedConnection.defaultModel ?? 'connection-default']
  const [model, setModel] = React.useState(() => profile.model ?? availableModels[0] ?? agent.model)
  const [thinking, setThinking] = React.useState<ThinkingLevel>(normalizeAgentThinking(profile.thinkingLevel))

  React.useEffect(() => {
    setConnectionSlug(profile.connectionSlug ?? defaultConnectionSlug)
    setModel(profile.model ?? availableModels[0] ?? agent.model)
    setThinking(normalizeAgentThinking(profile.thinkingLevel))
  }, [profile.id, profile.connectionSlug, profile.model, profile.thinkingLevel, defaultConnectionSlug])

  React.useEffect(() => {
    if (!connectionOptions.some(connection => connection.slug === connectionSlug)) {
      setConnectionSlug(defaultConnectionSlug)
    }
  }, [connectionOptions, connectionSlug, defaultConnectionSlug])

  React.useEffect(() => {
    if (!availableModels.includes(model)) {
      setModel(availableModels[0] ?? '')
    }
  }, [availableModels, model])

  return (
    <aside className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background md:h-full md:min-h-0 md:overflow-y-auto">
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-5 pt-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold leading-tight">{profile.name}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{profile.description || 'No description'}</p>
        </div>
        <AvailabilityBadge availability={agent.availability}>{capitalize(agent.availability)}</AvailabilityBadge>
      </div>

      <AgentInspectorSection label="Properties">
        <AgentPropRow label="Connection">
          <AgentInspectorSelect
            ariaLabel="Agent connection"
            value={selectedConnection.slug}
            onValueChange={(value) => {
              setConnectionSlug(value)
              const nextConnection = connectionOptions.find(connection => connection.slug === value)
              const nextModel = nextConnection?.defaultModel ?? nextConnection?.models[0] ?? undefined
              setModel(nextModel ?? 'connection-default')
              void onProfileUpdate({ connectionSlug: value, model: nextModel })
            }}
            options={connectionOptions.map(connection => ({ value: connection.slug, label: connection.name }))}
          />
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', selectedConnection.isAuthenticated === false ? 'bg-warning' : 'bg-success')} />
        </AgentPropRow>
        <AgentPropRow label="Model">
          <AgentInspectorSelect
            ariaLabel="Agent model"
            value={model}
            onValueChange={(value) => {
              setModel(value)
              void onProfileUpdate({ model: value === 'connection-default' ? undefined : value })
            }}
            options={availableModels.map(modelId => ({ value: modelId, label: modelId === 'connection-default' ? 'Connection default' : getModelDisplayName(modelId) }))}
          />
        </AgentPropRow>
        <AgentPropRow label="Thinking">
          <AgentInspectorSelect
            ariaLabel="Agent thinking"
            value={thinking}
            onValueChange={value => {
              const nextThinking = normalizeAgentThinking(value)
              setThinking(nextThinking)
              void onProfileUpdate({ thinkingLevel: nextThinking })
            }}
            options={THINKING_OPTIONS}
          />
        </AgentPropRow>
        <AgentPropRow label="Visibility">Workspace</AgentPropRow>
      </AgentInspectorSection>

      <AgentInspectorSection label="Details">
        <AgentPropRow label="Created">{formatTimestamp(profile.createdAt)}</AgentPropRow>
        <AgentPropRow label="Updated">{formatTimestamp(profile.updatedAt)}</AgentPropRow>
      </AgentInspectorSection>

      <div className="flex flex-col border-b border-border px-5 py-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Skills</span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{agent.skillSlugs.length}</span>
        </div>
        {agent.skillSlugs.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {agent.skillSlugs.map(skill => <AgentSmallToken key={skill}>{skill}</AgentSmallToken>)}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground/60">No skills attached.</p>
        )}
      </div>
    </aside>
  )
}

type LlmConnectionLike = {
  slug: string
  name: string
  models?: Array<string | { id: string }>
  defaultModel?: string
  isAuthenticated?: boolean
}

function getThinkingLabel(value: string): string {
  return THINKING_OPTIONS.find(option => option.value === value)?.label ?? value
}

function normalizeAgentThinking(value: string): ThinkingLevel {
  return THINKING_OPTIONS.some(option => option.value === value)
    ? value as ThinkingLevel
    : DEFAULT_THINKING_LEVEL
}

function buildAgentConnectionOptions(connections?: LlmConnectionLike[] | null): AgentConnectionOption[] {
  if (!connections || connections.length === 0) return FALLBACK_AGENT_CONNECTIONS
  return connections.map(connection => {
    const models = (connection.models ?? [])
      .map(model => typeof model === 'string' ? model : model.id)
      .filter(Boolean)
    const dedupedModels = Array.from(new Set([
      ...(connection.defaultModel ? [connection.defaultModel] : []),
      ...models,
    ]))
    return {
      slug: connection.slug,
      name: connection.name || connection.slug,
      defaultModel: connection.defaultModel,
      models: dedupedModels,
      isAuthenticated: connection.isAuthenticated,
    }
  })
}

function AgentInspectorSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-5 py-4">
      <div className="mb-1 -mx-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {children}
      </div>
    </div>
  )
}

function AgentPropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid items-center rounded-md px-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-foreground">
        {children}
      </div>
    </div>
  )
}

function AgentInspectorSelect({
  ariaLabel,
  value,
  onValueChange,
  options,
}: {
  ariaLabel: string
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 py-0 text-xs shadow-none hover:bg-accent/50 focus:ring-0 data-[state=open]:ring-1 data-[state=open]:ring-foreground/20"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[180px]">
        {options.map(option => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

type AgentDetailTab = 'activity' | 'instructions' | 'skills' | 'environment'

const AGENT_DETAIL_TABS: Array<{ id: AgentDetailTab; label: string; icon: typeof Bot }> = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'instructions', label: 'Instructions', icon: FileText },
  { id: 'skills', label: 'Skills', icon: BookOpenText },
  { id: 'environment', label: 'Environment', icon: KeyRound },
]

function AgentOverviewPaneMock({
  agent,
  profile,
  onInstructionsSave,
  onEnvironmentSave,
  onProfileUpdate,
}: {
  agent: AgentProfileMock
  profile: AgentProfileDetail
  onInstructionsSave: (instructions: string) => Promise<void>
  onEnvironmentSave: (environmentVariables: Record<string, string>) => Promise<void>
  onProfileUpdate: (patch: NonNullable<AgentProfileUpdateInput['profile']>) => Promise<void>
}) {
  const [activeTab, setActiveTab] = React.useState<AgentDetailTab>('activity')

  return (
    <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-background md:h-full md:min-h-0">
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border px-2 md:px-4">
        {AGENT_DETAIL_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'activity' && <AgentActivityTab agent={agent} />}
        {activeTab === 'instructions' && <AgentInstructionsTab profile={profile} onSave={onInstructionsSave} />}
        {activeTab === 'skills' && <AgentSkillsTab profile={profile} onProfileUpdate={onProfileUpdate} />}
        {activeTab === 'environment' && <AgentEnvironmentTab profile={profile} onSave={onEnvironmentSave} />}
      </div>
    </section>
  )
}

function AgentActivityTab({ agent }: { agent: AgentProfileMock }) {
  const appShell = useOptionalAppShellContext()
  const [workspaceRuns, setWorkspaceRuns] = React.useState<AgentRun[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const workspaceId = appShell?.activeWorkspaceId
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.listAgentRuns) {
      setWorkspaceRuns(null)
      return
    }

    window.electronAPI.listAgentRuns(workspaceId, { agentProfileId: agent.id })
      .then(runs => {
        if (!cancelled) setWorkspaceRuns(runs.length > 0 ? runs : null)
      })
      .catch(() => {
        if (!cancelled) setWorkspaceRuns(null)
      })

    return () => { cancelled = true }
  }, [agent.id, appShell?.activeWorkspaceId])

  const runSource = workspaceRuns ?? undefined
  const activeRuns = React.useMemo(() => getActiveAgentRuns(agent.id, runSource), [agent.id, runSource])
  const recentRuns = React.useMemo(() => getRecentFinishedAgentRuns(agent.id, 10, runSource), [agent.id, runSource])
  const summary = React.useMemo(
    () => summarizeAgentRunsLast30Days(agent.id, runSource, AGENT_RUN_MOCK_NOW),
    [agent.id, runSource],
  )
  const avgDuration = summary.avgDurationMs > 0 ? formatDurationMs(summary.avgDurationMs) : '—'

  return (
    <div className="flex flex-col gap-4 p-6">
      <AgentActivitySection
        title="Now"
        subtitle={activeRuns.length === 0 ? 'No active work' : `${activeRuns.length} active run${activeRuns.length === 1 ? '' : 's'}`}
      >
        {activeRuns.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/60">This agent isn&apos;t running anything right now.</p>
        ) : (
          <div className="space-y-1.5">
            {activeRuns.map(run => <ActiveAgentRunRow key={run.id} run={run} />)}
          </div>
        )}
      </AgentActivitySection>

      <AgentActivitySection title="Last 30 days" subtitle="Performance">
        <div className="flex items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold leading-none tabular-nums">{summary.totalRuns}</span>
              <span className="text-sm text-muted-foreground">run{summary.totalRuns === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {summary.successPct}% success
              <Sep />
              avg {avgDuration}
              {summary.totalFailed > 0 && <><Sep /><span className="text-destructive">{summary.totalFailed} failed</span></>}
              {summary.totalCancelled > 0 && <><Sep /><span>{summary.totalCancelled} cancelled</span></>}
            </div>
          </div>
          <AgentRunSparkline buckets={summary.buckets} />
        </div>
      </AgentActivitySection>

      <AgentActivitySection title="Recent work" subtitle={`${recentRuns.length} latest`}>
        {recentRuns.length === 0 ? (
          <p className="text-xs italic text-muted-foreground/60">This agent hasn&apos;t finished any runs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {recentRuns.map(run => <RecentAgentRunRow key={run.id} run={run} />)}
          </div>
        )}
      </AgentActivitySection>
    </div>
  )
}

function AgentActivitySection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <span className="text-[11px] text-muted-foreground/70">{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

function ActiveAgentRunRow({ run }: { run: AgentRun }) {
  return (
    <div className="group flex items-center gap-3 rounded-md border border-info/30 bg-info/5 px-3 py-2.5">
      <Activity className="h-4 w-4 shrink-0 animate-pulse text-info" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-info">{run.status}</span>
          <span className="truncate text-sm">{run.triggerSummary}</span>
        </div>
        <AgentRunMeta run={run} active />
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
        <span>{run.toolCount ?? 0} tools</span>
        <Sep />
        <span>{formatDurationMs(getRunDurationMs(run, AGENT_RUN_MOCK_NOW))}</span>
      </div>
    </div>
  )
}

function RecentAgentRunRow({ run }: { run: AgentRun }) {
  const status = getRunStatusPresentation(run.status)
  const Icon = status.icon
  return (
    <div className="group flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/50">
      <Icon className={cn('h-4 w-4 shrink-0', status.className)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-sm">{run.triggerSummary}</span>
        </div>
        <AgentRunMeta run={run} />
      </div>
      <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground md:flex">
        <span>{run.artifactCount ?? 0} artifacts</span>
        <Sep />
        <span>{formatDurationMs(getRunDurationMs(run))}</span>
      </div>
    </div>
  )
}

function AgentRunMeta({ run, active = false }: { run: AgentRun; active?: boolean }) {
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className="capitalize">{run.triggerType}</span>
      <Sep />
      <span className="truncate">parent {run.parentSessionId}</span>
      {run.childSessionId && <><Sep /><span className="truncate">child {run.childSessionId}</span></>}
      <Sep />
      <span>{active ? formatRelativeTime(run.startedAt ?? run.createdAt) : formatRelativeTime(run.completedAt ?? run.createdAt)}</span>
      {run.failureReason && <><Sep /><span className="text-destructive">{run.failureReason}</span></>}
    </div>
  )
}

function AgentRunSparkline({ buckets }: { buckets: AgentRunBucket[] }) {
  const maxValue = Math.max(1, ...buckets.map(bucket => bucket.completed + bucket.failed + bucket.cancelled))
  return (
    <div className="flex h-12 w-32 shrink-0 items-end justify-end gap-1 border-b border-foreground/[0.18] pr-2">
      {buckets.map(bucket => {
        const total = bucket.completed + bucket.failed + bucket.cancelled
        return (
          <span
            key={bucket.date}
            className={cn('w-1 rounded-t-sm', total > 0 ? (bucket.failed > 0 ? 'bg-destructive' : bucket.cancelled > 0 ? 'bg-muted-foreground/60' : 'bg-accent') : 'bg-transparent')}
            style={{ height: `${total > 0 ? Math.max(4, (total / maxValue) * 34) : 2}px` }}
          />
        )
      })}
    </div>
  )
}

const TASK_SECTIONS: Array<{
  id: string
  title: string
  count: number
  color: string
  rows?: Array<{ id: string; key: string; title: string; agent: string }>
}> = [
  { id: 'backlog', title: 'Backlog', count: 0, color: 'border-muted-foreground/70' },
  { id: 'todo', title: 'Todo', count: 0, color: 'border-muted-foreground/70' },
  { id: 'in-progress', title: 'In Progress', count: 0, color: 'border-warning' },
  { id: 'in-review', title: 'In Review', count: 1, color: 'border-success', rows: [{ id: 'cta-2', key: 'CTA-2', title: 'Test', agent: 'Orion' }] },
  { id: 'done', title: 'Done', count: 0, color: 'border-info' },
  { id: 'blocked', title: 'Blocked', count: 1, color: 'border-destructive' },
]

function AgentTasksTab() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search issues..." className="h-8 w-full rounded-md pl-8 text-sm" />
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-md text-xs">Assigned</Button>
        <Button variant="outline" size="sm" className="h-8 rounded-md text-xs text-muted-foreground">Created</Button>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-md">
            <Filter className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 rounded-md">
            <SlidersHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-5">
          {TASK_SECTIONS.map(section => (
            <TaskStatusSection key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  )
}

function TaskStatusSection({ section }: { section: (typeof TASK_SECTIONS)[number] }) {
  const rows = section.rows ?? []
  return (
    <section>
      <div className="flex h-11 items-center gap-2 rounded-lg bg-muted/50 px-3">
        <Square className="h-4 w-4 text-muted-foreground" />
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={cn('h-3.5 w-3.5 rounded-full border-2', section.color)} />
        <span className="text-sm font-semibold text-foreground">{section.title}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{section.count}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex h-[104px] items-center justify-center text-sm text-muted-foreground">No issues</div>
      ) : (
        <div className="space-y-1 px-6 py-3">
          {rows.map(row => (
            <div key={row.id} className="group flex h-10 items-center gap-4 rounded-md px-2 text-sm hover:bg-muted/40">
              <span className="font-mono text-muted-foreground">—</span>
              <span className="font-mono text-xs text-muted-foreground">{row.key}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-80">
                <Bot className="h-3.5 w-3.5" />
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function AgentInstructionsTab({ profile, onSave }: { profile: AgentProfileDetail; onSave: (instructions: string) => Promise<void> }) {
  const [draft, setDraft] = React.useState(profile.instructions)
  const [saving, setSaving] = React.useState(false)
  const isDirty = draft !== profile.instructions

  React.useEffect(() => {
    setDraft(profile.instructions)
  }, [profile.id, profile.instructions])

  const handleSave = async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
        Define this agent&apos;s identity and working style. Injected into the agent&apos;s context for every run.
        Markdown is supported.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background px-4 py-3 transition-colors focus-within:border-foreground/30">
        <TiptapMarkdownEditor
          key={profile.id}
          content={draft}
          onUpdate={setDraft}
          placeholder={INSTRUCTIONS_PLACEHOLDER}
          className="min-h-full text-sm font-normal leading-6 text-foreground/90 [&_.tiptap-prose]:min-h-[360px] [&_.tiptap-prose]:text-sm [&_.tiptap-prose]:leading-6"
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        {isDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  )
}

function AgentSkillsTab({
  profile,
  onProfileUpdate,
}: {
  profile: AgentProfileDetail
  onProfileUpdate: (patch: NonNullable<AgentProfileUpdateInput['profile']>) => Promise<void>
}) {
  const appShell = useOptionalAppShellContext()
  const [showAdd, setShowAdd] = React.useState(false)
  const [localSkills, setLocalSkills] = React.useState<LoadedSkill[]>([])
  const [importing, setImporting] = React.useState(false)
  const [dropActive, setDropActive] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const workspaceSkills = React.useMemo(() => {
    const all = [...(appShell?.skills ?? []), ...localSkills]
    const bySlug = new Map<string, LoadedSkill>()
    for (const skill of all) {
      if (skill.source === 'workspace') bySlug.set(skill.slug, skill)
    }
    return Array.from(bySlug.values()).sort((a, b) => a.metadata.name.localeCompare(b.metadata.name))
  }, [appShell?.skills, localSkills])
  const assignedSkillSet = React.useMemo(() => new Set(profile.skillSlugs), [profile.skillSlugs])
  const assignedSkills = profile.skillSlugs.map(slug => workspaceSkills.find(skill => skill.slug === slug) ?? null)
  const availableSkills = workspaceSkills.filter(skill => !assignedSkillSet.has(skill.slug))

  const saveSkillSlugs = React.useCallback(async (skillSlugs: string[]) => {
    await onProfileUpdate({ skillSlugs: Array.from(new Set(skillSlugs)) })
  }, [onProfileUpdate])

  const attachSkill = React.useCallback(async (slug: string) => {
    if (assignedSkillSet.has(slug)) return
    await saveSkillSlugs([...profile.skillSlugs, slug])
  }, [assignedSkillSet, profile.skillSlugs, saveSkillSlugs])

  const detachSkill = React.useCallback(async (slug: string) => {
    await saveSkillSlugs(profile.skillSlugs.filter(item => item !== slug))
  }, [profile.skillSlugs, saveSkillSlugs])

  const importFile = React.useCallback(async (file: File) => {
    const workspaceId = appShell?.activeWorkspaceId
    if (!workspaceId || typeof window === 'undefined' || !window.electronAPI?.importSkillFromContent) {
      setError('Workspace is not ready')
      return
    }
    setImporting(true)
    setError(null)
    try {
      const content = await file.text()
      const imported = await window.electronAPI.importSkillFromContent(workspaceId, { content, fileName: file.name })
      setLocalSkills(current => [...current.filter(skill => skill.slug !== imported.slug), imported])
      await saveSkillSlugs([...profile.skillSlugs, imported.slug])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import skill')
    } finally {
      setImporting(false)
      setDropActive(false)
    }
  }, [appShell?.activeWorkspaceId, profile.skillSlugs, saveSkillSlugs])

  const handleDrop = React.useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const file = Array.from(event.dataTransfer.files).find(candidate => /(^SKILL\.md$|\.md$|\.markdown$)/i.test(candidate.name))
    if (!file) {
      setError('Drop a SKILL.md or Markdown file')
      setDropActive(false)
      return
    }
    void importFile(file)
  }, [importFile])

  return (
    <div
      className="space-y-4 p-6"
      onDragOver={event => {
        event.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          Workspace skills assigned to this agent. Drop a <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">SKILL.md</code> file here to install it into the workspace and attach it.
        </p>
        <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={() => setShowAdd(true)} disabled={availableSkills.length === 0}>
          <Plus className="h-3 w-3" />
          Add skill
        </Button>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2.5">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
        <p className="text-xs text-muted-foreground">Importing creates a workspace copy that your team can edit and reuse. Agent runs will receive these skill slugs when child execution is wired.</p>
      </div>

      <div className={cn('rounded-lg border border-dashed px-4 py-5 transition-colors', dropActive ? 'border-accent bg-accent/5' : 'border-border bg-muted/20')}>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          {importing ? 'Importing skill…' : 'Drop SKILL.md or Markdown here to install and attach'}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {profile.skillSlugs.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">No skills assigned</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Add workspace skills to share team knowledge with this agent.
          </p>
          {availableSkills.length > 0 && (
            <Button onClick={() => setShowAdd(true)} size="sm" className="mt-3 gap-1.5">
              <Plus className="h-3 w-3" />
              Add skill
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {profile.skillSlugs.map((slug, index) => {
            const skill = assignedSkills[index]
            return (
              <li key={slug} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{skill?.metadata.name ?? slug}</div>
                  <div className="truncate text-xs text-muted-foreground">{skill?.metadata.description ?? 'Workspace skill'}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void detachSkill(slug)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Remove skill"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <SkillAddDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        skills={availableSkills}
        onAdd={(slug) => {
          void attachSkill(slug)
          setShowAdd(false)
        }}
      />
    </div>
  )
}

function SkillAddDialog({
  open,
  onOpenChange,
  skills,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  skills: LoadedSkill[]
  onAdd: (slug: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add skill</DialogTitle>
          <DialogDescription className="text-xs">Select a workspace skill to assign to this agent.</DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {skills.map(skill => (
            <button
              key={skill.slug}
              type="button"
              onClick={() => onAdd(skill.slug)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{skill.metadata.name}</div>
                <div className="truncate text-xs text-muted-foreground">{skill.metadata.description}</div>
              </div>
            </button>
          ))}
          {skills.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">All workspace skills are already assigned.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function envMapToEntries(env: Record<string, string>): EnvEntry[] {
  return Object.entries(env).map(([key, value]) => ({
    id: nextEnvEntryId++,
    key,
    value,
    visible: false,
  }))
}

function entriesToEnvMap(entries: EnvEntry[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const entry of entries) {
    const key = entry.key.trim()
    if (key) map[key] = entry.value
  }
  return map
}

function stableEnvMapString(env: Record<string, string>): string {
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)))
}

function AgentEnvironmentTab({ profile, onSave }: { profile: AgentProfileDetail; onSave: (environmentVariables: Record<string, string>) => Promise<void> }) {
  const [envEntries, setEnvEntries] = React.useState<EnvEntry[]>(() => envMapToEntries(profile.environmentVariables))
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const currentEnvMap = React.useMemo(() => entriesToEnvMap(envEntries), [envEntries])
  const isDirty = stableEnvMapString(currentEnvMap) !== stableEnvMapString(profile.environmentVariables)

  React.useEffect(() => {
    setEnvEntries(envMapToEntries(profile.environmentVariables))
    setError(null)
  }, [profile.id, profile.environmentVariables])

  const addEntry = () => {
    setEnvEntries(entries => [...entries, { id: nextEnvEntryId++, key: '', value: '', visible: true }])
  }

  const updateEntry = (index: number, field: 'key' | 'value', value: string) => {
    setEnvEntries(entries => entries.map((entry, i) => i === index ? { ...entry, [field]: value } : entry))
    setError(null)
  }

  const removeEntry = (index: number) => {
    setEnvEntries(entries => entries.filter((_, i) => i !== index))
    setError(null)
  }

  const toggleEntryVisibility = (index: number) => {
    setEnvEntries(entries => entries.map((entry, i) => i === index ? { ...entry, visible: !entry.visible } : entry))
  }

  const handleSave = async () => {
    if (!isDirty || saving) return
    const keys = envEntries.map(entry => entry.key.trim()).filter(Boolean)
    if (new Set(keys).size !== keys.length) {
      setError('Duplicate environment variable keys')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSave(currentEnvMap)
    } catch {
      setError('Failed to save environment variables')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          Runtime variables injected into child agent runs and MCP subprocesses. Use non-secret values such as{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">TAPD_WORKSPACE_ID</code>,{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">MCP_LOG_LEVEL</code>, or{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">HTTPS_PROXY</code>.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addEntry} className="shrink-0 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3">
        {envEntries.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-border py-12 text-center">
            <KeyRound className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No environment variables configured</p>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Add variables when an agent profile needs MCP-specific runtime context. Secrets should move to a dedicated credential store later.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[minmax(160px,0.42fr)_minmax(220px,1fr)_32px] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <span>Variable</span>
              <span>Value</span>
              <span />
            </div>
            {envEntries.map((entry, index) => (
              <div key={entry.id} className="grid grid-cols-[minmax(160px,0.42fr)_minmax(220px,1fr)_32px] items-center gap-2 rounded-md border border-border/80 bg-muted/20 p-2">
                <Input
                  value={entry.key}
                  onChange={event => updateEntry(index, 'key', event.target.value)}
                  placeholder="KEY"
                  className="h-8 font-mono text-xs"
                />
                <div className="relative min-w-0">
                  <Input
                    type={entry.visible ? 'text' : 'password'}
                    value={entry.value}
                    onChange={event => updateEntry(index, 'value', event.target.value)}
                    placeholder="value"
                    className="h-8 pr-8 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => toggleEntryVisibility(index)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={entry.visible ? 'Hide value' : 'Show value'}
                  >
                    {entry.visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeEntry(index)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Remove variable"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
          {error ?? (isDirty ? 'Unsaved changes' : 'Saved to profile.json')}
        </span>
        <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  )
}

function AvailabilityBadge({ availability, children }: { availability: AgentProfileMock['availability']; children: React.ReactNode }) {
  const dot = availability === 'online' ? 'bg-success' : availability === 'unstable' ? 'bg-warning' : 'bg-muted-foreground/50'
  const text = availability === 'online' ? 'text-success' : availability === 'unstable' ? 'text-warning' : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs', text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {children}
    </span>
  )
}

function AgentSmallToken({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">{children}</span>
}

function Sep() {
  return <span className="mx-1 text-muted-foreground/45">·</span>
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function getRunStatusPresentation(status: AgentRun['status']): { icon: typeof CheckCircle2; className: string } {
  switch (status) {
    case 'completed':
      return { icon: CheckCircle2, className: 'text-success' }
    case 'failed':
      return { icon: CircleX, className: 'text-destructive' }
    case 'cancelled':
      return { icon: CircleX, className: 'text-muted-foreground' }
    case 'queued':
    case 'running':
    case 'stopping':
      return { icon: Clock3, className: 'text-info' }
  }
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—'
  return formatRelativeTime(new Date(timestamp).toISOString())
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (ms < 60 * 60_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms % 60_000) / 1000)
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  }
  const hours = Math.floor(ms / (60 * 60_000))
  const minutes = Math.floor((ms % (60 * 60_000)) / 60_000)
  return `${hours}h ${minutes}m`
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const deltaMs = Math.max(0, AGENT_RUN_MOCK_NOW - timestamp)
  if (deltaMs < 60_000) return 'just now'
  if (deltaMs < 60 * 60_000) return `${Math.floor(deltaMs / 60_000)}m ago`
  if (deltaMs < 24 * 60 * 60_000) return `${Math.floor(deltaMs / (60 * 60_000))}h ago`
  return `${Math.floor(deltaMs / (24 * 60 * 60_000))}d ago`
}
