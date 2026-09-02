import type { IndexOptions } from '../../src/utils/pageIndex'
import type { RagOptions } from '../../src/utils/ragPipeline'

/** 单个问答样本。evidencePages 为 0-based inclusive 页号。 */
export interface QaQuestion {
  id: string
  question: string
  /** 参考答案，可有多个（QASPER 多标注者）；unanswerable 样本为空数组 */
  answers: string[]
  evidencePages: number[]
  unanswerable: boolean
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
  source: 'qasper' | 'smoke'
}

/** 一组具体参数取值（矩阵展开后的单点）。 */
export interface BenchConfig extends IndexOptions, RagOptions {
  name: string
}

/** 配置文件形态：matrix 各字段取值数组，展开为笛卡尔积。 */
export interface ConfigFile {
  name: string
  matrix: Record<string, Array<number | boolean>>
}

export interface SampleError {
  sampleId: string
  /** 失败阶段，用于区分「网络问题」与「代码问题」 */
  stage: 'load' | 'index' | 'retrieve' | 'generate' | 'summarize' | 'judge'
  message: string
}

/** 逐样本记录，用于错误分析——聚合分数只说好不好，这里说为什么。 */
export interface PerSampleRecord {
  id: string
  paperId: string
  source: 'qasper' | 'smoke'
  metrics: Record<string, number>
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
    /** unanswerableAccuracy 的判定口径，避免两种口径的数字被混着对比 */
    unanswerableMethod?: 'pattern' | 'judge'
  }
  metrics: Record<string, number>
  perSample: PerSampleRecord[]
  errors: SampleError[]
}
