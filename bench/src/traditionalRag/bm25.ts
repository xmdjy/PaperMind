import { lexicalTokenize } from './lexicalTokenizer'
import type { BenchChunk, BuiltRetriever, ScoredChunk } from './types'

export function buildBm25Retriever(chunks: BenchChunk[], options: { k1: number; b: number } = { k1: 1.2, b: 0.75 }): BuiltRetriever {
  const docs = chunks.map(c => lexicalTokenize(c.text)); const lengths = docs.map(d => d.length); const avgdl = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const tfs = docs.map(d => { const m = new Map<string, number>(); d.forEach(t => m.set(t, (m.get(t) ?? 0) + 1)); return m })
  const df = new Map<string, number>(); tfs.forEach(m => m.forEach((_, t) => df.set(t, (df.get(t) ?? 0) + 1)))
  return { chunks, score(query: string): ScoredChunk[] {
    const q = lexicalTokenize(query); const N = chunks.length
    return chunks.map((chunk, i) => { let score = 0; for (const term of q) { const tf = tfs[i].get(term) ?? 0; const n = df.get(term) ?? 0; if (!tf || !N || !avgdl) continue; const idf = Math.log(1 + (N - n + .5) / (n + .5)); score += idf * tf * (options.k1 + 1) / (tf + options.k1 * (1 - options.b + options.b * lengths[i] / avgdl)) } return { id: chunk.id, score: Number.isFinite(score) ? score : 0 } })
  } }
}
