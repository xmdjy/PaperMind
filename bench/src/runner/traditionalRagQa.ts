import type { BenchResult, EvalSample, PaperTimingRecord, PerSampleRecord, SampleError, TraditionalRagConfig } from '../types'
import type { LlmClient } from '../llmClient'
import { answerF1, isRefusal, REFUSAL_PATTERN_VERSION } from '../metrics/answerF1'
import { computeRetrievalMetrics, estimateTokens, expandPages } from '../metrics/retrieval'
import { aggregate, metricSampleCounts, renameQaRates, withLatencyStats, withPercentiles } from '../metrics/aggregate'
import { chunkPages } from '../traditionalRag/chunker'
import { buildBm25Retriever } from '../traditionalRag/bm25'
import { buildJaccardRetriever } from '../traditionalRag/jaccard'
import { buildCosineRetriever } from '../traditionalRag/cosine'
import { createBgeM3Provider, createBgeM3Tokenizer } from '../traditionalRag/embedding'
import { selectContext } from '../traditionalRag/context'
import type { BuiltRetriever, TextTokenizer } from '../traditionalRag/types'
import { benchPath } from '../paths'
import { MATH_FORMAT_INSTRUCTION } from '../../../src/utils/ragPipeline'
import { judgeAnswer, judgeUnanswerable, RUBRIC_VERSION } from '../metrics/judge'

export interface TraditionalRagQaArgs {
  samples: EvalSample[]; config: TraditionalRagConfig; client: LlmClient; systemPrompt: string; answerLanguageInstruction?: string; limit?: number; gitSha: string; model: string; judgeClient?: LlmClient; judgeModel?: string; now?: () => number
  deps?: { tokenizer?: TextTokenizer; buildRetriever?: (chunks: ReturnType<typeof chunkPages>, config: TraditionalRagConfig) => Promise<BuiltRetriever>; generateAnswer?: (system: string, question: string) => Promise<string> }
}
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const modelCacheDir = () => benchPath(import.meta.url, '../../cache/models/')

export async function runTraditionalRagQaTask(args: TraditionalRagQaArgs): Promise<BenchResult> {
  const now = args.now ?? Date.now; const started = now(); const startedAt = new Date().toISOString(); const records: PerSampleRecord[] = []; const perPaper: PaperTimingRecord[] = []; const errors: SampleError[] = []; let total = 0
  let sawUnanswerable = false
  let qasperEvidenceQuestions = 0; let mappedEvidenceQuestions = 0; let ambiguousEvidenceQuestions = 0; let unmappedEvidenceQuestions = 0
  let usedPatternFallback = false
  let tokenizer = args.deps?.tokenizer
  let defaultBuild: ((chunks: ReturnType<typeof chunkPages>) => Promise<BuiltRetriever>) | undefined
  if (args.config.retrieval.algorithm === 'cosine' && !args.deps?.buildRetriever) {
    const embedding = args.config.retrieval.embedding
    const runtime = await createBgeM3Provider({ ...embedding, cacheDir: modelCacheDir() })
    tokenizer ??= runtime.tokenizer
    defaultBuild = chunks => buildCosineRetriever(chunks, runtime.provider, embedding)
  }
  if (!tokenizer) {
    // 所有算法共用 BGE-M3 tokenizer；只有 cosine 额外加载 embedding pipeline。
    tokenizer = await createBgeM3Tokenizer({ model: 'BAAI/bge-m3', revision: 'main', cacheDir: modelCacheDir() })
  }
  const build = args.deps?.buildRetriever ?? (async chunks => {
    if (args.config.retrieval.algorithm === 'bm25') return buildBm25Retriever(chunks, args.config.retrieval)
    if (args.config.retrieval.algorithm === 'jaccard') return buildJaccardRetriever(chunks)
    if (!defaultBuild) throw new Error('cosine embedding provider 未初始化')
    return defaultBuild(chunks)
  })
  const baseSystemPrompt = args.answerLanguageInstruction ? `${args.systemPrompt}\n\n${args.answerLanguageInstruction}` : args.systemPrompt
  for (const sample of args.samples) {
    if (args.limit !== undefined && total >= args.limit) break
    const questionCount = Math.min(sample.questions.length, args.limit === undefined ? Infinity : args.limit - total)
    let retriever: BuiltRetriever
    const indexStart = now()
    try { retriever = await build(chunkPages(sample.pages, tokenizer, args.config.chunking), args.config) } catch (e) {
      perPaper.push({ paperId: sample.paperId, source: sample.source, pageCount: sample.pages.length, questionCount, indexBuildLatencyMs: Math.max(0, now() - indexStart), error: message(e) })
      for (const q of sample.questions.slice(0, questionCount)) errors.push({ sampleId: q.id, stage: 'index', message: message(e) }); total += questionCount; continue
    }
    perPaper.push({ paperId: sample.paperId, source: sample.source, pageCount: sample.pages.length, questionCount, indexBuildLatencyMs: Math.max(0, now() - indexStart), indexLlmCalls: 0, indexCacheHits: 0, indexCacheMisses: 0, leafCount: retriever.chunks.length })
    for (const question of sample.questions) {
      if (args.limit !== undefined && total >= args.limit) break
      total++; const queryStarted = now()
      if (sample.source === 'qasper' && !question.unanswerable) { qasperEvidenceQuestions++; if (question.evidenceMapping === 'mapped') mappedEvidenceQuestions++; else if (question.evidenceMapping === 'ambiguous') ambiguousEvidenceQuestions++; else unmappedEvidenceQuestions++ }
      let stage: SampleError['stage'] = 'retrieve'
      try {
        const retrieveStarted = now(); const scores = await retriever.score(question.question); const ctx = selectContext(retriever.chunks, scores, { retrievalTopK: args.config.retrieval.topK, topK: args.config.generationContext.topK, maxTokens: args.config.generationContext.maxTokens }); const retrievalLatencyMs = Math.max(0, now() - retrieveStarted)
        const systemPrompt = `${baseSystemPrompt}\n\n${MATH_FORMAT_INSTRUCTION}` + (ctx.context ? `\n\n参考内容：\n${ctx.context}` : '')
        stage = 'generate'
        const generateStarted = now(); const answer = args.deps?.generateAnswer ? await args.deps.generateAnswer(systemPrompt, question.question) : await args.client.chat([{ role: 'system', content: systemPrompt }, { role: 'user', content: question.question }]); const answerGenerationLatencyMs = Math.max(0, now() - generateStarted)
        const timing = { queryRewriteLatencyMs: 0, retrievalLatencyMs, answerGenerationLatencyMs, queryEndToEndLatencyMs: Math.max(0, now() - queryStarted) }
        const metrics: Record<string, number> = { llmCalls: 1, rewrite: 0, leafCount: retriever.chunks.length, ...timing }
        const retrievalEligible = question.evidencePages.length > 0 && question.evidenceMapping !== 'ambiguous' && question.evidenceMapping !== 'unmapped'
        if (retrievalEligible) Object.assign(metrics, computeRetrievalMetrics({ selected: ctx.selected, leaves: retriever.chunks, scores: ctx.ranked, evidencePages: question.evidencePages, context: ctx.context, degraded: false }))
        else metrics.contextTokens = estimateTokens(ctx.context)
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
        records.push({ id: question.id, paperId: sample.paperId, source: sample.source, metrics, timing, retrievalQuery: question.question, selectedPages: expandPages(ctx.selected), evidencePages: question.evidencePages, answer })
      } catch (e) { errors.push({ sampleId: question.id, stage, message: message(e) }) }
    }
  }
  const { hits, misses } = args.client.stats(); const values = { indexBuildLatency: perPaper.flatMap(p => p.indexBuildLatencyMs === undefined ? [] : [p.indexBuildLatencyMs]), retrievalLatency: records.map(r => r.timing!.retrievalLatencyMs), answerGenerationLatency: records.map(r => r.timing!.answerGenerationLatencyMs), queryEndToEndLatency: records.map(r => r.timing!.queryEndToEndLatencyMs), llmNetworkLatency: args.client.latencies() }
  const raw = aggregate(records)
  const counts = metricSampleCounts(records)
  for (const metric of ['evidenceRecall', 'evidenceHit', 'contextPrecision', 'mrr']) if (counts[metric] !== undefined) raw[`${metric}SampleCount`] = counts[metric]
  const metrics = withPercentiles(withLatencyStats(renameQaRates(raw), args.client.latencies()), values)
  return { task: 'qa', config: args.config, meta: { model: args.model, ...(args.judgeModel ? { judgeModel: args.judgeModel } : {}), timestamp: new Date().toISOString(), gitSha: args.gitSha, completed: records.length, total, startedAt, finishedAt: new Date().toISOString(), runWallClockMs: Math.max(0, now() - started), cacheHits: hits, cacheMisses: misses, cacheHitRate: hits + misses ? hits / (hits + misses) : 0, retrievalAlgorithm: args.config.retrieval.algorithm, refusalPatternVersion: REFUSAL_PATTERN_VERSION, rubricVersion: RUBRIC_VERSION, ...(sawUnanswerable ? { unanswerableMethod: (args.judgeClient && !usedPatternFallback ? 'judge' : 'pattern') as 'judge' | 'pattern' } : {}), ...(qasperEvidenceQuestions ? { evidenceMappingCoverage: mappedEvidenceQuestions / qasperEvidenceQuestions, ambiguousEvidenceRate: ambiguousEvidenceQuestions / qasperEvidenceQuestions, unmappedEvidenceRate: unmappedEvidenceQuestions / qasperEvidenceQuestions } : {}) }, metrics, perSample: records, perPaper, errors }
}
