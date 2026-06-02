import * as React from 'react'
import { cn } from '@/lib/utils'

const AGENT_AVATAR_PALETTE = [
  { background: 'hsl(222 83% 56% / 0.16)', foreground: 'hsl(222 83% 62%)', ring: 'hsl(222 83% 62% / 0.24)' },
  { background: 'hsl(262 83% 58% / 0.16)', foreground: 'hsl(262 83% 66%)', ring: 'hsl(262 83% 66% / 0.24)' },
  { background: 'hsl(316 70% 50% / 0.16)', foreground: 'hsl(316 70% 62%)', ring: 'hsl(316 70% 62% / 0.24)' },
  { background: 'hsl(6 84% 57% / 0.16)', foreground: 'hsl(6 84% 64%)', ring: 'hsl(6 84% 64% / 0.24)' },
  { background: 'hsl(28 90% 52% / 0.16)', foreground: 'hsl(28 90% 58%)', ring: 'hsl(28 90% 58% / 0.24)' },
  { background: 'hsl(45 92% 47% / 0.18)', foreground: 'hsl(45 92% 54%)', ring: 'hsl(45 92% 54% / 0.24)' },
  { background: 'hsl(150 67% 38% / 0.18)', foreground: 'hsl(150 67% 46%)', ring: 'hsl(150 67% 46% / 0.24)' },
  { background: 'hsl(188 78% 41% / 0.16)', foreground: 'hsl(188 78% 50%)', ring: 'hsl(188 78% 50% / 0.24)' },
]

export interface AgentAvatarIdentity {
  id?: string | null
  name?: string | null
}

export interface AgentAvatarPresentation {
  initials: string
  background: string
  foreground: string
  ring: string
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function getInitials(nameOrId: string): string {
  const normalized = nameOrId.trim()
  if (!normalized) return 'AG'

  const words = normalized
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (words.length >= 2) {
    return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase()
  }

  const compact = Array.from(words[0] ?? normalized).filter(char => /[\p{L}\p{N}]/u.test(char))
  return compact.slice(0, 2).join('').toUpperCase() || 'AG'
}

export function getAgentAvatarPresentation(agent: AgentAvatarIdentity): AgentAvatarPresentation {
  const label = agent.name?.trim() || agent.id?.trim() || 'Agent'
  const key = `${agent.id ?? ''}|${label}`
  const color = AGENT_AVATAR_PALETTE[stableHash(key) % AGENT_AVATAR_PALETTE.length]!
  return {
    initials: getInitials(label),
    ...color,
  }
}

export function AgentAvatar({
  agent,
  className,
  textClassName,
  title,
}: {
  agent: AgentAvatarIdentity
  className?: string
  textClassName?: string
  title?: string
}) {
  const avatar = React.useMemo(() => getAgentAvatarPresentation(agent), [agent.id, agent.name])
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full text-[10px] font-semibold uppercase ring-1', className)}
      style={{
        background: avatar.background,
        color: avatar.foreground,
        boxShadow: `inset 0 0 0 1px ${avatar.ring}`,
      }}
      title={title ?? agent.name ?? agent.id ?? 'Agent'}
      aria-hidden="true"
    >
      <span className={cn('leading-none', textClassName)}>{avatar.initials}</span>
    </span>
  )
}
