/**
 * Messaging Gateway Atoms
 *
 * Workspace-level state for messaging bindings.
 * Populated by subscribing to messaging:bindingChanged push events.
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai-family'

export interface MessagingBinding {
  id: string
  workspaceId: string
  sessionId: string
  platform: string
  channelId: string
  /** Telegram supergroup forum topic id; undefined for DMs / non-Telegram. */
  threadId?: number
  channelName?: string
  enabled: boolean
  createdAt: number
  /**
   * Per-binding access policy. Optional in the wire shape so legacy bindings
   * (created before access control existed) don't break atom updates. The
   * UI treats missing values as `'open'`.
   */
  accessMode?: 'inherit' | 'allow-list' | 'open'
  allowedSenderIds?: string[]
}

const EMPTY_BINDINGS: MessagingBinding[] = []

export const messagingBindingsAtom = atom<MessagingBinding[]>([])

const messagingBindingsBySessionStateAtom = atom<Map<string, MessagingBinding[]>>(new Map())

export const messagingBindingsBySessionAtom = atom((get) => get(messagingBindingsBySessionStateAtom))

export const messagingBindingsForSessionAtomFamily = atomFamily(
  (sessionId: string) => atom((get) => get(messagingBindingsBySessionStateAtom).get(sessionId) ?? EMPTY_BINDINGS),
  (a, b) => a === b,
)

export const setMessagingBindingsAtom = atom(
  null,
  (get, set, bindings: MessagingBinding[]) => {
    const enabledBindings = bindings.filter((binding) => binding.enabled)
    set(messagingBindingsAtom, enabledBindings)
    set(messagingBindingsBySessionStateAtom, buildBindingsBySession(enabledBindings, get(messagingBindingsBySessionStateAtom)))
  },
)

/**
 * Global messaging dialog state.
 *
 * Hoisted out of SessionMenu so dialogs survive context-menu / dropdown close.
 * Rendered by <MessagingDialogHost /> mounted at AppShell level.
 */
export type MessagingDialogState =
  | { kind: 'closed' }
  | {
      kind: 'pairing'
      platform: 'telegram' | 'whatsapp' | 'lark' | 'wechat'
      sessionId: string
      code: string | null
      expiresAt: number | null
      botUsername?: string
      error?: string
    }
  | {
      kind: 'wa_connect'
      continueToPairingSessionId?: string
    }
  | {
      kind: 'wechat_connect'
      continueToPairingSessionId?: string
    }

export const messagingDialogAtom = atom<MessagingDialogState>({ kind: 'closed' })

function buildBindingsBySession(
  bindings: MessagingBinding[],
  previous: Map<string, MessagingBinding[]> = new Map(),
): Map<string, MessagingBinding[]> {
  const grouped = new Map<string, MessagingBinding[]>()
  for (const binding of bindings) {
    const list = grouped.get(binding.sessionId)
    if (list) {
      list.push(binding)
    } else {
      grouped.set(binding.sessionId, [binding])
    }
  }

  const next = new Map<string, MessagingBinding[]>()
  for (const [sessionId, list] of grouped) {
    const previousList = previous.get(sessionId)
    next.set(sessionId, previousList && bindingsShallowEqual(previousList, list) ? previousList : list)
  }
  return next
}

function bindingsShallowEqual(a: MessagingBinding[], b: MessagingBinding[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!bindingShallowEqual(a[i]!, b[i]!)) return false
  }
  return true
}

function bindingShallowEqual(a: MessagingBinding, b: MessagingBinding): boolean {
  return a.id === b.id
    && a.workspaceId === b.workspaceId
    && a.sessionId === b.sessionId
    && a.platform === b.platform
    && a.channelId === b.channelId
    && a.threadId === b.threadId
    && a.channelName === b.channelName
    && a.enabled === b.enabled
    && a.createdAt === b.createdAt
    && a.accessMode === b.accessMode
    && stringArrayShallowEqual(a.allowedSenderIds ?? [], b.allowedSenderIds ?? [])
}

function stringArrayShallowEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
