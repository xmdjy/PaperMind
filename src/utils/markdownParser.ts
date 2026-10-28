import MarkdownIt from 'markdown-it'
import texmath from 'markdown-it-texmath'
import katex from 'katex'

function closingDelimiter(source: string, delimiter: string, start: number): number {
  let index = source.indexOf(delimiter, start)
  while (index >= 0) {
    let escapes = 0
    for (let before = index - 1; before >= 0 && source[before] === '\\'; before--) escapes++
    if (escapes % 2 === 0) return index
    index = source.indexOf(delimiter, index + 1)
  }
  return -1
}

/** Shared syntax rules; rendering must never rewrite code or link destinations. */
export function createMarkdownParser() {
  const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
  const katexOptions = { throwOnError: false, strict: false, trust: false }
  markdown.use(texmath, { delimiters: 'dollars', katexOptions })
  const displayMath = (content: string) => {
    try { return katex.renderToString(content, { ...katexOptions, displayMode: true }) }
    catch { return `<span class="katex-error" title="公式无法渲染">${markdown.utils.escapeHtml(content)}</span>` }
  }

  // texmath supports bracket display math as a block, but not inside table
  // cells or sentences. Parse it in the inline scope too, without adding lines.
  markdown.inline.ruler.before('escape', 'bracket_math', (state, silent) => {
    const opening = state.src.slice(state.pos, state.pos + 2)
    if (opening !== '\\[' && opening !== '\\(') return false
    const end = closingDelimiter(state.src, opening === '\\[' ? '\\]' : '\\)', state.pos + 2)
    if (end < 0 || end + 2 > state.posMax) return false
    if (!silent) {
      const token = state.push(opening === '\\[' ? 'math_inline_double' : 'math_inline', 'math', 0)
      token.content = state.src.slice(state.pos + 2, end)
      token.markup = opening
    }
    state.pos = end + 2
    return true
  })
  // A block <section> inside a paragraph makes browsers split the paragraph.
  markdown.renderer.rules.math_inline_double = (tokens, index) =>
    `<span class="math-inline-display">${displayMath(tokens[index].content)}</span>`

  // Read only the current Markdown container. The upstream block regexp can
  // swallow prose after the closing delimiter, or consume a following item.
  markdown.block.ruler.disable('math_block_eqno')
  markdown.block.ruler.at('math_block', (state, start, end, silent) => {
    const lineText = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])
    const first = lineText(start)
    const opening = first.slice(0, 2)
    if (opening !== '$$' && opening !== '\\[') return false
    const closing = opening === '$$' ? '$$' : '\\]'
    const lines: string[] = []
    for (let line = start; line < end; line++) {
      if (line > start && state.sCount[line] < state.blkIndent && lineText(line).trim()) return false
      const text = line === start ? first.slice(2) : lineText(line)
      const finish = closingDelimiter(text, closing, 0)
      if (finish < 0) { lines.push(text); continue }
      const rest = text.slice(finish + 2).trim()
      // With trailing prose, inline parsing preserves both math and prose.
      if (rest && !/^\([^()\n]+\)$/.test(rest)) return false
      if (silent) return true
      lines.push(text.slice(0, finish))
      const token = state.push('display_math', 'math', 0)
      token.block = true
      token.content = lines.join('\n').trim()
      token.info = rest
      token.map = [start, line + 1]
      state.line = line + 1
      return true
    }
    return false
  })
  markdown.renderer.rules.display_math = (tokens, index) => {
    const token = tokens[index]
    const formula = displayMath(token.content)
    return `<section>${formula}${token.info ? `<span class="equation-number">${markdown.utils.escapeHtml(token.info)}</span>` : ''}</section>\n`
  }

  // CJK text does not separate words with spaces. Allow punctuation at the
  // inner edge of emphasis when the outer edge is a CJK character; let the
  // existing delimiter matcher handle nesting, escapes and unmatched markers.
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  const punctuation = /[\p{P}\p{S}]/u
  markdown.inline.ruler.before('emphasis', 'cjk_emphasis', (state, silent) => {
    const marker = state.src[state.pos]
    if (silent || marker !== '*' && marker !== '_') return false
    const scanned = state.scanDelims(state.pos, marker === '*')
    if (scanned.length > 3) return false
    const before = [...state.src.slice(Math.max(0, state.pos - 2), state.pos)].at(-1) || ''
    const after = String.fromCodePoint(state.src.codePointAt(state.pos + scanned.length) || 32)
    const open = cjk.test(before) && punctuation.test(after)
    const close = punctuation.test(before) && cjk.test(after)
    if (!open && !close) return false
    for (let i = 0; i < scanned.length; i++) {
      const token = state.push('text', '', 0)
      token.content = marker
      state.delimiters.push({
        marker: marker.charCodeAt(0), length: scanned.length, token: state.tokens.length - 1,
        end: -1, open: scanned.can_open || open, close: scanned.can_close || close,
      })
    }
    state.pos += scanned.length
    return true
  })
  return markdown
}
