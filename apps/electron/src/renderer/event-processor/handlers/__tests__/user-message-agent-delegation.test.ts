import { describe, expect, it } from 'bun:test'
import { handleUserMessage } from '../session'
import type { SessionState, UserMessageEvent } from '../../types'

function makeState(isProcessing = false): SessionState {
  return {
    session: {
      id: 'parent-1',
      messages: [
        {
          id: 'optimistic-1',
          role: 'user',
          content: '[agent:orion] Review this requirement',
          timestamp: 100,
          isPending: true,
          badges: [{ type: 'agent', label: 'Orion', rawText: '[agent:orion]', start: 0, end: 13 }],
        },
      ],
      isProcessing,
      lastMessageAt: 100,
    } as any,
    streaming: null,
  }
}

describe('handleUserMessage agent delegation', () => {
  it('does not mark an idle parent session as processing for delegated agent messages', () => {
    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'parent-1',
      optimisticMessageId: 'optimistic-1',
      status: 'accepted',
      agentDelegated: true,
      message: {
        id: 'backend-1',
        role: 'user',
        content: '[agent:orion] Review this requirement',
        timestamp: 110,
        badges: [{ type: 'agent', label: 'Orion', rawText: '[agent:orion]', start: 0, end: 13 }],
      } as any,
    }

    const result = handleUserMessage(makeState(false), event)

    expect(result.state.session.isProcessing).toBe(false)
    expect(result.state.session.messages[0]?.isPending).toBe(false)
    expect(result.state.session.messages[0]?.isQueued).toBe(false)
  })

  it('preserves an already-processing parent session while delegated work runs elsewhere', () => {
    const event: UserMessageEvent = {
      type: 'user_message',
      sessionId: 'parent-1',
      optimisticMessageId: 'optimistic-1',
      status: 'accepted',
      agentDelegated: true,
      message: {
        id: 'backend-1',
        role: 'user',
        content: '[agent:orion] Review this requirement',
        timestamp: 110,
      } as any,
    }

    const result = handleUserMessage(makeState(true), event)

    expect(result.state.session.isProcessing).toBe(true)
  })
})
