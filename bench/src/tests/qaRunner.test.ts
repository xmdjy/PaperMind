import { describe, it, expect, vi } from 'vitest'
import type { EvalSample } from '../types'
import type { IndexNode } from '../../../src/utils/pageIndex'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

const { runQaTask, DEFAULT_SYSTEM_PROMPT } = await import('../runner/qa')

function leaf(id: string, start: number, end: number): IndexNode {
  return { title: `S${id}`, nodeId: id, startPage: start, endPage: end, summary: '', nodes: [] }
}

const tree: IndexNode = {
  title: 'P', nodeId: 'root', startPage: 0, endPage: 3, summary: '',
  nodes: [leaf('0', 0, 1), leaf('1', 2, 3)],
}

const sample: EvalSample = {
  paperId: 'p1',
  title: 'Paper 1',
  pages: ['a', 'b', 'c', 'd'],
  source: 'qasper',
  questions: [
    { id: 'p1#0', question: 'Q1?', answers: ['8'], evidencePages: [0], unanswerable: false },
  ],
}

const fakeClient = {
  complete: vi.fn(),
  chat: vi.fn(),
  stats: () => ({ hits: 0, misses: 0 }),
  latencies: () => [120, 340],
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    buildIndex: vi.fn().mockResolvedValue(tree),
    runPipeline: vi.fn().mockResolvedValue({
      answer: '8',
      retrievals: [{
        context: 'a\n\nb',
        sources: ['Pages 1–2: S0'],
        selected: [leaf('0', 0, 1)],
        scores: [{ id: 0, score: 9 }, { id: 1, score: 1 }],
        degraded: false,
        llmCalled: true,
      }],
      retrievalQuery: 'Q1?',
      rewritten: false,
      context: 'a\n\nb',
      sources: ['Pages 1–2: S0'],
      llmCalls: 2,
    }),
    ...overrides,
  }
}

const baseArgs = {
  samples: [sample],
  config: { name: 'default', topK: 2, minScore: 4 },
  client: fakeClient as never,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  gitSha: 'abc1234',
  model: 'test-model',
}

describe('runQaTask', () => {
  it('产出 BenchResult，含聚合指标与逐样本记录', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })

    expect(result.task).toBe('qa')
    expect(result.meta.completed).toBe(1)
    expect(result.meta.total).toBe(1)
    expect(result.meta.gitSha).toBe('abc1234')
    expect(result.metrics.evidenceRecall).toBe(1)
    expect(result.metrics.answerF1).toBe(1)
    expect(result.perSample).toHaveLength(1)
    expect(result.perSample[0].selectedPages).toEqual([0, 1])
    expect(result.errors).toEqual([])
  })

  it('把 config 的分块参数传给 buildPageIndex', async () => {
    const deps = makeDeps()
    await runQaTask({
      ...baseArgs,
      config: { name: 'c', chunkPages: 3, minSectionPages: 1, forceFixedChunk: true },
      deps: deps as never,
    })
    expect(deps.buildIndex.mock.calls[0][2]).toEqual({
      chunkPages: 3, minSectionPages: 1, forceFixedChunk: true,
    })
  })

  it('把 config 的检索参数传给 runRagPipeline', async () => {
    const deps = makeDeps()
    await runQaTask({
      ...baseArgs,
      config: { name: 'c', topK: 3, minScore: 6, enableRewrite: false },
      deps: deps as never,
    })
    expect(deps.runPipeline.mock.calls[0][6]).toEqual({
      topK: 3, minScore: 6, enableRewrite: false,
    })
  })

  it('每篇论文只建一次索引，多个问题复用', async () => {
    const deps = makeDeps()
    const twoQuestions: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
      ],
    }
    await runQaTask({ ...baseArgs, samples: [twoQuestions], deps: deps as never })

    expect(deps.buildIndex).toHaveBeenCalledTimes(1)
    expect(deps.runPipeline).toHaveBeenCalledTimes(2)
  })

  it('单样本失败不中断整轮，记入 errors 并从分母剔除', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce({
          answer: '9', retrievals: [], retrievalQuery: 'Q2?', rewritten: false,
          context: '', sources: [], llmCalls: 1,
        }),
    })
    const twoQuestions: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
      ],
    }
    const result = await runQaTask({ ...baseArgs, samples: [twoQuestions], deps: deps as never })

    expect(result.meta.completed).toBe(1)
    expect(result.meta.total).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ sampleId: 'p1#0', stage: 'generate' })
    expect(result.errors[0].message).toContain('network timeout')
  })

  it('建索引失败时该论文全部问题记为 index 阶段错误', async () => {
    const deps = makeDeps({ buildIndex: vi.fn().mockRejectedValue(new Error('bad pdf')) })
    const result = await runQaTask({ ...baseArgs, deps: deps as never })

    expect(result.meta.completed).toBe(0)
    expect(result.meta.total).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].stage).toBe('index')
  })

  it('unanswerable 样本按拒答模式判定，不计入 answerF1', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '参考内容中没有提到这一点。',
        retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({ ...baseArgs, samples: [unanswerableSample], deps: deps as never })

    expect(result.metrics.unanswerableAccuracy).toBe(1)
    expect(result.metrics.answerF1).toBeUndefined()
    expect(result.meta.unanswerableMethod).toBe('pattern')
  })

  it('硬答 unanswerable 问题时 unanswerableAccuracy 为 0', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '论文中使用了 8 个注意力头。',
        retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({ ...baseArgs, samples: [unanswerableSample], deps: deps as never })
    expect(result.metrics.unanswerableAccuracy).toBe(0)
  })

  it('limit 限制处理的问题数', async () => {
    const deps = makeDeps()
    const many: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
        { id: 'p1#2', question: 'Q3?', answers: ['7'], evidencePages: [3], unanswerable: false },
      ],
    }
    const result = await runQaTask({ ...baseArgs, samples: [many], limit: 2, deps: deps as never })

    expect(result.meta.total).toBe(2)
    expect(deps.runPipeline).toHaveBeenCalledTimes(2)
  })

  it('记录管线诊断指标：降级率、改写率、调用数、分块数', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })
    expect(result.metrics.degradedRate).toBe(0)
    expect(result.metrics.rewriteRate).toBe(0)
    expect(result.metrics.llmCallsPerQuery).toBe(2)
    expect(result.metrics.leafCount).toBe(2)
    // 最近秩法 p50：percentile([120, 340], 50) = ceil(0.5*2)-1 = 0 → 120（340 是 p95）
    expect(result.metrics.latencyP50).toBe(120)
    expect(result.metrics.latencyP95).toBe(340)
  })

  it('answerLanguageInstruction 非空时以空行追加在 systemPrompt 之后，未传时保持原样', async () => {
    const instruction = '请使用论文原文语言（英文）作答'
    const withInstr = makeDeps()
    await runQaTask({
      ...baseArgs,
      answerLanguageInstruction: instruction,
      deps: withInstr as never,
    })
    expect(withInstr.runPipeline.mock.calls[0][5]).toBe(`${DEFAULT_SYSTEM_PROMPT}\n\n${instruction}`)

    const without = makeDeps()
    await runQaTask({ ...baseArgs, deps: without as never })
    expect(without.runPipeline.mock.calls[0][5]).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('打分短路（llmCalled=false）时不写 mrr，检索覆盖指标照常写入', async () => {
    // 单叶索引时 scoreAndSelect 不发 LLM 打分，排序无从谈起——
    // mrr 记 0 会把「无排序可言」误算成「排得差」，必须缺指标交给聚合层剔除
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '8',
        retrievals: [{
          context: 'a\n\nb',
          sources: ['Pages 1–2: S0'],
          selected: [leaf('0', 0, 1)],
          scores: [{ id: 0, score: 9 }, { id: 1, score: 1 }],
          degraded: false,
          llmCalled: false,
        }],
        retrievalQuery: 'Q1?',
        rewritten: false,
        context: 'a\n\nb',
        sources: ['Pages 1–2: S0'],
        llmCalls: 1,
      }),
    })
    const result = await runQaTask({ ...baseArgs, deps: deps as never })

    expect(result.metrics.mrr).toBeUndefined()
    expect(result.metrics.evidenceRecall).toBe(1)
    expect(result.metrics.evidenceHitRate).toBe(1)
    expect(result.perSample[0].metrics.mrr).toBeUndefined()
  })

  it('单节点索引（无叶节点）时 leafCount 为 1 且不写 mrr', async () => {
    // 建索引 fallback：tree.nodes 为空时树根自身就是叶（短篇论文的生产真实路径），
    // 是「mrr 短路」与「leaves 口径」两条裁定的交汇点
    const singleNode: IndexNode = leaf('root', 0, 3)
    const deps = makeDeps({
      buildIndex: vi.fn().mockResolvedValue(singleNode),
      // 单叶短路语义：scoreAndSelect 不发 LLM 打分（llmCalled=false），
      // 否则 mrr 不会被删、断言失败
      runPipeline: vi.fn().mockResolvedValue({
        answer: '8',
        retrievals: [{
          context: 'a\n\nb',
          sources: ['Pages 1–3: Sroot'],
          selected: [singleNode],
          scores: [{ id: 0, score: 9 }],
          degraded: false,
          llmCalled: false,
        }],
        retrievalQuery: 'Q1?',
        rewritten: false,
        context: 'a\n\nb',
        sources: ['Pages 1–3: Sroot'],
        llmCalls: 1,
      }),
    })
    const result = await runQaTask({ ...baseArgs, deps: deps as never })

    expect(result.metrics.leafCount).toBe(1)
    expect(result.metrics.mrr).toBeUndefined()          // 无排序可言，不写而非记 0
    expect(result.metrics.evidenceRecall).toBeDefined() // 选中页覆盖与有无打分无关，照常写入
  })
})
