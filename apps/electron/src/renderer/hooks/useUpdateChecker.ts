/**
 * Update Checker Hook
 *
 * Manages update availability state for the Electron app.
 * - Listens for update availability broadcasts from main process
 * - Tracks download progress if electron-updater emits it unexpectedly
 * - Provides a method to check for updates
 * - Shows toast notification when an update is available
 * - Persistent dismissal across app restarts (per version)
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UpdateInfo } from '../../shared/types'

interface UseUpdateCheckerResult {
  /** Current update info */
  updateInfo: UpdateInfo | null
  /** Whether an update is available */
  updateAvailable: boolean
  /** Whether update is currently downloading */
  isDownloading: boolean
  /** Download progress (0-100) */
  downloadProgress: number
  /** Check for updates manually */
  checkForUpdates: () => Promise<void>
}

// Toast ID for update notification (allows dismiss/update)
const UPDATE_TOAST_ID = 'update-available'

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  // Track if we've shown the toast for this version to avoid duplicates
  const shownToastVersionRef = useRef<string | null>(null)

  // Show toast notification when an update is available
  const showUpdateToast = useCallback((version: string) => {
    // Don't show if already shown for this version in this session
    if (shownToastVersionRef.current === version) {
      return
    }
    shownToastVersionRef.current = version

    toast.info(t('toast.updateReady', { version }), {
      id: UPDATE_TOAST_ID,
      description: t('toast.restartToApply'),
      duration: 10000, // 10 seconds, then auto-dismiss
      onDismiss: () => {
        // Persist dismissal so we don't show again after app restart
        window.electronAPI.dismissUpdate(version)
      },
    })
  }, [t])

  // Load initial state and check if update is available
  useEffect(() => {
    const checkAndNotify = async (info: UpdateInfo) => {
      if (!info.available || !info.latestVersion) return

      // Check if this version was dismissed
      const dismissedVersion = await window.electronAPI.getDismissedUpdateVersion()
      if (dismissedVersion === info.latestVersion) {
        return
      }

      // Show toast for available update
      showUpdateToast(info.latestVersion)
    }

    // Get initial update info
    window.electronAPI.getUpdateInfo().then((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    // Subscribe to update availability changes
    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    // Subscribe to download progress updates
    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: progress } : prev)
    })

    return () => {
      cleanupAvailable()
      cleanupProgress()
    }
  }, [showUpdateToast])

  // Check for updates manually
  const checkForUpdates = useCallback(async () => {
    try {
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)

      if (!info.available) {
        toast.success(t('toast.upToDate'), {
          description: t('toast.versionIsLatest', { version: info.currentVersion }),
          duration: 3000,
        })
      } else if (info.latestVersion) {
        // Show availability notification (clear any previous dismissal since user explicitly checked)
        shownToastVersionRef.current = null // Reset so toast can show again
        showUpdateToast(info.latestVersion)
      }
    } catch (error) {
      console.error('[useUpdateChecker] Check failed:', error)
      toast.error(t('toast.failedToCheckUpdates'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [showUpdateToast, t])

  return {
    updateInfo,
    updateAvailable: updateInfo?.available ?? false,
    isDownloading: updateInfo?.downloadState === 'downloading',
    downloadProgress: updateInfo?.downloadProgress ?? 0,
    checkForUpdates,
  }
}
