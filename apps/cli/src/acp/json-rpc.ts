import type { JsonRpcId, JsonRpcIncoming, JsonRpcOutgoing, JsonRpcResponse } from './types.ts'

export const JSON_RPC_PARSE_ERROR = -32700
export const JSON_RPC_INVALID_REQUEST = -32600
export const JSON_RPC_METHOD_NOT_FOUND = -32601
export const JSON_RPC_INVALID_PARAMS = -32602
export const JSON_RPC_INTERNAL_ERROR = -32603

export interface JsonRpcLineTransportOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  onError?: (error: Error) => void
}

export class JsonRpcLineTransport {
  private input: NodeJS.ReadableStream
  private output: NodeJS.WritableStream
  private onError?: (error: Error) => void
  private buffer = ''
  private listening = false

  constructor(options?: JsonRpcLineTransportOptions) {
    this.input = options?.input ?? process.stdin
    this.output = options?.output ?? process.stdout
    this.onError = options?.onError
  }

  listen(onMessage: (message: JsonRpcIncoming) => void | Promise<void>): void {
    if (this.listening) return
    this.listening = true

    this.input.setEncoding?.('utf8')
    this.input.on('data', (chunk: string | Buffer) => {
      this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      void this.drain(onMessage)
    })
    this.input.on('error', (error: Error) => {
      this.onError?.(error)
    })
  }

  send(message: JsonRpcOutgoing): void {
    this.output.write(`${JSON.stringify(message)}\n`)
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.send({ jsonrpc: '2.0', id, result: result === undefined ? null : result })
  }

  respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: data === undefined ? { code, message } : { code, message, data },
    }
    this.send(response)
  }

  notify(method: string, params?: unknown): void {
    this.send(params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params })
  }

  private async drain(onMessage: (message: JsonRpcIncoming) => void | Promise<void>): Promise<void> {
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const rawLine = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      const line = rawLine.trim()
      if (!line) continue

      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch (error) {
        this.respondError(null, JSON_RPC_PARSE_ERROR, 'Parse error', error instanceof Error ? error.message : String(error))
        continue
      }

      if (!isJsonRpcIncoming(parsed)) {
        this.respondError(null, JSON_RPC_INVALID_REQUEST, 'Invalid Request')
        continue
      }

      try {
        await onMessage(parsed)
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }
}

function isJsonRpcIncoming(value: unknown): value is JsonRpcIncoming {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return record.jsonrpc === '2.0' && typeof record.method === 'string'
}
