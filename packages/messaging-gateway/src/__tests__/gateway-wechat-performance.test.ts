import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { MessagingGateway } from '../gateway'
import type { SessionEvent } from '../renderer'
import type { MessagingLogger, PlatformAdapter } from '../types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

let storageDir: string

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'gateway-wechat-perf-'))
})

afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true })
})

function makeSessionManager(): ISessionManager {
  return {
    getSession: async (id: string) => ({ id, name: id } as never),
    sendMessage: async () => {},
    cancelProcessing: async () => {},
    respondToPermission: mock(() => true),
    acceptPlan: mock(async () => {}),
    setPendingPlanExecution: mock(async () => {}),
    clearPendingPlanExecution: mock(async () => {}),
    setAutomationBinder: () => {},
  } as unknown as ISessionManager
}

function makeWeChatAdapter() {
  let connectedChecks = 0
  const sendText = mock(async (channelId: string, text: string) => ({
    platform: 'wechat' as const,
    channelId,
    messageId: `msg-${text.length}`,
  }))

  const adapter: PlatformAdapter & { connectedChecks: () => number } = {
    platform: 'wechat',
    capabilities: {
      messageEditing: false,
      inlineButtons: false,
      maxButtons: 0,
      maxMessageLength: 4000,
      markdown: 'wechat',
      webhookSupport: false,
    },
    initialize: async () => {},
    destroy: async () => {},
    isConnected: () => {
      connectedChecks += 1
      return true
    },
    onMessage: () => {},
    onButtonPress: () => {},
    sendText,
    editMessage: async () => {},
    sendButtons: mock(async (channelId: string) => ({ platform: 'wechat' as const, channelId, messageId: 'buttons-1' })),
    sendTyping: mock(async () => {}),
    sendFile: mock(async () => ({ platform: 'wechat' as const, channelId: 'chat-1', messageId: 'file-1' })),
    connectedChecks: () => connectedChecks,
  }
  return adapter
}

async function makeGateway() {
  const gateway = new MessagingGateway({
    sessionManager: makeSessionManager(),
    workspaceId: 'ws-test',
    storageDir,
    getWorkspaceConfig: () => ({ enabled: true, platforms: { wechat: { enabled: true, accessMode: 'open' } } }),
    logger: NOOP_LOGGER,
  })
  const adapter = makeWeChatAdapter()
  gateway.registerAdapter(adapter)
  await gateway.start()
  gateway.getBindingStore().bind('ws-test', 'sess-A', 'wechat', 'chat-1')
  return { gateway, adapter }
}

function emit(gateway: MessagingGateway, event: SessionEvent): void {
  gateway.onSessionEvent(RPC_CHANNELS.sessions.EVENT, { to: 'workspace', workspaceId: 'ws-test' }, event)
}

describe('MessagingGateway WeChat event filtering', () => {
  it('skips high-frequency transient events before touching the adapter', async () => {
    const { gateway, adapter } = await makeGateway()

    emit(gateway, { type: 'text_delta', sessionId: 'sess-A', delta: 'hello' })
    emit(gateway, { type: 'tool_start', sessionId: 'sess-A', toolName: 'bash' })
    emit(gateway, { type: 'tool_result', sessionId: 'sess-A', result: 'ok' })

    await Promise.resolve()
    expect(adapter.connectedChecks()).toBe(0)
    expect(adapter.sendText).toHaveBeenCalledTimes(0)
  })

  it('still sends the final WeChat answer', async () => {
    const { gateway, adapter } = await makeGateway()

    emit(gateway, { type: 'text_complete', sessionId: 'sess-A', text: 'final answer' })
    emit(gateway, { type: 'complete', sessionId: 'sess-A' })

    await Promise.resolve()
    await Promise.resolve()
    expect(adapter.connectedChecks()).toBeGreaterThan(0)
    expect(adapter.sendText).toHaveBeenCalledTimes(1)
    expect(adapter.sendText).toHaveBeenCalledWith('chat-1', 'final answer', {})
  })
})
