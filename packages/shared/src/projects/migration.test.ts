import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLabelConfig, saveLabelConfig } from '../labels/storage.ts';
import { createSession, loadSession } from '../sessions/storage.ts';
import { loadWorkspaceProjects, createProject } from './storage.ts';
import { migrateLegacyProjectLabelsToProjects } from './migration.ts';

const tmpRoots: string[] = [];

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-project-migration-'));
  tmpRoots.push(root);
  return root;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('migrateLegacyProjectLabelsToProjects', () => {
  it('creates official Projects, binds sessions, and removes legacy project labels', async () => {
    const root = workspaceRoot();
    const first = await createSession(root, { labels: ['bug', 'project::Craft Agents'] });
    const second = await createSession(root, { labels: ['project::Craft Agents', 'feature'] });
    const third = await createSession(root, { labels: ['project::Pi'] });
    const plain = await createSession(root, { labels: ['bug'] });

    const summary = await migrateLegacyProjectLabelsToProjects(root);

    expect(summary).toEqual({
      sessionsScannedWithLegacyLabel: 3,
      sessionsUpdated: 3,
      labelsRemoved: 3,
      projectsCreated: 2,
      sessionsBoundToProject: 3,
      labelConfigsRemoved: 0,
    });

    const projects = loadWorkspaceProjects(root).map(project => project.config);
    expect(projects.map(project => project.name).sort()).toEqual(['Craft Agents', 'Pi']);
    const craftProject = projects.find(project => project.name === 'Craft Agents')!;
    const piProject = projects.find(project => project.name === 'Pi')!;

    expect(loadSession(root, first.id)?.projectId).toBe(craftProject.id);
    expect(loadSession(root, second.id)?.projectId).toBe(craftProject.id);
    expect(loadSession(root, third.id)?.projectId).toBe(piProject.id);
    expect(loadSession(root, plain.id)?.projectId).toBeUndefined();

    expect(loadSession(root, first.id)?.labels).toEqual(['bug']);
    expect(loadSession(root, second.id)?.labels).toEqual(['feature']);
    expect(loadSession(root, third.id)?.labels).toEqual([]);
  });

  it('keeps valid existing official project bindings while removing legacy labels', async () => {
    const root = workspaceRoot();
    const official = createProject(root, { name: 'Official Project' });
    const legacy = await createSession(root, {
      labels: ['project::Legacy Project', 'bug'],
      projectId: official.id,
    });

    const summary = await migrateLegacyProjectLabelsToProjects(root);

    expect(summary).toEqual({
      sessionsScannedWithLegacyLabel: 1,
      sessionsUpdated: 1,
      labelsRemoved: 1,
      projectsCreated: 0,
      sessionsBoundToProject: 0,
      labelConfigsRemoved: 0,
    });
    expect(loadWorkspaceProjects(root).map(project => project.config.name)).toEqual(['Official Project']);
    expect(loadSession(root, legacy.id)?.projectId).toBe(official.id);
    expect(loadSession(root, legacy.id)?.labels).toEqual(['bug']);
  });

  it('is idempotent after the first run', async () => {
    const root = workspaceRoot();
    await createSession(root, { labels: ['project::Craft Agents'] });

    await migrateLegacyProjectLabelsToProjects(root);
    const summary = await migrateLegacyProjectLabelsToProjects(root);

    expect(summary).toEqual({
      sessionsScannedWithLegacyLabel: 0,
      sessionsUpdated: 0,
      labelsRemoved: 0,
      projectsCreated: 0,
      sessionsBoundToProject: 0,
      labelConfigsRemoved: 0,
    });
    expect(loadWorkspaceProjects(root)).toHaveLength(1);
  });

  it('removes the legacy Project valued label definition from existing label config', async () => {
    const root = workspaceRoot();
    saveLabelConfig(root, {
      version: 1,
      labels: [
        { id: 'bug', name: 'Bug' },
        {
          id: 'organization',
          name: 'Organization',
          children: [
            { id: 'project', name: 'Project', valueType: 'string' },
            { id: 'team', name: 'Team' },
          ],
        },
      ],
    });

    const summary = await migrateLegacyProjectLabelsToProjects(root);

    expect(summary.labelConfigsRemoved).toBe(1);
    expect(loadLabelConfig(root).labels).toEqual([
      { id: 'bug', name: 'Bug' },
      {
        id: 'organization',
        name: 'Organization',
        children: [
          { id: 'team', name: 'Team' },
        ],
      },
    ]);
  });
});
