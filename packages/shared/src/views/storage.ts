/**
 * Views Storage
 *
 * Filesystem-based storage for workspace view configurations.
 * Views are stored at {workspaceRootPath}/views.json
 *
 * Views are dynamic, expression-based filters computed at runtime from session state.
 * They are never persisted on sessions — purely runtime-evaluated.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ViewConfig } from './types.ts';
import { getDefaultViews } from './defaults.ts';
import { debug } from '../utils/debug.ts';
import { readJsonFileSync } from '../utils/files.ts';

const VIEWS_FILE = 'views.json';
const VIEWS_CONFIG_VERSION = 2;
const RECENT_SEVEN_DAYS_VIEW_ID = 'view-recent-7-days';

/**
 * Views configuration file structure.
 */
export interface ViewsConfig {
  /** Schema version */
  version: number;
  /** Array of view definitions */
  views: ViewConfig[];
}

/**
 * Load views configuration from workspace.
 * Returns default views if no file exists or parsing fails.
 * Also handles migration from old labels/config.json smartLabels key.
 */
export function loadViewsConfig(workspaceRootPath: string): ViewsConfig {
  const configPath = join(workspaceRootPath, VIEWS_FILE);

  // If no views.json exists, check for legacy smartLabels in labels/config.json
  // and migrate them. Otherwise seed with defaults.
  if (!existsSync(configPath)) {
    const migrated = migrateFromSmartLabels(workspaceRootPath);
    if (migrated) {
      debug('[loadViewsConfig] Migrated from legacy smartLabels');
      return migrated;
    }

    // No legacy data — seed with defaults
    const defaults: ViewsConfig = { version: VIEWS_CONFIG_VERSION, views: getDefaultViews() };
    debug('[loadViewsConfig] No config found, seeding with default views');
    saveViewsConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const config = readJsonFileSync<ViewsConfig>(configPath);
    return migrateViewsConfig(workspaceRootPath, config);
  } catch (error) {
    debug('[loadViewsConfig] Failed to parse config:', error);
    return { version: VIEWS_CONFIG_VERSION, views: getDefaultViews() };
  }
}

/**
 * Save views configuration to disk.
 */
export function saveViewsConfig(
  workspaceRootPath: string,
  config: ViewsConfig
): void {
  const configPath = join(workspaceRootPath, VIEWS_FILE);

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveViewsConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * List views for a workspace.
 * Returns the views array from config (seeded with defaults if missing).
 */
export function listViews(workspaceRootPath: string): ViewConfig[] {
  const config = loadViewsConfig(workspaceRootPath);
  return config.views ?? [];
}

/**
 * Save views to the workspace config.
 * Replaces the entire views array.
 */
export function saveViews(
  workspaceRootPath: string,
  views: ViewConfig[]
): void {
  const config = loadViewsConfig(workspaceRootPath);
  config.views = views;
  saveViewsConfig(workspaceRootPath, config);
}

/**
 * Migrate legacy smartLabels from labels/config.json to views.json.
 * Renames IDs from "smart-*" to "view-*" prefix.
 * Returns the migrated config if migration occurred, null otherwise.
 */
function migrateFromSmartLabels(workspaceRootPath: string): ViewsConfig | null {
  const labelsConfigPath = join(workspaceRootPath, 'labels', 'config.json');
  if (!existsSync(labelsConfigPath)) return null;

  try {
    const labelsConfig = readJsonFileSync<Record<string, any>>(labelsConfigPath);
    if (!labelsConfig.smartLabels || !Array.isArray(labelsConfig.smartLabels)) return null;

    // Migrate: rename IDs from smart-* to view-*
    const views: ViewConfig[] = labelsConfig.smartLabels.map((sl: any) => ({
      ...sl,
      id: sl.id?.startsWith('smart-') ? sl.id.replace('smart-', 'view-') : sl.id,
    }));

    const config: ViewsConfig = { version: 1, views };
    const migratedConfig = migrateViewsConfig(workspaceRootPath, config);

    // Remove smartLabels from labels config to avoid confusion
    delete labelsConfig.smartLabels;
    writeFileSync(labelsConfigPath, JSON.stringify(labelsConfig, null, 2), 'utf-8');

    return migratedConfig;
  } catch {
    return null;
  }
}

function migrateViewsConfig(workspaceRootPath: string, config: ViewsConfig): ViewsConfig {
  if ((config.version ?? 1) >= VIEWS_CONFIG_VERSION) return config;

  const views = config.views ?? [];
  const hasRecentView = views.some(view => view.id === RECENT_SEVEN_DAYS_VIEW_ID);
  const recentView = getDefaultViews().find(view => view.id === RECENT_SEVEN_DAYS_VIEW_ID);
  const next: ViewsConfig = {
    ...config,
    version: VIEWS_CONFIG_VERSION,
    views: hasRecentView || !recentView ? views : [...views, recentView],
  };

  saveViewsConfig(workspaceRootPath, next);
  return next;
}
