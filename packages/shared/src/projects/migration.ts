import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { LabelConfig } from '../labels/types.ts';
import { loadLabelConfig, saveLabelConfig } from '../labels/storage.ts';
import { parseLabelEntry } from '../labels/values.ts';
import { listSessions, updateSessionMetadata } from '../sessions/storage.ts';
import type { ProjectConfig } from './types.ts';
import { createProject, loadWorkspaceProjects } from './storage.ts';

export const LEGACY_PROJECT_LABEL_ID = 'project';

export interface LegacyProjectLabelMigrationSummary {
  /** Number of sessions that contained at least one legacy project:: label. */
  sessionsScannedWithLegacyLabel: number;
  /** Number of sessions whose labels/projectId were written. */
  sessionsUpdated: number;
  /** Number of legacy project labels removed from session labels. */
  labelsRemoved: number;
  /** Number of official Projects created from legacy label values. */
  projectsCreated: number;
  /** Number of sessions bound to an official projectId during migration. */
  sessionsBoundToProject: number;
  /** Number of legacy project label definitions removed from labels/config.json. */
  labelConfigsRemoved: number;
}

export interface LegacyProjectLabelMigrationOptions {
  /** Legacy valued label id; defaults to project for project::value. */
  labelId?: string;
  logger?: Pick<Console, 'info' | 'warn'>;
}

function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function findLegacyProjectName(labels: string[] | undefined, labelId: string): string | undefined {
  for (const entry of labels ?? []) {
    const parsed = parseLabelEntry(entry);
    if (parsed.id !== labelId) continue;
    const value = parsed.rawValue?.trim();
    if (value) return value;
  }
  return undefined;
}

function removeLegacyProjectLabels(labels: string[] | undefined, labelId: string): { labels: string[]; removed: number } {
  const next: string[] = [];
  let removed = 0;
  for (const entry of labels ?? []) {
    if (parseLabelEntry(entry).id === labelId) {
      removed += 1;
      continue;
    }
    next.push(entry);
  }
  return { labels: next, removed };
}

function removeLabelConfigById(labels: LabelConfig[], labelId: string): { labels: LabelConfig[]; removed: number } {
  const next: LabelConfig[] = [];
  let removed = 0;

  for (const label of labels) {
    if (label.id === labelId) {
      removed += 1;
      continue;
    }

    if (label.children?.length) {
      const childResult = removeLabelConfigById(label.children, labelId);
      removed += childResult.removed;
      next.push({ ...label, children: childResult.labels });
    } else {
      next.push(label);
    }
  }

  return { labels: next, removed };
}

function removeLegacyProjectLabelConfig(workspaceRootPath: string, labelId: string): number {
  // Avoid loadLabelConfig() when no config exists: new default configs no longer
  // include the legacy project label, so there is nothing to clean up.
  const labelConfigPath = join(workspaceRootPath, 'labels', 'config.json');
  if (!existsSync(labelConfigPath)) return 0;

  const config = loadLabelConfig(workspaceRootPath);
  const result = removeLabelConfigById(config.labels, labelId);
  if (result.removed === 0) return 0;

  saveLabelConfig(workspaceRootPath, { ...config, labels: result.labels });
  return result.removed;
}

/**
 * One-time compatibility migration from the fork's legacy project::value labels
 * to upstream's first-class Projects model.
 *
 * For every session carrying project::Name:
 * - create/reuse an official Project named Name in the same workspace;
 * - set session.projectId when the session is not already bound to a valid Project;
 * - remove all legacy project labels from the session label list;
 * - remove the legacy Project valued label definition from labels/config.json.
 *
 * The migration is intentionally idempotent and safe to run at every startup.
 */
export async function migrateLegacyProjectLabelsToProjects(
  workspaceRootPath: string,
  options: LegacyProjectLabelMigrationOptions = {},
): Promise<LegacyProjectLabelMigrationSummary> {
  const labelId = options.labelId ?? LEGACY_PROJECT_LABEL_ID;
  const summary: LegacyProjectLabelMigrationSummary = {
    sessionsScannedWithLegacyLabel: 0,
    sessionsUpdated: 0,
    labelsRemoved: 0,
    projectsCreated: 0,
    sessionsBoundToProject: 0,
    labelConfigsRemoved: 0,
  };

  summary.labelConfigsRemoved = removeLegacyProjectLabelConfig(workspaceRootPath, labelId);

  const projectsByName = new Map<string, ProjectConfig>();
  const projectIds = new Set<string>();
  for (const loaded of loadWorkspaceProjects(workspaceRootPath)) {
    projectsByName.set(normalizeProjectName(loaded.config.name), loaded.config);
    projectIds.add(loaded.config.id);
  }

  const ensureProjectForLegacyName = (name: string): ProjectConfig => {
    const key = normalizeProjectName(name);
    const existing = projectsByName.get(key);
    if (existing) return existing;

    const created = createProject(workspaceRootPath, { name: name.trim() });
    projectsByName.set(key, created);
    projectIds.add(created.id);
    summary.projectsCreated += 1;
    return created;
  };

  for (const meta of listSessions(workspaceRootPath)) {
    const legacyName = findLegacyProjectName(meta.labels, labelId);
    const { labels, removed } = removeLegacyProjectLabels(meta.labels, labelId);
    if (removed === 0) continue;

    summary.sessionsScannedWithLegacyLabel += 1;
    summary.labelsRemoved += removed;

    let nextProjectId = meta.projectId;
    const hasValidProjectBinding = !!nextProjectId && projectIds.has(nextProjectId);
    if (!hasValidProjectBinding && legacyName) {
      nextProjectId = ensureProjectForLegacyName(legacyName).id;
    }

    const projectChanged = nextProjectId !== meta.projectId;
    await updateSessionMetadata(workspaceRootPath, meta.id, {
      labels,
      ...(projectChanged ? { projectId: nextProjectId } : {}),
    });

    summary.sessionsUpdated += 1;
    if (projectChanged && nextProjectId) summary.sessionsBoundToProject += 1;
  }

  if (summary.sessionsUpdated > 0) {
    options.logger?.info?.('[projects] migrated legacy project labels to official Projects', summary);
  }

  return summary;
}
