import type { BenchChunk, TextTokenizer } from './types'

/** 页间分隔符不成为 token；token 本身携带页号，避免跨页时按字符猜测。 */
export function chunkPages(pages: string[], tokenizer: TextTokenizer, options: { chunkSize: number; overlap: number }): BenchChunk[] {
  if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0 || !Number.isInteger(options.overlap) || options.overlap < 0 || options.overlap >= options.chunkSize) throw new Error('chunkSize/overlap 非法')
  const tokens: Array<{ text: string; page: number }> = []
  pages.forEach((page, pageNo) => tokenizer.tokenize(page).forEach(text => tokens.push({ text, page: pageNo })))
  const out: BenchChunk[] = []; const step = options.chunkSize - options.overlap
  for (let start = 0, id = 0; start < tokens.length; start += step, id++) {
    const slice = tokens.slice(start, start + options.chunkSize)
    // XLM-R 的 Metaspace token 用 ▁ 表示词前空白，不能直接 join 后送给检索器/LLM。
    // 页码变化处显式换行，保证页间分隔既可读又不计入 chunk token。
    const text = slice.map((token, i) => {
      const pageBreak = i > 0 && token.page !== slice[i - 1].page ? '\n' : ''
      return pageBreak + token.text.replaceAll('▁', ' ')
    }).join('').trim()
    out.push({ id, text, tokenCount: slice.length, startPage: Math.min(...slice.map(t => t.page)), endPage: Math.max(...slice.map(t => t.page)) })
    if (start + options.chunkSize >= tokens.length) break
  }
  return out
}
