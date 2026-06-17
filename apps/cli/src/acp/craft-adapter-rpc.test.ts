import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeEnvelope, deserializeEnvelope } from '@craft-agent/server-core/transport'
import { CraftAcpAdapter } from './craft-adapter.ts'

interface MockCraftServer {
  url: string
  close: () => void
  invokeArgs: Record<string, unknown[][]>
}

interface MockWorkspace {
  id: string
  rootPath: string
  name?: string
}

interface MockSession {
  id: string
  name?: string
  labels?: string[]
  workspaceId?: string
  workingDirectory?: string
  hidden?: boolean
  lastUsedAt?: number
  lastMessageAt?: number
  createdAt?: number
  messageCount?: number
  permissionMode?: string
  messages?: Array<{ id: string; role: string; content: string; timestamp: number }>
}

function createMockCraftServer(opts?: {
  existingWorkspaceRoot?: string
  workspaces?: MockWorkspace[]
  sessions?: MockSession[]
  labels?: unknown[]
  sources?: unknown[]
  skills?: unknown[]
}): MockCraftServer {
  const invokeArgs: Record<string, unknown[][]> = {}
  const sessions = opts?.sessions ?? []
  const workspaces = opts?.workspaces ?? (opts?.existingWorkspaceRoot ? [{ id: 'ws-existing', rootPath: opts.existingWorkspaceRoot }] : [])
  const labels = opts?.labels ?? []
  const sources = opts?.sources ?? []
  const skills = opts?.skills ?? []
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
          case 'workspaces:get':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: workspaces }))
            break
          case 'workspaces:create':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { id: 'ws-1' } }))
            break
          case 'window:switchWorkspace':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { ok: true } }))
            break
          case 'labels:list':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: labels }))
            break
          case 'labels:create':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { id: 'zed', name: 'zed' } }))
            break
          case 'sessions:get':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: sessions }))
            break
          case 'sources:get':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: sources }))
            break
          case 'skills:get':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: skills }))
            break
          case 'sessions:getMessages': {
            const sessionId = envelope.args?.[0]
            const session = sessions.find(s => s.id === sessionId)
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: session ?? null }))
            break
          }
          case 'sessions:command':
            ws.send(serializeEnvelope({ id: envelope.id, type: 'response', channel, result: { ok: true } }))
            break
          case 'window:openSessionInNewWindow':
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
                args: [{ type: 'text_delta', sessionId: envelope.args?.[0], delta: 'Hello from Craft' }],
              }))
              ws.send(serializeEnvelope({
                id: crypto.randomUUID(),
                type: 'event',
                channel: 'session:event',
                args: [{ type: 'complete', sessionId: envelope.args?.[0] }],
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

function createAdapter(mockServer: MockCraftServer, overrides: Partial<ConstructorParameters<typeof CraftAcpAdapter>[0]> = {}, updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []): CraftAcpAdapter {
  return new CraftAcpAdapter({
    url: mockServer.url,
    token: '',
    workspace: undefined,
    timeout: 5_000,
    sendTimeout: 5_000,
    sources: [],
    mode: 'allow-all',
    serverEntry: undefined,
    workspaceDir: undefined,
    verbose: false,
    ...overrides,
  }, {
    notifySessionUpdate: (update) => updates.push(update),
  })
}

describe('Craft ACP adapter RPC bridge', () => {
  let mockServer: MockCraftServer
  let tmpRoot: string
  let tmpConfigDir: string
  let previousConfigDir: string | undefined

  beforeEach(() => {
    previousConfigDir = process.env.CRAFT_CONFIG_DIR
    mockServer = createMockCraftServer()
    tmpRoot = mkdtempSync(join(tmpdir(), 'craft-acp-adapter-'))
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'craft-acp-config-'))
    process.env.CRAFT_CONFIG_DIR = tmpConfigDir
  })

  afterEach(() => {
    mockServer.close()
    rmSync(tmpRoot, { recursive: true, force: true })
    rmSync(tmpConfigDir, { recursive: true, force: true })
    if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
    else process.env.CRAFT_CONFIG_DIR = previousConfigDir
  })

  it('creates a Craft session with zed label and streams prompt updates', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    const adapter = createAdapter(mockServer, {
      sources: ['tapd-openapi-docs'],
      mode: 'ask',
    }, updates)

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    expect(session.sessionId).toBe('craft-session-1')
    expect(session.modes?.currentModeId).toBe('ask')
    expect(mockServer.invokeArgs['sessions:create']?.[0]?.[1]).toMatchObject({
      permissionMode: 'ask',
      workingDirectory: tmpRoot,
      labels: ['zed'],
      enabledSourceSlugs: ['tapd-openapi-docs'],
    })
    expect(mockServer.invokeArgs['labels:create']?.[0]).toEqual(['ws-1', { name: 'zed', color: 'gray' }])

    const result = await adapter.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Hello' }],
    })

    expect(result.stopReason).toBe('end_turn')
    expect(mockServer.invokeArgs['workspaces:get']).toHaveLength(1)
    expect(mockServer.invokeArgs['workspaces:create']).toHaveLength(1)
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

  it('opens the current Craft session in a focused Craft window with /craft', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    const adapter = createAdapter(mockServer, { workspace: 'ws-active', mode: 'ask' }, updates)

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    const result = await adapter.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: '/craft' }] })

    expect(result.stopReason).toBe('end_turn')
    expect(mockServer.invokeArgs['window:openSessionInNewWindow']?.[0]).toEqual(['ws-active', 'craft-session-1'])
    expect(updates.at(-1)).toMatchObject({
      sessionId: 'craft-session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Opened this session in a focused Craft Agent window.' },
      },
    })
    expect(mockServer.invokeArgs['sessions:sendMessage']).toBeUndefined()

    await adapter.dispose()
  })

  it('opens a loaded session in its persisted Craft workspace with /craft', async () => {
    mockServer.close()
    mockServer = createMockCraftServer({
      workspaces: [{ id: 'ws-active', rootPath: '/repo' }],
      sessions: [{ id: 's-old', workspaceId: 'ws-original', workingDirectory: tmpRoot, messages: [] }],
    })
    const adapter = createAdapter(mockServer, { workspace: 'ws-active', mode: 'ask' })

    await adapter.resumeSession({ sessionId: 's-old', cwd: tmpRoot, mcpServers: [] })
    await adapter.prompt({ sessionId: 's-old', prompt: [{ type: 'text', text: '/craft' }] })

    expect(mockServer.invokeArgs['window:openSessionInNewWindow']?.[0]).toEqual(['ws-original', 's-old'])

    await adapter.dispose()
  })

  it('notifies mode updates with currentModeId for Zed schema compatibility', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    const adapter = createAdapter(mockServer, { mode: 'ask' }, updates)

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    await adapter.setMode({ sessionId: session.sessionId, modeId: 'allow-all' })

    expect(mockServer.invokeArgs['sessions:command']?.[0]).toEqual([
      'craft-session-1',
      { type: 'setPermissionMode', mode: 'allow-all' },
    ])
    expect(updates.at(-1)).toEqual({
      sessionId: 'craft-session-1',
      update: { sessionUpdate: 'current_mode_update', currentModeId: 'allow-all' },
    })

    await adapter.dispose()
  })

  it('bridges Craft source and skill bracket mentions from Zed prompts', async () => {
    const adapter = createAdapter(mockServer, {
      sources: ['existing-source'],
      mode: 'ask',
    })

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    const result = await adapter.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: '[source:tapd-openapi-docs] [skill:brainstorming] Do it' }],
    })

    expect(result.stopReason).toBe('end_turn')
    expect(mockServer.invokeArgs['sessions:command']?.[0]).toEqual([
      'craft-session-1',
      { type: 'setSources', sourceSlugs: ['existing-source', 'tapd-openapi-docs'] },
    ])
    expect(mockServer.invokeArgs['sessions:sendMessage']?.[0]).toEqual([
      'craft-session-1',
      '[source:tapd-openapi-docs] [skill:brainstorming] Do it',
      null,
      null,
      { skillSlugs: ['brainstorming'] },
    ])

    await adapter.dispose()
  })

  it('supports local /sources and /skills helper commands for Zed input', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    mockServer.close()
    mockServer = createMockCraftServer({
      sources: [{ config: { slug: 'tapd-openapi-docs', name: 'TAPD OpenAPI Docs', provider: 'local' } }],
      skills: [{ slug: 'brainstorming', metadata: { name: 'Brainstorming', description: 'Explore solution options' } }],
    })

    const adapter = createAdapter(mockServer, { mode: 'ask' }, updates)
    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })

    await adapter.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: '/sources' }] })
    await adapter.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: '/skills' }] })

    const texts = updates.map(update => (update.update.content as { text?: string } | undefined)?.text ?? '').join('\n')
    expect(texts).toContain('[source:tapd-openapi-docs]')
    expect(texts).toContain('/use-source <slug> your prompt')
    expect(texts).toContain('[skill:brainstorming]')
    expect(texts).toContain('/use-skill <slug> your prompt')
    expect(mockServer.invokeArgs['sources:get']?.[0]).toEqual(['ws-1'])
    expect(mockServer.invokeArgs['skills:get']?.[0]).toEqual(['ws-1', tmpRoot])
    expect(mockServer.invokeArgs['sessions:sendMessage']).toBeUndefined()

    await adapter.dispose()
  })

  it('translates /use-source and /use-skill helper commands into Craft mentions', async () => {
    const adapter = createAdapter(mockServer, { mode: 'ask' })
    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })

    await adapter.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: '/use-source tapd-openapi-docs 查 comment API' }] })
    await adapter.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: '/use-skill brainstorming 拆方案' }] })

    expect(mockServer.invokeArgs['sessions:command']?.[0]).toEqual([
      'craft-session-1',
      { type: 'setSources', sourceSlugs: ['tapd-openapi-docs'] },
    ])
    expect(mockServer.invokeArgs['sessions:sendMessage']?.[0]).toEqual([
      'craft-session-1',
      '[source:tapd-openapi-docs] 查 comment API',
    ])
    expect(mockServer.invokeArgs['sessions:sendMessage']?.[1]).toEqual([
      'craft-session-1',
      '[skill:brainstorming] 拆方案',
      null,
      null,
      { skillSlugs: ['brainstorming'] },
    ])

    await adapter.dispose()
  })

  it('prefers the locally active Craft workspace over Zed cwd workspace mapping', async () => {
    process.env.CRAFT_CONFIG_DIR = tmpConfigDir
    writeFileSync(join(tmpConfigDir, 'config.json'), JSON.stringify({ activeWorkspaceId: 'ws-active', workspaces: [] }), 'utf8')
    mockServer.close()
    mockServer = createMockCraftServer({
      existingWorkspaceRoot: tmpRoot,
      workspaces: [
        { id: 'ws-active', rootPath: '/Users/me/current-craft-workspace' },
        { id: 'ws-cwd', rootPath: tmpRoot },
      ],
      labels: [{ id: 'zed', name: 'zed' }],
    })

    const adapter = createAdapter(mockServer)
    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })

    expect(session.sessionId).toBe('craft-session-1')
    expect(mockServer.invokeArgs['workspaces:create']).toBeUndefined()
    expect(mockServer.invokeArgs['window:switchWorkspace']?.[0]).toEqual(['ws-active'])
    expect(mockServer.invokeArgs['sessions:create']?.[0]?.[0]).toBe('ws-active')

    await adapter.dispose()
  })

  it('reuses an existing workspace with the same cwd when no active workspace is configured', async () => {
    mockServer.close()
    mockServer = createMockCraftServer({ existingWorkspaceRoot: tmpRoot, labels: [{ id: 'zed', name: 'zed' }] })

    const adapter = createAdapter(mockServer)

    const session = await adapter.newSession({ cwd: tmpRoot, mcpServers: [] })
    expect(session.sessionId).toBe('craft-session-1')
    expect(mockServer.invokeArgs['workspaces:get']).toHaveLength(1)
    expect(mockServer.invokeArgs['workspaces:create']).toBeUndefined()
    expect(mockServer.invokeArgs['window:switchWorkspace']?.[0]).toEqual(['ws-existing'])

    await adapter.dispose()
  })

  it('lists all non-hidden sessions in the current workspace for Zed import', async () => {
    const now = Date.now()
    mockServer.close()
    mockServer = createMockCraftServer({
      workspaces: [{ id: 'ws-active', rootPath: '/repo' }],
      sessions: [
        { id: 's-1', name: 'From Zed', labels: ['zed'], workingDirectory: tmpRoot, lastUsedAt: now, messageCount: 2 },
        { id: 's-2', name: 'Existing Craft Session', labels: ['manual'], workingDirectory: '/other/project', lastUsedAt: now + 1, messageCount: 1 },
        { id: 's-hidden', name: 'Hidden', labels: ['zed'], workingDirectory: tmpRoot, hidden: true, lastUsedAt: now + 2 },
      ],
    })

    const adapter = createAdapter(mockServer, { workspace: 'ws-active' })
    const result = await adapter.listSessions({ cwd: tmpRoot })

    expect(result.sessions.map(s => s.sessionId)).toEqual(['s-2', 's-1'])
    expect(result.sessions[0]?.title).toBe('Existing Craft Session')
    expect(result.sessions[0]?.cwd).toBe('/other/project')
    expect(result.sessions[0]?._meta?.labels).toEqual(['manual'])
    expect(result.sessions[1]?._meta?.labels).toEqual(['zed'])

    await adapter.dispose()
  })

  it('loads a historical session and replays user and assistant messages', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    mockServer.close()
    mockServer = createMockCraftServer({
      workspaces: [{ id: 'ws-active', rootPath: '/repo' }],
      sessions: [{
        id: 's-1',
        labels: ['zed'],
        workingDirectory: tmpRoot,
        permissionMode: 'ask',
        messages: [
          { id: 'u1', role: 'user', content: 'Hi', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'Hello', timestamp: 2 },
        ],
      }],
    })

    const adapter = createAdapter(mockServer, { workspace: 'ws-active', mode: 'ask' }, updates)
    const result = await adapter.loadSession({ sessionId: 's-1', cwd: tmpRoot, mcpServers: [] })

    expect(result.modes?.currentModeId).toBe('ask')
    expect(updates).toEqual([
      { sessionId: 's-1', update: { sessionUpdate: 'user_message_chunk', messageId: 'u1', content: { type: 'text', text: 'Hi' } } },
      { sessionId: 's-1', update: { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: { type: 'text', text: 'Hello' } } },
    ])

    const prompt = await adapter.prompt({ sessionId: 's-1', prompt: [{ type: 'text', text: 'Continue' }] })
    expect(prompt.stopReason).toBe('end_turn')
    expect(mockServer.invokeArgs['sessions:sendMessage']?.[0]).toEqual(['s-1', 'Continue'])

    await adapter.dispose()
  })

  it('resumes a historical session without replaying messages', async () => {
    const updates: Array<{ sessionId: string; update: Record<string, unknown> }> = []
    mockServer.close()
    mockServer = createMockCraftServer({
      workspaces: [{ id: 'ws-active', rootPath: '/repo' }],
      sessions: [{
        id: 's-1',
        labels: ['zed'],
        workingDirectory: tmpRoot,
        permissionMode: 'ask',
        messages: [{ id: 'u1', role: 'user', content: 'Hi', timestamp: 1 }],
      }],
    })

    const adapter = createAdapter(mockServer, { workspace: 'ws-active', mode: 'ask' }, updates)
    const result = await adapter.resumeSession({ sessionId: 's-1', cwd: tmpRoot, mcpServers: [] })

    expect(result.modes?.currentModeId).toBe('ask')
    expect(updates).toEqual([])

    await adapter.dispose()
  })
})
