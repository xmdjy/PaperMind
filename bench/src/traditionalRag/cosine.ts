import { normalize } from './embedding'
import type { BenchChunk, BuiltRetriever, EmbeddingProvider, ScoredChunk } from './types'
export async function buildCosineRetriever(chunks: BenchChunk[], provider: EmbeddingProvider, options: { queryPrefix: string; maxLength: number }): Promise<BuiltRetriever> {
  const vectors = (await provider.embed(chunks.map(c => c.text))).map((v, i) => checked(normalize(v), `chunk ${i}`))
  const dimension = vectors[0]?.length
  return { chunks, async score(query: string): Promise<ScoredChunk[]> {
    if (!query || !chunks.length) return chunks.map(c => ({ id: c.id, score: 0 }))
    const queryVector = checked(normalize((await provider.embed([`${options.queryPrefix}${query}`]))[0] ?? []), 'query')
    if (dimension !== undefined && queryVector.length !== dimension) throw new Error(`embedding 维度不一致：query=${queryVector.length}, chunk=${dimension}`)
    return chunks.map((c, i) => ({ id: c.id, score: vectors[i].reduce((sum, n, d) => sum + n * queryVector[d], 0) }))
  } }
}
function checked(v: number[], label: string): number[] { if (!v.length || v.some(n => !Number.isFinite(n))) throw new Error(`${label} embedding 包含空值或非有限数`) ; return v }
