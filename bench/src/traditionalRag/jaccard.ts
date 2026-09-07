import { lexicalTokenize } from './lexicalTokenizer'
import type { BenchChunk, BuiltRetriever, ScoredChunk } from './types'
export function buildJaccardRetriever(chunks: BenchChunk[]): BuiltRetriever {
  const sets = chunks.map(c => new Set(lexicalTokenize(c.text)))
  return { chunks, score(query: string): ScoredChunk[] { const q = new Set(lexicalTokenize(query)); return chunks.map((c, i) => { const set = sets[i]; if (!q.size || !set.size) return { id: c.id, score: 0 }; let intersection = 0; q.forEach(t => { if (set.has(t)) intersection++ }); return { id: c.id, score: intersection / (q.size + set.size - intersection) } }) } }
}
