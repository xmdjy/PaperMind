import { describe, expect, it } from 'vitest'
import { runTraditionalRagQaTask } from '../runner/traditionalRagQa'

describe('traditional RAG runner', () => {
  it('builds once per paper and generates once per question', async () => {
    let builds = 0; let generations = 0
    const result = await runTraditionalRagQaTask({
      samples: [{ paperId: 'p', title: 'p', pages: ['evidence'], source: 'smoke', questions: [{ id: 'q1', question: 'q', answers: ['a'], evidencePages: [0], unanswerable: false }, { id: 'q2', question: 'q', answers: ['a'], evidencePages: [0], unanswerable: false }] }],
      config: { name: 'j', kind: 'traditional-rag', chunking: { tokenizer: 'bge-m3', chunkSize: 2, overlap: 0 }, retrieval: { algorithm: 'jaccard', topK: 2 }, generationContext: { topK: 1, maxTokens: 10 } },
      client: { complete: async () => '', chat: async () => '', stats: () => ({ hits: 0, misses: 0 }), latencies: () => [], requestTimings: () => [] }, systemPrompt: 'system', gitSha: 'x', model: 'm',
      deps: {
        tokenizer: { tokenize: text => [text] },
        buildRetriever: async chunks => { builds++; return { chunks, score: () => chunks.map(c => ({ id: c.id, score: 1 })) } },
        generateAnswer: async () => { generations++; return 'a' },
      },
    })
    expect(builds).toBe(1)
    expect(generations).toBe(2)
    expect(result.perSample.every(r => r.metrics.llmCalls === 1)).toBe(true)
  })

  it('excludes ambiguous evidence from retrieval-quality denominators', async () => {
    const result = await runTraditionalRagQaTask({
      samples: [{ paperId: 'p', title: 'p', pages: ['text'], source: 'qasper', questions: [{ id: 'q', question: 'q', answers: ['a'], evidencePages: [0], evidenceMapping: 'ambiguous', unanswerable: false }] }],
      config: { name: 'j', kind: 'traditional-rag', chunking: { tokenizer: 'bge-m3', chunkSize: 2, overlap: 0 }, retrieval: { algorithm: 'jaccard', topK: 1 }, generationContext: { topK: 1, maxTokens: 10 } },
      client: { complete: async () => '', chat: async () => '', stats: () => ({ hits: 0, misses: 0 }), latencies: () => [], requestTimings: () => [] }, systemPrompt: 's', gitSha: 'x', model: 'm',
      deps: { tokenizer: { tokenize: text => [text] }, buildRetriever: async chunks => ({ chunks, score: () => [{ id: 0, score: 1 }] }), generateAnswer: async () => 'a' },
    })
    expect(result.metrics.evidenceRecall).toBeUndefined()
  })

  it('records a retrieval failure and continues with later questions', async () => {
    let calls = 0
    const result = await runTraditionalRagQaTask({
      samples: [{ paperId: 'p', title: 'p', pages: ['text'], source: 'smoke', questions: [{ id: 'bad', question: 'q', answers: ['a'], evidencePages: [], unanswerable: false }, { id: 'good', question: 'q', answers: ['a'], evidencePages: [], unanswerable: false }] }],
      config: { name: 'j', kind: 'traditional-rag', chunking: { tokenizer: 'bge-m3', chunkSize: 2, overlap: 0 }, retrieval: { algorithm: 'jaccard', topK: 1 }, generationContext: { topK: 1, maxTokens: 10 } },
      client: { complete: async () => '', chat: async () => '', stats: () => ({ hits: 0, misses: 0 }), latencies: () => [], requestTimings: () => [] }, systemPrompt: 's', gitSha: 'x', model: 'm',
      deps: { tokenizer: { tokenize: text => [text] }, buildRetriever: async chunks => ({ chunks, score: () => { if (calls++ === 0) throw new Error('broken retrieval'); return [{ id: 0, score: 1 }] } }), generateAnswer: async () => 'a' },
    })
    expect(result.errors).toEqual([{ sampleId: 'bad', stage: 'retrieve', message: 'broken retrieval' }])
    expect(result.perSample.map(x => x.id)).toEqual(['good'])
  })
})
