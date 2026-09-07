import type { BenchChunk, ScoredChunk } from './types'
export function sortScoredChunks(scores: ScoredChunk[]): ScoredChunk[] { return [...scores].map(s => ({ ...s, score: Number.isFinite(s.score) ? s.score : 0 })).sort((a, b) => b.score - a.score || a.id - b.id) }
export function selectContext(chunks: BenchChunk[], scores: ScoredChunk[], options: { retrievalTopK: number; topK: number; maxTokens: number }) {
  const byId = new Map(chunks.map(c => [c.id, c])); const ranked = sortScoredChunks(scores); const selected: BenchChunk[] = []; let tokens = 0
  for (const score of ranked.slice(0, options.retrievalTopK)) { const chunk = byId.get(score.id); if (!chunk) continue; if (selected.length >= options.topK || tokens + chunk.tokenCount > options.maxTokens) break; selected.push(chunk); tokens += chunk.tokenCount }
  return { ranked, selected, tokenCount: tokens, context: selected.map(c => c.text).join('\n\n---\n\n'), sources: selected.map(c => `第 ${c.startPage + 1}-${c.endPage + 1} 页`) }
}
