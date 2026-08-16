import type { LLMFn } from './llm'

/** 对话中的一轮消息。结构上兼容 chat.ts 的 Message，避免反向依赖 store。 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * 将带指代的追问改写为可独立检索的查询。
 * LLM 失败或返回空时静默回退原始问题，检索链路不因此中断。
 */
export async function rewriteQuery(
  query: string,
  history: ChatTurn[],
  llm: LLMFn,
): Promise<string> {
  const historyText = history.map(m => `${m.role}: ${m.content}`).join('\n')
  const prompt = `Based on the following conversation, rewrite the user's latest question as a self-contained retrieval query. Resolve pronouns, expand abbreviations, preserve technical terms. Return ONLY the rewritten query, no explanation.

Conversation:
${historyText}

Latest question: ${query}`
  try {
    const result = await llm(prompt)
    return result.trim() || query
  } catch {
    return query
  }
}
