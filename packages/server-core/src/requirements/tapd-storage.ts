import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { RequirementComment, RequirementInfoFile } from '@craft-agent/shared/protocol'

export function sanitizeTapdRequirementFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

export function getTapdRequirementBaseDir(workspaceRootPath: string, sourceItemId: string): string {
  return join(workspaceRootPath, 'requirements', 'tapd', sanitizeTapdRequirementFileName(sourceItemId))
}

export function getTapdRequirementInfoDir(workspaceRootPath: string, sourceItemId: string): string {
  return join(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), 'info')
}

export function getTapdRequirementSnapshotPath(workspaceRootPath: string, sourceItemId: string): string {
  return join(workspaceRootPath, 'requirements', 'tapd', `${sanitizeTapdRequirementFileName(sourceItemId)}.md`)
}

export function ensureTapdRequirementInfoDir(workspaceRootPath: string, sourceItemId: string): string {
  const infoDir = getTapdRequirementInfoDir(workspaceRootPath, sourceItemId)
  mkdirSync(infoDir, { recursive: true })
  return infoDir
}

export function getTapdRequirementAgentRunsDir(workspaceRootPath: string, sourceItemId: string): string {
  const dir = join(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), 'agent-runs')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getTapdRequirementCommentsPath(workspaceRootPath: string, sourceItemId: string): string {
  return join(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), 'comments.jsonl')
}

function getRequirementInfoFileKind(path: string): RequirementInfoFile['kind'] {
  const ext = extname(path).toLowerCase()
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (ext === '.json') return 'json'
  if (['.txt', '.log', '.yaml', '.yml'].includes(ext)) return 'text'
  return 'file'
}

export function listTapdRequirementInfoFiles(workspaceRootPath: string, sourceItemId: string): RequirementInfoFile[] {
  const infoDir = ensureTapdRequirementInfoDir(workspaceRootPath, sourceItemId)
  const files: RequirementInfoFile[] = []

  const visit = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const absolutePath = join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) continue
      const stats = statSync(absolutePath)
      files.push({
        name: entry.name,
        relativePath,
        path: absolutePath,
        size: stats.size,
        updatedAt: stats.mtimeMs,
        kind: getRequirementInfoFileKind(entry.name),
      })
    }
  }

  visit(infoDir)
  return files.sort((a, b) => {
    const kindScore = (file: RequirementInfoFile) => file.kind === 'markdown' ? 0 : file.kind === 'text' ? 1 : file.kind === 'json' ? 2 : 3
    return kindScore(a) - kindScore(b) || a.relativePath.localeCompare(b.relativePath)
  })
}

function parseCommentLine(line: string): RequirementComment | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as Partial<RequirementComment>
    if (!parsed.id || !parsed.author) return null
    return parsed as RequirementComment
  } catch {
    return null
  }
}

export function readTapdRequirementLocalComments(workspaceRootPath: string, sourceItemId: string): RequirementComment[] {
  const path = getTapdRequirementCommentsPath(workspaceRootPath, sourceItemId)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map(parseCommentLine)
    .filter((comment): comment is RequirementComment => Boolean(comment))
    .sort((a, b) => {
      const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '') || 0
      const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '') || 0
      return aTime - bTime
    })
}

export function writeTapdRequirementLocalComments(workspaceRootPath: string, sourceItemId: string, comments: RequirementComment[]): void {
  const path = getTapdRequirementCommentsPath(workspaceRootPath, sourceItemId)
  mkdirSync(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), { recursive: true })
  const content = comments.map(comment => JSON.stringify(comment)).join('\n')
  writeFileSync(path, content ? `${content}\n` : '', 'utf-8')
}

export function appendTapdRequirementLocalComment(workspaceRootPath: string, sourceItemId: string, comment: RequirementComment): RequirementComment {
  const path = getTapdRequirementCommentsPath(workspaceRootPath, sourceItemId)
  mkdirSync(getTapdRequirementBaseDir(workspaceRootPath, sourceItemId), { recursive: true })
  appendFileSync(path, `${JSON.stringify(comment)}\n`, 'utf-8')
  return comment
}

export function upsertTapdRequirementLocalComment(workspaceRootPath: string, sourceItemId: string, comment: RequirementComment): RequirementComment {
  const comments = readTapdRequirementLocalComments(workspaceRootPath, sourceItemId)
  const index = comments.findIndex(existing => existing.id === comment.id)
  if (index >= 0) comments[index] = { ...comments[index], ...comment }
  else comments.push(comment)
  writeTapdRequirementLocalComments(workspaceRootPath, sourceItemId, comments)
  return comment
}
