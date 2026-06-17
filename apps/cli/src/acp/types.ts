export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcIncoming = JsonRpcRequest
export type JsonRpcOutgoing = JsonRpcResponse | JsonRpcNotification

export interface AcpInitializeRequest {
  protocolVersion: number
  clientCapabilities?: Record<string, unknown>
  clientInfo?: AcpImplementation
}

export interface AcpImplementation {
  name: string
  title?: string
  version?: string
}

export interface AcpInitializeResponse {
  protocolVersion: number
  agentCapabilities: Record<string, unknown>
  agentInfo: AcpImplementation
  authMethods: unknown[]
}

export interface AcpNewSessionRequest {
  cwd: string
  mcpServers?: unknown[]
  additionalDirectories?: string[]
}

export interface AcpNewSessionResponse {
  sessionId: string
  modes?: AcpSessionModeState
}

export interface AcpListSessionsRequest {
  cwd?: string
  cursor?: string
}

export interface AcpSessionInfo {
  sessionId: string
  cwd: string
  additionalDirectories?: string[]
  title?: string
  updatedAt?: string
  _meta?: Record<string, unknown>
}

export interface AcpListSessionsResponse {
  sessions: AcpSessionInfo[]
  nextCursor?: string
}

export interface AcpLoadSessionRequest {
  sessionId: string
  cwd: string
  mcpServers?: unknown[]
  additionalDirectories?: string[]
}

export type AcpResumeSessionRequest = AcpLoadSessionRequest

export interface AcpPromptRequest {
  sessionId: string
  prompt: AcpContentBlock[]
}

export interface AcpPromptResponse {
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'
}

export interface AcpCancelNotification {
  sessionId: string
}

export interface AcpCloseSessionRequest {
  sessionId: string
}

export interface AcpSetModeRequest {
  sessionId: string
  modeId: string
}

export interface AcpSessionModeState {
  currentModeId: string
  availableModes: AcpSessionMode[]
}

export interface AcpSessionMode {
  id: string
  name: string
  description?: string
}

export type AcpContentBlock =
  | { type: 'text'; text: string; annotations?: unknown }
  | { type: 'resource'; resource: AcpEmbeddedResource; annotations?: unknown }
  | { type: 'resource_link'; uri: string; name: string; title?: string; mimeType?: string; description?: string; size?: number; annotations?: unknown }
  | { type: 'image'; data: string; mimeType: string; uri?: string; annotations?: unknown }
  | { type: 'audio'; data: string; mimeType: string; annotations?: unknown }
  | Record<string, unknown>

export type AcpEmbeddedResource =
  | { uri: string; text: string; mimeType?: string; annotations?: unknown }
  | { uri: string; blob: string; mimeType?: string; annotations?: unknown }

export interface AcpSessionUpdateNotification {
  sessionId: string
  update: Record<string, unknown>
}

export interface CraftSessionEvent {
  type: string
  sessionId?: string
  delta?: string
  text?: string
  toolUseId?: string
  toolName?: string
  toolIntent?: string
  result?: unknown
  isError?: boolean
  error?: unknown
  tokenUsage?: {
    contextTokens?: number
    totalTokens?: number
    costUsd?: number
  }
  [key: string]: unknown
}
