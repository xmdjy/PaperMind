import { describe, expect, it } from 'vitest'
import { reciprocalRankFusion } from '../baselines/rrf'

const s = (id: number, score: number) => ({ id, score })

describe('reciprocalRankFusion', () => {
  it('fuses two rankings by 1/(k+rank+1) and dedupes by id', () => {
    // k=60：rank0=1/61，rank1=1/62
    const fused = reciprocalRankFusion([[s(1, 0.9), s(2, 0.8)], [s(2, 0.7), s(3, 0.6)]], 60)
    expect(fused).toEqual([
      { id: 2, score: 1 / 61 + 1 / 62 },
      { id: 1, score: 1 / 61 },
      { id: 3, score: 1 / 62 },
    ])
  })

  it('uses ranks not raw scores, sorting unsorted input first', () => {
    const fused = reciprocalRankFusion([[s(5, 0.1), s(4, 0.9)]], 60)
    expect(fused).toEqual([{ id: 4, score: 1 / 61 }, { id: 5, score: 1 / 62 }])
  })

  it('breaks score ties deterministically by id ascending', () => {
    // 两个 id 在各自列表中同为 rank0 → 同分 1/61；id 升序在前
    const fused = reciprocalRankFusion([[s(9, 1)], [s(2, 1)]], 60)
    expect(fused.map(f => f.id)).toEqual([2, 9])
  })

  it('rejects non-positive k', () => {
    expect(() => reciprocalRankFusion([[s(1, 1)]], 0)).toThrow()
    expect(() => reciprocalRankFusion([[s(1, 1)]], -1)).toThrow()
  })

  it('returns empty for no lists and ignores empty lists', () => {
    expect(reciprocalRankFusion([], 60)).toEqual([])
    expect(reciprocalRankFusion([[], []], 60)).toEqual([])
  })

  it('accumulates contributions when the same id appears in both lists', () => {
    const onlyA = reciprocalRankFusion([[s(1, 1), s(2, 0.9), s(3, 0.8)]], 60)
    const fused = reciprocalRankFusion([[s(1, 1), s(2, 0.9), s(3, 0.8)], [s(3, 1)]], 60)
    const scoreOf = (list: typeof fused, id: number) => list.find(f => f.id === id)!.score
    expect(scoreOf(fused, 3)).toBeCloseTo(scoreOf(onlyA, 3) + 1 / 61, 12)
  })
})
