import { basename, extname, join, resolve } from 'path'
import { homedir } from 'os'
import { execFileSync, execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { app as electronApp } from 'electron'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { DirectoryOpenAppId, DirectoryOpenAppInfo, OpenDirectoryWithAppInput } from '@craft-agent/shared/protocol'
import { getGitBashPath, setGitBashPath, clearGitBashPath } from '@craft-agent/shared/config'
import { classifyExternalUrl, formatBlockedUrlError } from '@craft-agent/shared/utils/url-safety'
import { isUsableGitBashPath, validateGitBashPath } from '@craft-agent/server-core/services'
import { validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import {
  requestClientOpenExternal,
  requestClientOpenPath,
  requestClientShowInFolder,
  requestClientOpenFileDialog,
} from '@craft-agent/server-core/transport'

export const CORE_HANDLED_CHANNELS = [
  RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  RPC_CHANNELS.system.VERSIONS,
  RPC_CHANNELS.system.HOME_DIR,
  RPC_CHANNELS.system.IS_DEBUG_MODE,
  RPC_CHANNELS.debug.LOG,
  RPC_CHANNELS.shell.OPEN_URL,
  RPC_CHANNELS.shell.OPEN_FILE,
  RPC_CHANNELS.shell.SHOW_IN_FOLDER,
  RPC_CHANNELS.releaseNotes.GET,
  RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION,
  RPC_CHANNELS.git.GET_BRANCH,
  RPC_CHANNELS.gitbash.CHECK,
  RPC_CHANNELS.gitbash.BROWSE,
  RPC_CHANNELS.gitbash.SET_PATH,
] as const

export const GUI_HANDLED_CHANNELS = [
  RPC_CHANNELS.update.CHECK,
  RPC_CHANNELS.update.GET_INFO,
  RPC_CHANNELS.update.INSTALL,
  RPC_CHANNELS.update.DISMISS,
  RPC_CHANNELS.update.GET_DISMISSED,
  RPC_CHANNELS.badge.REFRESH,
  RPC_CHANNELS.badge.SET_ICON,
  RPC_CHANNELS.window.GET_FOCUS_STATE,
  RPC_CHANNELS.notification.SHOW,
  RPC_CHANNELS.notification.GET_ENABLED,
  RPC_CHANNELS.notification.SET_ENABLED,
  RPC_CHANNELS.shell.LIST_DIRECTORY_OPEN_APPS,
  RPC_CHANNELS.shell.OPEN_DIRECTORY_WITH_APP,
  RPC_CHANNELS.menu.QUIT,
  RPC_CHANNELS.menu.NEW_WINDOW,
  RPC_CHANNELS.menu.MINIMIZE,
  RPC_CHANNELS.menu.MAXIMIZE,
  RPC_CHANNELS.menu.ZOOM_IN,
  RPC_CHANNELS.menu.ZOOM_OUT,
  RPC_CHANNELS.menu.ZOOM_RESET,
  RPC_CHANNELS.menu.TOGGLE_DEV_TOOLS,
  RPC_CHANNELS.menu.UNDO,
  RPC_CHANNELS.menu.REDO,
  RPC_CHANNELS.menu.CUT,
  RPC_CHANNELS.menu.COPY,
  RPC_CHANNELS.menu.PASTE,
  RPC_CHANNELS.menu.SELECT_ALL,
] as const

export const HANDLED_CHANNELS = [
  ...CORE_HANDLED_CHANNELS,
  ...GUI_HANDLED_CHANNELS,
] as const

interface DirectoryOpenAppDefinition {
  id: DirectoryOpenAppId
  name: string
  bundleNames: string[]
  bundleIdentifiers: string[]
  iconCandidates?: string[]
  openArgs: (path: string) => string[]
}

function appCandidatePaths(bundleName: string): string[] {
  return [
    join('/Applications', bundleName),
    join(homedir(), 'Applications', bundleName),
  ]
}

const DIRECTORY_OPEN_APPS: DirectoryOpenAppDefinition[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    bundleNames: ['Visual Studio Code.app'],
    bundleIdentifiers: ['com.microsoft.VSCode'],
    openArgs: path => ['-a', 'Visual Studio Code', path],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bundleNames: ['Cursor.app'],
    bundleIdentifiers: ['com.todesktop.230313mzl4w4u92'],
    openArgs: path => ['-a', 'Cursor', path],
  },
  {
    id: 'zed',
    name: 'Zed',
    bundleNames: ['Zed.app'],
    bundleIdentifiers: ['dev.zed.Zed'],
    openArgs: path => ['-a', 'Zed', path],
  },
  {
    id: 'finder',
    name: 'Finder',
    bundleNames: ['Finder.app'],
    bundleIdentifiers: ['com.apple.finder'],
    iconCandidates: ['/System/Library/CoreServices/Finder.app'],
    openArgs: path => [path],
  },
  {
    id: 'terminal',
    name: 'Terminal',
    bundleNames: ['Terminal.app'],
    bundleIdentifiers: ['com.apple.Terminal'],
    iconCandidates: ['/System/Applications/Utilities/Terminal.app', '/Applications/Utilities/Terminal.app'],
    openArgs: path => ['-a', 'Terminal', path],
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    bundleNames: ['Ghostty.app'],
    bundleIdentifiers: ['com.mitchellh.ghostty'],
    openArgs: path => ['-a', 'Ghostty', path],
  },
  {
    id: 'warp',
    name: 'Warp',
    bundleNames: ['Warp.app'],
    bundleIdentifiers: ['dev.warp.Warp-Stable'],
    openArgs: path => ['-a', 'Warp', path],
  },
  {
    id: 'xcode',
    name: 'Xcode',
    bundleNames: ['Xcode.app'],
    bundleIdentifiers: ['com.apple.dt.Xcode'],
    openArgs: path => ['-a', 'Xcode', path],
  },
]

function findDirectoryOpenAppDefinition(appId: DirectoryOpenAppId): DirectoryOpenAppDefinition | undefined {
  return DIRECTORY_OPEN_APPS.find(app => app.id === appId)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function findExistingCandidate(candidates: readonly string[]): string | undefined {
  return candidates.find(candidate => existsSync(candidate))
}

function querySpotlightApplications(query: string): string[] {
  if (process.platform !== 'darwin') return []
  try {
    return execFileSync('/usr/bin/mdfind', [query], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })
      .split('\n')
      .map(path => path.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function findDirectoryOpenAppBundle(definition: DirectoryOpenAppDefinition): string | undefined {
  const directCandidates = uniqueStrings([
    ...(definition.iconCandidates ?? []),
    ...definition.bundleNames.flatMap(appCandidatePaths),
  ])
  const directMatch = findExistingCandidate(directCandidates)
  if (directMatch) return directMatch

  for (const bundleIdentifier of definition.bundleIdentifiers) {
    const match = findExistingCandidate(querySpotlightApplications(`kMDItemCFBundleIdentifier == "${bundleIdentifier}"`))
    if (match) return match
  }

  for (const bundleName of definition.bundleNames) {
    const match = findExistingCandidate(querySpotlightApplications(`kMDItemKind == "Application" && kMDItemFSName == "${bundleName}"`))
    if (match) return match
  }

  return undefined
}

function readBundlePlistString(appPath: string, key: 'CFBundleIconFile' | 'CFBundleIconName'): string | undefined {
  try {
    return execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, join(appPath, 'Contents', 'Info.plist')], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim() || undefined
  } catch {
    return undefined
  }
}

function candidateIconFileNames(appPath: string): string[] {
  const plistNames = [
    readBundlePlistString(appPath, 'CFBundleIconFile'),
    readBundlePlistString(appPath, 'CFBundleIconName'),
  ].filter(Boolean) as string[]

  const normalizedPlistNames = plistNames.flatMap(name => {
    const extension = extname(name)
    return extension ? [name] : [`${name}.icns`, `${name}.png`]
  })

  let resourceIconNames: string[] = []
  try {
    resourceIconNames = readdirSync(join(appPath, 'Contents', 'Resources'))
      .filter(name => name.endsWith('.icns') || name.endsWith('.png'))
      .sort((a, b) => {
        const appName = basename(appPath, '.app').toLowerCase()
        const aScore = a.toLowerCase().includes(appName) || a.toLowerCase().includes('appicon') ? 0 : 1
        const bScore = b.toLowerCase().includes(appName) || b.toLowerCase().includes('appicon') ? 0 : 1
        return aScore - bScore || a.localeCompare(b)
      })
  } catch {
    resourceIconNames = []
  }

  return uniqueStrings([...normalizedPlistNames, ...resourceIconNames])
}

function findBundleIconFile(appPath: string): string | undefined {
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  return findExistingCandidate(candidateIconFileNames(appPath).map(name => join(resourcesPath, name)))
}

function pngDataUrlFromFile(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`
}

function buildIconPngCachePath(definition: DirectoryOpenAppDefinition): string {
  const cacheDir = join(electronApp.getPath('userData'), 'directory-open-app-icons')
  mkdirSync(cacheDir, { recursive: true })
  return join(cacheDir, `${definition.id}.png`)
}

function buildIconDataUrlFromBundle(appPath: string, definition: DirectoryOpenAppDefinition): string | undefined {
  const iconPath = findBundleIconFile(appPath)
  if (!iconPath) return undefined

  if (iconPath.endsWith('.png')) {
    return pngDataUrlFromFile(iconPath)
  }

  if (!iconPath.endsWith('.icns') || process.platform !== 'darwin') return undefined

  try {
    const outputPath = buildIconPngCachePath(definition)
    execFileSync('/usr/bin/sips', ['-Z', '64', '-s', 'format', 'png', iconPath, '--out', outputPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 2000,
    })
    if (existsSync(outputPath)) return pngDataUrlFromFile(outputPath)
  } catch {
    return undefined
  }

  return undefined
}

async function buildDirectoryOpenAppInfo(definition: DirectoryOpenAppDefinition): Promise<DirectoryOpenAppInfo> {
  const appPath = findDirectoryOpenAppBundle(definition)
  let iconDataUrl: string | undefined
  if (appPath) {
    iconDataUrl = buildIconDataUrlFromBundle(appPath, definition)
    if (!iconDataUrl) {
      try {
        iconDataUrl = (await electronApp.getFileIcon(appPath, { size: 'normal' })).toDataURL()
      } catch {
        iconDataUrl = undefined
      }
    }
  }
  return {
    id: definition.id,
    name: definition.name,
    iconDataUrl,
    available: Boolean(appPath),
  }
}

function spawnOpen(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('/usr/bin/open', args, {
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`/usr/bin/open exited with code ${code ?? 'unknown'}`))
    })
  })
}

export function registerSystemCoreHandlers(server: RpcServer, deps: HandlerDeps): void {
  const windowManager = deps.windowManager

  // Get system theme preference (dark = true, light = false)
  server.handle(RPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, async () => {
    return deps.platform.systemDarkMode?.() ?? false
  })

  // Get runtime versions (previously handled locally in preload via process.versions)
  server.handle(RPC_CHANNELS.system.VERSIONS, async () => {
    return {
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
    }
  })

  // Get user's home directory
  server.handle(RPC_CHANNELS.system.HOME_DIR, async () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  server.handle(RPC_CHANNELS.system.IS_DEBUG_MODE, async () => {
    return !deps.platform.isPackaged
  })

  // Release notes
  server.handle(RPC_CHANNELS.releaseNotes.GET, async () => {
    const { getCombinedReleaseNotes } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getCombinedReleaseNotes()
  })

  server.handle(RPC_CHANNELS.releaseNotes.GET_LATEST_VERSION, async () => {
    const { getLatestReleaseVersion } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getLatestReleaseVersion()
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  server.handle(RPC_CHANNELS.git.GET_BRANCH, async (_ctx, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      return branch || null
    } catch {
      return null
    }
  })

  // Git Bash detection and configuration (Windows only)
  server.handle(RPC_CHANNELS.gitbash.CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'

    if (platform !== 'win32') {
      return { found: true, path: null, platform }
    }

    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ]

    const persistedPath = getGitBashPath()
    if (persistedPath) {
      if (await isUsableGitBashPath(persistedPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = persistedPath.trim()
        return { found: true, path: persistedPath, platform }
      }
      clearGitBashPath()
    }

    for (const bashPath of commonPaths) {
      if (await isUsableGitBashPath(bashPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
        setGitBashPath(bashPath)
        return { found: true, path: bashPath, platform }
      }
    }

    try {
      const result = execSync('where bash', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const firstPath = result.split('\n')[0]?.trim()
      if (firstPath && firstPath.toLowerCase().includes('git') && await isUsableGitBashPath(firstPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = firstPath
        setGitBashPath(firstPath)
        return { found: true, path: firstPath, platform }
      }
    } catch {
      // where command failed
    }

    delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    return { found: false, path: null, platform }
  })

  server.handle(RPC_CHANNELS.gitbash.BROWSE, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      title: 'Select bash.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files\\Git\\bin',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  server.handle(RPC_CHANNELS.gitbash.SET_PATH, async (_ctx, bashPath: string) => {
    const validation = await validateGitBashPath(bashPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    setGitBashPath(validation.path)
    process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
    return { success: true }
  })

  // Debug logging from renderer -> main log file (fire-and-forget, no response)
  server.handle(RPC_CHANNELS.debug.LOG, async (_ctx, ...args: unknown[]) => {
    deps.platform.logger.info('[renderer]', ...args)
  })

  // Shell operations - open URL in external browser (or handle craftagents:// internally)
  server.handle(RPC_CHANNELS.shell.OPEN_URL, async (ctx, url: string) => {
    deps.platform.logger.info('[OPEN_URL] Received request:', url)
    try {
      const classification = classifyExternalUrl(url)
      if (classification.kind === 'dangerous') {
        throw new Error(formatBlockedUrlError(classification))
      }

      // Handle craftagents:// URLs internally via deep link handler (GUI only)
      if (classification.kind === 'internal-deeplink') {
        if (!windowManager) return
        deps.platform.logger.info('[OPEN_URL] Handling as deep link')
        const { handleDeepLink } = await import('../deep-link')
        const resolver = (wcId: number) => windowManager.getClientIdForWindow(wcId)
        const result = await handleDeepLink(url, windowManager, server.push.bind(server), resolver, ctx.clientId)
        deps.platform.logger.info('[OPEN_URL] Deep link result:', result)
        return
      }

      const result = await requestClientOpenExternal(server, ctx.clientId, url)
      if (!result.opened) {
        deps.platform.logger.error(`[OPEN_URL] Client capability failed: ${result.error}`)
        throw new Error(`Cannot open URL on client: ${result.error}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.OPEN_FILE, async (ctx, path: string) => {
    try {
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(workspaceId))
      const result = await requestClientOpenPath(server, ctx.clientId, safePath)
      if (result.error) throw new Error(result.error)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  server.handle(RPC_CHANNELS.shell.SHOW_IN_FOLDER, async (ctx, path: string) => {
    try {
      const expanded = path.startsWith('~') ? path.replace(/^~/, homedir()) : path
      const absolutePath = resolve(expanded)
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(workspaceId))
      await requestClientShowInFolder(server, ctx.clientId, safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })

}

export function registerSystemGuiHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps
  const windowManager = deps.windowManager

  server.handle(RPC_CHANNELS.shell.LIST_DIRECTORY_OPEN_APPS, async () => {
    return Promise.all(DIRECTORY_OPEN_APPS.map(buildDirectoryOpenAppInfo))
  })

  server.handle(RPC_CHANNELS.shell.OPEN_DIRECTORY_WITH_APP, async (ctx, input: OpenDirectoryWithAppInput) => {
    try {
      const definition = findDirectoryOpenAppDefinition(input.appId)
      if (!definition) {
        throw new Error(`Unsupported app: ${input.appId}`)
      }
      if (process.platform !== 'darwin') {
        throw new Error('Opening directories with a selected app is currently supported on macOS only')
      }

      const expanded = input.path.startsWith('~') ? input.path.replace(/^~/, homedir()) : input.path
      const absolutePath = resolve(expanded)
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(absolutePath, getWorkspaceAllowedDirs(workspaceId))
      await spawnOpen(definition.openArgs(safePath))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('openDirectoryWithApp error:', message)
      throw new Error(`Failed to open directory: ${message}`)
    }
  })

  // Auto-update handlers
  server.handle(RPC_CHANNELS.update.CHECK, async () => {
    const { checkForUpdates } = await import('../auto-update')
    return checkForUpdates({ autoDownload: false })
  })

  server.handle(RPC_CHANNELS.update.GET_INFO, async () => {
    const { getUpdateInfo } = await import('../auto-update')
    return getUpdateInfo()
  })

  server.handle(RPC_CHANNELS.update.INSTALL, async () => {
    const { installUpdate } = await import('../auto-update')
    return installUpdate()
  })

  server.handle(RPC_CHANNELS.update.DISMISS, async (_ctx, version: string) => {
    const { setDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    setDismissedUpdateVersion(version)
  })

  server.handle(RPC_CHANNELS.update.GET_DISMISSED, async () => {
    const { getDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    return getDismissedUpdateVersion()
  })

  // Menu actions from renderer (for unified Craft menu)
  server.handle(RPC_CHANNELS.menu.QUIT, async () => {
    deps.platform.quit?.()
  })

  server.handle(RPC_CHANNELS.menu.NEW_WINDOW, async (ctx) => {
    if (!windowManager) return
    const workspaceId = ctx.workspaceId ?? windowManager.getWorkspaceForWindow(ctx.webContentsId!)
    if (workspaceId) {
      windowManager.createWindow({ workspaceId })
    }
  })

  server.handle(RPC_CHANNELS.menu.MINIMIZE, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.minimize()
  })

  server.handle(RPC_CHANNELS.menu.MAXIMIZE, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  server.handle(RPC_CHANNELS.menu.ZOOM_IN, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0))
    }
  })

  server.handle(RPC_CHANNELS.menu.ZOOM_OUT, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5))
    }
  })

  server.handle(RPC_CHANNELS.menu.ZOOM_RESET, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.setZoomFactor(1.0)
  })

  server.handle(RPC_CHANNELS.menu.TOGGLE_DEV_TOOLS, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.toggleDevTools()
  })

  server.handle(RPC_CHANNELS.menu.UNDO, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.undo()
  })

  server.handle(RPC_CHANNELS.menu.REDO, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.redo()
  })

  server.handle(RPC_CHANNELS.menu.CUT, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.cut()
  })

  server.handle(RPC_CHANNELS.menu.COPY, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.copy()
  })

  server.handle(RPC_CHANNELS.menu.PASTE, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.paste()
  })

  server.handle(RPC_CHANNELS.menu.SELECT_ALL, async (ctx) => {
    if (!windowManager) return
    const win = windowManager.getWindowByWebContentsId(ctx.webContentsId!)
    win?.webContents.selectAll()
  })

  // Notifications
  server.handle(RPC_CHANNELS.notification.SHOW, async (_ctx, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('../notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  server.handle(RPC_CHANNELS.notification.GET_ENABLED, async () => {
    const { getNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    return getNotificationsEnabled()
  })

  server.handle(RPC_CHANNELS.notification.SET_ENABLED, async (_ctx, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    setNotificationsEnabled(enabled)

    if (enabled) {
      const { showNotification } = await import('../notifications')
      showNotification('Notifications enabled', 'You will be notified when tasks complete.', '', '')
    }
  })

  // Badge and window focus
  server.handle(RPC_CHANNELS.badge.REFRESH, async () => {
    try {
      await sessionManager.waitForInit()
    } catch {
      // continue
    }
    sessionManager.refreshBadge()
  })

  server.handle(RPC_CHANNELS.badge.SET_ICON, async (_ctx, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('../notifications')
    setDockIconWithBadge(dataUrl)
  })

  server.handle(RPC_CHANNELS.window.GET_FOCUS_STATE, async () => {
    const { isAnyWindowFocused } = require('../notifications')
    return isAnyWindowFocused()
  })
}

export function registerSystemHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerSystemCoreHandlers(server, deps)
  registerSystemGuiHandlers(server, deps)
}
