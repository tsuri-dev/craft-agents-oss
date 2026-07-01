import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, rm, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { CONFIG_DIR, getWorkspaces } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'

const execFileAsync = promisify(execFile)

export interface CleanupLogger {
  info?: (message: string, meta?: unknown) => void
  warn?: (message: string, meta?: unknown) => void
  error?: (message: string, meta?: unknown) => void
}

export interface CleanupOptions {
  logger?: CleanupLogger
}

export interface CleanupSummary {
  removedPaths: string[]
  deletedCredentials: number
  warnings: string[]
}

function log(logger: CleanupLogger | undefined, level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  try {
    logger?.[level]?.(message, meta)
  } catch {
    // logging must never break cleanup
  }
}

function emptySummary(): CleanupSummary {
  return { removedPaths: [], deletedCredentials: 0, warnings: [] }
}

function addWarning(summary: CleanupSummary, message: string, logger?: CleanupLogger): void {
  summary.warnings.push(message)
  log(logger, 'warn', message)
}

async function removePath(path: string, summary: CleanupSummary, logger?: CleanupLogger): Promise<void> {
  const existed = existsSync(path)
  try {
    await rm(path, { recursive: true, force: true })
    if (existed) {
      summary.removedPaths.push(path)
      log(logger, 'info', '[cleanup] removed path', { path })
    }
  } catch (err) {
    addWarning(summary, `[cleanup] failed to remove ${path}: ${err instanceof Error ? err.message : String(err)}`, logger)
  }
}

async function unlinkPath(path: string, summary: CleanupSummary, logger?: CleanupLogger): Promise<void> {
  const existed = existsSync(path)
  try {
    await unlink(path)
    if (existed) {
      summary.removedPaths.push(path)
      log(logger, 'info', '[cleanup] removed file', { path })
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return
    addWarning(summary, `[cleanup] failed to remove ${path}: ${err instanceof Error ? err.message : String(err)}`, logger)
  }
}

async function removeChildrenMatching(
  dir: string,
  predicate: (name: string) => boolean,
  summary: CleanupSummary,
  logger?: CleanupLogger,
): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return
    addWarning(summary, `[cleanup] failed to read ${dir}: ${err instanceof Error ? err.message : String(err)}`, logger)
    return
  }

  await Promise.all(entries
    .filter(predicate)
    .map((name) => removePath(join(dir, name), summary, logger)))
}

async function runBestEffort(command: string, args: string[], summary: CleanupSummary, logger?: CleanupLogger): Promise<void> {
  try {
    await execFileAsync(command, args, { timeout: 5_000 })
    log(logger, 'info', '[cleanup] command completed', { command, args })
  } catch (err) {
    // Most cleanup commands are expected to fail when the old service is absent.
    log(logger, 'info', '[cleanup] command skipped/failed harmlessly', {
      command,
      args,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Remove all persisted messaging-channel state from previous Craft Agent builds.
 * This is intentionally destructive: messaging channels were removed, so old
 * bindings/tokens/auth caches must not keep working or leak credentials.
 */
export async function cleanupDeprecatedMessagingState(options: CleanupOptions = {}): Promise<CleanupSummary> {
  const logger = options.logger
  const summary = emptySummary()

  if (process.env.CRAFT_SKIP_MESSAGING_CLEANUP === '1') {
    log(logger, 'info', '[cleanup] deprecated messaging cleanup skipped by CRAFT_SKIP_MESSAGING_CLEANUP')
    return summary
  }

  try {
    const manager = getCredentialManager()
    const ids = await manager.list({ type: 'messaging_bearer' })
    for (const id of ids) {
      try {
        if (await manager.delete(id)) summary.deletedCredentials += 1
      } catch (err) {
        addWarning(summary, `[cleanup] failed to delete messaging credential ${JSON.stringify(id)}: ${err instanceof Error ? err.message : String(err)}`, logger)
      }
    }
    if (summary.deletedCredentials > 0) {
      log(logger, 'info', '[cleanup] deleted deprecated messaging credentials', { count: summary.deletedCredentials })
    }
  } catch (err) {
    addWarning(summary, `[cleanup] failed to list messaging credentials: ${err instanceof Error ? err.message : String(err)}`, logger)
  }

  const globalPaths = [
    join(CONFIG_DIR, 'messaging'),
    join(CONFIG_DIR, 'wechat'),
    join(CONFIG_DIR, 'telegram'),
    join(CONFIG_DIR, 'whatsapp'),
    join(CONFIG_DIR, 'lark'),
    join(CONFIG_DIR, 'whatsapp-auth'),
    join(tmpdir(), 'craft-wechat-logs'),
    join(tmpdir(), 'craft-wechat-media'),
  ]

  for (const path of globalPaths) {
    await removePath(path, summary, logger)
  }

  await removeChildrenMatching(join(CONFIG_DIR, 'logs'), (name) => name.startsWith('messaging-gateway'), summary, logger)

  const workspaceIds = new Set<string>()
  try {
    for (const workspace of getWorkspaces()) {
      workspaceIds.add(workspace.id)
      await removePath(join(CONFIG_DIR, 'workspaces', workspace.id, 'messaging'), summary, logger)
      await removePath(join(workspace.rootPath, 'messaging'), summary, logger)
    }
  } catch (err) {
    addWarning(summary, `[cleanup] failed to load workspaces for messaging cleanup: ${err instanceof Error ? err.message : String(err)}`, logger)
  }

  // Also clean stale workspace directories that are no longer present in config.
  let workspaceDirs: string[] = []
  try {
    workspaceDirs = await readdir(join(CONFIG_DIR, 'workspaces'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      addWarning(summary, `[cleanup] failed to enumerate workspace data dirs: ${err instanceof Error ? err.message : String(err)}`, logger)
    }
  }
  for (const workspaceId of workspaceDirs) {
    if (workspaceIds.has(workspaceId)) continue
    await removePath(join(CONFIG_DIR, 'workspaces', workspaceId, 'messaging'), summary, logger)
  }

  return summary
}

/** Remove old OpenClaw app/CLI/service/home-dir residue on macOS. */
export async function cleanupOpenClawResidue(options: CleanupOptions = {}): Promise<CleanupSummary> {
  const logger = options.logger
  const summary = emptySummary()

  if (process.env.CRAFT_SKIP_OPENCLAW_CLEANUP === '1') {
    log(logger, 'info', '[cleanup] OpenClaw cleanup skipped by CRAFT_SKIP_OPENCLAW_CLEANUP')
    return summary
  }

  if (process.platform !== 'darwin') return summary

  const uid = typeof process.getuid === 'function' ? process.getuid() : Number(process.env.UID || 0)
  if (Number.isFinite(uid) && uid > 0) {
    await runBestEffort('launchctl', ['bootout', `gui/${uid}`, 'ai.openclaw.gateway'], summary, logger)
  }

  await removeChildrenMatching(
    join(homedir(), 'Library', 'LaunchAgents'),
    (name) => name.startsWith('ai.openclaw') && name.endsWith('.plist'),
    summary,
    logger,
  )

  await removeChildrenMatching(homedir(), (name) => name === '.openclaw' || name.startsWith('.openclaw-'), summary, logger)

  for (const path of [
    '/Applications/OpenClaw.app',
    '/usr/local/bin/openclaw',
    '/opt/homebrew/bin/openclaw',
  ]) {
    await removePath(path, summary, logger)
  }

  for (const base of [join(homedir(), '.nodenv', 'versions'), join(homedir(), '.nvm', 'versions', 'node')]) {
    let versions: string[] = []
    try {
      versions = await readdir(base)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') {
        addWarning(summary, `[cleanup] failed to enumerate ${base}: ${err instanceof Error ? err.message : String(err)}`, logger)
      }
      continue
    }
    for (const version of versions) {
      await unlinkPath(join(base, version, 'bin', 'openclaw'), summary, logger)
    }
  }

  const asdfNodeInstalls = join(homedir(), '.asdf', 'installs', 'nodejs')
  let asdfVersions: string[] = []
  try {
    asdfVersions = await readdir(asdfNodeInstalls)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      addWarning(summary, `[cleanup] failed to enumerate ${asdfNodeInstalls}: ${err instanceof Error ? err.message : String(err)}`, logger)
    }
  }
  for (const version of asdfVersions) {
    await unlinkPath(join(asdfNodeInstalls, version, 'bin', 'openclaw'), summary, logger)
  }

  return summary
}

export async function cleanupDeprecatedMessagingAndOpenClaw(options: CleanupOptions = {}): Promise<{
  messaging: CleanupSummary
  openclaw: CleanupSummary
}> {
  const messaging = await cleanupDeprecatedMessagingState(options)
  const openclaw = await cleanupOpenClawResidue(options)
  return { messaging, openclaw }
}
