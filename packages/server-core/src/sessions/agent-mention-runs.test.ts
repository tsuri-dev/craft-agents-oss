import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'sm-agent-runs-'))
}

async function waitForManifest(agentRunsDir: string, timeoutMs = 1000): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(agentRunsDir)) {
      for (const runId of readdirSync(agentRunsDir)) {
        const manifestPath = join(agentRunsDir, runId, 'manifest.json')
        if (existsSync(manifestPath)) return manifestPath
      }
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for AgentRun manifest in ${agentRunsDir}`)
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
    const childCreateOptions: Array<{ permissionMode?: string; enabledSourceSlugs?: string[] }> = []
    const userMessageEvents: Array<{ agentDelegated?: boolean; status?: string }> = []
    const originalSendMessage = sm.sendMessage.bind(sm)

    ;(sm as unknown as { sendEvent: (event: { type?: string; agentDelegated?: boolean; status?: string }) => void }).sendEvent = (event) => {
      if (event.type === 'user_message') userMessageEvents.push(event)
    }
    ;(sm as unknown as { sendMessage: (...args: Parameters<SessionManager['sendMessage']>) => Promise<void> }).sendMessage = async (...args) => {
      if (args[0] === 'child-1') return
      return originalSendMessage(...args)
    }
    ;(sm as unknown as { createSession: (workspaceId: string, options?: { name?: string; permissionMode?: string; llmConnection?: string; model?: string; thinkingLevel?: string; enabledSourceSlugs?: string[] }) => Promise<{ id: string }> }).createSession = async (_workspaceId, options) => {
      childCreateOptions.push({ permissionMode: options?.permissionMode, enabledSourceSlugs: options?.enabledSourceSlugs })
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
    })
    expect(userMessageEvents[0]).toMatchObject({ status: 'accepted', agentDelegated: true })

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
  })
})
