import { parse, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import sharp from 'sharp'
import { MAX_IMAGE_BYTES, type DocumentItem, type ParsedDocument } from '../src/utils/doclingDocument'
import type { PreviewSnapshot } from '../src/types/webPreview'

type HtmlNode = {
  nodeName: string
  value?: string
  attrs?: { name: string; value: string }[]
  childNodes?: HtmlNode[]
  parentNode?: HtmlNode
}
type ArchiveResource = { mime: string; bytes: Buffer }
const MAX_HTML_BYTES = 16 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40 * 1024 * 1024
const ignored = new Set(['script', 'style', 'nav', 'footer', 'aside', 'form', 'iframe', 'object', 'embed', 'template', 'noscript', 'head', 'button', 'input', 'select', 'textarea'])
const blocks = new Set(['address', 'article', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const pictureTags = new Set(['img', 'svg', 'canvas'])
const attr = (node: HtmlNode, name: string) => node.attrs?.find(value => value.name === name)?.value
const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
const children = (node: HtmlNode) => node.childNodes ?? []
const texScript = (node: HtmlNode) => node.nodeName === 'script' && /^math\/tex(?:\s*;|$)/i.test(attr(node, 'type') ?? '')
const hidden = (node: HtmlNode) => attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden') === 'true'
  || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(attr(node, 'style') ?? '')
const excluded = (node: HtmlNode) => ignored.has(node.nodeName) && !texScript(node) || hidden(node)
  || ['navigation', 'banner', 'contentinfo'].includes(attr(node, 'role') ?? '')

function descendants(node: HtmlNode, predicate: (child: HtmlNode) => boolean, stop?: (child: HtmlNode) => boolean): HtmlNode[] {
  const found: HtmlNode[] = []
  const stack = [...children(node)].reverse()
  while (stack.length) {
    const current = stack.pop()!
    if (predicate(current)) found.push(current)
    if (!stop?.(current)) for (let i = children(current).length - 1; i >= 0; i--) stack.push(children(current)[i])
  }
  return found
}

function textOf(node: HtmlNode, preserveWhitespace = false, skipLists = false): string {
  if (excluded(node) || skipLists && ['ul', 'ol'].includes(node.nodeName)) return ''
  if (node.nodeName === '#text') return node.value ?? ''
  if (node.nodeName === 'br') return '\n'
  if (node.nodeName === 'img') return attr(node, 'alt') ?? ''
  const value = children(node).map(child => textOf(child, preserveWhitespace, skipLists)).join('')
  return preserveWhitespace ? value : blocks.has(node.nodeName) ? `${value}\n` : value
}

function sourceAnchor(node: HtmlNode): string | undefined {
  for (let current: HtmlNode | undefined = node; current; current = current.parentNode) {
    const id = attr(current, 'id')
    if (id) return id
  }
}

function absoluteResource(value: string, base: string): string {
  if (/^cid:/i.test(value)) return `cid:${value.slice(4).replace(/^<|>$/g, '')}`
  try { const url = new URL(value, base); url.hash = ''; return url.href } catch { return value }
}

function srcsetSources(value: string): string[] {
  const sources: string[] = []
  let remaining = value
  while (remaining) {
    remaining = remaining.replace(/^[\s,]+/, '')
    const url = /^\S+/.exec(remaining)?.[0]
    if (!url) break
    sources.push(url.replace(/,+$/, ''))
    remaining = remaining.slice(url.length)
    if (!url.endsWith(',')) remaining = remaining.replace(/^[^,]*(?:,|$)/, '')
  }
  return sources
}

function decodeBase64(value: string, limit: number): Buffer {
  const encoded = value.replace(/[\r\n\t ]/g, '')
  if (encoded.length > Math.ceil(limit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('图片或归档大小超限或编码无效')
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length > limit || bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) throw new Error('图片或归档编码无效')
  return bytes
}

function mimeEntity(raw: string): { headers: Map<string, string>; body: string } {
  const separator = /\r?\n\r?\n/.exec(raw)
  if (!separator) return { headers: new Map(), body: '' }
  const headerText = raw.slice(0, separator.index).replace(/\r?\n[\t ]+/g, ' ')
  const headers = new Map<string, string>()
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
  }
  return { headers, body: raw.slice(separator.index + separator[0].length) }
}

function archiveResources(snapshot: PreviewSnapshot, warnings: string[]): Map<string, ArchiveResource> {
  const resources = new Map<string, ArchiveResource>()
  if (!snapshot.archiveMhtml) return resources
  const bytes = decodeBase64(snapshot.archiveMhtml, MAX_ARCHIVE_BYTES)
  const visit = (raw: string, base: string, depth: number) => {
    if (depth > 8) throw new Error('网页归档 MIME 嵌套超出安全上限')
    const { headers, body } = mimeEntity(raw)
    const type = headers.get('content-type') ?? ''
    const location = headers.get('content-location')
    const contentBase = headers.get('content-base')
    const entityBase = contentBase ? absoluteResource(contentBase, base) : location ? absoluteResource(location, base) : base
    if (/^multipart\//i.test(type)) {
      const boundary = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(type)
      if (!boundary) { warnings.push('网页原貌归档缺少 MIME boundary，部分图片可能不可用'); return }
      const marker = `--${boundary[1] ?? boundary[2]}`
      let part: string[] | undefined
      for (const line of body.split(/\r?\n/)) {
        if (line.trimEnd() === marker || line.trimEnd() === `${marker}--`) {
          if (part) visit(part.join('\r\n'), entityBase, depth + 1)
          part = line.trimEnd().endsWith('--') ? undefined : []
        } else if (part) part.push(line)
      }
      if (part?.length) visit(part.join('\r\n'), entityBase, depth + 1)
      return
    }
    const mime = type.split(';')[0].trim().toLowerCase()
    if (!mime.startsWith('image/')) return
    try {
      const encoding = (headers.get('content-transfer-encoding') ?? 'binary').toLowerCase()
      let data: Buffer
      if (encoding === 'base64') data = decodeBase64(body, MAX_IMAGE_BYTES)
      else if (encoding === 'quoted-printable') {
        const unfolded = body.replace(/=\r?\n/g, '')
        const values: number[] = []
        for (let i = 0; i < unfolded.length; i++) {
          if (unfolded[i] === '=' && /^[\da-f]{2}$/i.test(unfolded.slice(i + 1, i + 3))) {
            values.push(parseInt(unfolded.slice(i + 1, i + 3), 16)); i += 2
          } else values.push(unfolded.charCodeAt(i) & 255)
          if (values.length > MAX_IMAGE_BYTES) throw new Error('图片大小超出安全上限')
        }
        data = Buffer.from(values)
      } else if (['binary', '8bit', '7bit'].includes(encoding)) data = Buffer.from(body, 'latin1')
      else throw new Error('不支持的图片 MIME 编码')
      if (data.length > MAX_IMAGE_BYTES) throw new Error('图片大小超出安全上限')
      const resource = { mime, bytes: data }
      if (location) resources.set(absoluteResource(location, contentBase ? absoluteResource(contentBase, base) : base), resource)
      const cid = headers.get('content-id')?.replace(/^<|>$/g, '')
      if (cid) resources.set(`cid:${cid}`, resource)
    } catch { warnings.push('网页归档中有图片编码无效或大小超限，将保留图片缺失说明') }
  }
  visit(bytes.toString('latin1'), snapshot.finalUrl, 0)
  return resources
}

async function imageData(source: string, base: string, resources: Map<string, ArchiveResource>): Promise<string> {
  let resource: ArchiveResource | undefined
  if (/^data:/i.test(source)) {
    const match = /^data:(image\/[\w.+-]+)((?:;[^,]*)?),(.*)$/is.exec(source)
    if (!match) throw new Error('图片 data URL 无效')
    resource = { mime: match[1].toLowerCase(), bytes: /;base64(?:;|$)/i.test(match[2])
      ? decodeBase64(match[3], MAX_IMAGE_BYTES) : Buffer.from(decodeURIComponent(match[3]), 'utf8') }
  } else resource = resources.get(absoluteResource(source, base))
  if (!resource) throw new Error('同一归档中没有图片资源')
  if (!resource.bytes.length || resource.bytes.length > MAX_IMAGE_BYTES) throw new Error('图片大小超出安全上限')
  // Rasterization must not load external SVG references or process XML entities.
  if (resource.mime === 'image/svg+xml' || resource.bytes.includes(Buffer.from('<svg'))) {
    const svg = resource.bytes.toString('utf8')
    if (!Buffer.from(svg, 'utf8').equals(resource.bytes)) throw new Error('SVG 必须使用 UTF-8 编码')
    if (/<!DOCTYPE|<!ENTITY|<script|<foreignObject|@import|\\/i.test(svg)) throw new Error('SVG 包含不支持的外部或主动内容')
    const tree = parse(svg) as unknown as HtmlNode
    const nodes = descendants(tree, () => true)
    for (const node of nodes) {
      const href = attr(node, 'href')
      if (href && !href.startsWith('#')) throw new Error('SVG 包含外部或嵌套图片资源，无法安全转换')
    }
    for (const match of svg.matchAll(/url\(\s*['"]?([^)'"\s]+)/gi)) if (!match[1].startsWith('#')) throw new Error('SVG 引用了归档外的资源')
  } else {
    // Do not let a false image MIME type route XML (including UTF-16 SVG) to librsvg.
    const signature = resource.bytes.subarray(0, 16)
    const raster = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || signature.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      || /^GIF8[79]a/.test(signature.toString('latin1'))
      || signature.subarray(0, 4).toString() === 'RIFF' && signature.subarray(8, 12).toString() === 'WEBP'
      || signature.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || signature.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))
      || signature.subarray(4, 8).toString() === 'ftyp' && /^(avif|avis|heic|heix|mif1)$/.test(signature.subarray(8, 12).toString())
    if (!raster) throw new Error('图片内容不是支持的图像格式')
  }
  const renderer = sharp(resource.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning' })
  const metadata = await renderer.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) throw new Error('图片像素超出安全上限')
  const supported = ['png', 'jpeg', 'webp'].includes(metadata.format ?? '')
  const data = supported ? resource.bytes : await renderer.png().toBuffer()
  if (data.length > MAX_IMAGE_BYTES) throw new Error('转换后的图片大小超出安全上限')
  return `data:image/${supported ? metadata.format : 'png'};base64,${data.toString('base64')}`
}

export async function parseHtmlSummary(snapshot: PreviewSnapshot): Promise<ParsedDocument> {
  if (typeof snapshot.html !== 'string' || Buffer.byteLength(snapshot.html) > MAX_HTML_BYTES) throw new Error('网页 HTML 大小超出 16 MB 安全上限')
  const tree = parse(snapshot.html) as unknown as HtmlNode
  // Reject pathological trees explicitly; never summarize a silently clipped prefix.
  const stack = [{ node: tree, depth: 0 }]
  let nodeCount = 0
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (++nodeCount > 200000 || depth > 512) throw new Error('网页结构复杂度超出安全上限')
    for (const child of children(node)) stack.push({ node: child, depth: depth + 1 })
  }
  const items: DocumentItem[] = []
  const warnings: string[] = []
  const resources = archiveResources(snapshot, warnings)
  const baseNode = descendants(tree, node => node.nodeName === 'base')[0]
  const base = attr(baseNode ?? tree, 'href') ? absoluteResource(attr(baseNode!, 'href')!, snapshot.finalUrl) : snapshot.finalUrl
  const counts = { text: 0, heading: 0, picture: 0, table: 0, formula: 0 }
  const pendingImages: { item: DocumentItem; sources: string[]; missingReason?: string }[] = []
  const add = (kind: DocumentItem['kind'], node: HtmlNode, text: string, extra: Partial<DocumentItem> = {}) => {
    const anchor = sourceAnchor(node)
    const item: DocumentItem = { id: `${kind}-${++counts[kind]}`, kind, text, caption: '', pages: [], regions: [], images: [], ...(anchor ? { anchor } : {}), ...extra }
    items.push(item)
    return item
  }
  const formula = (node: HtmlNode) => node.nodeName === 'math' || /(?:^|\s)(?:katex|MathJax)(?:\s|$)/.test(attr(node, 'class') ?? '')
    || attr(node, 'data-latex') !== undefined || texScript(node)
  const picture = (node: HtmlNode) => {
    if (['presentation', 'none'].includes(attr(node, 'role') ?? '')) return
    let figure = node.parentNode
    while (figure && figure.nodeName !== 'figure') figure = figure.parentNode
    const captionNode = figure && descendants(figure, child => child.nodeName === 'figcaption')[0]
    const caption = captionNode ? clean(textOf(captionNode)) : attr(node, 'title') ?? ''
    if (attr(node, 'alt') === '' && !caption && !attr(node, 'aria-label')) return
    const title = children(node).find(child => child.nodeName === 'title')
    const label = attr(node, 'alt') || attr(node, 'aria-label') || (title ? clean(textOf(title)) : '')
    const item = add('picture', node, label, { caption, inBody: true })
    if (node.nodeName === 'canvas') {
      pendingImages.push({ item, sources: [], missingReason: 'HTML 快照不包含 canvas 像素，无法还原原图' })
      return
    }
    if (node.nodeName === 'svg') {
      const svg = serializeOuter(node as DefaultTreeAdapterTypes.Element)
      pendingImages.push({ item, sources: [`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`] })
      return
    }
    const sources = [attr(node, 'src'), attr(node, 'data-src'), ...srcsetSources(attr(node, 'srcset') ?? '')]
    if (node.parentNode?.nodeName === 'picture') {
      for (const source of children(node.parentNode).filter(child => child.nodeName === 'source')) sources.push(...srcsetSources(attr(source, 'srcset') ?? ''))
    }
    pendingImages.push({ item, sources: [...new Set(sources.filter((source): source is string => Boolean(source)))] })
  }
  const embedded = (node: HtmlNode, skipLists = false) => {
    for (const child of children(node)) {
      if (excluded(child) || skipLists && ['ul', 'ol'].includes(child.nodeName)) continue
      if (pictureTags.has(child.nodeName) || child.nodeName === 'table' || formula(child)) visit(child)
      else embedded(child, skipLists)
    }
  }
  const table = (node: HtmlNode) => {
    const rows = descendants(node, child => child.nodeName === 'tr', child => child !== node && child.nodeName === 'table')
    const cells: NonNullable<DocumentItem['table']>['cells'] = []
    const occupied = new Map<number, Set<number>>()
    const groupCounts = new Map<HtmlNode | undefined, number>()
    const groupPositions = new Map<HtmlNode | undefined, number>()
    for (const row of rows) groupCounts.set(row.parentNode, (groupCounts.get(row.parentNode) ?? 0) + 1)
    let numCols = 0
    let occupiedCount = 0
    for (const [row, tr] of rows.entries()) {
      const groupPosition = groupPositions.get(tr.parentNode) ?? 0
      const groupRemaining = groupCounts.get(tr.parentNode)! - groupPosition
      groupPositions.set(tr.parentNode, groupPosition + 1)
      let column = 0
      for (const cell of children(tr).filter(child => ['td', 'th'].includes(child.nodeName))) {
        while (occupied.get(row)?.has(column)) column++
        const readSpan = (name: string) => {
          const value = Number(attr(cell, name) ?? 1)
          if (!Number.isInteger(value) || value < 0) return 1
          if (value > 1000) throw new Error('网页表格合并单元格超出安全上限')
          return value || (name === 'rowspan' ? groupRemaining : 1)
        }
        const rowSpan = Math.min(readSpan('rowspan'), groupRemaining)
        const colSpan = readSpan('colspan')
        occupiedCount += rowSpan * colSpan
        if (occupiedCount > 200000) throw new Error('网页表格大小超出安全上限')
        for (let y = row; y < row + rowSpan; y++) {
          const cols = occupied.get(y) ?? new Set<number>()
          for (let x = column; x < column + colSpan; x++) cols.add(x)
          occupied.set(y, cols)
        }
        const scope = attr(cell, 'scope')
        const rowHeader = cell.nodeName === 'th' && ['row', 'rowgroup'].includes(scope ?? '')
        cells.push({ text: clean(textOf(cell)), row, column, rowSpan, colSpan, columnHeader: cell.nodeName === 'th' && !rowHeader, rowHeader })
        column += colSpan
        numCols = Math.max(numCols, column)
      }
    }
    const captionNode = children(node).find(child => child.nodeName === 'caption')
    add('table', node, cells.map(cell => `[row ${cell.row + 1}, col ${cell.column + 1}] ${cell.text}`).join('\n'), {
      caption: captionNode ? clean(textOf(captionNode)) : '', table: { numRows: rows.length, numCols, cells },
    })
    embedded(node)
  }
  const flow = (node: HtmlNode) => {
    let buffer = ''
    const flush = () => { const text = clean(buffer); if (text) add('text', node, text); buffer = '' }
    const inline = (child: HtmlNode): void => {
      if (excluded(child)) return
      if (child.nodeName === '#text') { buffer += child.value ?? ''; return }
      if (child.nodeName === 'br') { buffer += '\n'; return }
      if (blocks.has(child.nodeName) || pictureTags.has(child.nodeName) || formula(child)) { flush(); visit(child); return }
      if (child.nodeName === 'code') { buffer += `\`${textOf(child, true)}\``; return }
      for (const nested of children(child)) inline(nested)
    }
    for (const child of children(node)) inline(child)
    flush()
  }
  const visit = (node: HtmlNode): void => {
    if (excluded(node)) return
    if (pictureTags.has(node.nodeName) && !formula(node)) { picture(node); return }
    if (formula(node)) {
      const math = node.nodeName === 'math' ? node : descendants(node, child => child.nodeName === 'math')[0]
      const annotation = descendants(node, child => child.nodeName === 'annotation'
        && /^(?:application|text)\/(?:x-)?(?:la)?tex$/i.test((attr(child, 'encoding') ?? '').trim()))[0]
      const latex = [attr(node, 'data-latex'), annotation && textOf(annotation, true),
        math && attr(math, 'data-latex'), attr(node, 'alttext'), math && attr(math, 'alttext'),
        texScript(node) ? textOf(node, true) : undefined].find(value => value?.trim())?.trim()
      if (latex) add('formula', node, latex, { formulaFormat: 'latex' })
      else if (math) {
        const item = add('formula', node, serializeOuter(math as DefaultTreeAdapterTypes.Element), { formulaFormat: 'mathml' })
        warnings.push(`${item.id} 保留完整 MathML 原式，未转换为 LaTeX`)
      } else {
        const text = clean(textOf(node))
        const item = add('text', node, `[公式缺少原式，仅保留可见文本] ${text}`)
        warnings.push(`${item.id} 公式缺少 LaTeX 或 MathML 原式，不能可靠还原公式结构`)
      }
      return
    }
    if (/^h[1-6]$/.test(node.nodeName)) {
      const text = clean(textOf(node))
      if (text) add('heading', node, text, { level: Number(node.nodeName[1]) })
      embedded(node)
      return
    }
    if (node.nodeName === 'pre') {
      const text = textOf(node, true).replace(/^\n|\n$/g, '')
      if (text) add('text', node, `\`\`\`\n${text}\n\`\`\``)
      embedded(node)
      return
    }
    if (node.nodeName === 'table') { table(node); return }
    if (node.nodeName === 'li') {
      const parent = node.parentNode
      const siblings = parent ? children(parent).filter(child => child.nodeName === 'li') : []
      const start = Number(attr(parent ?? node, 'start') ?? 1)
      const marker = parent?.nodeName === 'ol' ? `${(Number.isSafeInteger(start) ? start : 1) + siblings.indexOf(node)}. ` : '- '
      const text = clean(textOf(node, false, true))
      if (text) add('text', node, `${marker}${text}`)
      embedded(node, true)
      for (const list of descendants(node, child => ['ul', 'ol'].includes(child.nodeName), child => ['ul', 'ol'].includes(child.nodeName))) visit(list)
      return
    }
    if (node.nodeName === 'figcaption' && node.parentNode?.nodeName === 'figure'
      && descendants(node.parentNode, child => pictureTags.has(child.nodeName)).length) return
    flow(node)
  }
  const mains = descendants(tree, node => node.nodeName === 'main' && !excluded(node), excluded)
  const articles = mains.length ? [] : descendants(tree, node => node.nodeName === 'article' && !excluded(node), child => excluded(child) || child.nodeName === 'article')
  const roots = mains.length ? mains : articles.length ? articles : [descendants(tree, node => node.nodeName === 'body')[0] ?? tree]
  for (const root of roots) visit(root)
  const decodedImages = new Map<string, Promise<string>>()
  for (const { item, sources, missingReason } of pendingImages) {
    let reason = missingReason ?? '同一归档中没有图片资源'
    for (const source of sources) {
      try {
        const key = /^data:/i.test(source) ? source : absoluteResource(source, base)
        let decoded = decodedImages.get(key)
        if (!decoded) { decoded = imageData(source, base, resources); decodedImages.set(key, decoded) }
        item.images.push({ data: await decoded })
        break
      }
      catch (error) { reason = error instanceof Error ? error.message : '图片解析失败' }
    }
    if (!item.images.length) warnings.push(`${item.id} 图片不可用：${reason}`)
  }
  if (!items.length) throw new Error('网页快照没有可用于摘要的正文或图片')
  return { version: 1, items, warnings }
}
