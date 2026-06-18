import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

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
  const leaves: IndexNode[] = []
  for (let i = 0; i < pages.length; i += CHUNK) {
    const end = Math.min(i + CHUNK - 1, pages.length - 1)
    leaves.push(await summarizeRange(pages, i, end, String(leaves.length), llm))
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
