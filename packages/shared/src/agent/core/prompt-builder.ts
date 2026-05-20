/**
 * PromptBuilder - System Prompt and Context Building
 *
 * Provides utilities for building system prompts and context blocks that both
 * ClaudeAgent and PiAgent can use. Handles workspace capabilities, recovery
 * context, and user preferences formatting.
 *
 * Key responsibilities:
 * - Build workspace capabilities context
 * - Format recovery context for session resume failures
 * - Build session state context blocks
 * - Format user preferences for prompt injection
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { isLocalMcpEnabled } from '../../workspaces/storage.ts';
import { formatPreferencesForPrompt } from '../../config/preferences.ts';
import { formatSessionState } from '../mode-manager.ts';
import { getDateTimeContext, getWorkingDirectoryContext } from '../../prompts/system.ts';
import { getSessionPlansPath, getSessionDataPath, getSessionPath } from '../../sessions/storage.ts';
import { parseLabelEntry } from '../../labels/values.ts';
import type {
  PromptBuilderConfig,
  ContextBlockOptions,
  RecoveryMessage,
} from './types.ts';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * PromptBuilder provides utilities for building prompts and context blocks.
 *
 * Usage:
 * ```typescript
 * const promptBuilder = new PromptBuilder({
 *   workspace,
 *   session,
 *   debugMode: { enabled: true },
 * });
 *
 * // Build context blocks for a user message
 * const contextParts = promptBuilder.buildContextParts({
 *   permissionMode: 'explore',
 *   plansFolderPath: '/path/to/plans',
 * });
 * ```
 */
export class PromptBuilder {
  private config: PromptBuilderConfig;
  private workspaceRootPath: string;
  private pinnedPreferencesPrompt: string | null = null;

  constructor(config: PromptBuilderConfig) {
    this.config = config;
    this.workspaceRootPath = config.workspace?.rootPath ?? '';
  }

  // ============================================================
  // Context Building
  // ============================================================

  /**
   * Build all context parts for a user message.
   * Returns an array of strings that should be prepended to the user message.
   *
   * @param options - Context building options
   * @param sourceStateBlock - Pre-formatted source state (from SourceManager)
   * @returns Array of context strings
   */
  buildContextParts(
    options: ContextBlockOptions,
    sourceStateBlock?: string
  ): string[] {
    const parts: string[] = [];

    // Add date/time context first (enables prompt caching)
    parts.push(getDateTimeContext());

    // Add session state (permission mode, plans folder path, data folder path)
    const sessionId = this.config.session?.id ?? `temp-${Date.now()}`;
    const plansFolderPath = options.plansFolderPath ??
      getSessionPlansPath(this.workspaceRootPath, sessionId);
    const dataFolderPath = options.dataFolderPath ??
      getSessionDataPath(this.workspaceRootPath, sessionId);
    parts.push(formatSessionState(sessionId, {
      plansFolderPath,
      dataFolderPath,
      consumeModeChangeUserSignal: true,
    }));

    // Add source state if provided
    if (sourceStateBlock) {
      parts.push(sourceStateBlock);
    }

    const linkedRequirementContext = this.getLinkedRequirementContext();
    if (linkedRequirementContext) {
      parts.push(linkedRequirementContext);
    }

    // Add workspace capabilities
    parts.push(this.formatWorkspaceCapabilities());

    // Add working directory context
    const workingDirContext = this.getWorkingDirectoryContext();
    if (workingDirContext) {
      parts.push(workingDirContext);
    }

    const remoteTargetContext = this.getRemoteTargetContext();
    if (remoteTargetContext) {
      parts.push(remoteTargetContext);
    }

    return parts;
  }

  /**
   * Format workspace capabilities for prompt injection.
   * Informs the agent about what features are available in this workspace.
   */
  formatWorkspaceCapabilities(): string {
    const capabilities: string[] = [];

    // Check local MCP server capability
    const localMcpEnabled = isLocalMcpEnabled(this.workspaceRootPath);
    if (localMcpEnabled) {
      capabilities.push('local-mcp: enabled (stdio subprocess servers supported)');
    } else {
      capabilities.push('local-mcp: disabled (only HTTP/SSE servers)');
    }

    return `<workspace_capabilities>\n${capabilities.join('\n')}\n</workspace_capabilities>`;
  }

  /**
   * Get working directory context for prompt injection.
   */
  getWorkingDirectoryContext(): string | null {
    const sessionId = this.config.session?.id;
    const effectiveWorkingDir = this.config.session?.workingDirectory ??
      (sessionId ? getSessionPath(this.workspaceRootPath, sessionId) : undefined);
    const isSessionRoot = !this.config.session?.workingDirectory && !!sessionId;

    return getWorkingDirectoryContext(
      effectiveWorkingDir,
      isSessionRoot,
      this.config.session?.sdkCwd
    );
  }

  getLinkedRequirementContext(): string | null {
    const labels = this.config.session?.labels ?? [];
    const tapdIds = labels
      .map(label => parseLabelEntry(label))
      .filter(parsed => parsed.id === 'tapd' && parsed.rawValue?.trim())
      .map(parsed => parsed.rawValue!.trim());

    const uniqueTapdIds = Array.from(new Set(tapdIds));
    if (uniqueTapdIds.length === 0 || !this.workspaceRootPath) return null;

    const entries = uniqueTapdIds.map((id) => {
      const filePath = join(this.workspaceRootPath, 'requirements', 'tapd', `${id.replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'}.md`);
      return `- TAPD-${id}: ${filePath}${existsSync(filePath) ? '' : ' (snapshot not found yet — open or refresh the TAPD requirement from the plugin board)'}`;
    });

    return `<linked_requirements>
This session is linked to workspace-level TAPD requirement snapshots.
Read the referenced file when you need requirement details. These files are shared by all sessions linked to the same TAPD requirement, so refreshing the requirement updates the single shared snapshot for every session.
Do not enable or call the TAPD MCP source unless the user explicitly asks to refresh/fetch live TAPD data.
${entries.join('\n')}
</linked_requirements>`;
  }

  getRemoteTargetContext(): string | null {
    const target = this.config.session?.remoteTarget;
    if (!target || target.type !== 'ssh') return null;

    const keyArg = target.privateKeyPath ? `-i ${shellQuote(target.privateKeyPath)} ` : '';
    const remote = `${target.username}@${target.host}`;
    const cdPrefix = `cd ${shellQuote(target.remoteWorkingDirectory)} &&`;
    const keepAliveEnabled = target.keepAlive !== false;
    const keepAliveMinutes = target.keepAliveMinutes ?? 30;
    const keepAliveArgs = keepAliveEnabled
      ? ` -o ControlMaster=auto -o ControlPersist=${keepAliveMinutes}m -o ControlPath=/tmp/craft-agent-ssh-%C -o ServerAliveInterval=30 -o ServerAliveCountMax=3`
      : '';

    return `<remote_execution_target type="ssh">
This session is bound to an SSH remote machine.
- Profile: ${target.profileName}
- Host: ${remote}
- Port: ${target.port}
- Remote working directory: ${target.remoteWorkingDirectory}
- Private key path: ${target.privateKeyPath ?? '(configured key path unavailable)'}
- SSH connection reuse: ${keepAliveEnabled ? `enabled, keep control socket for ${keepAliveMinutes} minutes` : 'disabled'}

When using shell commands for project work, run them on the remote machine under the remote working directory. You MUST include the SSH options below on every ssh command for this session so OpenSSH multiplexing is actually enabled:
ssh ${keyArg}-p ${target.port} -o BatchMode=yes -o IdentitiesOnly=yes${keepAliveArgs} ${shellQuote(remote)} ${shellQuote(`${cdPrefix} <command>`)}

If you verify the effective ssh configuration, include the same options in the verification command; checking plain ssh -G <host> does not reflect this session's per-command overrides.

Do not operate on the local session folder as if it were the remote project. Keep remote operations scoped to the remote working directory unless the user explicitly asks otherwise.
</remote_execution_target>`;
  }

  // ============================================================
  // Recovery Context
  // ============================================================

  /**
   * Build recovery context from previous messages when SDK resume fails.
   * Called when we detect an empty response during resume.
   *
   * @param messages - Previous messages to include in recovery context
   * @returns Formatted recovery context string, or null if no messages
   */
  buildRecoveryContext(messages?: RecoveryMessage[]): string | null {
    if (!messages || messages.length === 0) {
      return null;
    }

    // Format messages as a conversation block
    const formattedMessages = messages.map((m) => {
      const role = m.type === 'user' ? 'User' : 'Assistant';
      // Truncate very long messages to avoid bloating context
      const content = m.content.length > 1000
        ? m.content.slice(0, 1000) + '...[truncated]'
        : m.content;
      return `[${role}]: ${content}`;
    }).join('\n\n');

    return `<conversation_recovery>
This session was interrupted and is being restored. Here is the recent conversation context:

${formattedMessages}

Please continue the conversation naturally from where we left off.
</conversation_recovery>

`;
  }

  // ============================================================
  // User Preferences
  // ============================================================

  /**
   * Format user preferences for prompt injection.
   * Preferences are pinned on first call to ensure consistency within a session.
   *
   * @param forceRefresh - Force refresh of cached preferences
   * @returns Formatted preferences string
   */
  formatPreferences(forceRefresh = false): string {
    // Return pinned preferences if available (ensures session consistency)
    if (this.pinnedPreferencesPrompt && !forceRefresh) {
      return this.pinnedPreferencesPrompt;
    }

    // Load and format preferences (function loads internally)
    this.pinnedPreferencesPrompt = formatPreferencesForPrompt();
    return this.pinnedPreferencesPrompt;
  }

  /**
   * Clear pinned preferences (called on session clear).
   */
  clearPinnedPreferences(): void {
    this.pinnedPreferencesPrompt = null;
  }

  // ============================================================
  // Configuration Accessors
  // ============================================================

  /**
   * Update the workspace configuration.
   */
  setWorkspace(workspace: PromptBuilderConfig['workspace']): void {
    this.config.workspace = workspace;
    this.workspaceRootPath = workspace?.rootPath ?? '';
  }

  /**
   * Update the session configuration.
   */
  setSession(session: PromptBuilderConfig['session']): void {
    this.config.session = session;
  }

  /**
   * Get the workspace root path.
   */
  getWorkspaceRootPath(): string {
    return this.workspaceRootPath;
  }

  /**
   * Check if debug mode is enabled.
   */
  isDebugMode(): boolean {
    return this.config.debugMode?.enabled ?? false;
  }

  /**
   * Get the system prompt preset.
   */
  getSystemPromptPreset(): string {
    return this.config.systemPromptPreset ?? 'default';
  }
}
