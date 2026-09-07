/** 注入式 LLM 调用：接收 prompt，返回纯文本响应。 */
export type LLMFn = (prompt: string) => Promise<string>

/** 多轮消息形态（与 chat store 的 callLLM 入参一致）。 */
export interface ChatMessage {
  role: string
  content: string
}

/** 注入式多轮 LLM 调用：接收消息列表，返回纯文本响应。 */
export type ChatLLMFn = (messages: ChatMessage[]) => Promise<string>
