import { atom } from 'jotai'
import {
  BadgeCheck,
  Beaker,
  CalendarClock,
  CirclePause,
  Clock3,
  ShieldCheck,
  TestTube2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export type StoryStatusId =
  | 'reviewed'
  | 'scheduled'
  | 'developing'
  | 'testing'
  | 'pending-release'
  | 'released'
  | 'experimenting'
  | 'delayed'
  | 'paused'

export type StoryFilterId = StoryStatusId | 'all'

export interface StoryStatus {
  id: StoryStatusId
  label: string
  icon: LucideIcon
  tone: string
  order: number
}

export interface StoryItem {
  id: string
  title: string
  status: StoryStatusId
  owner: string
  cycle: string
  priority: 'P0' | 'P1' | 'P2'
  scope: string
  updatedAt: string
  labels: string[]
}

export const STORY_STATUSES: StoryStatus[] = [
  { id: 'reviewed', label: '已评审', icon: ShieldCheck, tone: 'oklch(62% 0.13 151)', order: 1 },
  { id: 'scheduled', label: '已排期', icon: CalendarClock, tone: 'oklch(61% 0.12 252)', order: 2 },
  { id: 'developing', label: '开发中', icon: Wrench, tone: 'oklch(64% 0.15 68)', order: 3 },
  { id: 'testing', label: '测试中', icon: TestTube2, tone: 'oklch(63% 0.12 202)', order: 4 },
  { id: 'pending-release', label: '待发布', icon: Clock3, tone: 'oklch(59% 0.12 28)', order: 5 },
  { id: 'released', label: '已发布', icon: BadgeCheck, tone: 'oklch(56% 0.12 145)', order: 6 },
  { id: 'experimenting', label: '实验中', icon: Beaker, tone: 'oklch(61% 0.13 305)', order: 7 },
  { id: 'delayed', label: '已延期', icon: CalendarClock, tone: 'oklch(58% 0.10 52)', order: 8 },
  { id: 'paused', label: '已暂停', icon: CirclePause, tone: 'oklch(55% 0.05 260)', order: 9 },
]

export const storyStatusById = new Map(STORY_STATUSES.map((status) => [status.id, status]))

export const initialStories: StoryItem[] = [
  {
    id: 'story-101',
    title: 'Story Board MVP: 状态列和筛选',
    status: 'developing',
    owner: 'Litsu',
    cycle: 'May W1',
    priority: 'P1',
    scope: 'App Shell',
    updatedAt: '2026-05-06T09:00:00.000Z',
    labels: ['feature'],
  },
  {
    id: 'story-102',
    title: '企业网络环境下禁用外部消息入口',
    status: 'testing',
    owner: 'Litsu',
    cycle: 'May W1',
    priority: 'P0',
    scope: 'Messaging',
    updatedAt: '2026-05-05T15:30:00.000Z',
    labels: ['security'],
  },
  {
    id: 'story-103',
    title: 'macOS M 系列本地包构建校验',
    status: 'released',
    owner: 'Litsu',
    cycle: '0.9.1',
    priority: 'P1',
    scope: 'Electron',
    updatedAt: '2026-05-06T07:45:00.000Z',
    labels: ['release'],
  },
  {
    id: 'story-104',
    title: 'Pi subprocess 资源打包修复',
    status: 'pending-release',
    owner: 'Litsu',
    cycle: '0.9.2',
    priority: 'P0',
    scope: 'Build',
    updatedAt: '2026-05-06T08:40:00.000Z',
    labels: ['bug'],
  },
  {
    id: 'story-105',
    title: 'Session Board 分组体验复盘',
    status: 'reviewed',
    owner: 'Product',
    cycle: 'Backlog',
    priority: 'P2',
    scope: 'Sessions',
    updatedAt: '2026-05-05T11:00:00.000Z',
    labels: ['ux'],
  },
  {
    id: 'story-106',
    title: '工作区资源配置的可视化巡检',
    status: 'experimenting',
    owner: 'Product',
    cycle: 'Lab',
    priority: 'P2',
    scope: 'Workspace',
    updatedAt: '2026-05-03T10:20:00.000Z',
    labels: [],
  },
  {
    id: 'story-107',
    title: '远程 workspace 切换的确认策略',
    status: 'delayed',
    owner: 'Platform',
    cycle: 'Later',
    priority: 'P1',
    scope: 'Remote',
    updatedAt: '2026-04-30T13:15:00.000Z',
    labels: ['remote'],
  },
  {
    id: 'story-108',
    title: '自动化配置编辑器重构',
    status: 'paused',
    owner: 'Platform',
    cycle: 'Hold',
    priority: 'P2',
    scope: 'Automations',
    updatedAt: '2026-04-29T12:10:00.000Z',
    labels: ['refactor'],
  },
  {
    id: 'story-109',
    title: '发布前回归清单整合',
    status: 'scheduled',
    owner: 'Release',
    cycle: 'May W2',
    priority: 'P1',
    scope: 'QA',
    updatedAt: '2026-05-04T16:00:00.000Z',
    labels: ['release'],
  },
]

export const storiesAtom = atom<StoryItem[]>(initialStories)
export const selectedStoryIdAtom = atom<string | null>(initialStories[0]?.id ?? null)
export const storyFilterAtom = atom<StoryFilterId>('all')
