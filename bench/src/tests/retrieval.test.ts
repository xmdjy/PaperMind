import { describe, it, expect } from 'vitest'
import type { IndexNode } from '../../../src/utils/pageIndex'
import { expandPages, computeRetrievalMetrics } from '../metrics/retrieval'

function node(id: string, start: number, end: number): IndexNode {
  return { title: `S${id}`, nodeId: id, startPage: start, endPage: end, summary: '', nodes: [] }
}

const leaves = [node('0', 0, 1), node('1', 2, 3), node('2', 4, 5)]

describe('expandPages', () => {
  it('把页码区间展开为去重升序页号', () => {
    expect(expandPages([node('a', 0, 2), node('b', 2, 3)])).toEqual([0, 1, 2, 3])
  })

  it('空输入返回空数组', () => {
    expect(expandPages([])).toEqual([])
  })
})

describe('computeRetrievalMetrics', () => {
  it('全部 evidence 被覆盖时 recall=1、hit=1', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }, { id: 1, score: 2 }, { id: 2, score: 1 }],
      evidencePages: [0, 1],
      context: 'x'.repeat(400),
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(1)
    expect(m.evidenceHit).toBe(1)
    expect(m.contextPrecision).toBe(1)   // 选中 2 页，2 页都是 evidence
    expect(m.mrr).toBe(1)                // evidence 所在节点排在第 1 位
    expect(m.contextTokens).toBe(100)    // 400 字符 / 4
  })

  it('部分覆盖时 recall 为覆盖比例', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }],
      evidencePages: [0, 4],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0.5)
    expect(m.evidenceHit).toBe(1)
    expect(m.contextPrecision).toBe(0.5)  // 选中 2 页，其中 1 页是 evidence
  })

  it('完全捞空时 recall=0、hit=0、precision=0', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }, { id: 2, score: 8 }],
      evidencePages: [4, 5],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0)
    expect(m.evidenceHit).toBe(0)
    expect(m.contextPrecision).toBe(0)
  })

  it('mrr 取 evidence 节点在打分排序中的首个名次倒数', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      // 排序后为 [1(9分), 2(7分), 0(1分)]；evidence 在页 4-5 即节点 2，排第 2 位
      scores: [{ id: 0, score: 1 }, { id: 1, score: 9 }, { id: 2, score: 7 }],
      evidencePages: [4],
      context: '',
      degraded: false,
    })
    expect(m.mrr).toBeCloseTo(0.5)
  })

  it('降级时 mrr 记 0（打分不可用，排序无意义）', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [],
      evidencePages: [0],
      context: '',
      degraded: true,
    })
    expect(m.mrr).toBe(0)
    expect(m.evidenceRecall).toBe(1)  // 降级但恰好命中，recall 照算
  })

  it('evidence 标注为空时 recall/precision 记 0 但不崩', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }],
      evidencePages: [],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0)
    expect(m.contextPrecision).toBe(0)
    expect(m.mrr).toBe(0)
  })

  it('未选中任何节点时不产生除零', () => {
    const m = computeRetrievalMetrics({
      selected: [],
      leaves,
      scores: [],
      evidencePages: [0],
      context: '',
      degraded: false,
    })
    expect(m.contextPrecision).toBe(0)
    expect(m.evidenceRecall).toBe(0)
    expect(Number.isNaN(m.contextPrecision)).toBe(false)
  })
})
