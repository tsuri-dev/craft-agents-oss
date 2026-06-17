import { describe, expect, it } from 'bun:test'
import { promptBlocksToCraftMessage } from './craft-adapter.ts'

describe('Craft ACP adapter prompt conversion', () => {
  it('keeps text prompts', () => {
    expect(promptBlocksToCraftMessage([{ type: 'text', text: 'Fix this' }])).toBe('Fix this')
  })

  it('embeds resource text with file path and code fence', () => {
    const message = promptBlocksToCraftMessage([
      { type: 'text', text: 'Review this selection' },
      {
        type: 'resource',
        resource: {
          uri: 'file:///Users/me/project/src/app.ts',
          mimeType: 'text/typescript',
          text: 'const x: string = 1',
        },
      },
    ])

    expect(message).toContain('Review this selection')
    expect(message).toContain('Context resource: /Users/me/project/src/app.ts')
    expect(message).toContain('```ts')
    expect(message).toContain('const x: string = 1')
  })

  it('embeds Zed selection resources with line ranges', () => {
    const message = promptBlocksToCraftMessage([
      {
        type: 'resource',
        resource: {
          uri: 'file:///Users/me/project/src/app.ts#L5:15',
          mimeType: 'text/typescript',
          text: 'function selected() {\n  return true\n}',
        },
      },
    ])

    expect(message).toContain('Context resource: /Users/me/project/src/app.ts')
    expect(message).toContain('Range: L5-L15')
    expect(message).toContain('MIME type: text/typescript')
    expect(message).toContain('```ts')
  })

  it('embeds Zed selection resources with path query metadata', () => {
    const message = promptBlocksToCraftMessage([
      {
        type: 'resource',
        resource: {
          uri: 'zed:///agent/selection?path=%2FUsers%2Fme%2Fproject%2Fsrc%2Fview.tsx&column=7#L20-L24',
          mimeType: 'text/typescript',
          text: '<View />',
        },
      },
    ])

    expect(message).toContain('Context resource: /Users/me/project/src/view.tsx')
    expect(message).toContain('Range: L20-L24')
    expect(message).toContain('Column: 7')
  })

  it('embeds Zed symbol resources with symbol names', () => {
    const message = promptBlocksToCraftMessage([
      {
        type: 'resource',
        resource: {
          uri: 'file:///Users/me/project/src/app.ts?symbol=renderCard#L42-L60',
          mimeType: 'text/typescript',
          text: 'function renderCard() {}',
        },
      },
    ])

    expect(message).toContain('Context resource: /Users/me/project/src/app.ts')
    expect(message).toContain('Range: L42-L60')
    expect(message).toContain('Symbol: renderCard')
  })

  it('represents resource links without loading them in the MVP', () => {
    const message = promptBlocksToCraftMessage([
      { type: 'resource_link', uri: 'file:///tmp/readme.md', name: 'README.md' },
    ])
    expect(message).toContain('Resource link: README.md')
    expect(message).toContain('file:///tmp/readme.md')
  })
})
