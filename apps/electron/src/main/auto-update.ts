/**
 * Auto-update module using electron-updater
 *
 * Handles checking for update availability via the standard electron-updater
 * library. Updates are served from https://agents.craft.do/electron/latest
 * using the generic provider (YAML manifests + binaries on R2/S3).
 *
 * Downloading and installing updates are intentionally disabled. The app only
 * checks whether a newer version exists and notifies the user.
 */

import { autoUpdater } from 'electron-updater'
import { mainLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import { getDismissedUpdateVersion } from '@craft-agent/shared/config'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null

// Kept for compatibility with shutdown guards. In-app update installation is disabled,
// so this remains false.
let __isUpdating = false

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Only check whether updates are available. Never download in the background.
autoUpdater.autoDownload = false

// Never apply a downloaded update on quit. Users install replacement builds manually.
autoUpdater.autoInstallOnAppQuit = false

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', (info) => {
  mainLog.info(`[auto-update] Update available: ${updateInfo.currentVersion} → ${info.version}`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'idle',
    downloadProgress: 0,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', (info) => {
  mainLog.info(`[auto-update] Ignoring downloaded update v${info.version}; in-app installation is disabled`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'idle',
    downloadProgress: 0,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('error', (error) => {
  mainLog.error('[auto-update] Error:', error.message)

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found. Disabled by default. */
  autoDownload?: boolean
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading.
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  const { autoDownload = false } = options

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    // Check for updates - this returns a promise that resolves with the check result.
    // autoDownload is false by default, so this only reports availability.
    await autoUpdater.checkForUpdates()
  } catch (error) {
    mainLog.error('[auto-update] Check failed:', error)
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Check failed',
    }
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

/**
 * Installing updates from inside the app is intentionally disabled.
 * The app only checks for update availability; replacement builds are installed manually.
 */
export async function installUpdate(): Promise<void> {
  mainLog.info('[auto-update] In-app update installation is disabled')
  throw new Error('In-app update installation is disabled')
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}

/**
 * Check for updates on app launch.
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Reports availability only; does not download or install
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  mainLog.info('[auto-update] Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: false })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  return { action: 'ready', version: info.latestVersion }
}
