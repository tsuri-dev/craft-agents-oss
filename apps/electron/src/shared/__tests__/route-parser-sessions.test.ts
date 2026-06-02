import { describe, expect, it } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: session routes', () => {
  it('parses inbox as a sessions navigator filter', () => {
    expect(parseCompoundRoute('inbox')).toEqual({
      navigator: 'sessions',
      sessionFilter: { kind: 'inbox' },
      details: null,
    })
  })

  it('parses inbox session detail routes', () => {
    expect(parseCompoundRoute('inbox/session/session-123')).toEqual({
      navigator: 'sessions',
      sessionFilter: { kind: 'inbox' },
      details: { type: 'session', id: 'session-123' },
    })
  })

  it('roundtrips inbox routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('inbox')!)).toBe('inbox')
    expect(buildCompoundRoute(parseCompoundRoute('inbox/session/session-123')!)).toBe('inbox/session/session-123')
  })

  it('maps inbox routes to NavigationState', () => {
    expect(parseRouteToNavigationState('inbox')).toEqual({
      navigator: 'sessions',
      filter: { kind: 'inbox' },
      details: null,
    })
    expect(parseRouteToNavigationState('inbox/session/session-123')).toEqual({
      navigator: 'sessions',
      filter: { kind: 'inbox' },
      details: { type: 'session', sessionId: 'session-123' },
    })
  })

  it('builds inbox routes from NavigationState', () => {
    expect(buildRouteFromNavigationState({ navigator: 'sessions', filter: { kind: 'inbox' }, details: null })).toBe('inbox')
    expect(buildRouteFromNavigationState({ navigator: 'sessions', filter: { kind: 'inbox' }, details: { type: 'session', sessionId: 'session-123' } })).toBe('inbox/session/session-123')
  })
})
