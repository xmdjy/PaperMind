import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

// ── 语义分块：节标题识别模式（英文 + 中文）───────────────────────────────────
const SECTION_PATTERNS: RegExp[] = [
  // 英文编号节标题："1. Introduction"、"2 Methods"、"1.1 Background"
  /^(\d+\.?\d*\.?\s+)[A-Z][a-zA-Z\s]{2,}$/m,
  // 英文全大写标题："INTRODUCTION"、"RELATED WORK"
  /^[A-Z][A-Z\s]{3,30}$/m,
  // 常见节名称（大小写不敏感）
  /^(Abstract|Introduction|Methods?|Results?|Discussion|Conclusion|References|Acknowledgements?|Appendix)$/im,
  // 中文章节："第一章"、"第3节"
  /^第[一二三四五六七八九十\d]+[章节]/m,
  // 中文编号节："1 引言"、"3.1 实验设置"、"1.1 研究背景"
  /^\d+(?:\.\d+)*[\s]+[一-龥]{2,10}$/m,
]

/** 扫描每页文本，返回节标题所在的页码索引列表（0-based）。 */
export function detectSectionBoundaries(pages: string[]): number[] {
  const boundaries: number[] = []
  for (let i = 0; i < pages.length; i++) {
    if (SECTION_PATTERNS.some(pattern => pattern.test(pages[i]))) {
      boundaries.push(i)
    }
  }
  return boundaries
}

/** 将不足 minPages 页的节并入前一节（若无前节则并入后节）。 */
export function mergeSmallSections(
  ranges: Array<{ start: number; end: number }>,
  minPages = 2,
): Array<{ start: number; end: number }> {
  const result = [...ranges]
  let i = 0
  while (i < result.length) {
    const size = result[i].end - result[i].start + 1
    if (size < minPages && result.length > 1) {
      if (i > 0) {
        // 并入前一节
        result[i - 1] = { start: result[i - 1].start, end: result[i].end }
        result.splice(i, 1)
      } else {
        // 首节并入后一节
        result[1] = { start: result[0].start, end: result[1].end }
        result.splice(0, 1)
      }
    } else {
      i++
    }
  }
  return result
}

export interface IndexNode {
  title: string
  nodeId: string
  startPage: number // 0-based inclusive
  endPage: number   // 0-based inclusive
  summary: string
  nodes: IndexNode[]
}

export type LLMFn = (prompt: string) => Promise<string>

const CHUNK = 5 // pages per leaf

export async function extractPages(base64: string): Promise<string[]> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const pdf = await pdfjsLib.getDocument({ data: bytes.buffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((it: any) => it.str).join(' '))
  }
  return pages
}

async function summarizeRange(
  pages: string[], start: number, end: number, nodeId: string, llm: LLMFn
): Promise<IndexNode> {
  const text = pages.slice(start, end + 1).join('\n\n').slice(0, 3000)
  const prompt = `Index pages ${start + 1}-${end + 1} of an academic paper.\n\nText:\n${text}\n\nReply JSON only: {"title":"...","summary":"2-3 sentences"}`
  let title = `Pages ${start + 1}–${end + 1}`
  let summary = ''
  try {
    const raw = (await llm(prompt)).replace(/```json\n?|```/g, '').trim()
    const p = JSON.parse(raw)
    title = p.title || title
    summary = p.summary || ''
  } catch { /* keep defaults */ }
  return { title, nodeId, startPage: start, endPage: end, summary, nodes: [] }
}

export async function buildPageIndex(pages: string[], llm: LLMFn): Promise<IndexNode> {
  // 语义分块：识别节边界；边界不足2个时降级为固定切块
  const boundaries = detectSectionBoundaries(pages)
  let ranges: Array<{ start: number; end: number }>

  if (boundaries.length >= 2) {
    ranges = boundaries.map((start, i) => ({
      start,
      end: i + 1 < boundaries.length ? boundaries[i + 1] - 1 : pages.length - 1,
    }))
    ranges = mergeSmallSections(ranges)
  } else {
    // 降级：固定5页切块（原有行为）
    ranges = []
    for (let i = 0; i < pages.length; i += CHUNK) {
      ranges.push({ start: i, end: Math.min(i + CHUNK - 1, pages.length - 1) })
    }
  }

  const leaves: IndexNode[] = []
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i]
    leaves.push(await summarizeRange(pages, start, end, String(i), llm))
  }
  if (leaves.length === 1) return leaves[0]

  const sectionList = leaves.map((n, i) => `[${i + 1}] ${n.title}: ${n.summary}`).join('\n')
  const prompt = `Create a top-level index for an academic paper.\n\nSections:\n${sectionList}\n\nReply JSON only: {"title":"...","summary":"2-3 sentences"}`
  let title = 'Paper'
  let summary = ''
  try {
    const raw = (await llm(prompt)).replace(/```json\n?|```/g, '').trim()
    const p = JSON.parse(raw)
    title = p.title || title
    summary = p.summary || ''
  } catch { /* keep defaults */ }

  return { title, nodeId: 'root', startPage: 0, endPage: pages.length - 1, summary, nodes: leaves }
}

export async function retrieve(
  root: IndexNode, pages: string[], query: string, llm: LLMFn
): Promise<{ context: string; sources: string[] }> {
  let node = root
  while (node.nodes.length > 0) {
    const options = node.nodes.map((n, i) => `[${i + 1}] ${n.title}: ${n.summary}`).join('\n')
    const prompt = `Query: ${query}\n\nSections:\n${options}\n\nWhich section number is most relevant? Reply with just the number.`
    try {
      const raw = await llm(prompt)
      const idx = parseInt(raw.trim()) - 1
      if (idx >= 0 && idx < node.nodes.length) { node = node.nodes[idx]; continue }
    } catch { /* fall through */ }
    node = node.nodes[0]
  }
  const context = pages.slice(node.startPage, node.endPage + 1).join('\n\n')
  return { context, sources: [`Pages ${node.startPage + 1}–${node.endPage + 1}: ${node.title}`] }
}
