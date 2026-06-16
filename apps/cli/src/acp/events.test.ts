import { describe, expect, it } from 'bun:test'
import { craftEventToAcpUpdates, terminalEventToStopReason } from './events.ts'

describe('ACP event mapping', () => {
  it('maps text_delta to agent_message_chunk', () => {
    const updates = craftEventToAcpUpdates({ type: 'text_delta', sessionId: 's1', delta: 'hello' })
    expect(updates).toEqual([{
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'agent-response',
        content: { type: 'text', text: 'hello' },
      },
    }])
  })

  it('maps tool_start and tool_result to tool call updates', () => {
    expect(craftEventToAcpUpdates({
      type: 'tool_start',
      sessionId: 's1',
      toolUseId: 'tool-1',
      toolName: 'bash',
      toolIntent: 'Run tests',
    })[0]?.update).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'bash: Run tests',
      kind: 'execute',
      status: 'in_progress',
    })

    expect(craftEventToAcpUpdates({
      type: 'tool_result',
      sessionId: 's1',
      toolUseId: 'tool-1',
      result: 'ok',
    })[0]?.update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
    })
  })

  it('maps terminal events to stop reasons', () => {
    expect(terminalEventToStopReason({ type: 'complete' })).toBe('end_turn')
    expect(terminalEventToStopReason({ type: 'interrupted' })).toBe('cancelled')
    expect(terminalEventToStopReason({ type: 'error' })).toBe('refusal')
  })
})
