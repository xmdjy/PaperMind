import type { LlmClient } from '../llmClient'

/**
 * Rubric 版本号。嵌在 prompt 中，因此改动 rubric 会自动使缓存失效
 * （缓存 key 按 prompt 哈希）。改 rubric 必须 bump 此值。
 */
export const RUBRIC_VERSION = 'rubric-v1'

export interface JudgeScores {
  factuality: number
  completeness: number
  groundedness: number
}

export interface JudgeArgs {
  question: string
  /** evidence 原文。刻意不传参考答案——与 answerF1 同源会失去互补性 */
  evidence: string
  answer: string
  client: LlmClient
}

export function buildJudgePrompt(args: { question: string; evidence: string; answer: string }): string {
  return `[${RUBRIC_VERSION}] 你是学术问答质量评审。仅依据给出的论文原文片段评估回答，不要使用你自己的知识。

问题：
${args.question}

论文原文片段：
${args.evidence}

待评估回答：
${args.answer}

按三个维度各打 1-5 分（5 最好）：
- factuality：回答中的陈述是否与原文片段一致（有事实错误则低分）
- completeness：是否完整回答了问题（遗漏关键信息则低分）
- groundedness：是否只用了原文片段中的信息（引入片段外内容则低分）

只回 JSON，不要解释：{"factuality":N,"completeness":N,"groundedness":N}`
}

const DIMENSIONS = ['factuality', 'completeness', 'groundedness'] as const

export function parseJudgeResponse(raw: string): JudgeScores | null {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const dim of DIMENSIONS) {
      const v = parsed[dim]
      // 越界或非数值一律作废——缺数据好过错数据
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 5) return null
      out[dim] = v
    }
    return out as unknown as JudgeScores
  } catch {
    return null
  }
}

export async function judgeAnswer(args: JudgeArgs): Promise<JudgeScores | null> {
  try {
    const raw = await args.client.complete(buildJudgePrompt(args))
    return parseJudgeResponse(raw)
  } catch {
    return null
  }
}

/** 用 judge 做「是否拒答」二分类，比正则表更宽容于表述变体。 */
export async function judgeUnanswerable(args: {
  question: string
  answer: string
  client: LlmClient
}): Promise<boolean | null> {
  const prompt = `[${RUBRIC_VERSION}] 判断下面的回答是否表达了「无法根据给定内容回答」。

问题：${args.question}

回答：${args.answer}

只回一个词：REFUSAL（表达了无法回答）或 ANSWERED（给出了实质回答）。`

  try {
    const raw = (await args.client.complete(prompt)).trim().toUpperCase()
    if (raw.includes('REFUSAL')) return true
    if (raw.includes('ANSWERED')) return false
    return null
  } catch {
    return null
  }
}
