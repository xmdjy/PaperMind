import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../utils/markdown'

describe('renderMarkdown', () => {
  it('renders common Markdown structures', () => {
    const html = renderMarkdown(`# Heading

- first
- second

\`inline\`

\`\`\`ts
const answer = 42
\`\`\`

| A | B |
| - | - |
| 1 | 2 |`)

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<code>inline</code>')
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain('<table>')
  })

  it('opens links externally without exposing the opener', () => {
    const html = renderMarkdown('[Paper](https://example.com/paper)')

    expect(html).toContain('href="https://example.com/paper"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('does not render raw or dangerous HTML', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(1)</script>')

    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
  })

  it('does not create links for unsafe protocols', () => {
    const html = renderMarkdown('[unsafe](javascript:alert(1))')

    expect(html).not.toContain('<a ')
  })
})
