import { describe, expect, it } from 'bun:test'
import { buildRendererRouteFromDeepLinkTarget, handleDeepLink, parseDeepLink } from '../deep-link'
import { RPC_CHANNELS } from '../../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'
import type { WindowManager } from '../window-manager'

function createMockWindow(webContentsId: number) {
  return {
    isMinimized: () => false,
    restore: () => {},
    focus: () => {},
    isDestroyed: () => false,
    webContents: {
      id: webContentsId,
      isLoading: () => false,
      isDestroyed: () => false,
      once: () => {},
    },
  }
}

describe('parseDeepLink compound routes', () => {
  it('parses plugin requirement routes with focused window mode', () => {
    expect(parseDeepLink('craftagents://plugins/plugin/tapd/requirement/1010045201134757330?window=focused')).toEqual({
      workspaceId: undefined,
      view: 'plugins/plugin/tapd/requirement/1010045201134757330',
      windowMode: 'focused',
      rightSidebar: undefined,
    })
  })

  it('parses plugin requirement routes with app-specific dev scheme', () => {
    expect(parseDeepLink('craftagentsdev://plugins/plugin/tapd/requirement/1010045201134757330?window=focused')).toEqual({
      workspaceId: undefined,
      view: 'plugins/plugin/tapd/requirement/1010045201134757330',
      windowMode: 'focused',
      rightSidebar: undefined,
    })
  })

  it('parses agent profile routes with focused window mode', () => {
    expect(parseDeepLink('craftagents://agents/agent/niu-ma?window=focused')).toEqual({
      workspaceId: undefined,
      view: 'agents/agent/niu-ma',
      windowMode: 'focused',
      rightSidebar: undefined,
    })
  })
})

describe('buildRendererRouteFromDeepLinkTarget', () => {
  it('builds renderer route for TAPD plugin requirement deeplinks', () => {
    const target = parseDeepLink('craftagentsdev://plugins/plugin/tapd/requirement/1010045201134757330?window=focused')
    expect(target).toBeTruthy()
    expect(buildRendererRouteFromDeepLinkTarget(target!)).toBe('plugins/plugin/tapd/requirement/1010045201134757330')
  })
})

describe('handleDeepLink routing', () => {
  it('prefers resolved target client over preferred caller client', async () => {
    const targetWindow = createMockWindow(22)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: (webContentsId: number) => webContentsId === 22 ? 'ws-target' : 'ws-other',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      (wcId) => wcId === 22 ? 'client-target' : undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.channel).toBe(RPC_CHANNELS.deeplink.NAVIGATE)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-target' })
  })

  it('uses preferred client only when no resolver is provided', async () => {
    const targetWindow = createMockWindow(31)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'client', clientId: 'client-caller' })
  })

  it('falls back to workspace routing when resolver exists but target client is unresolved', async () => {
    const targetWindow = createMockWindow(44)

    const windowManager = {
      focusOrCreateWindow: () => targetWindow,
      getFocusedWindow: () => targetWindow,
      getLastActiveWindow: () => targetWindow,
      getWorkspaceForWindow: () => 'ws-target',
    } as unknown as WindowManager

    const sent: Array<{ channel: string; target: unknown; args: unknown[] }> = []
    const sink: EventSink = (channel, target, ...args) => {
      sent.push({ channel, target, args })
    }

    await handleDeepLink(
      'craftagents://workspace/ws-target/allSessions',
      windowManager,
      sink,
      () => undefined,
      'client-caller',
    )

    expect(sent.length).toBe(1)
    expect(sent[0]?.target).toEqual({ to: 'workspace', workspaceId: 'ws-target' })
  })
})
