import type { AcpSessionUpdateNotification, CraftSessionEvent } from './types.ts'

export function craftEventToAcpUpdates(event: CraftSessionEvent): AcpSessionUpdateNotification[] {
  const sessionId = event.sessionId
  if (!sessionId) return []

  switch (event.type) {
    case 'text_delta': {
      const text = typeof event.delta === 'string' ? event.delta : ''
      if (!text) return []
      return [{
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'agent-response',
          content: { type: 'text', text },
        },
      }]
    }

    case 'tool_start': {
      const toolCallId = toolCallIdForEvent(event)
      return [{
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: formatToolTitle(event),
          kind: inferToolKind(event.toolName),
          status: 'in_progress',
          rawInput: event.input && typeof event.input === 'object' ? event.input : undefined,
        },
      }]
    }

    case 'tool_result': {
      const toolCallId = toolCallIdForEvent(event)
      const contentText = stringifyToolResult(event.result)
      return [{
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId,
          status: event.isError ? 'failed' : 'completed',
          content: contentText ? [{ type: 'content', content: { type: 'text', text: contentText } }] : undefined,
          rawOutput: event.result && typeof event.result === 'object' ? event.result : undefined,
        },
      }]
    }

    case 'error': {
      return [{
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'agent-error',
          content: { type: 'text', text: `\nError: ${String(event.error ?? 'Unknown error')}\n` },
        },
      }]
    }

    case 'token_usage':
    case 'usage_update': {
      const usage = event.tokenUsage
      if (!usage?.contextTokens && !usage?.totalTokens) return []
      return [{
        sessionId,
        update: {
          sessionUpdate: 'usage_update',
          used: usage.contextTokens ?? usage.totalTokens ?? 0,
          size: usage.totalTokens ?? usage.contextTokens ?? 0,
          cost: typeof usage.costUsd === 'number' ? { amount: usage.costUsd, currency: 'USD' } : undefined,
        },
      }]
    }

    default:
      return []
  }
}

export function terminalEventToStopReason(event: CraftSessionEvent): 'end_turn' | 'cancelled' | 'refusal' | undefined {
  switch (event.type) {
    case 'complete':
      return 'end_turn'
    case 'interrupted':
      return 'cancelled'
    case 'error':
      return 'refusal'
    default:
      return undefined
  }
}

function toolCallIdForEvent(event: CraftSessionEvent): string {
  return String(event.toolUseId ?? event.toolCallId ?? event.id ?? event.toolName ?? 'tool-call')
}

function formatToolTitle(event: CraftSessionEvent): string {
  const name = event.toolName ? String(event.toolName) : 'Tool call'
  const intent = event.toolIntent ? String(event.toolIntent) : ''
  return intent ? `${name}: ${intent}` : name
}

function inferToolKind(toolName: unknown): string {
  const name = String(toolName ?? '').toLowerCase()
  if (name.includes('read') || name.includes('list') || name.includes('ls')) return 'read'
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return 'edit'
  if (name.includes('delete') || name.includes('rm')) return 'delete'
  if (name.includes('move') || name.includes('rename')) return 'move'
  if (name.includes('grep') || name.includes('search') || name.includes('find')) return 'search'
  if (name.includes('bash') || name.includes('shell') || name.includes('exec') || name.includes('command')) return 'execute'
  if (name.includes('fetch') || name.includes('web')) return 'fetch'
  if (name.includes('think')) return 'think'
  return 'other'
}

function stringifyToolResult(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return truncate(result)
  try {
    return truncate(JSON.stringify(result, null, 2))
  } catch {
    return truncate(String(result))
  }
}

function truncate(value: string, max = 4000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}
