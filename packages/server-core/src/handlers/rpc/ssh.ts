import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { RPC_CHANNELS, type CreateSshConnectionProfileInput, type CreateSshPrivateKeyInput, type Session, type SshConnectionProfile, type SshKeyValidationResult, type SshPrivateKeyRecord, type SshProfileTestResult, type UpdateSshConnectionProfileInput, type UpdateSshPrivateKeyInput } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

const SSH_KEYS_FILE = 'ssh-keys.json'
const SSH_PROFILES_FILE = 'ssh-connections.json'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.ssh.LIST_KEYS,
  RPC_CHANNELS.ssh.CREATE_KEY,
  RPC_CHANNELS.ssh.UPDATE_KEY,
  RPC_CHANNELS.ssh.DELETE_KEY,
  RPC_CHANNELS.ssh.VALIDATE_KEY,
  RPC_CHANNELS.ssh.LIST_PROFILES,
  RPC_CHANNELS.ssh.CREATE_PROFILE,
  RPC_CHANNELS.ssh.UPDATE_PROFILE,
  RPC_CHANNELS.ssh.DELETE_PROFILE,
  RPC_CHANNELS.ssh.TEST_PROFILE,
  RPC_CHANNELS.ssh.OPEN_PROFILE_SESSION,
] as const

interface SshKeyStore { keys: SshPrivateKeyRecord[] }
interface SshProfileStore { profiles: SshConnectionProfile[] }

function workspaceRoot(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJsonFile<T>(path: string, value: T): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

function keyStorePath(root: string): string { return join(root, SSH_KEYS_FILE) }
function profileStorePath(root: string): string { return join(root, SSH_PROFILES_FILE) }

async function loadKeys(root: string): Promise<SshPrivateKeyRecord[]> {
  return (await readJsonFile<SshKeyStore>(keyStorePath(root), { keys: [] })).keys ?? []
}

async function saveKeys(root: string, keys: SshPrivateKeyRecord[]): Promise<void> {
  await writeJsonFile(keyStorePath(root), { keys })
}

async function loadProfiles(root: string): Promise<SshConnectionProfile[]> {
  return (await readJsonFile<SshProfileStore>(profileStorePath(root), { profiles: [] })).profiles ?? []
}

async function saveProfiles(root: string, profiles: SshConnectionProfile[]): Promise<void> {
  await writeJsonFile(profileStorePath(root), { profiles })
}

function normalizePort(port?: number): number {
  const normalized = Number(port ?? 22)
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 65535) {
    throw new Error('SSH port must be an integer between 1 and 65535')
  }
  return normalized
}

function normalizeKeepAliveMinutes(minutes?: number): number {
  const normalized = Number(minutes ?? 30)
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 24 * 60) {
    throw new Error('SSH keep-alive minutes must be an integer between 1 and 1440')
  }
  return normalized
}

function sshKeepAliveArgs(profile: Pick<SshConnectionProfile, 'keepAlive' | 'keepAliveMinutes'>): string[] {
  if (profile.keepAlive === false) return []
  return [
    '-o', 'ControlMaster=auto',
    '-o', `ControlPersist=${normalizeKeepAliveMinutes(profile.keepAliveMinutes)}m`,
    '-o', 'ControlPath=/tmp/craft-agent-ssh-%C',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
  ]
}

function requireNonEmpty(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${label} is required`)
  return trimmed
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

async function runCommand(command: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

async function validatePrivateKeyPath(privateKeyPath: string): Promise<SshKeyValidationResult> {
  try {
    await access(privateKeyPath, constants.R_OK)
  } catch (error) {
    return { ok: false, error: `Private key is not readable: ${error instanceof Error ? error.message : String(error)}` }
  }

  try {
    const publicKeyResult = await runCommand('ssh-keygen', ['-y', '-f', privateKeyPath], 10_000)
    if (publicKeyResult.code !== 0 || !publicKeyResult.stdout) {
      return { ok: false, error: publicKeyResult.stderr || 'ssh-keygen could not derive a public key. Passphrase-protected keys must be available via ssh-agent for MVP.' }
    }
    const fingerprintResult = await runCommand('ssh-keygen', ['-lf', privateKeyPath], 10_000)
    return {
      ok: true,
      publicKey: publicKeyResult.stdout,
      fingerprint: fingerprintResult.code === 0 ? fingerprintResult.stdout : undefined,
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function createRemoteTarget(profile: SshConnectionProfile, key: SshPrivateKeyRecord): NonNullable<Session['remoteTarget']> {
  return {
    type: 'ssh',
    profileId: profile.id,
    profileName: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    privateKeyId: key.id,
    privateKeyPath: key.privateKeyPath,
    remoteWorkingDirectory: profile.remoteWorkingDirectory,
    keepAlive: profile.keepAlive !== false,
    keepAliveMinutes: normalizeKeepAliveMinutes(profile.keepAliveMinutes),
  }
}

async function testProfileWithKey(profile: SshConnectionProfile, key: SshPrivateKeyRecord): Promise<SshProfileTestResult> {
  const keyValidation = await validatePrivateKeyPath(key.privateKeyPath)
  if (!keyValidation.ok) return { ok: false, error: keyValidation.error }

  const target = `${profile.username}@${profile.host}`
  const remoteCommand = `cd ${shellQuote(profile.remoteWorkingDirectory)} && pwd`
  try {
    const result = await runCommand('ssh', [
      '-i', key.privateKeyPath,
      '-p', String(profile.port),
      '-o', 'BatchMode=yes',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'ConnectTimeout=10',
      ...sshKeepAliveArgs(profile),
      target,
      remoteCommand,
    ], 20_000)
    if (result.code !== 0) {
      return { ok: false, error: result.stderr || `ssh exited with code ${result.code}` }
    }
    return { ok: true, cwd: result.stdout }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerSshHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.ssh.LIST_KEYS, async (_ctx, workspaceId: string) => {
    return loadKeys(workspaceRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.ssh.CREATE_KEY, async (_ctx, workspaceId: string, input: CreateSshPrivateKeyInput) => {
    const root = workspaceRoot(workspaceId)
    const privateKeyPath = requireNonEmpty(input.privateKeyPath, 'Private key path')
    const validation = await validatePrivateKeyPath(privateKeyPath)
    if (!validation.ok) throw new Error(validation.error || 'Invalid private key')
    const now = Date.now()
    const key: SshPrivateKeyRecord = {
      id: `key-${randomUUID()}`,
      name: requireNonEmpty(input.name, 'Key name'),
      privateKeyPath,
      publicKey: validation.publicKey,
      fingerprint: validation.fingerprint,
      createdAt: now,
      updatedAt: now,
    }
    const keys = await loadKeys(root)
    keys.push(key)
    await saveKeys(root, keys)
    deps.sessionManager.notifyConfigFileChange(root, SSH_KEYS_FILE)
    return key
  })

  server.handle(RPC_CHANNELS.ssh.UPDATE_KEY, async (_ctx, workspaceId: string, keyId: string, patch: UpdateSshPrivateKeyInput) => {
    const root = workspaceRoot(workspaceId)
    const keys = await loadKeys(root)
    const idx = keys.findIndex(key => key.id === keyId)
    if (idx === -1) throw new Error(`SSH key not found: ${keyId}`)
    const nextPath = patch.privateKeyPath != null ? requireNonEmpty(patch.privateKeyPath, 'Private key path') : keys[idx].privateKeyPath
    const validation = await validatePrivateKeyPath(nextPath)
    if (!validation.ok) throw new Error(validation.error || 'Invalid private key')
    keys[idx] = {
      ...keys[idx],
      name: patch.name != null ? requireNonEmpty(patch.name, 'Key name') : keys[idx].name,
      privateKeyPath: nextPath,
      publicKey: validation.publicKey,
      fingerprint: validation.fingerprint,
      updatedAt: Date.now(),
    }
    await saveKeys(root, keys)
    deps.sessionManager.notifyConfigFileChange(root, SSH_KEYS_FILE)
    return keys[idx]
  })

  server.handle(RPC_CHANNELS.ssh.DELETE_KEY, async (_ctx, workspaceId: string, keyId: string) => {
    const root = workspaceRoot(workspaceId)
    const profiles = await loadProfiles(root)
    if (profiles.some(profile => profile.privateKeyId === keyId)) {
      throw new Error('This private key is used by an SSH host. Remove or edit that host first.')
    }
    const keys = (await loadKeys(root)).filter(key => key.id !== keyId)
    await saveKeys(root, keys)
    deps.sessionManager.notifyConfigFileChange(root, SSH_KEYS_FILE)
  })

  server.handle(RPC_CHANNELS.ssh.VALIDATE_KEY, async (_ctx, workspaceId: string, keyIdOrInput: string | CreateSshPrivateKeyInput) => {
    const root = workspaceRoot(workspaceId)
    const privateKeyPath = typeof keyIdOrInput === 'string'
      ? (await loadKeys(root)).find(key => key.id === keyIdOrInput)?.privateKeyPath
      : keyIdOrInput.privateKeyPath
    if (!privateKeyPath) return { ok: false, error: 'Private key not found' } satisfies SshKeyValidationResult
    return validatePrivateKeyPath(privateKeyPath)
  })

  server.handle(RPC_CHANNELS.ssh.LIST_PROFILES, async (_ctx, workspaceId: string) => {
    return loadProfiles(workspaceRoot(workspaceId))
  })

  server.handle(RPC_CHANNELS.ssh.CREATE_PROFILE, async (_ctx, workspaceId: string, input: CreateSshConnectionProfileInput) => {
    const root = workspaceRoot(workspaceId)
    const keys = await loadKeys(root)
    if (!keys.some(key => key.id === input.privateKeyId)) throw new Error('Selected private key was not found')
    const now = Date.now()
    const profile: SshConnectionProfile = {
      id: `ssh-${randomUUID()}`,
      name: requireNonEmpty(input.name, 'Host name'),
      host: requireNonEmpty(input.host, 'Host'),
      port: normalizePort(input.port),
      username: requireNonEmpty(input.username, 'Username'),
      privateKeyId: requireNonEmpty(input.privateKeyId, 'Private key'),
      remoteWorkingDirectory: requireNonEmpty(input.remoteWorkingDirectory, 'Remote working directory'),
      keepAlive: input.keepAlive !== false,
      keepAliveMinutes: normalizeKeepAliveMinutes(input.keepAliveMinutes),
      createdAt: now,
      updatedAt: now,
    }
    const profiles = await loadProfiles(root)
    profiles.push(profile)
    await saveProfiles(root, profiles)
    deps.sessionManager.notifyConfigFileChange(root, SSH_PROFILES_FILE)
    return profile
  })

  server.handle(RPC_CHANNELS.ssh.UPDATE_PROFILE, async (_ctx, workspaceId: string, profileId: string, patch: UpdateSshConnectionProfileInput) => {
    const root = workspaceRoot(workspaceId)
    const profiles = await loadProfiles(root)
    const idx = profiles.findIndex(profile => profile.id === profileId)
    if (idx === -1) throw new Error(`SSH profile not found: ${profileId}`)
    if (patch.privateKeyId != null) {
      const keys = await loadKeys(root)
      if (!keys.some(key => key.id === patch.privateKeyId)) throw new Error('Selected private key was not found')
    }
    const current = profiles[idx]
    profiles[idx] = {
      ...current,
      name: patch.name != null ? requireNonEmpty(patch.name, 'Host name') : current.name,
      host: patch.host != null ? requireNonEmpty(patch.host, 'Host') : current.host,
      port: patch.port != null ? normalizePort(patch.port) : current.port,
      username: patch.username != null ? requireNonEmpty(patch.username, 'Username') : current.username,
      privateKeyId: patch.privateKeyId != null ? requireNonEmpty(patch.privateKeyId, 'Private key') : current.privateKeyId,
      remoteWorkingDirectory: patch.remoteWorkingDirectory != null ? requireNonEmpty(patch.remoteWorkingDirectory, 'Remote working directory') : current.remoteWorkingDirectory,
      keepAlive: patch.keepAlive ?? current.keepAlive ?? true,
      keepAliveMinutes: normalizeKeepAliveMinutes(patch.keepAliveMinutes ?? current.keepAliveMinutes),
      boundSessionId: patch.boundSessionId === null ? undefined : (patch.boundSessionId ?? current.boundSessionId),
      updatedAt: Date.now(),
    }
    await saveProfiles(root, profiles)
    deps.sessionManager.notifyConfigFileChange(root, SSH_PROFILES_FILE)
    return profiles[idx]
  })

  server.handle(RPC_CHANNELS.ssh.DELETE_PROFILE, async (_ctx, workspaceId: string, profileId: string) => {
    const root = workspaceRoot(workspaceId)
    const profiles = (await loadProfiles(root)).filter(profile => profile.id !== profileId)
    await saveProfiles(root, profiles)
    deps.sessionManager.notifyConfigFileChange(root, SSH_PROFILES_FILE)
  })

  server.handle(RPC_CHANNELS.ssh.TEST_PROFILE, async (_ctx, workspaceId: string, profileIdOrInput: string | CreateSshConnectionProfileInput) => {
    const root = workspaceRoot(workspaceId)
    const keys = await loadKeys(root)
    let profile: SshConnectionProfile
    if (typeof profileIdOrInput === 'string') {
      const existing = (await loadProfiles(root)).find(item => item.id === profileIdOrInput)
      if (!existing) return { ok: false, error: 'SSH profile not found' } satisfies SshProfileTestResult
      profile = existing
    } else {
      profile = {
        id: 'test',
        name: profileIdOrInput.name,
        host: profileIdOrInput.host,
        port: normalizePort(profileIdOrInput.port),
        username: profileIdOrInput.username,
        privateKeyId: profileIdOrInput.privateKeyId,
        remoteWorkingDirectory: profileIdOrInput.remoteWorkingDirectory,
        keepAlive: profileIdOrInput.keepAlive !== false,
        keepAliveMinutes: normalizeKeepAliveMinutes(profileIdOrInput.keepAliveMinutes),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }
    const key = keys.find(item => item.id === profile.privateKeyId)
    if (!key) return { ok: false, error: 'Selected private key was not found' } satisfies SshProfileTestResult
    return testProfileWithKey(profile, key)
  })

  server.handle(RPC_CHANNELS.ssh.OPEN_PROFILE_SESSION, async (_ctx, workspaceId: string, profileId: string) => {
    const root = workspaceRoot(workspaceId)
    const profiles = await loadProfiles(root)
    const idx = profiles.findIndex(profile => profile.id === profileId)
    if (idx === -1) throw new Error(`SSH profile not found: ${profileId}`)
    const profile = profiles[idx]
    const keys = await loadKeys(root)
    const key = keys.find(item => item.id === profile.privateKeyId)
    if (!key) throw new Error('Selected private key was not found')

    if (profile.boundSessionId) {
      const existing = await deps.sessionManager.getSession(profile.boundSessionId)
      if (existing) {
        const remoteTarget = createRemoteTarget(profile, key)
        await deps.sessionManager.updateSessionRemoteTarget?.(profile.boundSessionId, remoteTarget)
        const refreshed = await deps.sessionManager.getSession(profile.boundSessionId)
        return { profile, session: refreshed ?? { ...existing, remoteTarget }, created: false }
      }
    }

    const session = await deps.sessionManager.createSession(workspaceId, {
      name: `SSH: ${profile.name}`,
      workingDirectory: 'none',
      labels: [`ssh::${profile.id}`],
      remoteTarget: createRemoteTarget(profile, key),
    })
    profiles[idx] = { ...profile, boundSessionId: session.id, updatedAt: Date.now() }
    await saveProfiles(root, profiles)
    deps.sessionManager.notifyConfigFileChange(root, SSH_PROFILES_FILE)
    return { profile: profiles[idx], session, created: true }
  })
}
