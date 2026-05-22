import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AGENT_TASK_LABEL_ID } from '@craft-agent/shared/agent-runs'
import { SessionManager, createManagedSession } from './SessionManager.ts'

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'sm-agent-runs-'))
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for condition')
}

async function waitForManifest(agentRunsDir: string, timeoutMs = 1000): Promise<string> {
  const manifests = await waitForManifestCount(agentRunsDir, 1, timeoutMs)
  return manifests[0]
}

async function waitForManifestCount(agentRunsDir: string, count: number, timeoutMs = 1000): Promise<string[]> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(agentRunsDir)) {
      const manifests = readdirSync(agentRunsDir)
        .map(runId => join(agentRunsDir, runId, 'manifest.json'))
        .filter(existsSync)
      if (manifests.length >= count) return manifests
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${count} AgentRun manifest(s) in ${agentRunsDir}`)
}

describe('@agent mention AgentRun manifests', () => {
  let tmpRoot: string
  let sm: SessionManager
  const workspace = () => ({
    id: 'ws_test',
    name: 'Test Workspace',
    rootPath: tmpRoot,
    createdAt: Date.now(),
  })

  beforeEach(() => {
    tmpRoot = tempWorkspace()
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function writeProfile(id: string) {
    const dir = join(tmpRoot, 'agents', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'profile.json'), `${JSON.stringify({
      id,
      name: 'Orion',
      status: 'ready',
      visibility: 'workspace',
      connectionSlug: 'test-connection',
      model: 'test-model',
      thinkingLevel: 'medium',
      permissionMode: 'ask',
      skillSlugs: ['test-skill'],
      sourceSlugs: ['test-source'],
      environmentVariables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, null, 2)}\n`)
    writeFileSync(join(dir, 'instructions.md'), 'Follow the test instructions.')
  }

  function addManagedSession(id: string, isProcessing = false, permissionMode: 'ask' | 'allow-all' | 'safe' = 'ask') {
    const managed = createManagedSession(
      { id, name: id, permissionMode },
      workspace() as never,
      { messagesLoaded: true, isProcessing },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('persists a real AgentRun manifest and log without queueing the parent', async () => {
    writeProfile('orion')
    const parent = addManagedSession('parent-1', true, 'allow-all')
    const childIds: string[] = []
    const childCreateOptions: Array<{ permissionMode?: string; enabledSourceSlugs?: string[]; labels?: string[] }> = []
    const userMessageEvents: Array<{ agentDelegated?: boolean; status?: string }> = []
    const textCompleteEvents: Array<{ text?: string; sessionId?: string; messageId?: string; agentRun?: unknown }> = []
    const originalSendMessage = sm.sendMessage.bind(sm)

    ;(sm as unknown as { sendEvent: (event: { type?: string; agentDelegated?: boolean; status?: string; text?: string; sessionId?: string; messageId?: string; agentRun?: unknown }) => void }).sendEvent = (event) => {
      if (event.type === 'user_message') userMessageEvents.push(event)
      if (event.type === 'text_complete') textCompleteEvents.push(event)
    }
    ;(sm as unknown as { sendMessage: (...args: Parameters<SessionManager['sendMessage']>) => Promise<void> }).sendMessage = async (...args) => {
      if (args[0] === 'child-1') return
      return originalSendMessage(...args)
    }
    ;(sm as unknown as { createSession: (workspaceId: string, options?: { name?: string; permissionMode?: string; llmConnection?: string; model?: string; thinkingLevel?: string; enabledSourceSlugs?: string[]; labels?: string[] }) => Promise<{ id: string }> }).createSession = async (_workspaceId, options) => {
      childCreateOptions.push({ permissionMode: options?.permissionMode, enabledSourceSlugs: options?.enabledSourceSlugs, labels: options?.labels })
      const childId = `child-${childIds.length + 1}`
      childIds.push(childId)
      const child = createManagedSession(
        {
          id: childId,
          name: options?.name ?? childId,
          permissionMode: options?.permissionMode as never,
          llmConnection: options?.llmConnection,
          model: options?.model,
          thinkingLevel: options?.thinkingLevel as never,
          enabledSourceSlugs: options?.enabledSourceSlugs,
          labels: options?.labels,
        },
        workspace() as never,
        { messagesLoaded: true },
      )
      ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(childId, child)
      return { id: childId }
    }

    await sm.sendMessage('parent-1', '[agent:orion] Review the TAPD requirement')

    expect(parent.messageQueue).toHaveLength(0)
    expect(parent.isProcessing).toBe(true)
    expect(childIds).toEqual(['child-1'])
    expect(childCreateOptions[0]).toMatchObject({
      permissionMode: 'allow-all',
      enabledSourceSlugs: ['test-source'],
      labels: [AGENT_TASK_LABEL_ID],
    })
    expect(userMessageEvents[0]).toMatchObject({ status: 'accepted', agentDelegated: true })

    await waitForCondition(() => textCompleteEvents.length > 0 && parent.messages.at(-1)?.role === 'assistant')
    expect(parent.messages.at(-1)?.role).toBe('assistant')
    expect(parent.messages.at(-1)?.content).toContain('Orion started working on the delegated task')
    expect(parent.messages.at(-1)?.content).toContain('Child session: child-1')
    expect(parent.messages.at(-1)?.agentRun).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      agentName: 'Orion',
      phase: 'started',
    })
    expect(textCompleteEvents[0]).toMatchObject({
      sessionId: 'parent-1',
      text: parent.messages.at(-1)?.content,
      messageId: parent.messages.at(-1)?.id,
      agentRun: parent.messages.at(-1)?.agentRun,
    })

    const agentRunsDir = join(tmpRoot, 'sessions', 'parent-1', 'agent-runs')
    const manifestPath = await waitForManifest(agentRunsDir)
    const transcriptPath = join(manifestPath.slice(0, -'/manifest.json'.length), 'transcript.jsonl')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    expect(manifest).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      triggerType: 'mention',
      triggerSummary: 'Review the TAPD requirement',
      toolCount: 0,
      artifactCount: 0,
    })
    expect(manifest.status).toBe('running')
    expect(manifest.manifestPath).toBe(manifestPath)
    expect(manifest.transcriptPath).toBe(transcriptPath)
    expect(existsSync(transcriptPath)).toBe(true)
    expect(readFileSync(transcriptPath, 'utf-8')).toContain('agent_run_started')

    const child = (sm as unknown as { sessions: Map<string, any> }).sessions.get('child-1')
    child.messages.push({
      id: 'child-answer-1',
      role: 'assistant',
      content: 'Agent final answer from child session.',
      timestamp: Date.now(),
    })

    await (sm as unknown as { updateAgentRunForChildSession: (childSessionId: string, status: string) => Promise<void> }).updateAgentRunForChildSession('child-1', 'completed')

    expect(parent.messages.at(-1)?.role).toBe('assistant')
    expect(parent.messages.at(-1)?.content).toContain('Agent final answer from child session.')
    expect(parent.messages.at(-1)?.content).toContain('Child session: child-1')
    expect(parent.messages.at(-1)?.agentRun).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      agentName: 'Orion',
      phase: 'finished',
    })
    expect(textCompleteEvents[1]).toMatchObject({
      sessionId: 'parent-1',
      text: parent.messages.at(-1)?.content,
      messageId: parent.messages.at(-1)?.id,
      agentRun: parent.messages.at(-1)?.agentRun,
    })
  })

  it('routes parent replies to the same child session without blocking the parent', async () => {
    writeProfile('orion')
    const parent = addManagedSession('parent-1', true, 'allow-all')
    const child = addManagedSession('child-1', false, 'allow-all')
    child.messages.push({
      id: 'old-child-answer',
      role: 'assistant',
      content: 'Old completed run answer.',
      timestamp: Date.now() - 10_000,
    })

    const userMessageEvents: Array<{ agentDelegated?: boolean; status?: string; optimisticMessageId?: string }> = []
    const textCompleteEvents: Array<{ text?: string; sessionId?: string; messageId?: string; agentRun?: any }> = []
    const childSends: Array<{ sessionId: string; message: string; options?: any }> = []
    const originalSendMessage = sm.sendMessage.bind(sm)

    ;(sm as unknown as { sendEvent: (event: { type?: string; agentDelegated?: boolean; status?: string; optimisticMessageId?: string; text?: string; sessionId?: string; messageId?: string; agentRun?: any }) => void }).sendEvent = (event) => {
      if (event.type === 'user_message') userMessageEvents.push(event)
      if (event.type === 'text_complete') textCompleteEvents.push(event)
    }
    ;(sm as unknown as { sendMessage: (...args: Parameters<SessionManager['sendMessage']>) => Promise<void> }).sendMessage = async (...args) => {
      if (args[0] === 'child-1') {
        childSends.push({ sessionId: args[0], message: args[1], options: args[4] })
        return
      }
      return originalSendMessage(...args)
    }

    await sm.sendMessage('parent-1', 'Can you refine that result?', undefined, undefined, {
      optimisticMessageId: 'opt-follow-up-1',
      agentRunReply: {
        runId: 'run-orion-original',
        agentProfileId: 'orion',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        agentName: 'Orion',
        sourceMessageId: 'msg-agent-result-1',
      },
    })

    await waitForCondition(() => childSends.length === 1 && textCompleteEvents.length >= 1)

    expect(parent.isProcessing).toBe(true)
    expect(parent.messageQueue).toHaveLength(0)
    expect(userMessageEvents[0]).toMatchObject({
      status: 'accepted',
      optimisticMessageId: 'opt-follow-up-1',
      agentDelegated: true,
    })
    expect(parent.messages.find(message => message.role === 'user')?.content).toBe('Can you refine that result?')
    expect(parent.messages.at(-1)?.role).toBe('assistant')
    expect(parent.messages.at(-1)?.content).toContain('Orion started working on your follow-up')
    expect(parent.messages.at(-1)?.agentRun).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      phase: 'started',
    })
    expect(childSends[0]).toMatchObject({
      sessionId: 'child-1',
      message: 'Can you refine that result?',
      options: { skillSlugs: ['test-skill'] },
    })

    const agentRunsDir = join(tmpRoot, 'sessions', 'parent-1', 'agent-runs')
    const manifestPath = (await waitForManifestCount(agentRunsDir, 1))[0]
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    expect(manifest).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      triggerType: 'follow-up',
      triggerSummary: 'Can you refine that result?',
      status: 'running',
    })
    expect(readFileSync(manifest.transcriptPath, 'utf-8')).toContain('agent_run_follow_up_requested')

    child.messages.push({
      id: 'child-follow-up-answer',
      role: 'assistant',
      content: 'New follow-up answer from the same child session.',
      timestamp: Date.now(),
    })

    await (sm as unknown as { updateAgentRunForChildSession: (childSessionId: string, status: string) => Promise<void> }).updateAgentRunForChildSession('child-1', 'completed')

    expect(parent.messages.at(-1)?.role).toBe('assistant')
    expect(parent.messages.at(-1)?.content).toContain('New follow-up answer from the same child session.')
    expect(parent.messages.at(-1)?.content).not.toContain('Old completed run answer.')
    expect(parent.messages.at(-1)?.agentRun).toMatchObject({
      agentProfileId: 'orion',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      phase: 'finished',
    })
  })
})
