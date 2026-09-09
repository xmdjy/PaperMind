import type { TextTokenizer } from '../traditionalRag/types'

/**
 * 强基线共用的「带页号 token 流」原语。
 * 与 traditionalRag/chunker 相同的 token 语义（XLM-R Metaspace 的 ▁ 还原为空格、
 * 跨页显式换行且不计入 token），但保留每个 token 的全局下标，
 * 供章节边界对齐与连续区域扩展做确定性切片。
 */
export interface PageToken { text: string; page: number }

export interface LineSpan {
  /** 该行首个 token 的全局下标 */
  start: number
  /** 该行 token 数 */
  count: number
  page: number
  text: string
}

export function buildTokenStream(pages: string[], tokenizer: TextTokenizer): { tokens: PageToken[]; lines: LineSpan[] } {
  const tokens: PageToken[] = []
  const lines: LineSpan[] = []
  pages.forEach((page, pageNo) => {
    for (const line of page.split('\n')) {
      const start = tokens.length
      const piece = tokenizer.tokenize(line)
      for (const text of piece) tokens.push({ text, page: pageNo })
      lines.push({ start, count: tokens.length - start, page: pageNo, text: line })
    }
  })
  return { tokens, lines }
}

/** [start, end) 区间的 token 还原为可读文本；与 chunkPages 的还原规则一致。 */
export function sliceText(tokens: PageToken[], start: number, end: number): string {
  let out = ''
  for (let i = start; i < end; i++) {
    if (i > start && tokens[i].page !== tokens[i - 1].page) out += '\n'
    out += tokens[i].text.replaceAll('▁', ' ')
  }
  return out.trim()
}

export function spanPages(tokens: PageToken[], start: number, end: number): { startPage: number; endPage: number } {
  if (end <= start) {
    // 空区间没有 token 可依：退回最近一个 token 的页号；流为空时 0
    const fallback = tokens[Math.max(0, Math.min(start, tokens.length - 1))]?.page ?? 0
    return { startPage: fallback, endPage: fallback }
  }
  let startPage = tokens[start].page
  let endPage = startPage
  for (let i = start; i < end; i++) {
    if (tokens[i].page < startPage) startPage = tokens[i].page
    if (tokens[i].page > endPage) endPage = tokens[i].page
  }
  return { startPage, endPage }
}

/**
 * 在整篇 token 流上按 512/128 语义切锚点段（长章节基线的锚点）。
 * 与 chunkPages 相同的步长与终止规则，但每个 passage 携带全局 token 下标，
 * 使锚点能无歧义地映射回 token 流做章节内扩展。
 */
export interface StreamPassage {
  id: number
  text: string
  tokenCount: number
  startPage: number
  endPage: number
  /** 全局 token 下标，[startToken, endToken) */
  startToken: number
  endToken: number
}

export function chunkTokenStream(tokens: PageToken[], options: { chunkSize: number; overlap: number }): StreamPassage[] {
  if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0 || !Number.isInteger(options.overlap) || options.overlap < 0 || options.overlap >= options.chunkSize) throw new Error('chunkSize/overlap 非法')
  const out: StreamPassage[] = []
  const step = options.chunkSize - options.overlap
  for (let start = 0, id = 0; start < tokens.length; start += step, id++) {
    const end = Math.min(start + options.chunkSize, tokens.length)
    out.push({
      id,
      text: sliceText(tokens, start, end),
      tokenCount: end - start,
      ...spanPages(tokens, start, end),
      startToken: start,
      endToken: end,
    })
    if (end >= tokens.length) break
  }
  return out
}
