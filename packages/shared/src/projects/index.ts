/**
 * Projects Module
 *
 * Public exports for project management.
 */

export type {
  ProjectConfig,
  ProjectAsset,
  CreateProjectInput,
  LoadedProject,
  ProjectPromptContext,
} from './types.ts';

export {
  // Path utilities
  ensureProjectsDir,
  ensureProjectAssetsDir,
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectAssetsPath,
  getProjectMemoryPath,
  MEMORY_FILENAME,
  // Config operations
  loadProjectConfig,
  saveProjectConfig,
  // Memory operations
  loadProjectMemory,
  // Load operations
  loadProject,
  loadProjectById,
  loadWorkspaceProjects,
  // Create/update/delete
  generateProjectSlug,
  createProject,
  updateProject,
  deleteProject,
  projectExists,
  // Asset operations
  listProjectAssets,
  uploadProjectAsset,
  deleteProjectAsset,
  sanitizeAssetFilename,
} from './storage.ts';

export type { UploadProjectAssetInput } from './storage.ts';

export {
  LEGACY_PROJECT_LABEL_ID,
  migrateLegacyProjectLabelsToProjects,
} from './migration.ts';

export type {
  LegacyProjectLabelMigrationOptions,
  LegacyProjectLabelMigrationSummary,
} from './migration.ts';
