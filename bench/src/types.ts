import type { IndexOptions } from '../../src/utils/pageIndex'
import type { RagOptions } from '../../src/utils/ragPipeline'

/** 数据来源，用于报表中分开统计语义分块指标 */
export type SampleSource = 'qasper' | 'smoke'

/** 失败阶段，用于区分「网络问题」与「代码问题」 */
export type SampleStage = 'load' | 'index' | 'retrieve' | 'generate' | 'summarize' | 'judge'

/** 单个问答样本。evidencePages 为 0-based inclusive 页号。 */
export interface QaQuestion {
  id: string
  question: string
  /** 参考答案，可有多个（QASPER 多标注者）；unanswerable 样本为空数组 */
  answers: string[]
  evidencePages: number[]
  unanswerable: boolean
  /** QASPER free-text evidence may not map uniquely to a source paragraph. */
  evidenceMapping?: 'mapped' | 'ambiguous' | 'unmapped'
}

/** 一篇论文及其挂载的问答/摘要标注。 */
export interface EvalSample {
  paperId: string
  title: string
  /** 逐页文本，0-based。QASPER 为伪页，冒烟集为真实 PDF 页 */
  pages: string[]
  questions: QaQuestion[]
  /** 参考摘要；QASPER 样本可能没有，为 undefined 时跳过摘要任务 */
  referenceAbstract?: string
  /** 数据来源，用于报表中分开统计语义分块指标 */
  source: SampleSource
}

/**
 * 一组具体参数取值（矩阵展开后的单点）。
 * 刻意 Omit externalContext：它会让 runRagPipeline 跳过改写与检索，
 * 一个语法合法的配置就能静默关掉正在被评测的整条链路，而指标照常输出数字。
 */
export interface BenchConfig extends IndexOptions, Omit<RagOptions, 'externalContext'> {
  name: string
}

/** 配置文件形态：matrix 各字段取值数组，展开为笛卡尔积。 */
export interface ConfigFile {
  name: string
  /** 键收敛到 BenchConfig 的可调字段，防止拼错的键静默失效 */
  matrix: Partial<Record<Exclude<keyof BenchConfig, 'name'>, Array<number | boolean>>>
}

export interface SampleError {
  sampleId: string
  /** 失败阶段，用于区分「网络问题」与「代码问题」 */
  stage: SampleStage
  message: string
}

/** 单次 RAG 问答的热路径时延分阶段口径（毫秒），语义与 src/utils/ragPipeline.PipelineTiming 一致。 */
export interface PipelineTiming {
  queryRewriteLatencyMs: number
  retrievalLatencyMs: number
  answerGenerationLatencyMs: number
  queryEndToEndLatencyMs: number
}

/** 一篇论文的索引成本记录。索引失败时 error 与已消耗的索引时长/缓存差值仍记录，leafCount 不写。 */
export interface PaperTimingRecord {
  paperId: string
  source: SampleSource
  pageCount: number
  /** 本篇在 limit 约束下实际将执行的问题数，而非原始总数 */
  questionCount: number
  indexBuildLatencyMs?: number
  indexLlmCalls?: number
  indexCacheHits?: number
  indexCacheMisses?: number
  leafCount?: number
  error?: string
}

/** 逐样本记录，用于错误分析——聚合分数只说好不好，这里说为什么。 */
export interface PerSampleRecord {
  id: string
  paperId: string
  source: SampleSource
  metrics: Record<string, number>
  /** 本问热路径时延（仅 QA，失败样本不写） */
  timing?: PipelineTiming
  /** QA 专有 */
  retrievalQuery?: string
  selectedPages?: number[]
  evidencePages?: number[]
  answer?: string
  /** 摘要专有 */
  summary?: string
}

export interface BenchResult {
  task: 'qa' | 'summary'
  config: BenchConfig
  meta: {
    model: string
    judgeModel?: string
    timestamp: string
    gitSha: string
    completed: number
    total: number
    /** 整轮起止与 wall-clock（毫秒，QA 专有） */
    startedAt?: string
    finishedAt?: string
    runWallClockMs?: number
    /** 缓存计数（QA 专有） */
    cacheHits?: number
    cacheMisses?: number
    /** 无请求时为 0，不能 NaN */
    cacheHitRate?: number
    /** unanswerableAccuracy 的判定口径，避免两种口径的数字被混着对比 */
    unanswerableMethod?: 'pattern' | 'judge'
    /** 缓存模式：normal 读写缓存；bypass（--no-cache）只跳过读，不覆写已有缓存文件 */
    cacheMode?: 'normal' | 'bypass'
    /** 缓存计数的统计范围：仅主 RAG client；启用 --judge 时明确标注，不含 judgeClient 流量 */
    cacheScope?: 'rag'
    evidenceMappingCoverage?: number
    ambiguousEvidenceRate?: number
    unmappedEvidenceRate?: number
  }
  metrics: Record<string, number>
  perSample: PerSampleRecord[]
  perPaper?: PaperTimingRecord[]
  errors: SampleError[]
}
