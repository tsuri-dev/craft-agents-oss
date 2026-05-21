import { describe, expect, it } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: agents routes', () => {
  it('parses "agents" as agents navigator', () => {
    expect(parseCompoundRoute('agents')).toEqual({
      navigator: 'agents',
      details: null,
    })
  })

  it('parses agent detail routes', () => {
    expect(parseCompoundRoute('agents/agent/reviewer')).toEqual({
      navigator: 'agents',
      details: { type: 'agent', id: 'reviewer' },
    })
  })

  it('roundtrips agent routes', () => {
    expect(buildCompoundRoute(parseCompoundRoute('agents')!)).toBe('agents')
    expect(buildCompoundRoute(parseCompoundRoute('agents/agent/reviewer')!)).toBe('agents/agent/reviewer')
  })

  it('maps agents routes to NavigationState', () => {
    expect(parseRouteToNavigationState('agents')).toEqual({
      navigator: 'agents',
      details: null,
    })
    expect(parseRouteToNavigationState('agents/agent/reviewer')).toEqual({
      navigator: 'agents',
      details: { type: 'agent', agentId: 'reviewer' },
    })
  })

  it('builds agents routes from NavigationState', () => {
    expect(buildRouteFromNavigationState({ navigator: 'agents', details: null })).toBe('agents')
    expect(buildRouteFromNavigationState({ navigator: 'agents', details: { type: 'agent', agentId: 'reviewer' } })).toBe('agents/agent/reviewer')
  })
})
