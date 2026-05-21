import * as React from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowUpDown,
  BookOpenText,
  Bot,
  CheckCircle2,
  CircleX,
  Code2,
  FileText,
  GitPullRequest,
  Hash,
  KeyRound,
  Monitor,
  MoreHorizontal,
  Plus,
  Search,
  Terminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export interface AgentProfileMock {
  id: string
  name: string
  description: string
  instruction: string
  icon: typeof Bot
  tone: string
  status: 'ready' | 'draft'
  model: string
  thinkingLevel: string
  permissionMode: string
  skillSlugs: string[]
  sourceSlugs: string[]
  runtime: string
  availability: 'online' | 'unstable' | 'offline'
  workload: string
  recentRuns: number
  lastRun: string
}

export const MOCK_AGENT_PROFILES: AgentProfileMock[] = [
  {
    id: 'qqnews-implementation',
    name: 'QQNews Implementation',
    description: 'Turns linked requirements and local handoff notes into implementation plans and code changes.',
    instruction: 'Read linked requirement context first. Prefer local snapshots and info files. Use repo context before changing code. Save durable decisions back to the parent context.',
    icon: Code2,
    tone: 'Build agent',
    status: 'ready',
    model: 'Claude Opus',
    thinkingLevel: 'High',
    permissionMode: 'Ask',
    skillSlugs: ['save-to-tapd-info', 'verification-before-completion'],
    sourceSlugs: ['qqnews-context-wiki'],
    runtime: 'Codex (CORINLI-MC6)',
    availability: 'online',
    workload: 'Idle',
    recentRuns: 12,
    lastRun: 'Today',
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
    thinkingLevel: 'Medium',
    permissionMode: 'Safe',
    skillSlugs: ['receiving-code-review', 'verification-before-completion'],
    sourceSlugs: [],
    runtime: 'Claude Code (local)',
    availability: 'online',
    workload: 'Idle',
    recentRuns: 8,
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
    thinkingLevel: 'Low',
    permissionMode: 'Ask',
    skillSlugs: ['save-to-tapd-info'],
    sourceSlugs: [],
    runtime: 'Codex (CORINLI-MC6)',
    availability: 'unstable',
    workload: 'Queued 1',
    recentRuns: 3,
    lastRun: 'This week',
  },
]

export function getMockAgentProfile(agentId?: string | null): AgentProfileMock | null {
  if (!agentId) return null
  return MOCK_AGENT_PROFILES.find(agent => agent.id === agentId) ?? null
}

export function AgentProfilesOverviewPage({ onAgentClick }: { onAgentClick: (agentId: string) => void }) {
  const [query, setQuery] = React.useState('')
  const [scope, setScope] = React.useState<'mine' | 'all'>('mine')
  const [availability, setAvailability] = React.useState<'all' | AgentProfileMock['availability']>('all')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return MOCK_AGENT_PROFILES.filter(agent => {
      if (availability !== 'all' && agent.availability !== availability) return false
      if (!q) return true
      return agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q)
    })
  }, [query, availability])

  const counts = React.useMemo(() => ({
    all: MOCK_AGENT_PROFILES.length,
    online: MOCK_AGENT_PROFILES.filter(agent => agent.availability === 'online').length,
    unstable: MOCK_AGENT_PROFILES.filter(agent => agent.availability === 'unstable').length,
    offline: MOCK_AGENT_PROFILES.filter(agent => agent.availability === 'offline').length,
  }), [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Agents</h1>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{MOCK_AGENT_PROFILES.length}</span>
          <span className="ml-2 hidden truncate text-xs text-muted-foreground md:inline">
            Reusable agent presets for delegated work. Learn more →
          </span>
        </div>
        <Button size="sm" disabled>
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
                { id: 'mine', label: 'Mine', count: MOCK_AGENT_PROFILES.length },
                { id: 'all', label: 'All', count: MOCK_AGENT_PROFILES.length },
              ]}
              value={scope}
              onChange={value => setScope(value as 'mine' | 'all')}
            />
            <div className="ml-auto flex items-center gap-3">
              <span className="font-mono text-xs tabular-nums text-muted-foreground/70">{filtered.length} of {MOCK_AGENT_PROFILES.length}</span>
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
            <div>Runtime</div>
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
    </div>
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
        <span className="truncate">{agent.runtime}</span>
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
  const [query, setQuery] = React.useState('')
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return MOCK_AGENT_PROFILES
    return MOCK_AGENT_PROFILES.filter(agent =>
      agent.name.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q) ||
      agent.skillSlugs.some(skill => skill.toLowerCase().includes(q)) ||
      agent.sourceSlugs.some(source => source.toLowerCase().includes(q)),
    )
  }, [query])

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
        <MiniBadge>{agent.thinkingLevel}</MiniBadge>
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
  const agent = getMockAgentProfile(agentId) ?? MOCK_AGENT_PROFILES[0]
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
          <h1 className="truncate text-sm font-medium">{agent.name}</h1>
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
        <AgentDetailInspectorCard agent={agent} />
        <AgentOverviewPaneMock agent={agent} />
      </div>
    </div>
  )
}

function AgentDetailInspectorCard({ agent }: { agent: AgentProfileMock }) {
  const Icon = agent.icon
  return (
    <aside className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background md:h-full md:min-h-0 md:overflow-y-auto">
      <div className="flex flex-col gap-3 border-b border-border px-5 pb-5 pt-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="h-7 w-7 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold leading-tight">{agent.name}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{agent.description || 'No description'}</p>
        </div>
        <AvailabilityBadge availability={agent.availability}>{capitalize(agent.availability)}</AvailabilityBadge>
      </div>

      <AgentInspectorSection label="Properties">
        <AgentPropRow label="Runtime">
          <span className="flex min-w-0 items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{agent.runtime}</span>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          </span>
        </AgentPropRow>
        <AgentPropRow label="Model">{agent.model}</AgentPropRow>
        <AgentPropRow label="Visibility">Workspace</AgentPropRow>
        <AgentPropRow label="Concurrency">6</AgentPropRow>
      </AgentInspectorSection>

      <AgentInspectorSection label="Details">
        <AgentPropRow label="Owner">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning text-[9px] font-semibold text-warning-foreground">c</span>
            <span className="truncate">ccco little</span>
          </span>
        </AgentPropRow>
        <AgentPropRow label="Created">8d ago</AgentPropRow>
        <AgentPropRow label="Updated">8d ago</AgentPropRow>
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

type AgentDetailTab = 'activity' | 'tasks' | 'instructions' | 'skills' | 'environment' | 'custom-args'

const AGENT_DETAIL_TABS: Array<{ id: AgentDetailTab; label: string; icon: typeof Bot }> = [
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'tasks', label: 'Tasks', icon: CheckCircle2 },
  { id: 'instructions', label: 'Instructions', icon: FileText },
  { id: 'skills', label: 'Skills', icon: BookOpenText },
  { id: 'environment', label: 'Environment', icon: KeyRound },
  { id: 'custom-args', label: 'Custom Args', icon: Terminal },
]

function AgentOverviewPaneMock({ agent }: { agent: AgentProfileMock }) {
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
        {activeTab === 'tasks' && <AgentPlaceholderTab title="Tasks" body="Task assignment and dispatch history will live here once Agent Runs are wired." />}
        {activeTab === 'instructions' && <AgentInstructionsTab agent={agent} />}
        {activeTab === 'skills' && <AgentTokensTab title="Skills" items={agent.skillSlugs} empty="No skills attached." />}
        {activeTab === 'environment' && <AgentPlaceholderTab title="Environment" body="Environment variables and runtime device settings will be configured here." />}
        {activeTab === 'custom-args' && <AgentPlaceholderTab title="Custom Args" body="Runtime-specific CLI arguments and advanced execution switches will be configured here." />}
      </div>
    </section>
  )
}

function AgentActivityTab({ agent }: { agent: AgentProfileMock }) {
  const recentWork = getRecentWork(agent)
  return (
    <div className="flex flex-col gap-4 p-6">
      <AgentActivitySection title="Now" subtitle="No active work">
        <p className="text-xs italic text-muted-foreground/60">This agent isn&apos;t running anything right now.</p>
      </AgentActivitySection>

      <AgentActivitySection title="Last 30 days" subtitle="Performance">
        <div className="flex items-end justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold leading-none tabular-nums">{Math.max(agent.recentRuns, 1)}</span>
              <span className="text-sm text-muted-foreground">runs</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">100% success <Sep /> avg 1m 11s</div>
          </div>
          <MiniSparkline />
        </div>
      </AgentActivitySection>

      <AgentActivitySection title="Recent work" subtitle={`${recentWork.length} latest`}>
        <div className="space-y-1.5">
          {recentWork.map(work => <RecentWorkRow key={work.id} work={work} />)}
        </div>
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

function RecentWorkRow({ work }: { work: { id: string; title: string; meta: string; status: 'completed' | 'failed' } }) {
  const completed = work.status === 'completed'
  return (
    <div className="group flex items-center gap-3 rounded-md border border-border px-3 py-2.5 transition-colors hover:bg-muted/50">
      {completed ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <CircleX className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Hash className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate text-sm">{work.title}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{work.meta}</div>
      </div>
    </div>
  )
}

function MiniSparkline() {
  return (
    <div className="flex h-12 w-32 shrink-0 items-end justify-end gap-1 border-b border-foreground/[0.18] pr-2">
      {[0, 0, 0, 1, 0, 3, 0, 0, 7].map((height, index) => (
        <span
          key={index}
          className={cn('w-1 rounded-t-sm', height > 0 ? 'bg-accent' : 'bg-transparent')}
          style={{ height: `${Math.max(height * 5, 2)}px` }}
        />
      ))}
    </div>
  )
}

function AgentInstructionsTab({ agent }: { agent: AgentProfileMock }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4 md:p-6">
      <h2 className="text-sm font-semibold">Instructions</h2>
      <div className="mt-4 rounded-lg border border-border bg-background p-4">
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/85">{agent.instruction}</p>
      </div>
    </div>
  )
}

function AgentTokensTab({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4 md:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 rounded-lg border border-border bg-background p-4">
        {items.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {items.map(item => <AgentSmallToken key={item}>{item}</AgentSmallToken>)}
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground/65">{empty}</p>
        )}
      </div>
    </div>
  )
}

function AgentPlaceholderTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col p-4 md:p-6">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 rounded-lg border border-border bg-background p-4 text-xs leading-relaxed text-muted-foreground">
        {body}
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

function getRecentWork(agent: AgentProfileMock) {
  const prefix = agent.id === 'reviewer' ? 'CR' : agent.id === 'handoff' ? 'HD' : 'CTA'
  return [
    { id: '1', status: 'failed' as const, title: `${prefix}-1 1: 体验合规｜鸿蒙客户端&鸿蒙插件全部广告场景支持...`, meta: '8d ago · 58s' },
    { id: '2', status: 'completed' as const, title: `${prefix}-2 Test`, meta: '8d ago · 1m 23s' },
    { id: '3', status: 'completed' as const, title: `${prefix}-1 1: 体验合规｜鸿蒙客户端&鸿蒙插件全部广告场景支持...`, meta: '8d ago · 1m 42s' },
    { id: '4', status: 'completed' as const, title: `${prefix}-2 Test`, meta: '8d ago · 51s' },
    { id: '5', status: 'completed' as const, title: `${prefix}-1 1: 体验合规｜鸿蒙客户端&鸿蒙插件全部广告场景支持...`, meta: '8d ago · 1m 04s' },
  ]
}
