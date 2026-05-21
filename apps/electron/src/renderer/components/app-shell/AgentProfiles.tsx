import * as React from 'react'
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  Code2,
  FileText,
  FolderKanban,
  GitPullRequest,
  Layers3,
  MessageSquare,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Zap,
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
    recentRuns: 3,
    lastRun: 'This week',
  },
]

export function getMockAgentProfile(agentId?: string | null): AgentProfileMock | null {
  if (!agentId) return null
  return MOCK_AGENT_PROFILES.find(agent => agent.id === agentId) ?? null
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

export function AgentProfileDetailPage({ agentId }: { agentId?: string | null }) {
  const agent = getMockAgentProfile(agentId) ?? MOCK_AGENT_PROFILES[0]
  const Icon = agent.icon

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="shrink-0 border-b border-foreground/[0.06] px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-foreground/[0.045] ring-1 ring-foreground/[0.08]">
              <Icon className="h-5 w-5 text-foreground/80" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.022em] text-foreground">{agent.name}</h1>
                <span className="rounded-full bg-foreground/[0.055] px-2 py-1 text-[11px] font-medium text-foreground/65">UI preview</span>
              </div>
              <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">{agent.description}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" disabled className="gap-1.5 opacity-70">
            <Plus className="h-3.5 w-3.5" />
            New agent
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <QuietPanel title="Profile">
            <Property label="Status" value={agent.status === 'ready' ? 'Ready' : 'Draft'} icon={CheckCircle2} />
            <Property label="Model" value={agent.model} icon={Brain} />
            <Property label="Mode" value={agent.permissionMode} icon={ShieldCheck} />
            <Property label="Thinking" value={agent.thinkingLevel} icon={Sparkles} />
          </QuietPanel>
          <QuietPanel title="Defaults">
            <Property label="Skills" value={`${agent.skillSlugs.length} selected`} icon={Zap} />
            <Property label="Sources" value={`${agent.sourceSlugs.length} selected`} icon={Layers3} />
            <Property label="Recent runs" value={`${agent.recentRuns}`} icon={Activity} />
            <Property label="Last run" value={agent.lastRun} icon={MessageSquare} />
          </QuietPanel>
        </aside>

        <main className="min-w-0 space-y-4">
          <div className="flex flex-wrap gap-1 border-b border-foreground/[0.06] pb-2 text-[12px]">
            {['Activity', 'Instructions', 'Skills', 'Sources', 'Defaults'].map((tab, index) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  'rounded-md px-2.5 py-1.5 transition-colors',
                  index === 0 ? 'bg-foreground/[0.07] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <QuietPanel title="Activity" icon={Activity}>
              <div className="rounded-[14px] bg-foreground/[0.025] p-4 text-[13px] text-muted-foreground ring-1 ring-foreground/[0.06]">
                <div className="flex items-center gap-2 text-foreground">
                  <Bot className="h-4 w-4" />
                  No live runs yet
                </div>
                <p className="mt-2 leading-5">Agent runs will appear here once `@agent` dispatch is wired. This panel will show live status, elapsed time, tool count, stop action, and transcript access.</p>
              </div>
            </QuietPanel>

            <QuietPanel title="Run handoff" icon={FolderKanban}>
              <div className="rounded-[14px] bg-foreground/[0.025] p-4 text-[13px] text-muted-foreground ring-1 ring-foreground/[0.06]">
                <div className="flex items-center gap-2 text-foreground">
                  <Settings2 className="h-4 w-4" />
                  Artifact manifest preview
                </div>
                <p className="mt-2 leading-5">Completed runs should write summaries and artifacts to the parent session under `agent-runs/&lt;run-id&gt;/`, then insert a compact result card back into chat.</p>
              </div>
            </QuietPanel>
          </section>

          <QuietPanel title="Instructions" icon={FileText}>
            <div className="rounded-[14px] bg-foreground/[0.025] p-4 ring-1 ring-foreground/[0.06]">
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-foreground/82">{agent.instruction}</p>
            </div>
          </QuietPanel>

          <section className="grid gap-4 lg:grid-cols-2">
            <QuietPanel title="Skills" icon={Zap}>
              <TokenList items={agent.skillSlugs} empty="No skills selected" />
            </QuietPanel>
            <QuietPanel title="Sources" icon={Layers3}>
              <TokenList items={agent.sourceSlugs} empty="No sources selected" />
            </QuietPanel>
          </section>
        </main>
      </div>
    </div>
  )
}

function QuietPanel({ title, icon: Icon, children }: { title: string; icon?: typeof Bot; children: React.ReactNode }) {
  return (
    <section className="rounded-[18px] bg-background p-4 ring-1 ring-foreground/[0.07]">
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold text-foreground/80">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <span>{title}</span>
      </div>
      {children}
    </section>
  )
}

function Property({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Bot }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-foreground/[0.06] py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
      </div>
      <span className="truncate text-right text-[12px] font-medium text-foreground/75">{value}</span>
    </div>
  )
}

function TokenList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[13px] text-muted-foreground">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(item => (
        <span key={item} className="rounded-md bg-foreground/[0.055] px-2 py-1 text-[12px] font-medium text-foreground/72">
          {item}
        </span>
      ))}
    </div>
  )
}
