import type { TextTokenizer } from '../traditionalRag/types'
import { buildTokenStream, spanPages, type PageToken } from './tokenStream'

/**
 * 长章节基线的确定性章节边界提取（计划 §2.3：只依赖 canonical 文本中已有的标题，
 * 无 LLM 调用，保留全部原始页号映射）。
 * 识别规则刻意保守：Markdown 标题、短编号标题、已知英文节名、中文「第X章/节」与「一、」
 * ；编号行过长或过长句式的「标题样」假阳性一律不当作标题。
 */
export interface Section {
  title: string
  /** 全局 token 下标，[startToken, endToken)；endToken 为 exclusive */
  startToken: number
  endToken: number
  startPage: number
  endPage: number
}

const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/
const KNOWN_ENGLISH_HEADING = /^(abstract|introduction|background|related work|preliminaries|motivation|methods?|methodology|approach|model|experiments?|experimental setup|evaluation|results?( and discussion)?|discussion|analysis|conclusions?|limitations?|references|acknowledg(e)?ments?|appendix|appendices)$/i
const CN_CHAPTER = /^(第[一二三四五六七八九十百\d]+[章节部分])\s*\S{0,60}$/
const CN_ENUMERATED = /^[一二三四五六七八九十]+、\s*\S{1,60}$/

/** 编号「标题」的内容部分长度/词数上限：超过即按正文处理（假阳性防线）。 */
const MAX_HEADING_CHARS = 100
const MAX_HEADING_WORDS = 20

export function isHeadingLine(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const markdown = MARKDOWN_HEADING.exec(trimmed)
  if (markdown) return markdown[1].trim()
  const cn = CN_CHAPTER.exec(trimmed) ?? CN_ENUMERATED.exec(trimmed)
  if (cn) return trimmed
  if (KNOWN_ENGLISH_HEADING.test(trimmed)) return trimmed
  const numbered = NUMBERED_HEADING.exec(trimmed)
  if (numbered) {
    const rest = numbered[2].trim()
    if (rest.length > 0 && rest.length <= MAX_HEADING_CHARS && rest.split(/\s+/).length <= MAX_HEADING_WORDS && !/[。;；]$/.test(rest)) return rest
  }
  return null
}

/**
 * 章节列表首尾相接覆盖整个 token 流：首个标题之前是 title 为空的 preamble 节。
 * 相邻标题之间没有正文时产生空节（startToken === endToken），不影响锚点扩展——
 * 锚点只会落在有内容的 token 上。
 */
export function detectSections(pages: string[], tokenizer: TextTokenizer): Section[] {
  const { tokens, lines } = buildTokenStream(pages, tokenizer)
  const boundaries: Array<{ title: string; startToken: number }> = []
  for (const line of lines) {
    if (line.count === 0) continue
    const title = isHeadingLine(line.text)
    if (title !== null) boundaries.push({ title, startToken: line.start })
  }
  const sections: Section[] = []
  const total = tokens.length
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].startToken
    const end = i + 1 < boundaries.length ? boundaries[i + 1].startToken : total
    // 连续标题行：前一个标题没有任何正文，跳过空节，只保留最后一个标题
    if (i + 1 < boundaries.length && boundaries[i + 1].startToken === start) continue
    if (start >= end) continue
    sections.push({ title: boundaries[i].title, startToken: start, endToken: end, ...spanPages(tokens, start, end) })
  }
  if (boundaries.length === 0 || boundaries[0].startToken > 0) {
    const preambleEnd = boundaries.length > 0 ? boundaries[0].startToken : total
    if (preambleEnd > 0) sections.unshift({ title: '', startToken: 0, endToken: preambleEnd, ...spanPages(tokens, 0, preambleEnd) })
  }
  return sections
}

export type { PageToken }
export { buildTokenStream }
