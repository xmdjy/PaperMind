import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../utils/markdown'

describe('renderMarkdown', () => {
  const view = (content: string) => {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(content)
    return root
  }

  it.each([
    ['**MCE（2026）**进一步说明', 'MCE（2026）'],
    ['采用**“上下文工程”**方法', '“上下文工程”'],
    ['采用**(context)**方法', '(context)'],
    ['采用__“上下文工程”__方法', '“上下文工程”'],
    ['**MCE（含 `code` 与 $x$）**进一步说明', 'MCE（含 code 与 x）'],
    ['**$x$**表示变量', 'x'],
    ['**`code`**表示代码', 'code'],
    ['**L∞**范数', 'L∞'],
  ])('renders emphasis next to Chinese punctuation: %s', (source, label) => {
    const root = view(source)
    const strong = root.querySelector('strong')
    expect(strong).not.toBeNull()
    for (const math of Array.from(strong!.querySelectorAll('.katex'))) math.replaceWith('x')
    expect(strong?.textContent).toBe(label)
    expect(root.textContent).not.toContain('**')
  })

  it('keeps literal emphasis, code, URLs and unfinished delimiters unchanged', () => {
    const root = view('`**（literal）**中文` \\*\\*转义\\*\\* **未结束\n\n```md\n**（代码）**中文\n```\n\n[x](https://example.com/a**b)')
    expect(root.querySelectorAll('strong')).toHaveLength(0)
    expect(root.querySelector('code')?.textContent).toBe('**（literal）**中文')
    expect(root.querySelector('pre code')?.textContent).toBe('**（代码）**中文\n')
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a**b')
  })

  it.each([
    ['`\\(literal\\)`', '\\(literal\\)'],
    ['```tex\n\\[code\\]\n```', '\\[code\\]\n'],
    ['~~~tex\n\\(code\\)\n~~~', '\\(code\\)\n'],
    ['    \\[code\\]', '\\[code\\]\n'],
  ])('preserves literal math in code: %s', (source, expected) => {
    const root = view(source)
    expect(root.querySelector('code')?.textContent).toBe(expected)
    expect(root.querySelector('.katex')).toBeNull()
  })

  it('preserves escaped math delimiters and link destinations', () => {
    const root = view('\\\\(literal\\\\) \\\\[literal\\\\]\n\n[literal](https://example.com/\\(x\\))')
    expect(root.querySelector('.katex')).toBeNull()
    expect(root.querySelector('p')?.textContent).toBe('\\(literal\\) \\[literal\\]')
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com/(x)')
  })

  it('renders bracket math adjacent to digits without changing delimiters to currency', () => {
    const root = view('2\\(x\\) and \\(x\\)2')
    expect(root.querySelectorAll('.katex')).toHaveLength(2)
    expect(Array.from(root.querySelectorAll('.katex-html')).map(node => node.textContent)).toEqual(['x', 'x'])
  })

  it('keeps display math and continuation inside their list item', () => {
    const root = view('- before\n\n  \\[x^2\\]\n\n  after\n- next')
    expect(root.querySelectorAll(':scope > ul')).toHaveLength(1)
    expect(root.querySelectorAll('li')).toHaveLength(2)
    expect(root.querySelector('li .katex-display')).not.toBeNull()
    expect(root.querySelector('li')?.textContent).toContain('after')
  })

  it('renders multiline quoted display math without quote markers in the formula', () => {
    const root = view('> before\n>\n> \\[\n> x^2\n> \\]\n>\n> after')
    expect(root.querySelectorAll(':scope > blockquote')).toHaveLength(1)
    expect(root.querySelector('blockquote .katex-display')).not.toBeNull()
    expect(root.querySelector('.katex-html')?.textContent).not.toContain('>')
    expect(root.querySelector('blockquote')?.textContent).toContain('after')
  })

  it('renders bracket display math within a table cell without adding rows', () => {
    const root = view('| A | B |\n| - | - |\n| \\[x^2\\] | x |')
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(root.querySelectorAll('td')).toHaveLength(2)
    expect(root.querySelector('td .katex-display')).not.toBeNull()
    expect(root.querySelector('.katex-error')).toBeNull()
  })

  it('does not move unrelated punctuation just because a report has paper evidence', () => {
    const root = view(`![original](asset:${'a'.repeat(64)})\n\n*原文图片* [p2](paper-source:p:1)\n\nEarlier.\n\n:literal leading colon`)
    expect(root.querySelector('p:last-child')?.textContent).toBe(':literal leading colon')
  })

  it('preserves leading punctuation after evidence when there is no preceding claim', () => {
    const root = view(`![original](asset:${'a'.repeat(64)})\n\n*原文图片* [p2](paper-source:p:1)\n\n；独立说明。`)
    expect(root.querySelector('p')?.textContent).toBe('；独立说明。')
  })

  it('does not wrap an entire list as a sourced formula', () => {
    const root = view('- $$x$$\n- plain\n\n[p1](paper-source:p:0)')
    expect(root.querySelector('figure ul')).toBeNull()
    expect(root.querySelectorAll('li')).toHaveLength(2)
    expect(root.querySelector('li:last-child')?.textContent).toBe('plain')
  })

  it.each(['\\[x\\] 后续说明', '$$x$$ 后续说明', '\\[\nx\n\\] 后续说明'])('keeps prose after display math: %s', source => {
    const root = view(source)
    expect(root.querySelector('.katex-display')).not.toBeNull()
    expect(root.textContent).toContain('后续说明')
  })

  it.each([
    String.raw`\[\begin{matrix}x\\] + y\end{matrix}\]`,
    String.raw`$$x \$\$$$`,
  ])('does not mistake escaped formula characters for closing delimiters: %s', source => {
    const root = view(source)
    expect(root.querySelectorAll('.katex-display')).toHaveLength(1)
    expect(root.querySelector('.katex-error')).toBeNull()
    root.querySelector('.katex')?.remove()
    expect(root.textContent?.trim()).toBe('')
  })

  it('keeps the report readable if a formula exceeds the math renderer stack', () => {
    const root = view(`$$${'{'.repeat(2500)}x${'}'.repeat(2500)}$$\n\n后续正文`)
    expect(root.querySelector('.katex-error')).not.toBeNull()
    expect(root.textContent).toContain('后续正文')
  })

  it('preserves readable original-image descriptions and titles', () => {
    const root = view(`![A [B] \\[C\\] **bold** \`code\`](asset:${'a'.repeat(64)} "Figure > 1")`)
    expect(root.querySelector('img')?.alt).toBe('A [B] [C] bold code')
    expect(root.querySelector('img')?.title).toBe('Figure > 1')
  })

  it('groups old report images with their short source label and repairs detached punctuation', () => {
    const id = 'a'.repeat(64)
    const html = renderMarkdown(`结果提高 [p2](paper-source:paper:1)。\n\n![原文图片](asset:${id})\n\n*原文图片* [p2](paper-source:paper:1)\n\n；后续实验也支持这一点。`)
    const container = document.createElement('div')
    container.innerHTML = html
    const figure = container.querySelector('figure.paper-evidence--image')
    expect(figure?.querySelector('img')?.getAttribute('data-asset-id')).toBe(id)
    expect(figure?.querySelector('figcaption')?.textContent).toContain('原文图片')
    expect(figure?.querySelector('figcaption .paper-source')?.textContent).toBe('p2')
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.querySelectorAll('p')[1].textContent).toBe('后续实验也支持这一点。')
  })

  it('groups a sourced display formula without altering ordinary formulas', () => {
    const html = renderMarkdown('$$\nx = y\n$$\n\n[p4](paper-source:paper:3)')
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelector('figure.paper-evidence--formula .katex-display')).not.toBeNull()
    expect(container.querySelector('figcaption .paper-source')?.textContent).toBe('p4')
    expect(renderMarkdown('$$\nx = y\n$$')).not.toContain('paper-evidence')
  })

  it('removes punctuation and a duplicated source line after consecutive evidence blocks', () => {
    const id = 'a'.repeat(64)
    const html = renderMarkdown(`论述尚未结束 [p2](paper-source:paper:1)\n\n$$\nx = y\n$$\n\n[p2](paper-source:paper:1)\n\n![原文图片](asset:${id})\n\n*原文图片* [p2](paper-source:paper:1)\n\n；后续论述。\n\n[p2](paper-source:paper:1)`)
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelectorAll('figure.paper-evidence')).toHaveLength(2)
    expect(container.querySelectorAll('p')).toHaveLength(2)
    expect(container.querySelectorAll('p')[0].textContent).toContain('论述尚未结束 p2；')
    expect(container.querySelectorAll('p')[1].textContent).toBe('后续论述。 p2')
  })
  it('moves a page-only line after a figure back onto the preceding claim', () => {
    const id = 'a'.repeat(64)
    const html = renderMarkdown(`评测增幅最大\n\n![原文表格](asset:${id})\n\n*原文表格* [p29](paper-source:paper:28)\n\n[p30](paper-source:paper:29)。 [p29](paper-source:paper:28)`)
    const container = document.createElement('div')
    container.innerHTML = html
    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('p')?.textContent).toBe('评测增幅最大 p30。')
    expect(container.querySelector('figcaption')?.textContent).toContain('p29')
  })
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

  it('renders dollar-delimited inline and display LaTeX', () => {
    const html = renderMarkdown('Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 \\, dx\n$$')

    expect(html).toContain('class="katex"')
    expect(html).toContain('class="katex-display"')
    expect(html).toContain('<math')
  })

  it('normalizes bracket-delimited display LaTeX to dollar delimiters', () => {
    const html = renderMarkdown('\\[\\sum_{i=1}^{n} i\\]')

    expect(html).toContain('class="katex-display"')
    expect(html).not.toContain('\\[')
    expect(html).not.toContain('\\]')
  })

  it('normalizes parenthesis-delimited inline LaTeX to dollar delimiters', () => {
    const html = renderMarkdown('维度为 \\(d\\)，索引为 \\(k = 0, 1, \\dots, \\frac{d}{2}\\)。')
    const container = document.createElement('div')
    container.innerHTML = html

    expect(container.querySelectorAll('.katex')).toHaveLength(2)
    expect(container.querySelector('.katex-html')?.textContent).not.toContain('\\')
    expect(html).not.toContain('\\(')
    expect(html).not.toContain('\\)')
  })
})
