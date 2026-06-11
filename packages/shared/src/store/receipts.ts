import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts'
import type { StoreInstalledPackageReceipt, StoreReceiptsFile } from './types.ts'

const RECEIPTS_VERSION = 1 as const

export function getStoreDir(workspaceRoot: string): string {
  return join(workspaceRoot, 'store')
}

export function getStoreReceiptsPath(workspaceRoot: string): string {
  return join(getStoreDir(workspaceRoot), 'receipts.json')
}

export function getStorePackageKey(registryUrl: string, packageId: string): string {
  return `${registryUrl.replace(/\/+$/, '')}::${packageId}`
}

export function loadStoreReceipts(workspaceRoot: string): StoreReceiptsFile {
  const path = getStoreReceiptsPath(workspaceRoot)
  if (!existsSync(path)) {
    return { version: RECEIPTS_VERSION, installedPackages: {} }
  }
  try {
    const parsed = readJsonFileSync<StoreReceiptsFile>(path)
    if (parsed?.version === RECEIPTS_VERSION && parsed.installedPackages && typeof parsed.installedPackages === 'object') {
      return parsed
    }
  } catch {
    // Fall through to empty receipts. Corrupt files are not auto-deleted.
  }
  return { version: RECEIPTS_VERSION, installedPackages: {} }
}

export function saveStoreReceipts(workspaceRoot: string, receipts: StoreReceiptsFile): void {
  mkdirSync(getStoreDir(workspaceRoot), { recursive: true })
  atomicWriteFileSync(getStoreReceiptsPath(workspaceRoot), JSON.stringify({
    version: RECEIPTS_VERSION,
    installedPackages: receipts.installedPackages ?? {},
  }, null, 2))
}

export function upsertStoreReceipt(
  workspaceRoot: string,
  packageKey: string,
  receipt: StoreInstalledPackageReceipt,
): StoreReceiptsFile {
  const receipts = loadStoreReceipts(workspaceRoot)
  receipts.installedPackages[packageKey] = receipt
  saveStoreReceipts(workspaceRoot, receipts)
  return receipts
}

export function removeStoreReceipt(workspaceRoot: string, packageKey: string): StoreReceiptsFile {
  const receipts = loadStoreReceipts(workspaceRoot)
  delete receipts.installedPackages[packageKey]
  saveStoreReceipts(workspaceRoot, receipts)
  return receipts
}
