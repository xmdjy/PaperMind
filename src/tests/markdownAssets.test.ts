import { describe, expect, it } from 'vitest'
import { replaceSummaryAssets } from '../utils/markdownAssets'
import { createMarkdownParser } from '../utils/markdownParser'

const id = 'a'.repeat(64)
const foreign = 'b'.repeat(64)
const allowed = new Set([id])
const parser = createMarkdownParser()

describe('summary image references', () => {
  it.each([
    '`intro\n\n![remote](https://example.org/a.png)\n\n`',
    '- `one\n- ![remote](https://example.org/a.png)`',
    '> `one\n\n![remote](https://example.org/a.png)`',
    '| A | B |\n| - | - |\n| ` | ![remote](https://example.org/a.png) ` |',
  ])('checks real images across separate inline scopes: %s', raw => {
    const safe = replaceSummaryAssets(raw, allowed)
    expect(parser.render(safe)).not.toContain('<img')
    expect(safe).toContain('图片不可用')
  })

  it('rejects foreign local assets even between separate code-looking paragraphs', () => {
    const safe = replaceSummaryAssets('`intro\n\n![foreign](asset:' + foreign + ')\n\n`', allowed)
    expect(parser.render(safe)).not.toContain('<img')
    expect(safe).toContain('图片不可用')
  })

  it.each([
    '    ![literal](https://example.org/a.png)',
    '~~~md\n![literal](https://example.org/a.png)\n~~~',
    '```md\n![literal](https://example.org/a.png)\n```',
    '`![literal](https://example.org/a.png)`',
    '`<img src="https://example.org/a.png">`',
    '    <img src="https://example.org/a.png">',
    '~~~html\n<img src="https://example.org/a.png">\n~~~',
    '> ~~~md\n> ![literal](https://example.org/a.png)\n> ~~~',
    '- Example:\n\n      ![literal](https://example.org/a.png)',
    '\\![literal](https://example.org/a.png)',
    '[link](https://example.org/![literal](x) "<img src=x>")',
  ])('preserves image-looking literal content: %s', raw => {
    expect(replaceSummaryAssets(raw, allowed)).toBe(raw)
  })

  it('preserves approved image source, brackets, escapes, titles and reference definitions', () => {
    const raw = `![A [B] \\[C\\]](<asset:${id}> "Figure > 1")\n\n![reference][a] ![a][] ![a]\n\n[a]: asset:${id} 'Original title'`
    expect(replaceSummaryAssets(raw, allowed)).toBe(raw)
    const root = document.createElement('div')
    root.innerHTML = parser.render(replaceSummaryAssets(raw, allowed))
    expect(root.querySelectorAll('img')).toHaveLength(4)
    expect(root.querySelector('img')?.title).toBe('Figure > 1')
  })

  it('validates images in links without changing the link destination or title', () => {
    const raw = `[![remote](https://example.org/a.png)](https://example.org/paper "<img src=x>")\n\n[![original](asset:${id})](https://example.org/figure)`
    const root = document.createElement('div')
    root.innerHTML = parser.render(replaceSummaryAssets(raw, allowed))
    expect(root.querySelectorAll('img')).toHaveLength(1)
    expect(root.querySelector('img')?.getAttribute('src')).toBe(`asset:${id}`)
    expect(root.querySelector('a')?.title).toBe('<img src=x>')
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.org/paper')
  })

  it('keeps nested image syntax in an approved outer image as alt text', () => {
    const raw = `![Figure ![label](https://example.org/label.png)](asset:${id} "Title")`
    expect(replaceSummaryAssets(raw, allowed)).toBe(raw)
    const html = parser.render(replaceSummaryAssets(raw, allowed))
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).not.toContain('src="https://')
  })

  it('replaces raw image tags outside literals without breaking quoted greater-than signs', () => {
    expect(replaceSummaryAssets('Before <img alt="a > b" src="x"> after', allowed))
      .toBe('Before [图片不可用：不受支持的图片引用] after')
  })

  it('preserves containers and CRLF while removing multiline disallowed images', () => {
    const raw = '> - Intro\r\n>   ![remote\r\n>   caption](https://example.org/a.png)\r\n>   After\r\n'
    const safe = replaceSummaryAssets(raw, allowed)
    expect(safe).toBe('> - Intro\r\n>   [图片不可用：remote caption]\r\n>   After\r\n')
    expect(parser.render(safe)).toContain('<blockquote>')
    expect(parser.render(safe)).toContain('<li>')
    expect(parser.render(safe)).not.toContain('<img')
  })

  it('keeps table escapes and cell boundaries while replacing actual images', () => {
    const raw = '| A | B |\n| - | - |\n| text \\| more | ![a \\| b](https://example.org/a.png) |'
    const safe = replaceSummaryAssets(raw, allowed)
    const root = document.createElement('div')
    root.innerHTML = parser.render(safe)
    expect(root.querySelectorAll('td')).toHaveLength(2)
    expect(root.querySelectorAll('td')[0].textContent).toBe('text | more')
    expect(root.querySelectorAll('td')[1].textContent).toBe('[图片不可用：a | b]')
    expect(root.querySelector('img')).toBeNull()
  })

  it('rejects unsafe schemes and reference images while retaining unrelated links', () => {
    const raw = '![x](javascript:alert(1)) ![y][remote] ![remote][] ![remote]\n\n[remote]: https://example.org/a.png\n\n[paper](https://example.org/paper)'
    const safe = replaceSummaryAssets(raw, allowed)
    const html = parser.render(safe)
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://example.org/paper"')
    expect(safe.match(/图片不可用/g)).toHaveLength(4)
  })

  it('validates images exposed when an unsafe surrounding link is rejected', () => {
    const raw = '[x](javascript:alert(1) "![remote](https://example.org/a.png)")'
    const safe = replaceSummaryAssets(raw, allowed)
    expect(parser.render(safe)).not.toContain('<img')
    expect(safe).toContain('图片不可用')
  })

  it('keeps decoded alt text literal in unavailable-image notices', () => {
    const safe = replaceSummaryAssets('![A &amp;amp; `$x$` **bold** [label] ~~text~~](https://example.org/a.png)', allowed)
    const root = document.createElement('div')
    root.innerHTML = parser.render(safe)
    expect(root.textContent?.trim()).toBe('[图片不可用：A &amp; $x$ bold [label] text]')
    expect(root.querySelector('strong, code, s, a, .katex')).toBeNull()
  })

  it('preserves image-like text inside math notation', () => {
    const raw = '$\\text{![literal](https://example.org/a.png)}$\n\n\\(\\text{![literal](https://example.org/a.png)}\\)\n\n$$\n\\text{![literal](https://example.org/a.png)}\n$$'
    expect(replaceSummaryAssets(raw, allowed)).toBe(raw)
  })
})
