import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '../../atoms/sessions'
import type { LoadedProject } from '@craft-agent/shared/projects/types'
import {
  NO_PROJECT_FILTER_ID,
  buildSessionProjectFilterOptions,
  filterSessionProjectOptions,
  filterSessionsByProjectFilter,
  getSessionProjectFilterId,
} from '../session-project-filter'

function session(id: string, projectId?: string): SessionMeta {
  return {
    id,
    workspaceId: 'workspace-1',
    projectId,
  }
}

function project(id: string, name: string): LoadedProject {
  return {
    config: {
      id,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      createdAt: 1,
      updatedAt: 1,
    },
    folderPath: `/workspace/projects/${id}`,
    assetsPath: `/workspace/projects/${id}/assets`,
    workspaceRootPath: '/workspace',
    workspaceId: 'workspace-1',
  }
}

describe('getSessionProjectFilterId', () => {
  it('uses official session.projectId and falls back to no-project', () => {
    expect(getSessionProjectFilterId(session('one', 'proj_craft'))).toBe('proj_craft')
    expect(getSessionProjectFilterId(session('none'))).toBe(NO_PROJECT_FILTER_ID)
  })
})

describe('buildSessionProjectFilterOptions', () => {
  it('builds filter options from official Projects and session.projectId counts', () => {
    const options = buildSessionProjectFilterOptions([
      session('one', 'proj_craft'),
      session('two', 'proj_craft'),
      session('three', 'proj_pi'),
      session('four'),
    ], [project('proj_craft', 'Craft Agents OSS'), project('proj_pi', 'Pi')])

    expect(options).toEqual([
      {
        id: 'proj_craft',
        label: 'Craft Agents OSS',
        projectId: 'proj_craft',
        slug: 'craft-agents-oss',
        color: undefined,
        count: 2,
      },
      {
        id: 'proj_pi',
        label: 'Pi',
        projectId: 'proj_pi',
        slug: 'pi',
        color: undefined,
        count: 1,
      },
      {
        id: NO_PROJECT_FILTER_ID,
        label: 'No project',
        projectId: null,
        count: 1,
      },
    ])
  })
})

describe('filterSessionsByProjectFilter', () => {
  it('applies include and exclude filters using official session.projectId', () => {
    const sessions = [
      session('craft', 'proj_craft'),
      session('pi', 'proj_pi'),
      session('none'),
    ]

    expect(filterSessionsByProjectFilter(
      sessions,
      new Map<string, 'include' | 'exclude'>([['proj_craft', 'include']]),
    ).map(s => s.id)).toEqual(['craft'])

    expect(filterSessionsByProjectFilter(
      sessions,
      new Map<string, 'include' | 'exclude'>([[NO_PROJECT_FILTER_ID, 'exclude']]),
    ).map(s => s.id)).toEqual(['craft', 'pi'])
  })
})

describe('filterSessionProjectOptions', () => {
  it('matches official projects by display name', () => {
    const options = buildSessionProjectFilterOptions([
      session('craft', 'proj_craft'),
      session('pi', 'proj_pi'),
    ], [project('proj_craft', 'Craft Agents OSS'), project('proj_pi', 'Pi')])

    expect(filterSessionProjectOptions(options, 'craft').map(o => o.id)).toEqual(['proj_craft'])
    expect(filterSessionProjectOptions(options, 'pi').map(o => o.id)).toEqual(['proj_pi'])
  })
})
