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
  // pages[0] 用唯一哨兵串：judge evidence 用例靠它区分「evidence 原文」与「检索上下文」，
  // 若用普通字符（如 'a'）会与 prompt 样板文本恒匹配，断言恒真
  pages: ['EVIDENCE_MARKER_7f3a', 'b', 'c', 'd'],
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
  requestTimings: () => [],
}

/** 生产 timing 字段的最小值，供 pipeline mock 返回。 */
const baseTiming = {
  queryRewriteLatencyMs: 0,
  retrievalLatencyMs: 20,
  answerGenerationLatencyMs: 30,
  queryEndToEndLatencyMs: 50,
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    buildIndex: vi.fn().mockResolvedValue(tree),
    runPipeline: vi.fn().mockResolvedValue({
      answer: '8',
      retrievals: [{
        context: 'CONTEXT_MARKER_9c2e',
        sources: ['Pages 1–2: S0'],
        selected: [leaf('0', 0, 1)],
        scores: [{ id: 0, score: 9 }, { id: 1, score: 1 }],
        degraded: false,
        llmCalled: true,
      }],
      retrievalQuery: 'Q1?',
      rewritten: false,
      context: 'CONTEXT_MARKER_9c2e',
      sources: ['Pages 1–2: S0'],
      llmCalls: 2,
      timing: { ...baseTiming },
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
          context: '', sources: [], llmCalls: 1, timing: { ...baseTiming },
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
        context: '', sources: [], llmCalls: 1, timing: { ...baseTiming },
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
        context: '', sources: [], llmCalls: 1, timing: { ...baseTiming },
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
        timing: { ...baseTiming },
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
        timing: { ...baseTiming },
      }),
    })
    const result = await runQaTask({ ...baseArgs, deps: deps as never })

    expect(result.metrics.leafCount).toBe(1)
    expect(result.metrics.mrr).toBeUndefined()          // 无排序可言，不写而非记 0
    expect(result.metrics.evidenceRecall).toBeDefined() // 选中页覆盖与有无打分无关，照常写入
  })

  it('无 evidence 样本保留运行诊断，但不进入任何 retrieval quality 分母', async () => {
    const mixed: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'unknown?', answers: [], evidencePages: [], unanswerable: true },
      ],
    }
    const result = await runQaTask({ ...baseArgs, samples: [mixed], deps: makeDeps() as never })
    expect(result.metrics.evidenceRecall).toBe(1)
    expect(result.metrics.evidenceRecallSampleCount).toBe(1)
    expect(result.metrics.evidenceHitSampleCount).toBe(1)
    expect(result.metrics.contextPrecisionSampleCount).toBe(1)
    expect(result.metrics.mrrSampleCount).toBe(1)
    expect(result.perSample[1].metrics.contextTokens).toBeDefined()
    expect(result.perSample[1].metrics.evidenceRecall).toBeUndefined()
  })

  it('evidence 映射元数据只统计 QASPER，且 unmapped 进入覆盖率分母', async () => {
    const qasper: EvalSample = {
      ...sample,
      source: 'qasper',
      questions: [
        { ...sample.questions[0], evidenceMapping: 'mapped' },
        { id: 'p1#1', question: 'missing?', answers: ['x'], evidencePages: [], unanswerable: false, evidenceMapping: 'unmapped' },
      ],
    }
    const smoke: EvalSample = { ...qasper, paperId: 'smoke', source: 'smoke' }
    const result = await runQaTask({ ...baseArgs, samples: [qasper, smoke], deps: makeDeps() as never })
    expect(result.meta.evidenceMappingCoverage).toBe(0.5)
    expect(result.meta.unmappedEvidenceRate).toBe(0.5)
  })

  it('perPaper 记录索引时长、问题数、cache 差值与 leafCount', async () => {
    // 注入脚本化时钟：runStartedMs → indexStartedMs → indexFinishedMs → questionStartedMs → 结束
    // 默认单样本单问题，now() 恰好调用 5 次
    const now = scriptedClock([100, 100, 250, 300, 500])
    const result = await runQaTask({ ...baseArgs, now, deps: makeDeps() as never })

    expect(result.perPaper).toHaveLength(1)
    const p = result.perPaper![0]
    expect(p.paperId).toBe('p1')
    expect(p.source).toBe('qasper')
    expect(p.pageCount).toBe(4)
    expect(p.questionCount).toBe(1)
    expect(p.indexBuildLatencyMs).toBe(150)
    expect(p.leafCount).toBe(2)
    // fakeClient.stats() 恒为 {hits:0, misses:0}，索引前后差值即 0
    expect(p.indexLlmCalls).toBe(0)
    expect(p.indexCacheHits).toBe(0)
    expect(p.indexCacheMisses).toBe(0)
    expect(p.error).toBeUndefined()
  })

  it('每个成功 perSample 都有四个非负 timing 字段', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })

    expect(result.perSample).toHaveLength(1)
    const t = result.perSample[0].timing
    expect(t).toBeDefined()
    expect(t).toMatchObject({
      queryRewriteLatencyMs: 0,
      retrievalLatencyMs: 20,
      answerGenerationLatencyMs: 30,
      queryEndToEndLatencyMs: 50,
    })
    for (const v of Object.values(t!)) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('metrics 正确生成 index/retrieval/generation/end-to-end 的 P50/P95', async () => {
    const now = scriptedClock([100, 100, 250, 300, 500])
    const result = await runQaTask({ ...baseArgs, now, deps: makeDeps() as never })

    // index 单值 150；retrieval 20 / generation 30 / e2e 50 来自 mock timing
    expect(result.metrics.indexBuildLatencyP50Ms).toBe(150)
    expect(result.metrics.indexBuildLatencyP95Ms).toBe(150)
    expect(result.metrics.retrievalLatencyP50Ms).toBe(20)
    expect(result.metrics.retrievalLatencyP95Ms).toBe(20)
    expect(result.metrics.answerGenerationLatencyP50Ms).toBe(30)
    expect(result.metrics.answerGenerationLatencyP95Ms).toBe(30)
    expect(result.metrics.queryEndToEndLatencyP50Ms).toBe(50)
    expect(result.metrics.queryEndToEndLatencyP95Ms).toBe(50)
    // 均值侧同样存在（aggregate 产生），供报表均值列展示
    expect(result.metrics.queryEndToEndLatencyMs).toBe(50)
  })

  it('索引失败仍记录已消耗的索引时长与缓存差值，但不能生成题目时延', async () => {
    // 注入脚本化时钟：runStartedMs → indexStartedMs → indexFinishedMs（catch 内）→ runWallClockMs
    const now = scriptedClock([100, 100, 250, 400])
    const deps = makeDeps({ buildIndex: vi.fn().mockRejectedValue(new Error('bad pdf')) })
    const result = await runQaTask({ ...baseArgs, now, deps: deps as never })

    expect(result.perPaper).toHaveLength(1)
    const p = result.perPaper![0]
    expect(p.error).toContain('bad pdf')
    // 失败论文的索引时长不能被时延分析漏掉——「索引慢后失败」的成本同样要可诊断
    expect(p.indexBuildLatencyMs).toBe(150)
    // fakeClient.stats() 恒为 {hits:0, misses:0}，索引前后差值即 0
    expect(p.indexLlmCalls).toBe(0)
    expect(p.indexCacheHits).toBe(0)
    expect(p.indexCacheMisses).toBe(0)
    // 失败后没有树结构，leafCount 仍不写
    expect(p.leafCount).toBeUndefined()
    expect(result.perSample).toHaveLength(0)
    // 失败样本不得伪造题目时延：无完成题则检索/生成/端到端分位数不产生
    expect(result.metrics.retrievalLatencyP50Ms).toBeUndefined()
    expect(result.metrics.queryEndToEndLatencyP50Ms).toBeUndefined()
    // 但已记录的索引时长进入聚合
    expect(result.metrics.indexBuildLatencyP50Ms).toBe(150)
    expect(result.metrics.indexBuildLatencyP95Ms).toBe(150)
  })

  it('meta 记录 startedAt/finishedAt/runWallClockMs/缓存计数，零请求时 cacheHitRate 为 0', async () => {
    const now = scriptedClock([100, 100, 250, 300, 500])
    const result = await runQaTask({ ...baseArgs, now, deps: makeDeps() as never })

    expect(result.meta.startedAt).toBeDefined()
    expect(result.meta.finishedAt).toBe(result.meta.timestamp)
    expect(new Date(result.meta.startedAt!).getTime()).toBeLessThanOrEqual(new Date(result.meta.finishedAt!).getTime())
    expect(result.meta.runWallClockMs).toBe(400)
    expect(result.meta.cacheHits).toBe(0)
    expect(result.meta.cacheMisses).toBe(0)
    expect(result.meta.cacheHitRate).toBe(0)
  })

  it('latencyP50/P95 与 llmNetworkLatencyP50Ms/P95Ms 相等', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })

    // 最近秩法 p50：percentile([120, 340], 50) = ceil(0.5*2)-1 = 0 → 120（340 是 p95）
    expect(result.metrics.latencyP50).toBe(120)
    expect(result.metrics.latencyP95).toBe(340)
    expect(result.metrics.llmNetworkLatencyP50Ms).toBe(120)
    expect(result.metrics.llmNetworkLatencyP95Ms).toBe(340)
    expect(result.metrics.llmNetworkLatencyP50Ms).toBe(result.metrics.latencyP50)
    expect(result.metrics.llmNetworkLatencyP95Ms).toBe(result.metrics.latencyP95)
  })

  it('pipeline 完全缺失 timing 时抛错，不把缺 timing 的题静默当成功样本', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '8', retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    await expect(runQaTask({ ...baseArgs, deps: deps as never })).rejects.toThrow(/timing/)
  })

  it('pipeline 任一时延字段为负或非有限时抛错，不伪造成功', async () => {
    // 四个字段逐个覆盖：负值、NaN、Infinity 均应触发不变量破坏
    const badTimings = [
      { ...baseTiming, queryRewriteLatencyMs: -1 },
      { ...baseTiming, retrievalLatencyMs: NaN },
      { ...baseTiming, answerGenerationLatencyMs: Infinity },
      { ...baseTiming, queryEndToEndLatencyMs: -5 },
    ]
    for (const timing of badTimings) {
      const deps = makeDeps({
        runPipeline: vi.fn().mockResolvedValue({
          answer: '8', retrievals: [], retrievalQuery: 'Q?', rewritten: false,
          context: '', sources: [], llmCalls: 1, timing,
        }),
      })
      await expect(runQaTask({ ...baseArgs, deps: deps as never })).rejects.toThrow(/timing/)
    }
  })
})

/** 注入脚本化时钟：返回预设时间序列，用尽后保持末值（配合 Math.max(0,…) 钳制）。 */
function scriptedClock(ts: number[]): () => number {
  let i = 0
  return () => (i < ts.length ? ts[i++] : ts[ts.length - 1])
}

describe('runQaTask + judge', () => {
  const judgeClient = {
    complete: vi.fn().mockResolvedValue('{"factuality":5,"completeness":4,"groundedness":5}'),
    chat: vi.fn(),
    stats: () => ({ hits: 0, misses: 0 }),
    latencies: () => [],
  }

  it('启用 judge 时记录三维分数并标注 judgeModel', async () => {
    const result = await runQaTask({
      ...baseArgs,
      judgeClient: judgeClient as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })

    expect(result.metrics.judgeFactuality).toBe(5)
    expect(result.metrics.judgeCompleteness).toBe(4)
    expect(result.metrics.judgeGroundedness).toBe(5)
    expect(result.meta.judgeModel).toBe('judge-model')
  })

  it('judge prompt 用 evidence 原文而非检索上下文', async () => {
    judgeClient.complete.mockClear()
    await runQaTask({
      ...baseArgs,
      judgeClient: judgeClient as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })
    // 哨兵断言：evidence 只能来自 sample.pages[0]，不能混入 runPipeline mock 返回的检索 context；
    // 普通短串会与 prompt 样板恒匹配（变异测试已证），必须用双方互斥的哨兵串
    const prompt = judgeClient.complete.mock.calls[0][0]
    expect(prompt).toContain('EVIDENCE_MARKER_7f3a')
    expect(prompt).not.toContain('CONTEXT_MARKER_9c2e')
  })

  it('judge 返回不可解析内容时不写 judge 指标，其余指标照常', async () => {
    const badJudge = {
      complete: vi.fn().mockResolvedValue('我拒绝评分'),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    }
    const result = await runQaTask({
      ...baseArgs,
      judgeClient: badJudge as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })

    expect(result.metrics.judgeFactuality).toBeUndefined()
    expect(result.metrics.answerF1).toBe(1)
  })

  it('judge 判定 unanswerable 时 meta 标注口径为 judge', async () => {
    const refusalJudge = {
      complete: vi.fn().mockResolvedValue('REFUSAL'),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    }
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '无从判断', retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1, timing: { ...baseTiming },
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({
      ...baseArgs,
      samples: [unanswerableSample],
      judgeClient: refusalJudge as never,
      judgeModel: 'judge-model',
      deps: deps as never,
    })

    expect(result.metrics.unanswerableAccuracy).toBe(1)
    expect(result.meta.unanswerableMethod).toBe('judge')
  })
})
