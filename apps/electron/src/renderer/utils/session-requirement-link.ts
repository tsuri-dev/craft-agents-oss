import { parseLabelEntry } from '@craft-agent/shared/labels'

export const TAPD_PLUGIN_ID = 'tapd'
export const TAPD_SOURCE_SLUG = 'tapd-mcp-http'
export const TAPD_LABEL_ID = 'tapd'

export function isTapdPluginInstalled(sources?: Array<{ config: { slug: string; enabled?: boolean } }>): boolean {
  return (sources ?? []).some(source => source.config.slug === TAPD_SOURCE_SLUG && source.config.enabled !== false)
}

export function getTapdRequirementId(labels?: string[]): string | null {
  for (const label of labels ?? []) {
    const parsed = parseLabelEntry(label)
    if (parsed.id === TAPD_LABEL_ID && parsed.rawValue?.trim()) return parsed.rawValue.trim()
  }
  return null
}
