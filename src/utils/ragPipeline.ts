import { scoreAndSelect, type IndexNode, type RetrievalResult, type ScoreOptions } from './pageIndex'
import { rewriteQuery, type ChatTurn } from './queryRewrite'
import type { ChatLLMFn, LLMFn } from './llm'

/** 数学公式格式约束，追加在 system 提示词之后。 */
export const MATH_FORMAT_INSTRUCTION =
  '数学公式请使用 LaTeX：行内公式使用 $...$，独立公式使用 $$...$$。不要使用 \\(...\\) 或 \\[...\\] 包裹公式。'

/** 触发查询改写所需的最少历史轮数。 */
const REWRITE_MIN_HISTORY = 2
/** 改写时参考的最近历史轮数。 */
const REWRITE_HISTORY_WINDOW = 3
/** 生成回答时携带的最近历史轮数（不含当前提问）。 */
const GENERATE_HISTORY_WINDOW = 19

/** 已建好索引的单篇论文。 */
export interface IndexedPaper {
  tree: IndexNode
  pages: string[]
}

export interface RagOptions extends ScoreOptions {
  /** 是否启用查询改写，默认 true（仍需历史轮数达标才实际触发） */
  enableRewrite?: boolean
  /**
   * 外部直接提供的参考内容（如用户划选文本）。
   * 提供时跳过改写与检索，直接用它作为上下文生成回答。
   */
  externalContext?: string
  /** Hard cap for the combined retrieval context sent to the generation model. */
  maxContextChars?: number
}

export interface RagResult {
  answer: string
  /** 每篇论文一份检索结果，顺序与入参 papers 一致 */
  retrievals: RetrievalResult[]
  /** 实际用于检索的查询（未改写时等于原始 query） */
  retrievalQuery: string
  /** 是否发生了查询改写 */
  rewritten: boolean
  /** 合并后的参考内容；无可用索引时为空串 */
  context: string
  /** 各篇检索来源汇总 */
  sources: string[]
  /** 本次问答实际发出的 LLM 请求数 */
  llmCalls: number
  /** Whether retrieval context was clipped to maxContextChars. */
  contextTruncated: boolean
}

/**
 * 论文问答 RAG 主流程（纯函数）：查询改写 → 逐篇评分多选 → 生成回答。
 *
 * 不依赖 store / IPC / DOM，供渲染层与离线评测复用同一份实现。
 */
export async function runRagPipeline(
  papers: IndexedPaper[],
  query: string,
  history: ChatTurn[],
  llm: LLMFn,
  generate: ChatLLMFn,
  systemPrompt: string,
  opts: RagOptions = {},
): Promise<RagResult> {
  const { enableRewrite = true, externalContext, maxContextChars, ...scoreOpts } = opts
  if (maxContextChars !== undefined && (!Number.isInteger(maxContextChars) || maxContextChars <= 0)) {
    throw new Error('maxContextChars must be a positive integer')
  }
  let llmCalls = 0
  const skipRetrieval = externalContext !== undefined && externalContext !== ''

  // Call 1（条件）：查询改写
  const recentHistory = history.slice(-REWRITE_HISTORY_WINDOW)
  let retrievalQuery = query
  let rewritten = false
  if (!skipRetrieval && enableRewrite && recentHistory.length >= REWRITE_MIN_HISTORY) {
    llmCalls++
    retrievalQuery = await rewriteQuery(query, recentHistory, llm)
    rewritten = retrievalQuery !== query
  }

  // Call 2（每篇论文，单叶节点时短路不发请求）：评分多选
  const retrievals: RetrievalResult[] = []
  if (!skipRetrieval) {
    for (const paper of papers) {
      const result = await scoreAndSelect(paper.tree, paper.pages, retrievalQuery, llm, scoreOpts)
      if (result.llmCalled) llmCalls++
      retrievals.push(result)
    }
  }

  const unboundedContext = skipRetrieval
    ? (externalContext as string)
    : retrievals.map(r => r.context).join('\n\n---\n\n')
  const contextTruncated = maxContextChars !== undefined && unboundedContext.length > maxContextChars
  const context = contextTruncated ? unboundedContext.slice(0, maxContextChars) : unboundedContext
  const sources = retrievals.flatMap(r => r.sources)

  // Call 3：生成回答
  const messages = [
    {
      role: 'system',
      content:
        `${systemPrompt}\n\n${MATH_FORMAT_INSTRUCTION}` +
        (context ? `\n\n参考内容：\n${context}` : ''),
    },
    ...history.slice(-GENERATE_HISTORY_WINDOW),
    { role: 'user', content: query },
  ]
  llmCalls++
  const answer = await generate(messages)

  return { answer, retrievals, retrievalQuery, rewritten, context, sources, llmCalls, contextTruncated }
}
