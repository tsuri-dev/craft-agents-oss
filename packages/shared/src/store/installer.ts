import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import matter from 'gray-matter'
import * as tar from 'tar'
import type { AgentProfile, AgentProfileDetail } from '../agent-profiles.ts'
import type { PermissionMode } from '../agent/mode-types.ts'
import type { ThinkingLevel } from '../agent/thinking-levels.ts'
import { deleteSkill, invalidateSkillsCache, loadSkill } from '../skills/index.ts'
import { loadWorkspaceSources } from '../sources/index.ts'
import { getWorkspaceSkillsPath } from '../workspaces/index.ts'
import { parseStorePackageManifest, getSkillPackageRef } from './manifest.ts'
import { downloadStorePackage, resolveStoreRegistryUrl } from './registry.ts'
import {
  getStorePackageKey,
  loadStoreReceipts,
  removeStoreReceipt,
  upsertStoreReceipt,
} from './receipts.ts'
import type {
  StoreInstallPackageInput,
  StoreInstallPackageResult,
  StoreInstalledPackageReceipt,
  StoreRequiredSource,
  StoreSkillConflictStrategy,
} from './types.ts'

const MAX_PACKAGE_FILES = 200
const MAX_PACKAGE_BYTES = 10 * 1024 * 1024
const TEXT_SCAN_BYTES = 256 * 1024
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(['low', 'medium', 'high', 'xhigh', 'max'])
const VALID_PERMISSION_MODES = new Set<PermissionMode>(['safe', 'ask', 'allow-all'])

interface WalkEntry {
  absPath: string
  relPath: string
  isDirectory: boolean
  size: number
}

interface ExtractedPackage {
  rootDir: string
  contentHashes: Record<string, string>
}

interface InstalledAgentResult {
  profile: AgentProfileDetail
  hash: string
  missingSources: StoreRequiredSource[]
}

export async function installStorePackage(
  workspaceRoot: string,
  input: StoreInstallPackageInput,
): Promise<StoreInstallPackageResult> {
  const registryUrl = input.registryUrl ? resolveStoreRegistryUrl(input.registryUrl) : resolveStoreRegistryUrl(undefined)
  const packageId = input.packageId
  const version = input.version
  if (!packageId && !input.downloadUrl) throw new Error('packageId is required when downloadUrl is not provided')
  if (!version && !input.downloadUrl) throw new Error('version is required when downloadUrl is not provided')

  const bytes = await downloadStorePackage({
    registryUrl,
    packageId: packageId ?? 'direct-package',
    version: version ?? '0.0.0',
    downloadUrl: input.downloadUrl,
  })
  if (input.expectedSha256) assertSha256(bytes, input.expectedSha256)

  const extracted = await extractStorePackage(bytes)
  try {
    const manifestPath = join(extracted.rootDir, 'manifest.json')
    if (!existsSync(manifestPath)) throw new Error('Package is missing manifest.json')
    const manifest = parseStorePackageManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    if (packageId && manifest.packageId !== packageId) {
      throw new Error(`Downloaded packageId mismatch: expected ${packageId}, got ${manifest.packageId}`)
    }
    if (version && manifest.version !== version) {
      throw new Error(`Downloaded version mismatch: expected ${version}, got ${manifest.version}`)
    }

    assertPackagePolicy(extracted.rootDir)

    const installedSkills = [] as StoreInstallPackageResult['skills']
    for (const skillRef of manifest.contents.skills ?? []) {
      const sourceSkillDir = join(extracted.rootDir, 'skills', skillRef.slug)
      const sourceSkillFile = join(sourceSkillDir, 'SKILL.md')
      if (!existsSync(sourceSkillFile)) {
        throw new Error(`Package is missing skills/${skillRef.slug}/SKILL.md`)
      }
      const skillFrontmatter = matter(readFileSync(sourceSkillFile, 'utf-8')).data
      if (skillFrontmatter.version !== skillRef.version) {
        throw new Error(`SKILL.md version must match manifest skill version (${skillRef.version})`)
      }

      const installDecision = decideSkillInstall(workspaceRoot, manifest.packageId, skillRef.slug, input.conflictStrategy ?? 'fail')
      const stripAlwaysAllow = input.allowAlwaysAllow !== true
      const installResult = installSkillDirectory(workspaceRoot, sourceSkillDir, {
        slug: installDecision.slug,
        overwrite: installDecision.overwrite,
        stripAlwaysAllow,
      })
      const installedHash = hashDirectory(installResult.loadedSkill.path)
      installedSkills.push({
        slug: installResult.loadedSkill.slug,
        version: installResult.loadedSkill.metadata.version,
        hash: installedHash,
        action: installDecision.action,
        loadedSkill: installResult.loadedSkill,
        strippedAlwaysAllow: installResult.strippedAlwaysAllow,
      })
    }

    const installedAgent = manifest.type === 'agent'
      ? installAgentProfile(workspaceRoot, extracted.rootDir, manifest.packageId, {
        installedSkillSlugs: installedSkills.map(skill => skill.slug),
        requiredSources: manifest.requiredSources ?? [],
        sourceSlugMap: input.sourceSlugMap ?? {},
      })
      : undefined

    const packageKey = getStorePackageKey(registryUrl, manifest.packageId)
    const now = Date.now()
    const previousReceipt = loadStoreReceipts(workspaceRoot).installedPackages[packageKey]
    const receipt: StoreInstalledPackageReceipt = {
      type: manifest.type,
      packageId: manifest.packageId,
      version: manifest.version,
      registry: registryUrl,
      installedAt: previousReceipt?.installedAt ?? now,
      updatedAt: now,
      agentProfileId: installedAgent?.profile.id,
      agentProfileHash: installedAgent?.hash,
      skills: installedSkills.map(skill => ({
        slug: skill.slug,
        version: skill.version,
        hash: skill.hash,
        reused: skill.action === 'reused',
      })),
      requiredSources: manifest.requiredSources,
      contentHashes: extracted.contentHashes,
    }
    upsertStoreReceipt(workspaceRoot, packageKey, receipt)

    const warnings: string[] = []
    if (installedSkills.some(skill => skill.strippedAlwaysAllow)) {
      warnings.push('Removed alwaysAllow from SKILL.md during install. Users can re-enable permissions manually after review.')
    }
    if (installedAgent?.missingSources.length) {
      warnings.push(`Missing required sources: ${installedAgent.missingSources.map(source => source.slug).join(', ')}`)
    }

    return {
      packageKey,
      manifest,
      skills: installedSkills,
      agentProfile: installedAgent?.profile,
      missingSources: installedAgent?.missingSources ?? [],
      warnings,
    }
  } finally {
    rmSync(extracted.rootDir, { recursive: true, force: true })
  }
}

export async function installStoreSkillPackage(
  workspaceRoot: string,
  input: StoreInstallPackageInput,
): Promise<StoreInstallPackageResult> {
  return installStorePackage(workspaceRoot, input)
}

export function listInstalledStorePackages(workspaceRoot: string) {
  return loadStoreReceipts(workspaceRoot).installedPackages
}

export function uninstallStorePackage(workspaceRoot: string, input: { packageKey: string; force?: boolean }): void {
  const receipts = loadStoreReceipts(workspaceRoot)
  const receipt = receipts.installedPackages[input.packageKey]
  if (!receipt) throw new Error(`Store package is not installed: ${input.packageKey}`)

  if (receipt.agentProfileId) {
    const agentDir = getAgentProfileDir(workspaceRoot, receipt.agentProfileId)
    if (existsSync(agentDir)) {
      const currentHash = hashDirectory(agentDir)
      if (!input.force && receipt.agentProfileHash && currentHash !== receipt.agentProfileHash) {
        throw new Error(`Agent profile ${receipt.agentProfileId} has local modifications. Pass force to uninstall anyway.`)
      }
      rmSync(agentDir, { recursive: true, force: true })
    }
  }

  for (const skill of receipt.skills) {
    const otherReference = Object.entries(receipts.installedPackages).some(([key, other]) => {
      if (key === input.packageKey) return false
      return other.skills.some(entry => entry.slug === skill.slug)
    })
    if (otherReference) continue

    const loaded = loadSkill(workspaceRoot, skill.slug)
    if (!loaded) continue
    const currentHash = hashDirectory(loaded.path)
    if (!input.force && currentHash !== skill.hash) {
      throw new Error(`Skill ${skill.slug} has local modifications. Pass force to uninstall anyway.`)
    }
    deleteSkill(workspaceRoot, skill.slug)
  }

  removeStoreReceipt(workspaceRoot, input.packageKey)
}

function decideSkillInstall(
  workspaceRoot: string,
  packageId: string,
  slug: string,
  strategy: StoreSkillConflictStrategy,
): { slug: string; overwrite: boolean; action: 'installed' | 'updated' | 'reused' | 'copied' } {
  const existing = loadSkill(workspaceRoot, slug)
  if (!existing) return { slug, overwrite: false, action: 'installed' }

  const receipts = loadStoreReceipts(workspaceRoot)
  const receiptEntry = Object.values(receipts.installedPackages)
    .flatMap(receipt => receipt.skills.map(skill => ({ receipt, skill })))
    .find(entry => entry.skill.slug === slug)
  const currentHash = hashDirectory(existing.path)
  const isStoreManagedAndClean = !!receiptEntry && receiptEntry.skill.hash === currentHash

  if (strategy === 'reuse') return { slug, overwrite: false, action: 'reused' }
  if (strategy === 'copy') {
    return { slug: uniqueSkillSlug(workspaceRoot, slug), overwrite: false, action: 'copied' }
  }
  if (strategy === 'overwrite') return { slug, overwrite: true, action: 'updated' }
  if (isStoreManagedAndClean) return { slug, overwrite: true, action: 'updated' }

  throw new Error(
    `Skill ${slug} already exists and is not a clean store-managed install for ${packageId}. `
    + 'Choose overwrite or copy to continue.',
  )
}

function installSkillDirectory(
  workspaceRoot: string,
  sourceDir: string,
  options: { slug: string; overwrite: boolean; stripAlwaysAllow: boolean },
) {
  const skillsRoot = getWorkspaceSkillsPath(workspaceRoot)
  const targetDir = join(skillsRoot, options.slug)
  if (existsSync(targetDir)) {
    if (!options.overwrite) throw new Error(`Skill already exists: ${options.slug}`)
    rmSync(targetDir, { recursive: true, force: true })
  }
  mkdirSync(targetDir, { recursive: true })

  let strippedAlwaysAllow = false
  for (const entry of walk(sourceDir)) {
    const destination = join(targetDir, entry.relPath)
    if (entry.isDirectory) {
      mkdirSync(destination, { recursive: true })
      continue
    }
    mkdirSync(dirname(destination), { recursive: true })
    if (entry.relPath === 'SKILL.md' && options.stripAlwaysAllow) {
      const parsed = matter(readFileSync(entry.absPath, 'utf-8'))
      if ('alwaysAllow' in parsed.data) {
        delete parsed.data.alwaysAllow
        strippedAlwaysAllow = true
      }
      writeFileSync(destination, matter.stringify(parsed.content, parsed.data), 'utf-8')
    } else {
      copyFileSync(entry.absPath, destination)
    }
  }

  invalidateSkillsCache()
  const loadedSkill = loadSkill(workspaceRoot, options.slug)
  if (!loadedSkill) throw new Error(`Installed skill could not be loaded: ${options.slug}`)
  return { loadedSkill, strippedAlwaysAllow }
}

function installAgentProfile(
  workspaceRoot: string,
  rootDir: string,
  packageId: string,
  options: {
    installedSkillSlugs: string[]
    requiredSources: StoreRequiredSource[]
    sourceSlugMap: Record<string, string>
  },
): InstalledAgentResult {
  const profilePath = join(rootDir, 'agent', 'profile.json')
  const instructionsPath = join(rootDir, 'agent', 'instructions.md')
  if (!existsSync(profilePath)) throw new Error('Agent package is missing agent/profile.json')
  if (!existsSync(instructionsPath)) throw new Error('Agent package is missing agent/instructions.md')

  const raw = JSON.parse(readFileSync(profilePath, 'utf-8')) as Partial<AgentProfile>
  if (raw.environmentVariables && Object.values(raw.environmentVariables).some(value => String(value ?? '').trim())) {
    throw new Error('Agent package profile must not contain environment variable values; use requiredEnv in manifest')
  }

  const sources = resolveRequiredSources(workspaceRoot, raw.sourceSlugs ?? [], options.requiredSources, options.sourceSlugMap)
  const now = Date.now()
  const id = uniqueAgentProfileId(workspaceRoot, slugifyAgentProfileId(raw.name || packageId || 'agent'))
  const profile: AgentProfile = {
    id,
    name: normalizeString(raw.name, packageId),
    description: typeof raw.description === 'string' ? raw.description : '',
    status: 'ready',
    visibility: 'workspace',
    connectionSlug: typeof raw.connectionSlug === 'string' ? raw.connectionSlug : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    thinkingLevel: VALID_THINKING_LEVELS.has(raw.thinkingLevel as ThinkingLevel) ? raw.thinkingLevel as ThinkingLevel : 'medium',
    permissionMode: clampPermissionMode(raw.permissionMode),
    skillSlugs: options.installedSkillSlugs,
    sourceSlugs: sources.satisfied,
    environmentVariables: {},
    createdAt: now,
    updatedAt: now,
  }
  const instructions = readFileSync(instructionsPath, 'utf-8')
  const agentDir = getAgentProfileDir(workspaceRoot, id)
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'profile.json'), `${JSON.stringify(profile, null, 2)}\n`, 'utf-8')
  writeFileSync(join(agentDir, 'instructions.md'), instructions, 'utf-8')

  return {
    profile: {
      ...profile,
      instructions,
      profilePath: join(agentDir, 'profile.json'),
      instructionsPath: join(agentDir, 'instructions.md'),
    },
    hash: hashDirectory(agentDir),
    missingSources: sources.missing,
  }
}

function resolveRequiredSources(
  workspaceRoot: string,
  packagedProfileSources: string[],
  requiredSources: StoreRequiredSource[],
  sourceSlugMap: Record<string, string>,
): { satisfied: string[]; missing: StoreRequiredSource[] } {
  const available = new Set(loadWorkspaceSources(workspaceRoot).map(source => source.config.slug))
  const requirements = new Map<string, StoreRequiredSource>()
  for (const slug of packagedProfileSources) requirements.set(slug, { slug })
  for (const source of requiredSources) requirements.set(source.slug, source)

  const satisfied: string[] = []
  const missing: StoreRequiredSource[] = []
  for (const requirement of requirements.values()) {
    const localSlug = sourceSlugMap[requirement.slug] ?? requirement.slug
    if (available.has(localSlug)) {
      if (!satisfied.includes(localSlug)) satisfied.push(localSlug)
    } else {
      missing.push(requirement)
    }
  }
  return { satisfied, missing }
}

async function extractStorePackage(bytes: Uint8Array): Promise<ExtractedPackage> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error(`Package exceeds max size of ${MAX_PACKAGE_BYTES} bytes`)
  }
  const rootDir = join(tmpdir(), `craft-store-${randomUUID()}`)
  mkdirSync(rootDir, { recursive: true })
  const tarPath = join(rootDir, 'package.tar.gz')
  writeFileSync(tarPath, bytes)

  let fileCount = 0
  let unpackedBytes = 0
  await tar.x({
    file: tarPath,
    cwd: rootDir,
    filter: (path, entry) => {
      const normalized = normalizePackagePath(path)
      if (!normalized) throw new Error(`Unsafe package path: ${path}`)
      const tarEntry = entry as { type?: string; size?: number }
      const type = String(tarEntry.type)
      if (type !== 'File' && type !== 'Directory') {
        throw new Error(`Unsupported tar entry type for ${path}: ${type}`)
      }
      fileCount += 1
      if (fileCount > MAX_PACKAGE_FILES) throw new Error(`Package exceeds max file count of ${MAX_PACKAGE_FILES}`)
      unpackedBytes += Number(tarEntry.size ?? 0)
      if (unpackedBytes > MAX_PACKAGE_BYTES) throw new Error(`Package exceeds max unpacked size of ${MAX_PACKAGE_BYTES} bytes`)
      return true
    },
  })
  rmSync(tarPath, { force: true })

  const contentHashes = computeFileHashes(rootDir)
  return { rootDir, contentHashes }
}

function assertPackagePolicy(rootDir: string): void {
  const entries = walk(rootDir)
  for (const entry of entries) {
    const rel = toPackagePath(entry.relPath)
    if (rel === 'package.tar.gz') continue
    if (rel === 'sources' || rel.startsWith('sources/')) {
      throw new Error('Store packages must not include source configuration')
    }
    if (rel === '.git' || rel.startsWith('.git/')) {
      throw new Error('Store packages must not include .git directories')
    }
    const base = basename(rel).toLowerCase()
    if (['.env', '.npmrc', '.netrc', 'credentials.json', 'secrets.json'].includes(base)) {
      throw new Error(`Store package contains a disallowed secret-like file: ${rel}`)
    }
    if (!entry.isDirectory && entry.size <= TEXT_SCAN_BYTES && isStructuredConfigFile(rel)) {
      assertNoSecretLikeFields(readFileSync(entry.absPath, 'utf-8'), rel)
    }
  }
}

function assertNoSecretLikeFields(content: string, relPath: string): void {
  const secretAssignment = /(^|\n)\s*(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*['\"]?[^\s'\"]{8,}/i
  if (secretAssignment.test(content)) {
    throw new Error(`Store package appears to contain a credential in ${relPath}`)
  }
}

function isStructuredConfigFile(path: string): boolean {
  return /\.(json|ya?ml|toml|env|ini)$/i.test(path)
}

function assertSha256(bytes: Uint8Array, expected: string): void {
  const normalizedExpected = expected.replace(/^sha256:/, '').toLowerCase()
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== normalizedExpected) {
    throw new Error(`Package sha256 mismatch: expected ${normalizedExpected}, got ${actual}`)
  }
}

function normalizePackagePath(path: string): string | null {
  const normalized = posix.normalize(path.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (posix.isAbsolute(normalized)) return null
  if (normalized.startsWith('../') || normalized.includes('/../')) return null
  return normalized
}

function walk(rootDir: string): WalkEntry[] {
  const result: WalkEntry[] = []
  function visit(absPath: string): void {
    const info = lstatSync(absPath)
    if (info.isSymbolicLink()) throw new Error(`Symlinks are not allowed in store packages: ${absPath}`)
    const relPath = toPackagePath(relative(rootDir, absPath))
    if (relPath) {
      result.push({ absPath, relPath, isDirectory: info.isDirectory(), size: info.size })
    }
    if (info.isDirectory()) {
      for (const entry of readdirSync(absPath).sort()) visit(join(absPath, entry))
    }
  }
  visit(rootDir)
  return result
}

function computeFileHashes(rootDir: string): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const entry of walk(rootDir).filter(entry => !entry.isDirectory)) {
    hashes[entry.relPath] = `sha256:${createHash('sha256').update(readFileSync(entry.absPath)).digest('hex')}`
  }
  return hashes
}

export function hashSkillDirectory(skillDir: string): string {
  return hashDirectory(skillDir)
}

function hashDirectory(dir: string): string {
  const hash = createHash('sha256')
  for (const entry of walk(dir).filter(entry => !entry.isDirectory).sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    hash.update(entry.relPath)
    hash.update('\0')
    hash.update(readFileSync(entry.absPath))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function uniqueSkillSlug(workspaceRoot: string, baseSlug: string): string {
  const skillsRoot = getWorkspaceSkillsPath(workspaceRoot)
  if (!existsSync(join(skillsRoot, baseSlug))) return baseSlug
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseSlug}-${i}`
    if (!existsSync(join(skillsRoot, candidate))) return candidate
  }
  throw new Error(`Could not find an available skill slug for ${baseSlug}`)
}

function getAgentsDir(workspaceRoot: string): string {
  return join(workspaceRoot, 'agents')
}

function getAgentProfileDir(workspaceRoot: string, agentProfileId: string): string {
  return join(getAgentsDir(workspaceRoot), sanitizeFileName(agentProfileId))
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'agent'
}

function slugifyAgentProfileId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'agent'
}

function uniqueAgentProfileId(workspaceRoot: string, baseId: string): string {
  let id = baseId
  let suffix = 2
  while (existsSync(getAgentProfileDir(workspaceRoot, id))) {
    id = `${baseId}-${suffix}`
    suffix += 1
  }
  return id
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function clampPermissionMode(mode: unknown): PermissionMode {
  const candidate = VALID_PERMISSION_MODES.has(mode as PermissionMode) ? mode as PermissionMode : 'ask'
  return candidate === 'allow-all' ? 'ask' : candidate
}

function toPackagePath(path: string): string {
  return path.split(sep).join('/')
}
