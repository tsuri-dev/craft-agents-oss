import { describe, expect, it } from 'bun:test'
import { TestAgent, createMockBackendConfig, createMockSession } from './test-utils.ts'

describe('PromptBuilder SSH remote target context', () => {
  it('overrides host-level RemoteCommand and RequestTTY for non-interactive remote commands', () => {
    const agent = new TestAgent(createMockBackendConfig({
      session: createMockSession({
        remoteTarget: {
          type: 'ssh',
          profileId: 'ssh-profile',
          profileName: 'Test SSH Host',
          host: 'example.internal',
          port: 22,
          username: 'ubuntu',
          privateKeyId: 'key-1',
          privateKeyPath: '/Users/test/.ssh/id_ed25519',
          remoteWorkingDirectory: '/srv/app',
          keepAlive: true,
          keepAliveMinutes: 30,
        },
      }),
    }))

    const context = agent.getPromptBuilder().getRemoteTargetContext()

    expect(context).toContain('-o RemoteCommand=none')
    expect(context).toContain('-o RequestTTY=no')
    expect(context).toContain('-o ControlMaster=auto')
  })
})
