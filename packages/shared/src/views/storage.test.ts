import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listViews } from './storage.ts';

describe('views storage', () => {
  it('migrates existing configs with the Recent 7 Days view', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'views-storage-'));
    writeFileSync(
      join(workspaceRoot, 'views.json'),
      JSON.stringify({
        version: 1,
        views: [
          {
            id: 'view-processing',
            name: 'Processing',
            expression: 'isProcessing == true',
          },
        ],
      }),
      'utf-8',
    );

    const views = listViews(workspaceRoot);
    expect(views.map(view => view.id)).toContain('view-processing');
    expect(views.map(view => view.id)).toContain('view-recent-7-days');

    const stored = JSON.parse(readFileSync(join(workspaceRoot, 'views.json'), 'utf-8'));
    expect(stored.version).toBe(2);
    expect(stored.views.find((view: { id: string }) => view.id === 'view-recent-7-days')).toMatchObject({
      expression: 'daysSince(lastUsedAt) <= 7',
      displayMode: 'list',
    });
  });
});
