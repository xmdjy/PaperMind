/**
 * 强基线共享 QA 编排引擎（hybrid-rerank / long-section-rag 复用）：
 * 每篇建索引一次 → 逐问调用注入的检索器 → 与既有 runner 完全相同的
 * 生成 prompt、拒答/judge 口径、指标计算与聚合尾部。
 * 计划 §1.1 冻结契约：原始问题直投（无改写）、4096 token 预算、
 * 失败记入 errors 且不伪造上下文、index 阶段 LLM 调用恒为 0。
 */
import type { BenchResult, EvalSample, PaperTimingRecord, PerSampleRecord, SampleError } from '../types'
import type { PageSpan, ScoredPageSpan } from '../metrics/retrieval'
import type { LlmClient } from '../llmClient'
import { answerF1, isRefusal, REFUSAL_PATTERN_VERSION } from '../metrics/answerF1'
import { computeRetrievalMetrics, estimateTokens, expandPages } from '../metrics/retrieval'
import { aggregate, metricSampleCounts, renameQaRates, withLatencyStats, withPercentiles } from '../metrics/aggregate'
import { judgeAnswer, judgeUnanswerable, RUBRIC_VERSION } from '../metrics/judge'
import { MATH_FORMAT_INSTRUCTION } from '../../../src/utils/ragPipeline'

export interface StrongRetrievalOutcome {
  context: string
  /** 选中的上下文单元（页区间，含端点） */
  selected: PageSpan[]
  /** 全部候选，供 MRR 把 scores 的 id 映射回页区间 */
  leaves: PageSpan[]
  /** 完整排序（最终次序），分数必须单调于名次 */
  scores: ScoredPageSpan[]
  /** 检索阶段自身消耗的 LLM 调用次数（如 agentic 检索）；计入 llmCalls */
  retrievalLlmCalls?: number
}

export interface StrongRetrievalRuntime {
  /** 候选/上下文粒度自证（写入 meta.candidateGranularity） */
  granularity: string
  /** 每篇论文调用一次；返回该论文的逐问检索函数 */
  build(sample: EvalSample): Promise<{
    leafCount: number
    /** 索引阶段 LLM 调用与缓存命中（上游索引型基线如实计入；默认 0） */
    indexLlmCalls?: number
    indexCacheHits?: number
    indexCacheMisses?: number
    retrieve(question: string): Promise<StrongRetrievalOutcome>
  }>
}

export interface StrongBaselineQaArgs {
  samples: EvalSample[]
  client: LlmClient
  systemPrompt: string
  /** 样本级语言覆盖指令，语义与 runQaTask 一致 */
  answerLanguageInstruction?: string
  limit?: number
  gitSha: string
  model: string
  judgeClient?: LlmClient
  judgeModel?: string
  now?: () => number
  retrieval: StrongRetrievalRuntime
  /** 写入 meta 的基线标识 */
  meta: { retrievalAlgorithm: NonNullable<BenchResult['meta']['retrievalAlgorithm']>; baselineFamily: BenchResult['meta']['baselineFamily']; config: BenchResult['config'] }
  /** 测试注入，替换真实 LLM 生成 */
  generateAnswer?: (system: string, question: string) => Promise<string>
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export async function runStrongBaselineQaTask(args: StrongBaselineQaArgs): Promise<BenchResult> {
  const now = args.now ?? Date.now
  const started = now()
  const startedAt = new Date().toISOString()
  const records: PerSampleRecord[] = []
  const perPaper: PaperTimingRecord[] = []
  const errors: SampleError[] = []
  let total = 0
  let sawUnanswerable = false
  let usedPatternFallback = false
  let qasperEvidenceQuestions = 0
  let mappedEvidenceQuestions = 0
  let ambiguousEvidenceQuestions = 0
  let unmappedEvidenceQuestions = 0

  const baseSystemPrompt = args.answerLanguageInstruction
    ? `${args.systemPrompt}\n\n${args.answerLanguageInstruction}`
    : args.systemPrompt

  for (const sample of args.samples) {
    if (args.limit !== undefined && total >= args.limit) break
    const questionCount = Math.min(sample.questions.length, args.limit === undefined ? Infinity : args.limit - total)
    const indexStart = now()
    let runtime: { leafCount: number; indexLlmCalls?: number; indexCacheHits?: number; indexCacheMisses?: number; retrieve(question: string): Promise<StrongRetrievalOutcome> }
    try {
      runtime = await args.retrieval.build(sample)
    } catch (e) {
      perPaper.push({ paperId: sample.paperId, source: sample.source, pageCount: sample.pages.length, questionCount, indexBuildLatencyMs: Math.max(0, now() - indexStart), error: message(e) })
      for (const q of sample.questions.slice(0, questionCount)) errors.push({ sampleId: q.id, stage: 'index', message: message(e) })
      total += questionCount
      continue
    }
    perPaper.push({
      paperId: sample.paperId, source: sample.source, pageCount: sample.pages.length, questionCount,
      indexBuildLatencyMs: Math.max(0, now() - indexStart),
      indexLlmCalls: runtime.indexLlmCalls ?? 0, indexCacheHits: runtime.indexCacheHits ?? 0, indexCacheMisses: runtime.indexCacheMisses ?? 0,
      leafCount: runtime.leafCount,
    })

    for (const question of sample.questions) {
      if (args.limit !== undefined && total >= args.limit) break
      total++
      if (sample.source === 'qasper' && !question.unanswerable) {
        qasperEvidenceQuestions++
        if (question.evidenceMapping === 'mapped') mappedEvidenceQuestions++
        else if (question.evidenceMapping === 'ambiguous') ambiguousEvidenceQuestions++
        else unmappedEvidenceQuestions++
      }
      const queryStart = now()
      let stage: SampleError['stage'] = 'retrieve'
      try {
        const retrievalStart = now()
        const outcome = await runtime.retrieve(question.question)
        const retrievalLatencyMs = Math.max(0, now() - retrievalStart)
        const systemPrompt = `${baseSystemPrompt}\n\n${MATH_FORMAT_INSTRUCTION}` + (outcome.context ? `\n\n参考内容：\n${outcome.context}` : '')
        stage = 'generate'
        const generateStart = now()
        const answer = args.generateAnswer
          ? await args.generateAnswer(systemPrompt, question.question)
          : await args.client.chat([{ role: 'system', content: systemPrompt }, { role: 'user', content: question.question }])
        const answerGenerationLatencyMs = Math.max(0, now() - generateStart)
        const timing = { queryRewriteLatencyMs: 0, retrievalLatencyMs, answerGenerationLatencyMs, queryEndToEndLatencyMs: Math.max(0, now() - queryStart) }
        const metrics: Record<string, number> = { llmCalls: 1 + (outcome.retrievalLlmCalls ?? 0), rewrite: 0, leafCount: runtime.leafCount, ...timing }
        if (outcome.retrievalLlmCalls !== undefined) metrics.retrievalLlmCalls = outcome.retrievalLlmCalls

        // 与既有 runner 相同的映射证据排除规则；MRR 用完整最终排序
        const retrievalEligible = question.evidencePages.length > 0 && question.evidenceMapping !== 'ambiguous' && question.evidenceMapping !== 'unmapped'
        if (retrievalEligible) {
          Object.assign(metrics, computeRetrievalMetrics({
            selected: outcome.selected,
            leaves: outcome.leaves,
            scores: outcome.scores,
            evidencePages: question.evidencePages,
            context: outcome.context,
            degraded: false,
          }))
        } else {
          metrics.contextTokens = estimateTokens(outcome.context)
        }

        if (question.unanswerable) {
          sawUnanswerable = true
          const verdict = args.judgeClient ? await judgeUnanswerable({ question: question.question, answer, client: args.judgeClient }) : null
          if (verdict === null) usedPatternFallback = true
          metrics.unanswerableAccuracy = verdict === null ? (isRefusal(answer) ? 1 : 0) : (verdict ? 1 : 0)
        } else {
          metrics.answerF1 = answerF1(answer, question.answers)
          const evidence = question.evidencePages.map(p => sample.pages[p] ?? '').join('\n\n').trim()
          if (args.judgeClient && evidence) {
            const judged = await judgeAnswer({ question: question.question, evidence, answer, client: args.judgeClient })
            if (judged) Object.assign(metrics, { judgeFactuality: judged.factuality, judgeCompleteness: judged.completeness, judgeGroundedness: judged.groundedness })
          }
        }

        records.push({ id: question.id, paperId: sample.paperId, source: sample.source, metrics, timing, retrievalQuery: question.question, selectedPages: expandPages(outcome.selected), evidencePages: question.evidencePages, answer })
      } catch (e) {
        errors.push({ sampleId: question.id, stage, message: message(e) })
      }
    }
  }

  const finishedAt = new Date().toISOString()
  const { hits, misses } = args.client.stats()
  const values = {
    indexBuildLatency: perPaper.flatMap(p => p.indexBuildLatencyMs === undefined ? [] : [p.indexBuildLatencyMs]),
    retrievalLatency: records.map(r => r.timing!.retrievalLatencyMs),
    answerGenerationLatency: records.map(r => r.timing!.answerGenerationLatencyMs),
    queryEndToEndLatency: records.map(r => r.timing!.queryEndToEndLatencyMs),
    llmNetworkLatency: args.client.latencies(),
  }
  const raw = aggregate(records)
  const counts = metricSampleCounts(records)
  for (const metric of ['evidenceRecall', 'evidenceHit', 'contextPrecision', 'mrr']) if (counts[metric] !== undefined) raw[`${metric}SampleCount`] = counts[metric]
  const metrics = withPercentiles(withLatencyStats(renameQaRates(raw), args.client.latencies()), values)
  return {
    task: 'qa',
    config: args.meta.config,
    meta: {
      model: args.model,
      ...(args.judgeModel ? { judgeModel: args.judgeModel } : {}),
      timestamp: finishedAt,
      gitSha: args.gitSha,
      startedAt,
      finishedAt,
      runWallClockMs: Math.max(0, now() - started),
      cacheHits: hits,
      cacheMisses: misses,
      cacheHitRate: hits + misses ? hits / (hits + misses) : 0,
      completed: records.length,
      total,
      retrievalAlgorithm: args.meta.retrievalAlgorithm,
      baselineFamily: args.meta.baselineFamily,
      candidateGranularity: args.retrieval.granularity,
      refusalPatternVersion: REFUSAL_PATTERN_VERSION,
      rubricVersion: RUBRIC_VERSION,
      ...(sawUnanswerable ? { unanswerableMethod: (args.judgeClient && !usedPatternFallback ? 'judge' : 'pattern') as 'judge' | 'pattern' } : {}),
      ...(qasperEvidenceQuestions ? { evidenceMappingCoverage: mappedEvidenceQuestions / qasperEvidenceQuestions, ambiguousEvidenceRate: ambiguousEvidenceQuestions / qasperEvidenceQuestions, unmappedEvidenceRate: unmappedEvidenceQuestions / qasperEvidenceQuestions } : {}),
    },
    metrics,
    perSample: records,
    perPaper,
    errors,
  }
}
