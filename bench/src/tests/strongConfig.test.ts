import { describe, expect, it } from 'vitest'
import { loadConfigs } from '../config'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const hybrid = {
  name: 'hybrid-rerank',
  kind: 'hybrid-rerank',
  chunking: { tokenizer: 'bge-m3', chunkSize: 512, overlap: 128 },
  retrieval: {
    bm25: { topK: 20, k1: 1.2, b: 0.75 },
    dense: { topK: 20, embedding: { model: 'BAAI/bge-m3', revision: 'main', queryPrefix: '', normalize: true, maxLength: 8192 } },
    rrf: { k: 60, topK: 40 },
    reranker: { model: 'BAAI/bge-reranker-v2-m3', revision: 'main', topK: 40, maxLength: 512 },
  },
  generationContext: { topK: 5, maxTokens: 4096 },
}

const longSection = {
  name: 'long-section-rag',
  kind: 'long-section-rag',
  anchors: { tokenizer: 'bge-m3', chunkSize: 512, overlap: 128 },
  retrieval: { algorithm: 'bm25', topK: 10, k1: 1.2, b: 0.75 },
  generationContext: { topK: 1, maxTokens: 4096 },
}

describe('strong baseline configs', () => {
  it('accepts the frozen hybrid-rerank contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-config-'))
    try {
      const path = join(dir, 'hybrid.json')
      writeFileSync(path, JSON.stringify(hybrid))
      const configs = await loadConfigs(path)
      expect(configs).toHaveLength(1)
      expect(configs[0]).toMatchObject({ kind: 'hybrid-rerank', retrieval: { rrf: { k: 60 } }, generationContext: { maxTokens: 4096 } })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects a context cap different from the frozen 4096 and impossible topK relations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-config-'))
    try {
      const bad = join(dir, 'bad.json')
      writeFileSync(bad, JSON.stringify({ ...hybrid, generationContext: { topK: 5, maxTokens: 2048 } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/冻结口径 4096/)
      writeFileSync(bad, JSON.stringify({ ...hybrid, retrieval: { ...hybrid.retrieval, rrf: { k: 60, topK: 100 } } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/rrf.topK/)
      writeFileSync(bad, JSON.stringify({ ...hybrid, generationContext: { topK: 50, maxTokens: 4096 } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/generationContext.topK/)
      writeFileSync(bad, JSON.stringify({ ...hybrid, retrieval: { ...hybrid.retrieval, reranker: { ...hybrid.retrieval.reranker, topK: 4 } } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/reranker.topK/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('enforces the single-unit long-section contract', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-config-'))
    try {
      const path = join(dir, 'long.json')
      writeFileSync(path, JSON.stringify(longSection))
      expect((await loadConfigs(path))[0]).toMatchObject({ kind: 'long-section-rag', generationContext: { topK: 1, maxTokens: 4096 } })
      const bad = join(dir, 'bad.json')
      writeFileSync(bad, JSON.stringify({ ...longSection, generationContext: { topK: 3, maxTokens: 4096 } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/必须为 1/)
      writeFileSync(bad, JSON.stringify({ ...longSection, retrieval: { algorithm: 'cosine', topK: 10 } }))
      await expect(loadConfigs(bad)).rejects.toThrow(/bm25/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects unknown kinds explicitly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-config-'))
    try {
      const bad = join(dir, 'bad.json')
      writeFileSync(bad, JSON.stringify({ name: 'x', kind: 'mystery' }))
      await expect(loadConfigs(bad)).rejects.toThrow(/kind/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
