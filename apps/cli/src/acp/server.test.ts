import { Writable } from 'node:stream'
import { describe, expect, it } from 'bun:test'
import { JsonRpcLineTransport } from './json-rpc.ts'
import { handleMessage } from './server.ts'
import type { JsonRpcOutgoing } from './types.ts'

class MemoryWritable extends Writable {
  chunks: string[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    callback()
  }

  messages(): JsonRpcOutgoing[] {
    return this.chunks
      .join('')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as JsonRpcOutgoing)
  }
}

describe('ACP server dispatcher', () => {
  it('responds to initialize with Craft Agent capabilities', async () => {
    const output = new MemoryWritable()
    const transport = new JsonRpcLineTransport({ output })
    await handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'zed-test' },
      },
    }, transport, {} as never)

    const response = output.messages()[0] as any
    expect(response).toMatchObject({ jsonrpc: '2.0', id: 1 })
    expect(response.result.protocolVersion).toBe(1)
    expect(response.result.agentInfo).toMatchObject({ name: 'craft-agent', title: 'Craft Agent' })
    expect(response.result.agentCapabilities.promptCapabilities.embeddedContext).toBe(true)
  })

  it('returns method-not-found for unknown requests', async () => {
    const output = new MemoryWritable()
    const transport = new JsonRpcLineTransport({ output })
    await handleMessage({ jsonrpc: '2.0', id: 2, method: 'nope', params: {} }, transport, {} as never)

    const response = output.messages()[0] as any
    expect(response.error.code).toBe(-32601)
  })
})
