import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderDriver } from '../driver-types.ts';
import { applyAnthropicRuntimeBootstrap, type ResolvedBackendRuntimePaths } from '../runtime-resolver.ts';
import { validateAnthropicConnection } from '../../../../config/llm-validation.ts';
import { getModelContextWindow } from '../../../../config/models.ts';
import type { LlmConnection } from '../../../../config/storage.ts';

function resolveConnectionClaudeCliPath(
  connection: LlmConnection | null,
  resolvedPaths: ResolvedBackendRuntimePaths,
): string | undefined {
  const configuredPath = connection?.claudeCodeExecutablePath?.trim();
  return configuredPath ? resolve(configuredPath) : resolvedPaths.claudeCliPath;
}

async function validateExternalClaudeCli(args: {
  executablePath: string;
  cwd: string;
  model?: string;
}): Promise<{ success: boolean; error?: string }> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60_000);
  try {
    let succeeded = false;
    for await (const msg of query({
      prompt: 'Reply exactly: ok',
      options: {
        pathToClaudeCodeExecutable: args.executablePath,
        cwd: args.cwd,
        model: args.model || 'Default',
        maxTurns: 1,
        tools: [],
        systemPrompt: 'Reply with only the requested text.',
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController,
      },
    })) {
      if (msg.type === 'result') {
        succeeded = msg.subtype === 'success';
        if (!succeeded) {
          const resultText = 'result' in msg ? String(msg.result || '') : '';
          return { success: false, error: resultText || 'Claude CLI test failed' };
        }
      }
    }
    return succeeded ? { success: true } : { success: false, error: 'Claude CLI test produced no result event.' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

export const anthropicDriver: ProviderDriver = {
  provider: 'anthropic',
  initializeHostRuntime: ({ hostRuntime, resolvedPaths }) => {
    // Set paths opportunistically — don't throw on missing.
    // Missing paths will be caught at session start (prepareRuntime).
    applyAnthropicRuntimeBootstrap(hostRuntime, resolvedPaths, { strict: false });
  },
  prepareRuntime: ({ hostRuntime, resolvedPaths, context }) => {
    applyAnthropicRuntimeBootstrap(hostRuntime, {
      ...resolvedPaths,
      claudeCliPath: resolveConnectionClaudeCliPath(context.connection, resolvedPaths),
    });
  },
  buildRuntime: ({ context, resolvedPaths }) => ({
    paths: {
      claudeCli: resolveConnectionClaudeCliPath(context.connection, resolvedPaths),
    },
  }),
  fetchModels: async ({ connection, credentials }) => {
    // After legacy migration, only direct 'anthropic' connections reach this driver.
    // iam_credentials and service_account_file are no longer valid auth types for anthropic.

    const apiKey = credentials.apiKey;
    const oauthAccessToken = credentials.oauthAccessToken;

    if (!apiKey && !oauthAccessToken) {
      throw new Error('Anthropic credentials required to fetch models');
    }

    const baseUrl = connection.baseUrl || 'https://api.anthropic.com';
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
    } else {
      headers.authorization = `Bearer ${oauthAccessToken}`;
    }

    const allRawModels: Array<{
      id: string;
      display_name: string;
      created_at: string;
      type: string;
    }> = [];
    let afterId: string | undefined;

    do {
      const params = new URLSearchParams({ limit: '100' });
      if (afterId) params.set('after_id', afterId);

      const response = await fetch(`${baseUrl}/v1/models?${params}`, { headers });
      if (!response.ok) {
        throw new Error(`Anthropic /v1/models failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as {
        data: Array<{ id: string; display_name: string; created_at: string; type: string }>;
        has_more: boolean;
        first_id: string;
        last_id: string;
      };
      if (data.data) allRawModels.push(...data.data);

      if (data.has_more && data.last_id) {
        afterId = data.last_id;
      } else {
        break;
      }
    } while (true);

    if (allRawModels.length === 0) {
      throw new Error('No models returned from Anthropic API');
    }

    const models = allRawModels
      .filter(m => m.id.startsWith('claude-') && !m.id.startsWith('claude-2') && !m.id.startsWith('claude-instant') && !m.id.startsWith('claude-1'))
      .map(m => ({
        id: m.id,
        name: m.display_name,
        shortName: (() => {
          const stripped = m.id
            .replace('claude-', '')
            .replace(/-\d{8}$/, '')
            .replace(/-latest$/, '');
          const variant = stripped
            .replace(/^[\d.-]+/, '')
            .replace(/-[\d.]+$/, '')
            .replace(/^-/, '');
          return variant ? variant.charAt(0).toUpperCase() + variant.slice(1) : stripped;
        })(),
        description: '',
        provider: 'anthropic' as const,
        contextWindow: getModelContextWindow(m.id) ?? 200_000,
      }));

    return { models };
  },
  validateStoredConnection: async ({ slug, connection, credentialManager, hostRuntime }) => {
    // After legacy migration, only direct 'anthropic' connections reach this driver.

    if (connection.providerType === 'anthropic' && connection.authType === 'external_cli') {
      const executablePath = connection.claudeCodeExecutablePath?.trim();
      if (!executablePath) {
        return { success: false, error: 'Claude executable path is required.' };
      }
      if (!existsSync(executablePath)) {
        return { success: false, error: `Claude executable not found: ${executablePath}` };
      }
      return validateExternalClaudeCli({
        executablePath,
        cwd: hostRuntime.appRootPath,
        model: connection.defaultModel,
      });
    }

    if (connection.providerType === 'anthropic' && connection.authType === 'oauth') {
      const { getValidClaudeOAuthToken } = await import('../../../../auth/state.ts');
      const tokenResult = await getValidClaudeOAuthToken(slug);
      if (!tokenResult.accessToken) {
        const errorMsg = tokenResult.migrationRequired?.message || 'OAuth token expired. Please re-authenticate.';
        return { success: false, error: errorMsg };
      }
      return { success: true };
    }

    let apiKey: string | null = null;
    let oauthToken: string | null = null;

    if (connection.authType === 'api_key' || connection.authType === 'api_key_with_endpoint') {
      apiKey = await credentialManager.getLlmApiKey(slug);
    } else if (connection.authType === 'bearer_token') {
      oauthToken = await credentialManager.getLlmApiKey(slug);
    } else if (connection.authType === 'environment') {
      apiKey = process.env.ANTHROPIC_API_KEY || null;
      if (!apiKey) {
        return { success: false, error: 'ANTHROPIC_API_KEY environment variable not set' };
      }
    } else if (connection.authType === 'none') {
      apiKey = 'ollama';
    }

    if (!apiKey && !oauthToken && connection.authType !== 'none') {
      return { success: false, error: 'Could not retrieve credentials' };
    }

    const testModel = connection.defaultModel!;
    const validationResult = await validateAnthropicConnection({
      model: testModel,
      apiKey: apiKey || undefined,
      oauthToken: oauthToken || undefined,
      baseUrl: connection.baseUrl || undefined,
    });

    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    return { success: true };
  },
};
