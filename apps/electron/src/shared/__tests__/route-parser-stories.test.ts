import { describe, expect, it } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: stories routes', () => {
  it('parses "stories" as stories navigator', () => {
    const result = parseCompoundRoute('stories')
    expect(result).toEqual({
      navigator: 'stories',
      details: null,
    })
  })

  it('roundtrips the stories compound route', () => {
    const parsed = parseCompoundRoute('stories')!
    expect(buildCompoundRoute(parsed)).toBe('stories')
  })

  it('maps "stories" to NavigationState', () => {
    expect(parseRouteToNavigationState('stories')).toEqual({
      navigator: 'stories',
    })
  })

  it('builds the stories route from NavigationState', () => {
    expect(buildRouteFromNavigationState({ navigator: 'stories' })).toBe('stories')
  })
})
