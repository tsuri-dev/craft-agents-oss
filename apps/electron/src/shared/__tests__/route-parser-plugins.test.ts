import { describe, expect, it } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: plugins routes', () => {
  it('parses "plugins" as plugins navigator', () => {
    expect(parseCompoundRoute('plugins')).toEqual({
      navigator: 'plugins',
      details: null,
    })
  })

  it('parses plugin intro, board, and requirement routes', () => {
    expect(parseCompoundRoute('plugins/plugin/tapd')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin', id: 'tapd' },
    })
    expect(parseCompoundRoute('plugins/plugin/tapd/board')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin-board', id: 'tapd' },
    })
    expect(parseCompoundRoute('plugins/plugin/tapd/requirement/1010045201134227877')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin-requirement', id: 'tapd', sourceItemId: '1010045201134227877' },
    })
  })

  it('roundtrips plugin routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('plugins')!)).toBe('plugins')
    expect(buildCompoundRoute(parseCompoundRoute('plugins/plugin/tapd')!)).toBe('plugins/plugin/tapd')
    expect(buildCompoundRoute(parseCompoundRoute('plugins/plugin/tapd/board')!)).toBe('plugins/plugin/tapd/board')
    expect(buildCompoundRoute(parseCompoundRoute('plugins/plugin/tapd/requirement/1010045201134227877')!)).toBe('plugins/plugin/tapd/requirement/1010045201134227877')
  })

  it('maps plugins routes to NavigationState', () => {
    expect(parseRouteToNavigationState('plugins')).toEqual({
      navigator: 'plugins',
      details: null,
    })
    expect(parseRouteToNavigationState('plugins/plugin/tapd')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin', pluginId: 'tapd', page: 'intro' },
    })
    expect(parseRouteToNavigationState('plugins/plugin/tapd/board')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin', pluginId: 'tapd', page: 'board' },
    })
    expect(parseRouteToNavigationState('plugins/plugin/tapd/requirement/1010045201134227877')).toEqual({
      navigator: 'plugins',
      details: { type: 'plugin', pluginId: 'tapd', page: 'requirement', sourceItemId: '1010045201134227877' },
    })
  })

  it('builds plugins routes from NavigationState', () => {
    expect(buildRouteFromNavigationState({ navigator: 'plugins', details: null })).toBe('plugins')
    expect(buildRouteFromNavigationState({ navigator: 'plugins', details: { type: 'plugin', pluginId: 'tapd' } })).toBe('plugins/plugin/tapd')
    expect(buildRouteFromNavigationState({ navigator: 'plugins', details: { type: 'plugin', pluginId: 'tapd', page: 'intro' } })).toBe('plugins/plugin/tapd')
    expect(buildRouteFromNavigationState({ navigator: 'plugins', details: { type: 'plugin', pluginId: 'tapd', page: 'board' } })).toBe('plugins/plugin/tapd/board')
    expect(buildRouteFromNavigationState({ navigator: 'plugins', details: { type: 'plugin', pluginId: 'tapd', page: 'requirement', sourceItemId: '1010045201134227877' } })).toBe('plugins/plugin/tapd/requirement/1010045201134227877')
  })
})
