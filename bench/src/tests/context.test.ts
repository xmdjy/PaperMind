import { describe, expect, it } from 'vitest'
import { selectContext } from '../traditionalRag/context'
describe('context selection', () => {
  it('uses stable ranking and never truncates an over-budget chunk', () => {
    const chunks = [{ id: 0, text: 'A', tokenCount: 2, startPage: 0, endPage: 0 }, { id: 1, text: 'B', tokenCount: 2, startPage: 1, endPage: 1 }]
    const out = selectContext(chunks, [{ id: 1, score: 1 }, { id: 0, score: 1 }], { retrievalTopK: 2, topK: 2, maxTokens: 3 })
    expect(out.selected.map(c => c.id)).toEqual([0])
    expect(out.context).toBe('A')
  })

  it('skips an unknown scored id instead of discarding valid later context', () => {
    const chunks = [{ id: 0, text: 'A', tokenCount: 1, startPage: 0, endPage: 0 }]
    const out = selectContext(chunks, [{ id: 99, score: 2 }, { id: 0, score: 1 }], { retrievalTopK: 2, topK: 1, maxTokens: 2 })
    expect(out.selected.map(c => c.id)).toEqual([0])
  })
})
