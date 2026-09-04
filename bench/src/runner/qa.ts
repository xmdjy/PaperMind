/**
 * QA 任务 Runner——整个评测的中枢编排：
 * 加载数据（由调用方完成）→ 建索引 → 跑生产 RAG 管线 → 计算检索/答案指标 → 聚合。
 * 复用 src/utils/ 的生产实现（buildPageIndex / runRagPipeline），
 * 评测与应用跑同一份代码，这是 benchmark 有效性的前提。
 */
import { buildPageIndex, type IndexNode, type IndexOptions } from '../../../src/utils/pageIndex'
import { runRagPipeline, type RagOptions } from '../../../src/utils/ragPipeline'
import type { BenchConfig, BenchResult, EvalSample, PerSampleRecord, SampleError } from '../types'
import type { LlmClient } from '../llmClient'
import { computeRetrievalMetrics, estimateTokens, expandPages } from '../metrics/retrieval'
import { answerF1, isRefusal, REFUSAL_PATTERN_VERSION } from '../metrics/answerF1'
import { judgeAnswer, judgeUnanswerable } from '../metrics/judge'
import { aggregate, metricSampleCounts, withLatencyStats } from '../metrics/aggregate'

/** 与 src/stores/chat.ts 的 DEFAULT_PROFILE.systemPrompt 保持一致的字面值。 */
export const DEFAULT_SYSTEM_PROMPT =
  '你是一个专业的学术论文阅读助手，帮助用户理解和分析论文内容。'

export interface QaTaskDeps {
  buildIndex?: typeof buildPageIndex
  runPipeline?: typeof runRagPipeline
}

export interface QaTaskArgs {
  samples: EvalSample[]
  config: BenchConfig
  client: LlmClient
  systemPrompt: string
  /**
   * 样本级语言覆盖指令：非空时以 `\n\n` 追加在 systemPrompt 之后。
   * QASPER 参考答案是英文而生产 prompt 是中文的，若不强制英文作答，
   * 中英 token 完全不相交，answerable 样本的 answerF1 恒≈0，量化评测失效。
   */
  answerLanguageInstruction?: string
  limit?: number
  gitSha: string
  model: string
  /** 提供时启用 LLM-as-judge；通常与 client 用不同模型 */
  judgeClient?: LlmClient
  judgeModel?: string
  /** 注入替换生产实现，单测无需真实 LLM */
  deps?: QaTaskDeps
}

/** 只透传 config 中显式给出的分块字段，未设置的字段让生产代码用默认值。 */
function indexOptions(config: BenchConfig): IndexOptions {
  const out: IndexOptions = {}
  if (config.chunkPages !== undefined) out.chunkPages = config.chunkPages
  if (config.minSectionPages !== undefined) out.minSectionPages = config.minSectionPages
  if (config.forceFixedChunk !== undefined) out.forceFixedChunk = config.forceFixedChunk
  if (config.maxSectionPages !== undefined) out.maxSectionPages = config.maxSectionPages
  return out
}

/** 只透传 config 中显式给出的检索字段（externalContext 已被 BenchConfig Omit，永不传入）。 */
function ragOptions(config: BenchConfig): RagOptions {
  const out: RagOptions = {}
  if (config.topK !== undefined) out.topK = config.topK
  if (config.minScore !== undefined) out.minScore = config.minScore
  if (config.enableRewrite !== undefined) out.enableRewrite = config.enableRewrite
  if (config.maxContextChars !== undefined) out.maxContextChars = config.maxContextChars
  return out
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runQaTask(args: QaTaskArgs): Promise<BenchResult> {
  const { samples, config, client, limit, gitSha, model } = args
  const buildIndex = args.deps?.buildIndex ?? buildPageIndex
  const runPipeline = args.deps?.runPipeline ?? runRagPipeline
  // 语言覆盖指令追加在调用方 systemPrompt 之后；未传时 prompt 原样透传
  const systemPrompt = args.answerLanguageInstruction
    ? `${args.systemPrompt}\n\n${args.answerLanguageInstruction}`
    : args.systemPrompt

  const perSample: PerSampleRecord[] = []
  const errors: SampleError[] = []
  let total = 0
  let sawUnanswerable = false
  // judge 不可用或部分失败而回落 pattern 时置位；meta.unanswerableMethod 据此如实标注口径
  let usedPatternFallback = false
  let qasperEvidenceQuestions = 0
  let mappedEvidenceQuestions = 0
  let ambiguousEvidenceQuestions = 0
  let unmappedEvidenceQuestions = 0

  for (const sample of samples) {
    if (limit !== undefined && total >= limit) break

    // 每篇论文只建一次索引，同篇的多个问题复用
    let tree: IndexNode
    try {
      tree = await buildIndex(sample.pages, client.complete, indexOptions(config))
    } catch (e) {
      // 建索引失败：该论文全部问题按 index 阶段记错，不静默跳过
      for (const q of sample.questions) {
        if (limit !== undefined && total >= limit) break
        total++
        errors.push({ sampleId: q.id, stage: 'index', message: errorMessage(e) })
      }
      continue
    }

    // 复刻生产口径：单节点文档（buildPageIndex 直接返回叶子）时叶节点是树本身，
    // 传空数组会让 mrr 静默变 0
    const leaves = tree.nodes.length > 0 ? tree.nodes : [tree]

    for (const question of sample.questions) {
      if (limit !== undefined && total >= limit) break
      total++
      if (sample.source === 'qasper' && !question.unanswerable) {
        qasperEvidenceQuestions++
        if (question.evidenceMapping === 'mapped') mappedEvidenceQuestions++
        else if (question.evidenceMapping === 'ambiguous') ambiguousEvidenceQuestions++
        else unmappedEvidenceQuestions++
      }

      // 生产 scoreAndSelect 对野值打分可能在 try 块外抛 TypeError，
      // 这里必须 catch 一切异常——单个坏样本不能终止整轮评测
      try {
        const result = await runPipeline(
          [{ tree, pages: sample.pages }],
          question.question,
          [],                       // 单轮评测，无历史；rewriteRate 因此在本评测中恒为 0
          client.complete,
          client.chat,
          systemPrompt,
          ragOptions(config),
        )

        const retrieval = result.retrievals[0]
        const metrics: Record<string, number> = {
          llmCalls: result.llmCalls,
          rewrite: result.rewritten ? 1 : 0,
          leafCount: leaves.length,
          contextTruncated: result.contextTruncated ? 1 : 0,
        }

        if (retrieval) {
          const retrievalEligible = question.evidencePages.length > 0 && question.evidenceMapping !== 'ambiguous' && question.evidenceMapping !== 'unmapped'
          if (retrievalEligible) {
            Object.assign(metrics, computeRetrievalMetrics({
              selected: retrieval.selected,
              leaves,
              scores: retrieval.scores,
              evidencePages: question.evidencePages,
              context: result.context,
              degraded: retrieval.degraded,
            }))
          } else {
            metrics.contextTokens = estimateTokens(result.context)
          }
          metrics.selectedContextTokens = estimateTokens(retrieval.context)
          metrics.degraded = retrieval.degraded ? 1 : 0
          metrics.partialScoreCoverage = retrieval.degradedReason === 'incomplete-score-coverage' ? 1 : 0
          // 单叶索引短路时 scoreAndSelect 不发 LLM 打分（llmCalled=false），
          // 排序无从谈起——此时不写 mrr，否则「无排序可言」被误算成「排得差」，
          // 系统性拉低均值；缺指标交给聚合层自动剔除分母。
          // evidenceRecall / evidenceHit / contextPrecision 与有无打分无关，照常写入。
          if (!retrieval.llmCalled || retrieval.degraded) delete metrics.mrr
        }

        // judge 只看 evidence 原文，不看检索到的上下文——避免检索失败连带压低 judge 分；
        // trim 保证 evidencePages 全部越界时（join 结果为纯空白）也走「为空则跳过 judge 打分」的裁定
        const evidenceText = question.evidencePages
          .map(p => sample.pages[p] ?? '')
          .join('\n\n')
          .trim()

        if (question.unanswerable) {
          sawUnanswerable = true
          if (args.judgeClient) {
            const verdict = await judgeUnanswerable({
              question: question.question,
              answer: result.answer,
              client: args.judgeClient,
            })
            // judge 不可用时回落到正则口径，并如实记录用了哪种
            if (verdict === null) {
              metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
              usedPatternFallback = true
            } else {
              metrics.unanswerableAccuracy = verdict ? 1 : 0
            }
          } else {
            metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
            usedPatternFallback = true
          }
        } else {
          metrics.answerF1 = answerF1(result.answer, question.answers)

          if (args.judgeClient && evidenceText) {
            const scores = await judgeAnswer({
              question: question.question,
              evidence: evidenceText,
              answer: result.answer,
              client: args.judgeClient,
            })
            if (scores) {
              metrics.judgeFactuality = scores.factuality
              metrics.judgeCompleteness = scores.completeness
              metrics.judgeGroundedness = scores.groundedness
            }
            // scores 为 null 时不写指标 → aggregate 自动从分母剔除
          }
        }

        perSample.push({
          id: question.id,
          paperId: sample.paperId,
          source: sample.source,
          metrics,
          retrievalQuery: result.retrievalQuery,
          selectedPages: retrieval ? expandPages(retrieval.selected) : [],
          evidencePages: question.evidencePages,
          answer: result.answer,
        })
      } catch (e) {
        errors.push({ sampleId: question.id, stage: 'generate', message: errorMessage(e) })
      }
    }
  }

  const raw = aggregate(perSample)
  const counts = metricSampleCounts(perSample)
  for (const metric of ['evidenceRecall', 'evidenceHit', 'contextPrecision', 'mrr']) {
    if (counts[metric] !== undefined) raw[`${metric}SampleCount`] = counts[metric]
  }
  // 重命名 0/1 指标的聚合结果为「率」，让报表列名自解释
  const metrics = withLatencyStats(renameRates(raw), client.latencies())

  return {
    task: 'qa',
    config,
    meta: {
      model,
      ...(args.judgeModel ? { judgeModel: args.judgeModel } : {}),
      timestamp: new Date().toISOString(),
      gitSha,
      completed: perSample.length,
      total,
      ...(sawUnanswerable
        ? { unanswerableMethod: (args.judgeClient && !usedPatternFallback ? 'judge' : 'pattern') as 'judge' | 'pattern' }
        : {}),
      ...(qasperEvidenceQuestions > 0
        ? {
            evidenceMappingCoverage: mappedEvidenceQuestions / qasperEvidenceQuestions,
            ambiguousEvidenceRate: ambiguousEvidenceQuestions / qasperEvidenceQuestions,
            unmappedEvidenceRate: unmappedEvidenceQuestions / qasperEvidenceQuestions,
          }
        : {}),
    },
    metrics,
    perSample,
    errors,
  }
}

/** evidenceHit → evidenceHitRate 等；均值本身就是比率，只是改个名。 */
function renameRates(metrics: Record<string, number>): Record<string, number> {
  const renames: Record<string, string> = {
    evidenceHit: 'evidenceHitRate',
    degraded: 'degradedRate',
    rewrite: 'rewriteRate',
    contextTruncated: 'contextTruncatedRate',
    partialScoreCoverage: 'partialScoreCoverageRate',
    llmCalls: 'llmCallsPerQuery',
  }
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    out[renames[key] ?? key] = value
  }
  return out
}

export { REFUSAL_PATTERN_VERSION }
