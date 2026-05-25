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

  function addManagedSession(id: string, isProcessing = false, permissionMode: 'ask' | 'allow-all' | 'safe' = 'ask', workingDirectory?: string) {
    const managed = createManagedSession(
      { id, name: id, permissionMode, workingDirectory },
      workspace() as never,
      { messagesLoaded: true, isProcessing, workingDirectory },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('persists a real AgentRun manifest and log without queueing the parent', async () => {
    writeProfile('orion')
    const parentWorkingDirectory = join(tmpRoot, 'repo')
    mkdirSync(parentWorkingDirectory, { recursive: true })
    const parent = addManagedSession('parent-1', true, 'allow-all', parentWorkingDirectory)
    const childIds: string[] = []
    const childPrompts: string[] = []
    const childCreateOptions: Array<{ permissionMode?: string; enabledSourceSlugs?: string[]; labels?: string[]; workingDirectory?: string }> = []
    const userMessageEvents: Array<{ agentDelegated?: boolean; status?: string }> = []
    const textCompleteEvents: Array<{ text?: string; sessionId?: string; messageId?: string; agentRun?: unknown }> = []
    const originalSendMessage = sm.sendMessage.bind(sm)

    ;(sm as unknown as { sendEvent: (event: { type?: string; agentDelegated?: boolean; status?: string; text?: string; sessionId?: string; messageId?: string; agentRun?: unknown }) => void }).sendEvent = (event) => {
      if (event.type === 'user_message') userMessageEvents.push(event)
      if (event.type === 'text_complete') textCompleteEvents.push(event)
    }
    ;(sm as unknown as { sendMessage: (...args: Parameters<SessionManager['sendMessage']>) => Promise<void> }).sendMessage = async (...args) => {
      if (args[0] === 'child-1') {
        childPrompts.push(args[1])
        return
      }
      return originalSendMessage(...args)
    }
    ;(sm as unknown as { createSession: (workspaceId: string, options?: { name?: string; permissionMode?: string; llmConnection?: string; model?: string; thinkingLevel?: string; enabledSourceSlugs?: string[]; labels?: string[]; workingDirectory?: string }) => Promise<{ id: string; workingDirectory?: string }> }).createSession = async (_workspaceId, options) => {
      childCreateOptions.push({ permissionMode: options?.permissionMode, enabledSourceSlugs: options?.enabledSourceSlugs, labels: options?.labels, workingDirectory: options?.workingDirectory })
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
          workingDirectory: options?.workingDirectory,
        },
        workspace() as never,
        { messagesLoaded: true, workingDirectory: options?.workingDirectory },
      )
      ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(childId, child)
      return { id: childId, workingDirectory: options?.workingDirectory }
    }

    await sm.sendMessage('parent-1', '[agent:orion] Review the TAPD requirement')

    expect(parent.messageQueue).toHaveLength(0)
    expect(parent.isProcessing).toBe(true)
    expect(childIds).toEqual(['child-1'])
    expect(childCreateOptions[0]).toMatchObject({
      permissionMode: 'ask',
      enabledSourceSlugs: ['test-source'],
      labels: [AGENT_TASK_LABEL_ID],
      workingDirectory: parentWorkingDirectory,
    })
    expect(userMessageEvents[0]).toMatchObject({ status: 'accepted', agentDelegated: true })

    await waitForCondition(() => textCompleteEvents.length > 0 && parent.messages.at(-1)?.role === 'assistant')
    expect(parent.messages.at(-1)?.role).toBe('assistant')
    expect(parent.messages.at(-1)?.content).toContain('Orion started working on the delegated task')
    expect(parent.messages.at(-1)?.content).toContain('Child session: child-1')
    expect(parent.messages.at(-1)?.content).toContain(`Working directory: ${parentWorkingDirectory}`)
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
      workingDirectory: parentWorkingDirectory,
    })
    expect(manifest.status).toBe('running')
    expect(manifest.manifestPath).toBe(manifestPath)
    expect(manifest.transcriptPath).toBe(transcriptPath)
    expect(existsSync(transcriptPath)).toBe(true)
    expect(readFileSync(transcriptPath, 'utf-8')).toContain('agent_run_started')
    expect(readFileSync(transcriptPath, 'utf-8')).toContain(parentWorkingDirectory)
    expect(childPrompts[0]).toContain(`Inherited working directory: ${parentWorkingDirectory}`)
    expect(childPrompts[0]).toContain('verify from this child session')

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

  it('syncs reused requirement child sessions to the latest requirement working directory', () => {
    const oldWorkingDirectory = join(tmpRoot, 'old-repo')
    const nextWorkingDirectory = join(tmpRoot, 'next-repo')
    mkdirSync(oldWorkingDirectory, { recursive: true })
    mkdirSync(nextWorkingDirectory, { recursive: true })
    const child = addManagedSession('child-requirement-1', false, 'ask', oldWorkingDirectory)
    const workingDirectoryEvents: Array<{ type?: string; sessionId?: string; workingDirectory?: string }> = []

    ;(sm as unknown as { sendEvent: (event: { type?: string; sessionId?: string; workingDirectory?: string }) => void }).sendEvent = (event) => {
      if (event.type === 'working_directory_changed') workingDirectoryEvents.push(event)
    }

    ;(sm as unknown as { syncAgentChildWorkingDirectory: (child: unknown, workingDirectory?: string) => void })
      .syncAgentChildWorkingDirectory(child, nextWorkingDirectory)

    expect(child.workingDirectory).toBe(nextWorkingDirectory)
    expect(workingDirectoryEvents[0]).toMatchObject({
      type: 'working_directory_changed',
      sessionId: 'child-requirement-1',
      workingDirectory: nextWorkingDirectory,
    })
  })

  it('routes parent replies to the same child session without blocking the parent', async () => {
    writeProfile('orion')
    const parentWorkingDirectory = join(tmpRoot, 'parent-follow-up-repo')
    const childWorkingDirectory = join(tmpRoot, 'old-child-repo')
    mkdirSync(parentWorkingDirectory, { recursive: true })
    mkdirSync(childWorkingDirectory, { recursive: true })
    const parent = addManagedSession('parent-1', true, 'allow-all', parentWorkingDirectory)
    const child = addManagedSession('child-1', false, 'allow-all', childWorkingDirectory)
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
      workingDirectory: parentWorkingDirectory,
    })
    expect(child.workingDirectory).toBe(parentWorkingDirectory)
    expect(readFileSync(manifest.transcriptPath, 'utf-8')).toContain('agent_run_follow_up_requested')
    expect(readFileSync(manifest.transcriptPath, 'utf-8')).toContain(parentWorkingDirectory)

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
