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

  it('represents resource links without loading them in the MVP', () => {
    const message = promptBlocksToCraftMessage([
      { type: 'resource_link', uri: 'file:///tmp/readme.md', name: 'README.md' },
    ])
    expect(message).toContain('Resource link: README.md')
    expect(message).toContain('file:///tmp/readme.md')
  })
})
