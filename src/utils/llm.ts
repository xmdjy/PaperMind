/** 注入式 LLM 调用：接收 prompt，返回纯文本响应。 */
export type LLMFn = (prompt: string) => Promise<string>
