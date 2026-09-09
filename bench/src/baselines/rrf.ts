import type { ScoredChunk } from '../traditionalRag/types'

/**
 * 确定性倒数排名融合（RRF，k=60 为计划 §2.2 冻结参数）。
 * 每路排序先按分数排出名次，第 rank 位（0-based）贡献 1/(k + rank + 1)；
 * 同一 id 跨列表累加后去重。并列分数按 id 升序破平，保证同输入必得同输出。
 * RRF 只消费各路的秩，不感知原始分数量纲，天然保持两路候选的贡献。
 */
export function reciprocalRankFusion(lists: ScoredChunk[][], k: number): ScoredChunk[] {
  if (!Number.isFinite(k) || k <= 0) throw new Error('RRF k 必须为正数')
  const scores = new Map<number, number>()
  for (const list of lists) {
    const ranked = [...list].sort((a, b) => b.score - a.score || a.id - b.id)
    ranked.forEach((item, rank) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + rank + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
}
