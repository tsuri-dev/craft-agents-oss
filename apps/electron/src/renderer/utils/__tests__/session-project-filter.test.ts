import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '../../atoms/sessions'
import {
  NO_PROJECT_FILTER_ID,
  addSessionProjectLabel,
  buildSessionProjectFilterOptions,
  filterSessionProjectOptions,
  filterSessionsByProjectFilter,
  getSessionProjectValue,
  resolveUniqueSessionProjectName,
} from '../session-project-filter'

function session(id: string, labels?: string[]): SessionMeta {
  return {
    id,
    workspaceId: 'workspace-1',
    labels,
  }
}

describe('getSessionProjectValue', () => {
  it('reads project from the valued project label, not workingDirectory', () => {
    const meta = session('one', ['bug', 'project::Craft Agents OSS'])
    meta.workingDirectory = '/Users/me/projects/wrong-directory'

    expect(getSessionProjectValue(meta)).toBe('Craft Agents OSS')
  })
})

describe('addSessionProjectLabel', () => {
  it('replaces any existing project label with the new project value', () => {
    expect(addSessionProjectLabel(['bug', 'project::Old'], 'New')).toEqual(['bug', 'project::New'])
  })
})

describe('resolveUniqueSessionProjectName', () => {
  it('appends a numeric suffix when a project already exists', () => {
    expect(resolveUniqueSessionProjectName('Craft', ['Craft', 'Craft 2'])).toBe('Craft 3')
  })
})

describe('buildSessionProjectFilterOptions', () => {
  it('groups sessions by project label custom value', () => {
    const options = buildSessionProjectFilterOptions([
      session('one', ['project::Craft Agents OSS']),
      session('two', ['project::Craft Agents OSS']),
      session('three', ['project::Pi']),
      session('four', ['bug']),
    ])

    expect(options).toEqual([
      {
        id: 'Craft Agents OSS',
        label: 'Craft Agents OSS',
        value: 'Craft Agents OSS',
        count: 2,
      },
      {
        id: 'Pi',
        label: 'Pi',
        value: 'Pi',
        count: 1,
      },
      {
        id: NO_PROJECT_FILTER_ID,
        label: 'No Project',
        value: null,
        count: 1,
      },
    ])
  })
})

describe('filterSessionsByProjectFilter', () => {
  it('applies include and exclude project filters using project label values', () => {
    const sessions = [
      session('craft', ['project::Craft Agents OSS']),
      session('pi', ['project::Pi']),
      session('none', ['bug']),
    ]

    expect(filterSessionsByProjectFilter(
      sessions,
      new Map<string, 'include' | 'exclude'>([['Craft Agents OSS', 'include']]),
    ).map(s => s.id)).toEqual(['craft'])

    expect(filterSessionsByProjectFilter(
      sessions,
      new Map<string, 'include' | 'exclude'>([[NO_PROJECT_FILTER_ID, 'exclude']]),
    ).map(s => s.id)).toEqual(['craft', 'pi'])
  })
})

describe('filterSessionProjectOptions', () => {
  it('matches projects by custom value', () => {
    const options = buildSessionProjectFilterOptions([
      session('craft', ['project::Craft Agents OSS']),
      session('pi', ['project::Pi']),
    ])

    expect(filterSessionProjectOptions(options, 'craft').map(o => o.id)).toEqual(['Craft Agents OSS'])
    expect(filterSessionProjectOptions(options, 'pi').map(o => o.id)).toEqual(['Pi'])
  })
})
