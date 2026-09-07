import { describe, expect, it } from 'vitest'
import { loadConfigs } from '../config'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
describe('traditional config', () => {
  it('loads each baseline as one validated point', async () => {
    for (const [name, algorithm] of [['rag-cosine', 'cosine'], ['rag-bm25', 'bm25'], ['rag-jaccard', 'jaccard']] as const) {
      const configs = await loadConfigs(name)
      expect(configs).toHaveLength(1)
      expect(configs[0]).toMatchObject({ name, kind: 'traditional-rag', retrieval: { algorithm } })
    }
  })
  it('rejects invalid traditional constraints and unknown matrix keys with their path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'traditional-config-'))
    try {
      const bad = join(dir, 'bad.json')
      writeFileSync(bad, JSON.stringify({ name: 'bad', kind: 'traditional-rag', chunking: { tokenizer: 'bge-m3', chunkSize: 10, overlap: 10 }, retrieval: { algorithm: 'jaccard', topK: 1 }, generationContext: { topK: 1, maxTokens: 1 } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/chunking.overlap/)
      writeFileSync(bad, JSON.stringify({ name: 'bad', matrix: { topk: [1] } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/matrix.topk/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
