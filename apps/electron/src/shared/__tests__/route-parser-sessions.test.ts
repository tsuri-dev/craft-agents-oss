import { describe, expect, it } from 'bun:test'
import {
  isCompoundRoute,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'

describe('route-parser: session routes', () => {
  it('does not expose the retired inbox route', () => {
    expect(isCompoundRoute('inbox')).toBe(false)
    expect(parseCompoundRoute('inbox')).toBeNull()
    expect(parseRouteToNavigationState('inbox')).toBeNull()
  })

  it('does not expose retired inbox session detail routes', () => {
    expect(isCompoundRoute('inbox/session/session-123')).toBe(false)
    expect(parseCompoundRoute('inbox/session/session-123')).toBeNull()
    expect(parseRouteToNavigationState('inbox/session/session-123')).toBeNull()
  })
})
