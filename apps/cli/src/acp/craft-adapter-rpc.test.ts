import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeEnvelope, deserializeEnvelope } from '@craft-agent/server-core/transport'
import { CraftAcpAdapter } from './craft-adapter.ts'

interface MockCraftServer {
  url: string
  close: () => void
  invokeArgs: Record<string, unknown[][]>
}

function createMockCraftServer(): MockCraftServer {
  const invokeArgs: Record<string, unknown[][]> = {}
  const server = Bun.serve({
    port: 0,
    fetch(req, svr) {
      if (svr.upgrade(req)) return undefined
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      message(ws, message) {
        const raw = typeof message === 'string' ? message : new TextDecoder().decode(message)
        const envelope = deserializeEnvelope(raw)

        if (envelope.type === 'handshake') {
          ws.send(serializeEnvelope({
            id: crypto.randomUUID(),
            type: 'handshake_ack',
            clientId: 'acp-test-client',
            protocolVersion: '1.0',
          }))
          return
        }

        if (envelope.type !== 'request') return
        const channel = envelope.channel!
        if (!invokeArgs[channel]) invokeArgs[channel] = []
        invokeArgs[channel].push(envelope.args ?? [])

        switch (channel) {
          case 'workspaces:create':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { id: 'ws-1' } }))
            break
          case 'window:switchWorkspace':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { ok: true } }))
            break
          case 'sessions:create':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { id: 'craft-session-1' } }))
            break
          case 'sessions:sendMessage':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { ok: true } }))
            setTimeout(() => {
              ws.send(serializeEnvelope({
                id: crypto.randomUUID(),
                type: 'event',
                channel: 'session:event',
                args: [{ type: 'text_delta', sessionId: 'craft-session-1', delta: 'Hello from Craft' }],
              }))
              ws.send(serializeEnvelope({
                id: crypto.randomUUID(),
                type: 'event',
                channel: 'session:event',
                args: [{ type: 'complete', sessionId: 'craft-session-1' }],
              }))
            }, 1)
            break
          default:
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: null }))
        }
      },
    },
  })

  return {
    url: `ws://localhost:${server.port}`,
    close: () => server.stop(),
    invokeArgs,
  }
}

describe('Craft ACP adapter RPC bridge', () => {
  let mockServer: MockCraftServer
  let tmpRoot: string

  beforeEach(() => {
    mockServer = createMockCraftServer()
    tmpRoot = mkdtempSync(join(tmpdir(), 'craft-acp-adapter-'))
  })

  afterEach(() => {
    mockServer.close()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('creates a Craft session and streams prompt updates', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    const adapter = new CraftAcpAdapter({
      url: mockServer.url,
      token: '',
      workspace: undefined,
      timeout: 5_000,
      sendTimeout: 5_000,
      sources: ['tapd-openapi-docs'],
      mode: 'ask',
      serverEntry: undefined,
      workspaceDir: undefined,
      verbose: false,
    }, {
      notifySessionUpdate: (update) => updates.push(update),
    })

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    expect(session.sessionId).toBe('craft-session-1')
    expect(session.modes?.currentModeId).toBe('ask')
    expect(mockServer.invokeArgs['sessions:create']?.[0]?.[1]).toMatchObject({
      permissionMode: 'ask',
      workingDirectory: tmpRoot,
      enabledSourceSlugs: ['tapd-openapi-docs'],
    })

    const result = await adapter.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Hello' }],
    })

    expect(result.stopReason).toBe('end_turn')
    expect(mockServer.invokeArgs['sessions:sendMessage']?.[0]).toEqual(['craft-session-1', 'Hello'])
    expect(updates[0]).toEqual({
      sessionId: 'craft-session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'agent-response',
        content: { type: 'text', text: 'Hello from Craft' },
      },
    })

    await adapter.dispose()
  })
})
