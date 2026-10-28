import { createMarkdownParser } from './markdownParser'
import type Ruler from 'markdown-it/lib/ruler.mjs'
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
import type Token from 'markdown-it/lib/token.mjs'

interface MappedText { text: string; positions: number[] }
interface Edit { start: number; end: number; replacement: string }

function getRule<T>(ruler: Ruler<T>, name: string): T {
  const before = ruler.getRules('')
  ruler.disable(name)
  const remaining = new Set(ruler.getRules(''))
  ruler.enable(name)
  const rule = before.find(candidate => !remaining.has(candidate))
  if (!rule) throw new Error('无法校验摘要图片引用')
  return rule
}

/** Keep original offsets when Markdown normalizes CRLF, CR and NUL. */
function normalizeSource(content: string): MappedText {
  const positions: number[] = []
  let text = ''
  for (let index = 0; index < content.length; index++) {
    positions.push(index)
    const char = content[index]
    text += char === '\r' ? '\n' : char === '\0' ? '\uFFFD' : char
    if (char === '\r' && content[index + 1] === '\n') index++
  }
  positions.push(content.length)
  return { text, positions }
}

function trimMapped(value: MappedText): MappedText {
  const start = value.text.length - value.text.trimStart().length
  const end = value.text.trimEnd().length
  return { text: value.text.slice(start, end), positions: value.positions.slice(start, end) }
}

/** Match Markdown's table splitting, which removes the escape before a pipe. */
function tableCells(state: StateBlock, line: number): MappedText[] {
  const start = state.bMarks[line] + state.tShift[line]
  const source = trimMapped({
    text: state.src.slice(start, state.eMarks[line]),
    positions: Array.from({ length: state.eMarks[line] - start }, (_, index) => start + index),
  })
  const cells: MappedText[] = []
  let cell: MappedText = { text: '', positions: [] }
  for (let index = 0; index < source.text.length; index++) {
    const char = source.text[index]
    if (char === '|') {
      if (source.text[index - 1] !== '\\') {
        cells.push(cell)
        cell = { text: '', positions: [] }
        continue
      }
      cell.text = cell.text.slice(0, -1)
      cell.positions.pop()
    }
    cell.text += char
    cell.positions.push(source.positions[index])
  }
  cells.push(cell)
  if (cells[0]?.text === '') cells.shift()
  if (cells.at(-1)?.text === '') cells.pop()
  return cells.map(trimMapped)
}

/** Run while container prefixes are still reflected in the block parser state. */
function inlinePositions(state: StateBlock, token: Token): number[] {
  if (!token.map) return []
  const positions: number[] = []
  const lines = token.content.split('\n')
  for (const [offset, text] of lines.entries()) {
    const line = token.map[0] + offset
    const start = state.bMarks[line]
    const raw = state.src.slice(start, state.eMarks[line])
    let found = raw.indexOf(text)
    let padding = 0
    if (found < 0) {
      // A container can partly expand a tab into leading spaces. Image syntax
      // itself is unchanged, so map the remaining literal suffix exactly.
      const suffix = text.replace(/^[ \t]+/, '')
      padding = text.length - suffix.length
      found = raw.indexOf(suffix)
    }
    if (found < 0) throw new Error('无法定位摘要图片引用')
    for (let index = 0; index < text.length; index++) {
      positions.push(start + found + Math.max(0, index - padding))
    }
    if (offset < lines.length - 1) positions.push(state.eMarks[line])
  }
  return positions
}

function imageDescription(tokens: Token[]): string {
  return tokens.map(token => token.children ? imageDescription(token.children)
    : token.type === 'softbreak' || token.type === 'hardbreak' ? ' '
      : token.nesting === 0 ? token.content : '').join('')
}

/** Validate rendered image references without rewriting literal Markdown. */
export function replaceSummaryAssets(content: string, allowed: Set<string>): string {
  const source = normalizeSource(content)
  const parser = createMarkdownParser()
  const maps = new WeakMap<Token, number[]>()
  for (const name of ['paragraph', 'heading', 'lheading', 'table']) {
    const rule = getRule(parser.block.ruler, name)
    const alt = ['paragraph', 'reference', 'blockquote', 'list']
      .filter(chain => parser.block.ruler.getRules(chain).includes(rule))
    parser.block.ruler.at(name, (state, start, end, silent) => {
      const first = state.tokens.length
      const matched = rule(state, start, end, silent)
      if (!matched || silent) return matched
      let cells: MappedText[] = []
      let cell = 0
      for (const token of state.tokens.slice(first)) {
        if (name === 'table' && token.type === 'tr_open' && token.map) {
          cells = tableCells(state, token.map[0])
          cell = 0
        }
        if (token.type !== 'inline') continue
        if (name !== 'table') maps.set(token, inlinePositions(state, token))
        else {
          const mapped = cells[cell++] ?? { text: '', positions: [] }
          if (mapped.text !== token.content) throw new Error('无法定位摘要表格中的图片引用')
          maps.set(token, mapped.positions)
        }
      }
      return matched
    }, { alt })
  }

  const edits: Edit[] = []
  let activePositions: number[] = []
  let depth = 0
  const parseInline = parser.inline.parse.bind(parser.inline)
  parser.inline.parse = (...args) => {
    depth++
    try { parseInline(...args) } finally { depth-- }
  }
  parser.core.ruler.at('inline', state => {
    for (const token of state.tokens) {
      if (token.type !== 'inline') continue
      activePositions = maps.get(token) ?? []
      parser.inline.parse(token.content, parser, state.env, token.children ?? [])
    }
  })
  const replace = (start: number, end: number, replacement: string) => {
    const first = activePositions[start], last = activePositions[end - 1]
    if (first === undefined || last === undefined) throw new Error('无法定位摘要图片引用')
    edits.push({ start: source.positions[first], end: source.positions[last + 1], replacement })
  }
  const imageRule = getRule(parser.inline.ruler, 'image')
  parser.inline.ruler.at('image', (state, silent) => {
    const start = state.pos
    // Recognize unsafe image destinations solely to replace them. Keep normal
    // link validation: a rejected outer link can expose real images in its title.
    const validateLink = parser.validateLink
    let matched: boolean
    parser.validateLink = () => true
    try { matched = imageRule(state, silent) } finally { parser.validateLink = validateLink }
    // Nested images in image alt text are only text, not independent resources.
    if (matched && !silent && depth === 1) {
      const token = state.tokens.at(-1)!
      const match = /^asset:([a-f0-9]{64})$/.exec(token.attrGet('src') || '')
      if (!match || !allowed.has(match[1])) {
        const alt = imageDescription(token.children ?? []).replace(/\s+/g, ' ').trim()
        // Entities remain literal text on the next parse. Backslash-escaping
        // brackets would instead introduce the supported LaTeX \[...\] syntax.
        const literal = (alt || '未知图片').replace(/[&\\`*_[\]<>!|$~]/g,
          char => `&#${char.charCodeAt(0)};`,
        )
        replace(start, state.pos, `[图片不可用：${literal}]`)
      }
    }
    return matched
  })
  parser.inline.ruler.before('html_inline', 'summary_raw_image', (state, silent) => {
    if (depth !== 1 || state.src[state.pos] !== '<') return false
    const match = /^<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(state.src.slice(state.pos, state.posMax))
    if (!match) return false
    const start = state.pos
    state.pos += match[0].length
    if (!silent) {
      replace(start, state.pos, '[图片不可用：不受支持的图片引用]')
      state.push('text', '', 0).content = match[0]
    }
    return true
  })
  parser.parse(source.text, {})
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    content = content.slice(0, edit.start) + edit.replacement + content.slice(edit.end)
  }
  return content
}
