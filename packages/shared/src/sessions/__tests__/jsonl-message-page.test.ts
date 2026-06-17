import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { StoredMessage, StoredSession } from '../types'
import { readSessionMessagePage, writeSessionJsonl } from '../jsonl'

let dir: string
let sessionFile: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-message-page-'))
  sessionFile = join(dir, 'session.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function message(id: string, type: StoredMessage['type']): StoredMessage {
  return {
    id,
    type,
    content: `content:${id}`,
    timestamp: Number(id.replace(/\D/g, '')) || Date.now(),
  }
}

function writeMessages(messages: StoredMessage[]): void {
  const session: StoredSession = {
    id: 'session-1',
    workspaceRootPath: dir,
    createdAt: 1,
    lastUsedAt: 2,
    messages,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  }
  writeSessionJsonl(sessionFile, session)
}

describe('readSessionMessagePage', () => {
  it('returns the latest N user turns with their assistant/tool context', () => {
    writeMessages([
      message('u1', 'user'), message('a1', 'assistant'),
      message('u2', 'user'), message('t2', 'tool'), message('a2', 'assistant'),
      message('u3', 'user'), message('a3', 'assistant'),
      message('u4', 'user'), message('a4', 'assistant'),
    ])

    const page = readSessionMessagePage(sessionFile, { limitUserTurns: 3 })

    expect(page.messages.map((m) => m.id)).toEqual(['u2', 't2', 'a2', 'u3', 'a3', 'u4', 'a4'])
    expect(page.oldestMessageId).toBe('u2')
    expect(page.newestMessageId).toBe('a4')
    expect(page.hasMoreBefore).toBe(true)
    expect(page.totalMessageCount).toBe(9)
  })

  it('returns the previous page before a cursor', () => {
    writeMessages([
      message('u1', 'user'), message('a1', 'assistant'),
      message('u2', 'user'), message('a2', 'assistant'),
      message('u3', 'user'), message('a3', 'assistant'),
      message('u4', 'user'), message('a4', 'assistant'),
    ])

    const latest = readSessionMessagePage(sessionFile, { limitUserTurns: 3 })
    const previous = readSessionMessagePage(sessionFile, {
      limitUserTurns: 3,
      beforeMessageId: latest.oldestMessageId,
    })

    expect(latest.messages.map((m) => m.id)).toEqual(['u2', 'a2', 'u3', 'a3', 'u4', 'a4'])
    expect(previous.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(previous.hasMoreBefore).toBe(false)
  })

  it('returns an empty page for an unknown cursor to avoid duplicates', () => {
    writeMessages([message('u1', 'user'), message('a1', 'assistant')])

    const page = readSessionMessagePage(sessionFile, {
      limitUserTurns: 3,
      beforeMessageId: 'missing',
    })

    expect(page.messages).toEqual([])
    expect(page.hasMoreBefore).toBe(false)
    expect(page.totalMessageCount).toBe(2)
  })
})
