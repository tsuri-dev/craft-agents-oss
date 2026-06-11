import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import { loadSkill } from '../../skills/index.ts'
import { loadStoreReceipts } from '../receipts.ts'
import { installStorePackage, installStoreSkillPackage } from '../installer.ts'

const tempDirs: string[] = []
const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('store skill installer', () => {
  it('installs a full skill folder and strips alwaysAllow by default', async () => {
    const workspaceRoot = tempDir('workspace-')
    const tarball = await createSkillPackageTarball({ slug: 'taste-skill', version: '1.0.0' })
    mockDownload(tarball)

    const result = await installStoreSkillPackage(workspaceRoot, {
      registryUrl: 'https://store.example',
      packageId: 'taste-skill',
      version: '1.0.0',
    })

    expect(result.manifest.packageId).toBe('taste-skill')
    expect(result.skills[0]?.slug).toBe('taste-skill')
    expect(result.skills[0]?.strippedAlwaysAllow).toBe(true)
    expect(existsSync(join(workspaceRoot, 'skills', 'taste-skill', 'assets', 'check.py'))).toBe(true)

    const loaded = loadSkill(workspaceRoot, 'taste-skill')
    expect(loaded?.metadata.version).toBe('1.0.0')
    expect(loaded?.metadata.alwaysAllow).toBeUndefined()

    const skillFile = readFileSync(join(workspaceRoot, 'skills', 'taste-skill', 'SKILL.md'), 'utf-8')
    expect(skillFile).not.toContain('alwaysAllow')

    const receipts = loadStoreReceipts(workspaceRoot)
    expect(Object.keys(receipts.installedPackages)).toHaveLength(1)
    const receipt = Object.values(receipts.installedPackages)[0]
    expect(receipt?.packageId).toBe('taste-skill')
    expect(receipt?.skills[0]?.slug).toBe('taste-skill')
    expect(receipt?.skills[0]?.hash).toBeTruthy()
  })

  it('installs an agent package with inline skills and maps available sources', async () => {
    const workspaceRoot = tempDir('workspace-')
    createSource(workspaceRoot, 'github')
    const tarball = await createAgentPackageTarball({ slug: 'review-helper', skillSlug: 'review-skill', version: '1.0.0' })
    mockDownload(tarball)

    const result = await installStorePackage(workspaceRoot, {
      registryUrl: 'https://store.example',
      packageId: 'review-helper',
      version: '1.0.0',
    })

    expect(result.manifest.type).toBe('agent')
    expect(result.agentProfile?.name).toBe('Review Helper')
    expect(result.agentProfile?.skillSlugs).toEqual(['review-skill'])
    expect(result.agentProfile?.sourceSlugs).toEqual(['github'])
    expect(result.missingSources).toEqual([{ slug: 'linear', type: 'api', hint: 'Linear API' }])
    expect(existsSync(join(workspaceRoot, 'agents', result.agentProfile?.id ?? '', 'instructions.md'))).toBe(true)

    const receipts = loadStoreReceipts(workspaceRoot)
    const receipt = Object.values(receipts.installedPackages)[0]
    expect(receipt?.type).toBe('agent')
    expect(receipt?.agentProfileId).toBe(result.agentProfile?.id)
    expect(receipt?.agentProfileHash).toBeTruthy()
  })

  it('protects existing manual skills unless copy strategy is selected', async () => {
    const workspaceRoot = tempDir('workspace-')
    mkdirSync(join(workspaceRoot, 'skills', 'taste-skill'), { recursive: true })
    writeFileSync(join(workspaceRoot, 'skills', 'taste-skill', 'SKILL.md'), `---\nname: Local Taste\ndescription: Local copy\n---\n\nLocal body\n`)

    const tarball = await createSkillPackageTarball({ slug: 'taste-skill', version: '1.0.0' })
    mockDownload(tarball)

    await expect(installStoreSkillPackage(workspaceRoot, {
      registryUrl: 'https://store.example',
      packageId: 'taste-skill',
      version: '1.0.0',
    })).rejects.toThrow(/already exists/)

    mockDownload(tarball)
    const result = await installStoreSkillPackage(workspaceRoot, {
      registryUrl: 'https://store.example',
      packageId: 'taste-skill',
      version: '1.0.0',
      conflictStrategy: 'copy',
    })

    expect(result.skills[0]?.slug).toBe('taste-skill-2')
    expect(loadSkill(workspaceRoot, 'taste-skill')?.metadata.name).toBe('Local Taste')
    expect(loadSkill(workspaceRoot, 'taste-skill-2')?.metadata.name).toBe('Taste Skill')
  })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `craft-store-test-${prefix}`))
  tempDirs.push(dir)
  return dir
}

function mockDownload(bytes: Uint8Array): void {
  globalThis.fetch = (async () => new Response(bytes) as Response) as unknown as typeof fetch
}

function createSource(workspaceRoot: string, slug: string): void {
  const sourceDir = join(workspaceRoot, 'sources', slug)
  mkdirSync(sourceDir, { recursive: true })
  writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
    id: `${slug}_test`,
    name: slug,
    slug,
    enabled: true,
    provider: slug,
    type: 'api',
    api: {
      baseUrl: 'https://api.example.test',
      authType: 'none',
    },
  }, null, 2))
}

async function createSkillPackageTarball(input: { slug: string; version: string }): Promise<Uint8Array> {
  const root = tempDir('package-')
  const skillDir = join(root, 'skills', input.slug)
  mkdirSync(join(skillDir, 'assets'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    type: 'skill',
    packageId: input.slug,
    version: input.version,
    name: 'Taste Skill',
    description: 'A store-distributed skill used by tests.',
    contents: {
      skills: [{ slug: input.slug, version: input.version }],
    },
    permissionsSummary: {
      alwaysAllow: ['Bash'],
      bundledFiles: [`skills/${input.slug}/assets/check.py`],
    },
  }, null, 2))
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: Taste Skill\ndescription: A tasty test skill.\nversion: ${input.version}\nalwaysAllow:\n  - Bash\n---\n\nUse this skill for tasting tests.\n`)
  writeFileSync(join(skillDir, 'assets', 'check.py'), 'print("ok")\n')

  const tarPath = join(root, 'package.tar.gz')
  await tar.c({ gzip: true, file: tarPath, cwd: root }, ['manifest.json', 'skills'])
  return readFileSync(tarPath)
}

async function createAgentPackageTarball(input: { slug: string; skillSlug: string; version: string }): Promise<Uint8Array> {
  const root = tempDir('agent-package-')
  const skillDir = join(root, 'skills', input.skillSlug)
  mkdirSync(join(skillDir, 'assets'), { recursive: true })
  mkdirSync(join(root, 'agent'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    type: 'agent',
    packageId: input.slug,
    version: input.version,
    name: 'Review Helper',
    description: 'Agent package used by tests.',
    contents: {
      agent: true,
      skills: [{ slug: input.skillSlug, version: input.version }],
    },
    requiredSources: [
      { slug: 'github', type: 'api', hint: 'GitHub API' },
      { slug: 'linear', type: 'api', hint: 'Linear API' },
    ],
  }, null, 2))
  writeFileSync(join(root, 'agent', 'profile.json'), JSON.stringify({
    name: 'Review Helper',
    description: 'Reviews code with project context.',
    permissionMode: 'allow-all',
    thinkingLevel: 'medium',
    sourceSlugs: ['github'],
  }, null, 2))
  writeFileSync(join(root, 'agent', 'instructions.md'), 'Review the change and report risks.\n')
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: Review Skill\ndescription: A review helper skill.\nversion: ${input.version}\n---\n\nUse this skill for reviews.\n`)
  writeFileSync(join(skillDir, 'assets', 'check.py'), 'print("review")\n')

  const tarPath = join(root, 'package.tar.gz')
  await tar.c({ gzip: true, file: tarPath, cwd: root }, ['manifest.json', 'agent', 'skills'])
  return readFileSync(tarPath)
}
