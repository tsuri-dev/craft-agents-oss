import { describe, expect, it } from 'bun:test'
import { getAgentAvatarPresentation } from '../agent-avatar'

describe('agent avatar presentation', () => {
  it('generates stable initials and colors from agent identity', () => {
    const first = getAgentAvatarPresentation({ id: 'niu-ma', name: 'niuma' })
    const second = getAgentAvatarPresentation({ id: 'niu-ma', name: 'niuma' })

    expect(second).toEqual(first)
    expect(first.initials).toBe('NI')
  })

  it('uses readable two-letter initials for multi-word names', () => {
    expect(getAgentAvatarPresentation({ id: 'qqnews-implementation', name: 'Tapd Agent' }).initials).toBe('TA')
  })

  it('gives common default requirement agents distinct avatar treatments', () => {
    const tapd = getAgentAvatarPresentation({ id: 'qqnews-implementation', name: 'Tapd' })
    const niuma = getAgentAvatarPresentation({ id: 'niu-ma', name: 'niuma' })
    const ci = getAgentAvatarPresentation({ id: 'ci', name: 'ci' })

    expect(new Set([tapd.background, niuma.background, ci.background]).size).toBeGreaterThan(1)
  })
})
