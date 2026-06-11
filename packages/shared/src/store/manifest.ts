import { z } from 'zod'
import type { StorePackageManifest } from './types.ts'

const semverSchema = z.string().regex(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  'Version must be semver, e.g. 1.2.0',
)

const slugSchema = z.string().regex(
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
  'Slug must be lowercase alphanumeric with hyphens',
)

const authorSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
}).passthrough()

export const StorePackageManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['skill', 'agent']),
  packageId: slugSchema,
  version: semverSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  author: authorSchema.optional(),
  compat: z.object({
    minAppVersion: semverSchema.optional(),
  }).passthrough().optional(),
  contents: z.object({
    agent: z.boolean().optional(),
    skills: z.array(z.object({
      slug: slugSchema,
      version: semverSchema,
    })).optional(),
  }).passthrough(),
  requiredSources: z.array(z.object({
    slug: slugSchema,
    type: z.string().optional(),
    hint: z.string().optional(),
  }).passthrough()).optional(),
  requiredEnv: z.array(z.string().min(1)).optional(),
  permissionsSummary: z.object({
    alwaysAllow: z.array(z.string()).optional(),
    permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
    bundledFiles: z.array(z.string()).optional(),
  }).passthrough().optional(),
  checksums: z.record(z.string(), z.string()).optional(),
}).passthrough()

export function parseStorePackageManifest(value: unknown): StorePackageManifest {
  const parsed = StorePackageManifestSchema.parse(value) as StorePackageManifest
  validateStorePackageManifest(parsed)
  return parsed
}

export function validateStorePackageManifest(manifest: StorePackageManifest): void {
  if (manifest.type === 'skill') {
    const skills = manifest.contents.skills ?? []
    if (skills.length !== 1) {
      throw new Error('Skill packages must declare exactly one skill in contents.skills')
    }
    const skill = skills[0]
    if (!skill) throw new Error('Skill package manifest does not declare a skill')
    if (skill.version !== manifest.version) {
      throw new Error('Skill package version must match contents.skills[0].version')
    }
  }
  if (manifest.type === 'agent' && manifest.contents.agent !== true) {
    throw new Error('Agent packages must declare contents.agent = true')
  }
}

export function getSkillPackageRef(manifest: StorePackageManifest) {
  if (manifest.type !== 'skill') {
    throw new Error(`Expected a skill package, got ${manifest.type}`)
  }
  const skill = manifest.contents.skills?.[0]
  if (!skill) throw new Error('Skill package manifest does not declare a skill')
  return skill
}
