import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createSession, loadSession } from '../storage.ts';

let workspaceRoot: string | undefined;

afterEach(() => {
  if (workspaceRoot) {
    rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = undefined;
  }
});

describe('session preferredLanguage persistence', () => {
  it('persists the preferred language snapshot on new sessions', async () => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'session-language-'));

    const session = await createSession(workspaceRoot, { preferredLanguage: 'ja' });
    const stored = loadSession(workspaceRoot, session.id);

    expect(session.preferredLanguage).toBe('ja');
    expect(stored?.preferredLanguage).toBe('ja');
  });
});
