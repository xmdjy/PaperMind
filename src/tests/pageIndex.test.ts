import { describe, it, expect, vi } from 'vitest'
import { scoreAndSelect, buildPageIndex } from '../utils/pageIndex'
import type { IndexNode } from '../utils/pageIndex'

// pdfjs-dist 在 pageIndex.ts 顶层导入，测试中需要 mock
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  default: {},
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}))

function makeRoot(): IndexNode {
  return {
    title: 'Paper',
    nodeId: 'root',
    startPage: 0,
    endPage: 5,
    summary: 'A test paper about deep learning.',
    nodes: [
      { title: 'Introduction', nodeId: '0', startPage: 0, endPage: 1, summary: 'Motivates the problem.', nodes: [] },
      { title: 'Methods',      nodeId: '1', startPage: 2, endPage: 3, summary: 'Describes the approach.', nodes: [] },
      { title: 'Results',      nodeId: '2', startPage: 4, endPage: 5, summary: 'Shows experimental results.', nodes: [] },
    ],
  }
}

const pages = ['p0 text', 'p1 text', 'p2 text', 'p3 text', 'p4 text', 'p5 text']

describe('scoreAndSelect', () => {
  it('returns the top-scored node when second score is below threshold (< 4)', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":1,"score":9},{"id":0,"score":2},{"id":2,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'how was the study conducted?', llm)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toContain('Methods')
    expect(result.context).toBe('p2 text\n\np3 text')
    expect(llm).toHaveBeenCalledTimes(1)
  })

  it('returns top-2 nodes in document order when second score >= 4', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":2,"score":8},{"id":1,"score":5},{"id":0,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'methods and results?', llm)

    expect(result.sources).toHaveLength(2)
    // Document order: Methods (pages 2-3) before Results (pages 4-5)
    expect(result.sources[0]).toContain('Methods')
    expect(result.sources[1]).toContain('Results')
    expect(result.context).toContain('---')
    // Methods context comes first
    expect(result.context.indexOf('p2')).toBeLessThan(result.context.indexOf('p4'))
  })

  it('excludes second node when score is exactly 3 (below threshold)', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":7},{"id":1,"score":3},{"id":2,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'introduction overview', llm)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toContain('Introduction')
  })

  it('falls back to first leaf node on JSON parse failure', async () => {
    const llm = vi.fn().mockResolvedValue('this is not valid json at all')
    const result = await scoreAndSelect(makeRoot(), pages, 'anything', llm)

    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]).toContain('Introduction')
  })

  it('returns single node directly when root has no children', async () => {
    const singleRoot: IndexNode = {
      title: 'Short Paper', nodeId: 'root',
      startPage: 0, endPage: 2,
      summary: 'A very short paper.', nodes: [],
    }
    const llm = vi.fn()
    const result = await scoreAndSelect(singleRoot, ['a', 'b', 'c'], 'anything', llm)

    expect(llm).not.toHaveBeenCalled()
    expect(result.sources).toHaveLength(1)
    expect(result.context).toBe('a\n\nb\n\nc')
  })
})

describe('scoreAndSelect structured result (benchmark hooks)', () => {
  it('exposes selected nodes with page ranges, avoiding source-string parsing', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":1,"score":9},{"id":2,"score":6},{"id":0,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'methods and results?', llm)

    expect(result.selected.map(n => n.title)).toEqual(['Methods', 'Results'])
    expect(result.selected.map(n => [n.startPage, n.endPage])).toEqual([[2, 3], [4, 5]])
  })

  it('exposes the raw scores returned by the LLM', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":1,"score":9},{"id":0,"score":2},{"id":2,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'how was the study conducted?', llm)

    expect(result.scores).toEqual([
      { id: 1, score: 9 },
      { id: 0, score: 2 },
      { id: 2, score: 1 },
    ])
    expect(result.degraded).toBe(false)
  })

  it('flags degraded=true when the LLM response is unparseable', async () => {
    const llm = vi.fn().mockResolvedValue('this is not valid json at all')
    const result = await scoreAndSelect(makeRoot(), pages, 'anything', llm)

    expect(result.degraded).toBe(true)
    expect(result.scores).toEqual([])
    expect(result.selected.map(n => n.title)).toEqual(['Introduction'])
  })

  it('flags degraded=false on the single-node short circuit', async () => {
    const singleRoot: IndexNode = {
      title: 'Short Paper', nodeId: 'root',
      startPage: 0, endPage: 2,
      summary: 'A very short paper.', nodes: [],
    }
    const result = await scoreAndSelect(singleRoot, ['a', 'b', 'c'], 'anything', vi.fn())

    expect(result.degraded).toBe(false)
    expect(result.selected.map(n => n.title)).toEqual(['Short Paper'])
  })
})

describe('scoreAndSelect topK / minScore options', () => {
  it('selects three nodes in document order when topK is 3', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":2,"score":9},{"id":1,"score":7},{"id":0,"score":5}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'everything', llm, { topK: 3 })

    expect(result.selected.map(n => n.title)).toEqual(['Introduction', 'Methods', 'Results'])
  })

  it('still honours minScore when topK is 3', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":2,"score":9},{"id":1,"score":7},{"id":0,"score":3}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'everything', llm, { topK: 3 })

    // id 0 scores 3, below the default minScore of 4
    expect(result.selected.map(n => n.title)).toEqual(['Methods', 'Results'])
  })

  it('admits a low-scoring second node when minScore is lowered', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":7},{"id":1,"score":3},{"id":2,"score":1}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'introduction overview', llm, { minScore: 2 })

    expect(result.selected.map(n => n.title)).toEqual(['Introduction', 'Methods'])
  })

  it('always keeps the top node even when it scores below minScore', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":1,"score":1},{"id":0,"score":0},{"id":2,"score":0}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'unrelated question', llm, { minScore: 4 })

    expect(result.selected.map(n => n.title)).toEqual(['Methods'])
  })

  it('selects only the top node when topK is 1', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":9},{"id":1,"score":9},{"id":2,"score":9}]')
    const result = await scoreAndSelect(makeRoot(), pages, 'everything', llm, { topK: 1 })

    expect(result.selected.map(n => n.title)).toEqual(['Introduction'])
  })
})

describe('buildPageIndex range coverage', () => {
  it('does not drop pages before the first detected section heading', async () => {
    // pages 0-1: preamble (no heading), page 2: first heading, pages 3-4: more content
    const pages = [
      'preamble page one, no heading here',
      'preamble page two, still no heading',
      '1. Introduction\nFirst real section starts here',
      'Introduction content continues here.',
      '2. Methods\nSecond section begins.',
    ]
    const llm = vi.fn().mockResolvedValue('{"title":"Test","summary":"A test paper"}')
    const tree = await buildPageIndex(pages, llm)

    // The root node must span the full page range
    expect(tree.endPage).toBe(4)
    // Pre-heading pages (0-1) must be covered by some leaf
    const allLeaves = tree.nodes.length > 0 ? tree.nodes : [tree]
    const coversPage0 = allLeaves.some(n => n.startPage === 0)
    expect(coversPage0).toBe(true)
  })
})
