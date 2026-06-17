import type { CliArgs } from '../index.ts'
import {
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  JsonRpcLineTransport,
} from './json-rpc.ts'
import { CraftAcpAdapter } from './craft-adapter.ts'
import type {
  AcpCancelNotification,
  AcpCloseSessionRequest,
  AcpInitializeRequest,
  AcpInitializeResponse,
  AcpListSessionsRequest,
  AcpLoadSessionRequest,
  AcpNewSessionRequest,
  AcpPromptRequest,
  AcpResumeSessionRequest,
  AcpSetModeRequest,
  JsonRpcId,
  JsonRpcIncoming,
} from './types.ts'

export interface RunAcpServerOptions {
  transport?: JsonRpcLineTransport
}

export async function runAcpServer(args: CliArgs, options?: RunAcpServerOptions): Promise<void> {
  const transport = options?.transport ?? new JsonRpcLineTransport({
    onError: (error) => log(`transport error: ${error.message}`),
  })

  const adapter = new CraftAcpAdapter(args, {
    notifySessionUpdate: (params) => {
      transport.notify('session/update', params)
    },
    log,
  })

  const dispose = async () => {
    await adapter.dispose()
  }
  process.once('SIGINT', () => { void dispose().finally(() => process.exit(130)) })
  process.once('SIGTERM', () => { void dispose().finally(() => process.exit(143)) })
  process.once('exit', () => { void adapter.dispose() })

  transport.listen(async (message) => {
    await handleMessage(message, transport, adapter)
  })

  await new Promise(() => {
    // Keep the ACP server alive until the editor closes stdin or kills us.
  })
}

export async function handleMessage(
  message: JsonRpcIncoming,
  transport: JsonRpcLineTransport,
  adapter: CraftAcpAdapter,
): Promise<void> {
  const shouldRespond = Object.prototype.hasOwnProperty.call(message, 'id')
  const id = shouldRespond ? (message.id ?? null) : null

  try {
    const result = await dispatch(message.method, message.params, adapter)
    if (shouldRespond) transport.respond(id, result)
  } catch (error) {
    const code = error instanceof AcpMethodNotFoundError
      ? JSON_RPC_METHOD_NOT_FOUND
      : error instanceof AcpInvalidParamsError
        ? JSON_RPC_INVALID_PARAMS
        : JSON_RPC_INTERNAL_ERROR
    const msg = error instanceof Error ? error.message : String(error)
    if (shouldRespond) {
      transport.respondError(id, code, msg)
    } else {
      log(`notification ${message.method} failed: ${msg}`)
    }
  }
}

async function dispatch(method: string, params: unknown, adapter: CraftAcpAdapter): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return initialize(params)
    case 'session/new':
      return adapter.newSession(requireObject<AcpNewSessionRequest>(params, method))
    case 'session/list':
      return adapter.listSessions(optionalObject<AcpListSessionsRequest>(params, method))
    case 'session/load':
      return adapter.loadSession(requireObject<AcpLoadSessionRequest>(params, method))
    case 'session/resume':
      return adapter.resumeSession(requireObject<AcpResumeSessionRequest>(params, method))
    case 'session/prompt':
      return adapter.prompt(requireObject<AcpPromptRequest>(params, method))
    case 'session/cancel':
      await adapter.cancel(requireObject<AcpCancelNotification>(params, method))
      return undefined
    case 'session/close':
      return adapter.closeSession(requireObject<AcpCloseSessionRequest>(params, method))
    case 'session/set_mode':
      return adapter.setMode(requireObject<AcpSetModeRequest>(params, method))
    default:
      throw new AcpMethodNotFoundError(`Method not found: ${method}`)
  }
}

async function initialize(params: unknown): Promise<AcpInitializeResponse> {
  requireObject<AcpInitializeRequest>(params, 'initialize')
  const pkg = await import('../../package.json')
  return {
    protocolVersion: 1,
    agentCapabilities: {
      promptCapabilities: {
        embeddedContext: true,
        image: false,
        audio: false,
      },
      loadSession: true,
      sessionCapabilities: {
        close: {},
        list: {},
        resume: {},
      },
    },
    agentInfo: {
      name: 'craft-agent',
      title: 'Craft Agent',
      version: String(pkg.default?.version ?? pkg.version ?? 'unknown'),
    },
    authMethods: [],
  }
}

function requireObject<T>(params: unknown, method: string): T {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new AcpInvalidParamsError(`Invalid params for ${method}: expected object`)
  }
  return params as T
}

function optionalObject<T>(params: unknown, method: string): T {
  if (params == null) return {} as T
  return requireObject<T>(params, method)
}

function log(message: string): void {
  process.stderr.write(`[craft-cli acp] ${message}\n`)
}

class AcpMethodNotFoundError extends Error {}
class AcpInvalidParamsError extends Error {}
