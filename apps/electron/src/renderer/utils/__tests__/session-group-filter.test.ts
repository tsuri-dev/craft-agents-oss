import { describe, expect, it } from 'bun:test'
import {
  addSessionGroupLabel,
  buildSessionGroupFilterOptions,
  filterSessionsByGroupFilter,
  getSessionGroupValues,
  removeSessionGroupLabel,
  renameSessionGroupLabel,
  resolveUniqueSessionGroupName,
} from '../session-group-filter'

describe('session-group-filter', () => {
  it('reads all group values from valued group labels', () => {
    expect(getSessionGroupValues({ labels: ['group::Launch', 'bug', 'group::Research'] } as never)).toEqual(['Launch', 'Research'])
  })

  it('builds group options with membership counts', () => {
    const options = buildSessionGroupFilterOptions([
      { labels: ['group::Launch'] },
      { labels: ['group::Launch', 'group::Research'] },
      { labels: ['project::Craft'] },
    ] as never[])

    expect(options).toEqual([
      { id: 'Launch', label: 'Launch', value: 'Launch', count: 2 },
      { id: 'Research', label: 'Research', value: 'Research', count: 1 },
    ])
  })

  it('filters sessions by include and exclude group filters', () => {
    const sessions = [
      { id: 'a', labels: ['group::Launch'] },
      { id: 'b', labels: ['group::Research'] },
      { id: 'c', labels: ['group::Launch', 'group::Hidden'] },
      { id: 'd', labels: [] },
    ]

    expect(filterSessionsByGroupFilter(sessions, new Map([['Launch', 'include']])).map(s => s.id)).toEqual(['a', 'c'])
    expect(filterSessionsByGroupFilter(sessions, new Map([['Hidden', 'exclude']])).map(s => s.id)).toEqual(['a', 'b', 'd'])
    expect(filterSessionsByGroupFilter(sessions, new Map([['Launch', 'include'], ['Hidden', 'exclude']])).map(s => s.id)).toEqual(['a'])
  })

  it('adds, removes, and renames group labels without touching other labels', () => {
    const added = addSessionGroupLabel(['bug', 'group::Old'], 'New')
    expect(added).toEqual(['bug', 'group::Old', 'group::New'])
    expect(addSessionGroupLabel(added, 'New')).toBe(added)
    expect(removeSessionGroupLabel(added, 'Old')).toEqual(['bug', 'group::New'])
    expect(renameSessionGroupLabel(added, 'Old', 'Renamed')).toEqual(['bug', 'group::New', 'group::Renamed'])
  })

  it('resolves duplicate group names by appending an incrementing number', () => {
    expect(resolveUniqueSessionGroupName('Launch', ['Launch', 'Launch (2)'])).toBe('Launch (3)')
    expect(resolveUniqueSessionGroupName('Launch (2)', ['Launch', 'Launch (2)'])).toBe('Launch (3)')
    expect(resolveUniqueSessionGroupName('Launch', ['Launch'], 'Launch')).toBe('Launch')
  })
})
