import type { AgentProfileDetail } from '../agent-profiles.ts'
import type { LoadedSkill } from '../skills/types.ts'

export type StorePackageType = 'skill' | 'agent'
export type StoreSkillConflictStrategy = 'fail' | 'overwrite' | 'copy' | 'reuse'

export interface StorePackageAuthor {
  id?: string
  name: string
}

export interface StorePackageCompat {
  minAppVersion?: string
}

export interface StorePackageSkillRef {
  slug: string
  version: string
}

export interface StorePermissionsSummary {
  alwaysAllow?: string[]
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  bundledFiles?: string[]
}

export interface StoreRequiredSource {
  slug: string
  type?: string
  hint?: string
}

export interface StorePackageManifest {
  schemaVersion: 1
  type: StorePackageType
  packageId: string
  version: string
  name: string
  description: string
  author?: StorePackageAuthor
  compat?: StorePackageCompat
  contents: {
    agent?: boolean
    skills?: StorePackageSkillRef[]
  }
  requiredSources?: StoreRequiredSource[]
  requiredEnv?: string[]
  permissionsSummary?: StorePermissionsSummary
  checksums?: Record<string, string>
}

export interface StorePackageSummary {
  id: string
  type: StorePackageType
  name: string
  description?: string
  author?: StorePackageAuthor
  version: string
  downloads?: number
  updatedAt?: string | number
  compat?: StorePackageCompat
}

export interface StorePackageDetail extends StorePackageSummary {
  readme?: string
  changelog?: string
  versions?: string[]
  manifest?: StorePackageManifest
  sha256?: string
  downloadUrl?: string
}

export interface StoreListPackagesInput {
  registryUrl?: string
  type?: StorePackageType
  q?: string
  sort?: string
  page?: number
}

export interface StoreGetPackageInput {
  registryUrl?: string
  packageId: string
}

export interface StoreInstallPackageInput {
  registryUrl?: string
  packageId?: string
  version?: string
  downloadUrl?: string
  expectedSha256?: string
  conflictStrategy?: StoreSkillConflictStrategy
  allowAlwaysAllow?: boolean
  sourceSlugMap?: Record<string, string>
}

export interface StoreUninstallPackageInput {
  packageKey: string
  force?: boolean
}

export interface StoreSkillInstallResult {
  slug: string
  version?: string
  hash: string
  action: 'installed' | 'updated' | 'reused' | 'copied'
  loadedSkill?: LoadedSkill
  strippedAlwaysAllow?: boolean
}

export interface StoreInstallPackageResult {
  packageKey: string
  manifest: StorePackageManifest
  skills: StoreSkillInstallResult[]
  agentProfile?: AgentProfileDetail
  missingSources?: StoreRequiredSource[]
  warnings: string[]
}

export interface StoreInstalledSkillReceipt {
  slug: string
  version?: string
  hash: string
  reused: boolean
}

export interface StoreInstalledPackageReceipt {
  type: StorePackageType
  packageId: string
  version: string
  registry: string
  installedAt: number
  updatedAt: number
  agentProfileId?: string
  agentProfileHash?: string
  skills: StoreInstalledSkillReceipt[]
  requiredSources?: StoreRequiredSource[]
  contentHashes: Record<string, string>
}

export interface StoreReceiptsFile {
  version: 1
  installedPackages: Record<string, StoreInstalledPackageReceipt>
}
