// @vitest-environment node
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { parseHtmlSummary } from '../../electron/htmlSummary'
import type { PreviewSnapshot } from '../types/webPreview'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const snapshot = (html: string, archive?: string): PreviewSnapshot => ({
  html, title: 'Captured title', finalUrl: 'https://example.org/papers/old/index.html',
  capturedAt: 1, contentHash: 'historical-hash', byteLength: Buffer.byteLength(html),
  ...(archive ? { archiveMhtml: Buffer.from(archive).toString('base64') } : {}),
})

function archive(parts: string[]) {
  return ['MIME-Version: 1.0', 'Content-Type: multipart/related;', '\tboundary="saved-boundary"', '',
    ...parts.flatMap(part => ['--saved-boundary', part]), '--saved-boundary--', ''].join('\r\n')
}

describe('HTML summary parser', () => {
  it('retains primary content, heading levels, nested lists, code, and formulas in source order', async () => {
    const document = await parseHtmlSummary(snapshot(`<html><body><nav>menu</nav><main>
      <header><h1 id="title">Saved research</h1></header><h3 id="method">Method</h3>
      <p>First <strong>paragraph</strong>.</p><ol start="3"><li>Third<ul><li>Nested</li></ul></li><li>Fourth</li></ol>
      <pre><code>const x = 1\n  x += 2</code></pre>
      <math id="equation"><semantics><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow><annotation encoding="application/x-tex">x + 1</annotation></semantics></math>
      <script>globalThis.shouldNotRun = true</script><style>hidden styling</style><nav>next menu</nav>
    </main><footer>Copyright navigation</footer></body></html>`))
    expect(document.items.filter(item => item.kind === 'heading').map(item => [item.id, item.text, item.level, item.anchor]))
      .toEqual([['heading-1', 'Saved research', 1, 'title'], ['heading-2', 'Method', 3, 'method']])
    const text = document.items.map(item => item.text).join('\n')
    expect(text).toContain('First paragraph.')
    expect(text).toContain('3. Third')
    expect(text).toContain('- Nested')
    expect(text).toContain('4. Fourth')
    expect(text).toContain('const x = 1\n  x += 2')
    expect(document.items.find(item => item.kind === 'formula')).toMatchObject({ id: 'formula-1', text: 'x + 1', anchor: 'equation' })
    expect(text).not.toMatch(/menu|Copyright|shouldNotRun|hidden styling/)
  })

  it('keeps every main article and does not silently truncate the captured body', async () => {
    const longText = '完整正文内容'.repeat(40000)
    const document = await parseHtmlSummary(snapshot(`<main><article><p>${longText}</p></article><article><p>FINAL SAVED PARAGRAPH</p></article></main>`))
    expect(document.items.map(item => item.text).join('\n') === `${longText}\nFINAL SAVED PARAGRAPH`).toBe(true)
    expect(document.warnings).toEqual([])
  })

  it('keeps table headers, rowspan, colspan, and caption as structured data', async () => {
    const document = await parseHtmlSummary(snapshot(`<article><table id="results"><caption>Saved results</caption>
      <thead><tr><th rowspan="2">Model</th><th colspan="2">Score</th></tr><tr><th>A</th><th>B</th></tr></thead>
      <tbody><tr><th scope="row">Ours</th><td>91</td><td>92</td></tr></tbody>
    </table></article>`))
    expect(document.items).toHaveLength(1)
    expect(document.items[0]).toMatchObject({
      id: 'table-1', kind: 'table', caption: 'Saved results', anchor: 'results', pages: [], regions: [],
      table: { numRows: 3, numCols: 3, cells: [
        { text: 'Model', row: 0, column: 0, rowSpan: 2, colSpan: 1, columnHeader: true, rowHeader: false },
        { text: 'Score', row: 0, column: 1, rowSpan: 1, colSpan: 2, columnHeader: true, rowHeader: false },
        { text: 'A', row: 1, column: 1, rowSpan: 1, colSpan: 1, columnHeader: true, rowHeader: false },
        { text: 'B', row: 1, column: 2, rowSpan: 1, colSpan: 1, columnHeader: true, rowHeader: false },
        { text: 'Ours', row: 2, column: 0, rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: true },
        { text: '91', row: 2, column: 1, rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
        { text: '92', row: 2, column: 2, rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
      ] },
    })
  })

  it('retains all nondecorative images and captions, including missing archived resources', async () => {
    const document = await parseHtmlSummary(snapshot(`<main><figure id="figure"><img src="data:image/png;base64,${png}" alt="First panel"><img src="missing.png" alt="Second panel"><figcaption>图 1：中文图注</figcaption></figure>
      <p><img src="uncaptioned.png" alt="An uncaptioned graph"></p><img role="presentation" src="decorative.png"><img alt="" src="spacer.png"></main>`))
    const pictures = document.items.filter(item => item.kind === 'picture')
    expect(pictures.map(item => [item.id, item.text, item.caption])).toEqual([
      ['picture-1', 'First panel', '图 1：中文图注'], ['picture-2', 'Second panel', '图 1：中文图注'],
      ['picture-3', 'An uncaptioned graph', ''],
    ])
    expect(pictures[0].images[0].data).toMatch(/^data:image\/png;base64,/)
    expect(pictures[1].images).toEqual([])
    expect(pictures[2].images).toEqual([])
    expect(document.warnings).toHaveLength(2)
    expect(document.warnings.join('\n')).toMatch(/picture-2/)
    expect(document.warnings.join('\n')).toMatch(/picture-3/)
  })

  it('resolves relative and cid images solely from the historical MIME archive', async () => {
    const mime = archive([
      'Content-Type: text/html\r\nContent-Location: https://example.org/papers/old/index.html\r\n\r\n<p>Archive wrapper must not replace snapshot text</p>',
      `Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Location: ../assets/chart.png\r\n\r\n${png.slice(0, 40)}\r\n${png.slice(40)}`,
      `Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <second@saved>\r\n\r\n${png}`,
    ])
    const document = await parseHtmlSummary(snapshot('<main><p>Historical body</p><img src="../assets/chart.png"><img src="cid:second@saved"></main>', mime))
    expect(document.items.filter(item => item.kind === 'picture').every(item => item.images[0]?.data?.startsWith('data:image/png;base64,'))).toBe(true)
    expect(document.items.filter(item => item.kind === 'picture')).toHaveLength(2)
    expect(document.items[0].text).toBe('Historical body')
    expect(document.warnings).toEqual([])
  })

  it.each(['chrome--', '----MultipartBoundary--saved----'])('loads archived images when the MIME boundary itself ends in hyphens (%s)', async boundary => {
    const mime = [
      'MIME-Version: 1.0', `Content-Type: multipart/related; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/html', '', '<p>Saved page</p>',
      `--${boundary}`, 'Content-Type: image/png', 'Content-Transfer-Encoding: base64',
      'Content-Location: images/first.png', '', png,
      `--${boundary}`, 'Content-Type: image/png', 'Content-Transfer-Encoding: base64',
      'Content-ID: <second@saved>', '', png,
      `--${boundary}--`, '',
    ].join('\r\n')
    const document = await parseHtmlSummary(snapshot('<main><img src="images/first.png"><img src="cid:second@saved"></main>', mime))
    const pictures = document.items.filter(item => item.kind === 'picture')
    expect(pictures).toHaveLength(2)
    expect(pictures.map(item => item.images.length)).toEqual([1, 1])
    expect(pictures.every(item => item.images[0]?.data?.startsWith('data:image/png;base64,'))).toBe(true)
    expect(document.warnings).toEqual([])
  })

  it('decodes quoted-printable archived SVG and converts it to a supported raster image', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'
    const mime = archive([`Content-Type: image/svg+xml\r\nContent-Transfer-Encoding: quoted-printable\r\nContent-Location: images/vector.svg\r\n\r\n${svg.replace(/=/g, '=3D').replace('<rect', '=\r\n<rect')}`])
    const document = await parseHtmlSummary(snapshot('<article><img src="images/vector.svg" alt="Vector chart"></article>', mime))
    const data = document.items[0].images[0].data!
    expect(data).toMatch(/^data:image\/png;base64,/)
    expect(await sharp(Buffer.from(data.split(',')[1], 'base64')).metadata()).toMatchObject({ width: 2, height: 2, format: 'png' })
    expect(document.warnings).toEqual([])
  })

  it('preserves image-only content and reports invalid image data instead of losing the item', async () => {
    const document = await parseHtmlSummary(snapshot('<main><img src="data:image/png;base64,bm90LWEtcG5n" alt="Corrupted source"></main>'))
    expect(document.items).toHaveLength(1)
    expect(document.items[0]).toMatchObject({ kind: 'picture', text: 'Corrupted source', images: [] })
    expect(document.warnings).toHaveLength(1)
  })

  it('rejects oversized HTML explicitly instead of generating a partial summary', async () => {
    await expect(parseHtmlSummary(snapshot(`<main>${'x'.repeat(16 * 1024 * 1024)}</main>`))).rejects.toThrow(/大小|上限|过大/)
  })

  it('keeps captioned figures with empty alt and does not duplicate nested list images', async () => {
    const document = await parseHtmlSummary(snapshot(`<main><figure><img alt="" src="data:image/png;base64,${png}"><figcaption>Figure with a meaningful caption</figcaption></figure>
      <ul><li>Outer<ul><li>Inner<img src="data:image/png;base64,${png}"></li></ul></li></ul></main>`))
    const pictures = document.items.filter(item => item.kind === 'picture')
    expect(pictures).toHaveLength(2)
    expect(pictures[0].caption).toBe('Figure with a meaningful caption')
    expect(pictures.every(item => item.images.length === 1)).toBe(true)
  })

  it('uses archived srcset alternatives when the snapshot image source is missing', async () => {
    const mime = archive([`Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\nContent-Location: images/large.png\r\n\r\n${png}`])
    const document = await parseHtmlSummary(snapshot('<main><img src="missing.png" srcset="images/small.png 1x, images/large.png 2x" alt="Responsive graph"></main>', mime))
    expect(document.items[0].images).toHaveLength(1)
    expect(document.warnings).toEqual([])
  })

  it('keeps TeX source from KaTeX and inert MathJax scripts without duplicate visual text', async () => {
    const document = await parseHtmlSummary(snapshot(`<main><p>Equation <span class="katex"><span class="katex-mathml"><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2</span></span>.</p>
      <script type="math/tex; mode=display">E = mc^2</script><script>executeMe()</script></main>`))
    expect(document.items.filter(item => item.kind === 'formula').map(item => item.text)).toEqual(['x^2', 'E = mc^2'])
    expect(document.items.map(item => item.text).join('\n')).not.toContain('executeMe')
  })

  it('keeps LaTeX from MathML alttext instead of flattening fractions', async () => {
    const document = await parseHtmlSummary(snapshot(String.raw`<main><math alttext="\frac{a}{b}"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>
      <span class="katex"><math alttext="x^2"><msup><mi>x</mi><mn>2</mn></msup></math></span></main>`))
    expect(document.items.map(item => [item.kind, item.text, item.formulaFormat])).toEqual([
      ['formula', String.raw`\frac{a}{b}`, 'latex'], ['formula', 'x^2', 'latex'],
    ])
    expect(document.warnings).toEqual([])
  })

  it('preserves full MathML and warns when no reliable LaTeX source exists', async () => {
    const document = await parseHtmlSummary(snapshot('<main><math id="fraction"><mfrac><mi>a</mi><mi>b</mi></mfrac></math><math><msup><mi>x</mi><mn>2</mn></msup></math></main>'))
    expect(document.items.map(item => [item.text, item.formulaFormat])).toEqual([
      ['<math id="fraction"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>', 'mathml'],
      ['<math><msup><mi>x</mi><mn>2</mn></msup></math>', 'mathml'],
    ])
    expect(document.warnings).toHaveLength(2)
    expect(document.warnings[0]).toMatch(/formula-1.*MathML.*LaTeX/)
    expect(document.warnings[1]).toMatch(/formula-2.*MathML.*LaTeX/)
  })

  it('does not mistake text annotations or rendered glyphs for LaTeX source', async () => {
    const document = await parseHtmlSummary(snapshot('<main><math><semantics><msup><mi>x</mi><mn>2</mn></msup><annotation encoding="text/plain">x squared</annotation></semantics></math><span class="MathJax">x2</span></main>'))
    expect(document.items[0]).toMatchObject({ kind: 'formula', formulaFormat: 'mathml' })
    expect(document.items[0].text).toContain('<msup><mi>x</mi><mn>2</mn></msup>')
    expect(document.items[1]).toMatchObject({ kind: 'text' })
    expect(document.warnings).toHaveLength(2)
  })

  it('limits rowspan zero to its row group and keeps nested table structure', async () => {
    const document = await parseHtmlSummary(snapshot(`<main><table><thead><tr><th rowspan="0">A</th><th>B</th></tr><tr><th>C</th></tr></thead>
      <tbody><tr><td>D</td><td><table><tr><td>Inner</td></tr></table></td></tr></tbody></table></main>`))
    const tables = document.items.filter(item => item.kind === 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0].table?.cells[0]).toMatchObject({ rowSpan: 2 })
    expect(tables[0].table?.cells.find(cell => cell.text === 'D')).toMatchObject({ row: 2, column: 0 })
    expect(tables[1].table).toMatchObject({ numRows: 1, numCols: 1, cells: [{ text: 'Inner', row: 0, column: 0 }] })
  })

  it('rejects SVG external resources even when mislabeled as a raster or nested in a data image', async () => {
    const external = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="file:///not-a-real-image.png" width="2" height="2"/></svg>'
    const nested = `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="data:image/svg+xml;base64,${Buffer.from(external).toString('base64')}" width="2" height="2"/></svg>`
    const mislabeled = `${' '.repeat(600)}${external}`
    const document = await parseHtmlSummary(snapshot(`<main><p>Preserved body</p><img src="data:image/png;base64,${Buffer.from(mislabeled).toString('base64')}"><img src="data:image/svg+xml;base64,${Buffer.from(nested).toString('base64')}"></main>`))
    expect(document.items.filter(item => item.kind === 'picture').map(item => item.images.length)).toEqual([0, 0])
    expect(document.warnings).toHaveLength(2)
  })

  it('keeps an inline SVG chart as a source image with its caption, label, and anchor', async () => {
    const document = await parseHtmlSummary(snapshot('<main><figure id="comparison"><svg width="100" height="100" role="img" aria-label="Comparison chart"><rect x="0" y="0" width="30" height="50" fill="red"/><rect x="40" y="0" width="30" height="80" fill="blue"/></svg><figcaption>Figure 1. Two results</figcaption></figure></main>'))
    expect(document.items).toHaveLength(1)
    expect(document.items[0]).toMatchObject({ id: 'picture-1', kind: 'picture', text: 'Comparison chart', caption: 'Figure 1. Two results', anchor: 'comparison' })
    expect(document.items[0].images).toHaveLength(1)
    const data = document.items[0].images[0].data!
    expect(data).toMatch(/^data:image\/png;base64,/)
    expect(await sharp(Buffer.from(data.split(',')[1], 'base64')).metadata()).toMatchObject({ width: 100, height: 100 })
    expect(document.warnings).toEqual([])
  })

  it('keeps unsafe inline SVG and canvas as missing picture evidence with warnings', async () => {
    const document = await parseHtmlSummary(snapshot('<main><figure><svg aria-label="Archived external chart" width="100" height="100"><image href="https://example.org/remote.png" width="100" height="100"/></svg><figcaption>Figure 2. External chart</figcaption></figure><figure><canvas id="plot" aria-label="Interactive plot" width="200" height="100"></canvas><figcaption>Figure 3. Canvas plot</figcaption></figure></main>'))
    expect(document.items).toHaveLength(2)
    expect(document.items[0]).toMatchObject({ kind: 'picture', text: 'Archived external chart', caption: 'Figure 2. External chart', images: [] })
    expect(document.items[1]).toMatchObject({ kind: 'picture', text: 'Interactive plot', caption: 'Figure 3. Canvas plot', anchor: 'plot', images: [] })
    expect(document.warnings).toHaveLength(2)
    expect(document.warnings[0]).toMatch(/picture-1.*SVG/)
    expect(document.warnings[1]).toMatch(/picture-2.*canvas.*像素/)
  })

  it('does not duplicate formula SVG or decorative SVG as chart images', async () => {
    const document = await parseHtmlSummary(snapshot('<main><span class="MathJax" data-latex="x^2"><svg width="100" height="100"><text>x2</text></svg></span><svg role="presentation" width="20" height="20"><rect width="20" height="20"/></svg></main>'))
    expect(document.items).toHaveLength(1)
    expect(document.items[0]).toMatchObject({ kind: 'formula', text: 'x^2', formulaFormat: 'latex' })
    expect(document.warnings).toEqual([])
  })
})
