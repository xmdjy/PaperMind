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
import { computeRetrievalMetrics, expandPages } from '../metrics/retrieval'
import { answerF1, isRefusal, REFUSAL_PATTERN_VERSION } from '../metrics/answerF1'
import { aggregate, withLatencyStats } from '../metrics/aggregate'

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
  /** 注入替换生产实现，单测无需真实 LLM */
  deps?: QaTaskDeps
}

/** 只透传 config 中显式给出的分块字段，未设置的字段让生产代码用默认值。 */
function indexOptions(config: BenchConfig): IndexOptions {
  const out: IndexOptions = {}
  if (config.chunkPages !== undefined) out.chunkPages = config.chunkPages
  if (config.minSectionPages !== undefined) out.minSectionPages = config.minSectionPages
  if (config.forceFixedChunk !== undefined) out.forceFixedChunk = config.forceFixedChunk
  return out
}

/** 只透传 config 中显式给出的检索字段（externalContext 已被 BenchConfig Omit，永不传入）。 */
function ragOptions(config: BenchConfig): RagOptions {
  const out: RagOptions = {}
  if (config.topK !== undefined) out.topK = config.topK
  if (config.minScore !== undefined) out.minScore = config.minScore
  if (config.enableRewrite !== undefined) out.enableRewrite = config.enableRewrite
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
        }

        if (retrieval) {
          Object.assign(metrics, computeRetrievalMetrics({
            selected: retrieval.selected,
            leaves,
            scores: retrieval.scores,
            evidencePages: question.evidencePages,
            context: result.context,
            degraded: retrieval.degraded,
          }))
          metrics.degraded = retrieval.degraded ? 1 : 0
          // 单叶索引短路时 scoreAndSelect 不发 LLM 打分（llmCalled=false），
          // 排序无从谈起——此时不写 mrr，否则「无排序可言」被误算成「排得差」，
          // 系统性拉低均值；缺指标交给聚合层自动剔除分母。
          // evidenceRecall / evidenceHit / contextPrecision 与有无打分无关，照常写入。
          if (!retrieval.llmCalled) delete metrics.mrr
        }

        if (question.unanswerable) {
          sawUnanswerable = true
          // 本轮仅 pattern 口径判定拒答；LLM judge 属于后续任务
          metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
        } else {
          metrics.answerF1 = answerF1(result.answer, question.answers)
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
  // 重命名 0/1 指标的聚合结果为「率」，让报表列名自解释
  const metrics = withLatencyStats(renameRates(raw), client.latencies())

  return {
    task: 'qa',
    config,
    meta: {
      model,
      timestamp: new Date().toISOString(),
      gitSha,
      completed: perSample.length,
      total,
      ...(sawUnanswerable ? { unanswerableMethod: 'pattern' as const } : {}),
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
    llmCalls: 'llmCallsPerQuery',
  }
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    out[renames[key] ?? key] = value
  }
  return out
}

export { REFUSAL_PATTERN_VERSION }
