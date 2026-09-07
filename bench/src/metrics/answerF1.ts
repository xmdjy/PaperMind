/**
 * QASPER 官方口径的答案归一化：小写、去冠词、去标点、压缩空白。
 * 保留中日韩字符——PaperMind 的回答常为中文。
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')       // 去标点，保留各语言字母与数字
    .replace(/\b(a|an|the)\b/g, ' ')          // 只去独立冠词
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  const normalized = normalizeAnswer(text)
  return normalized ? normalized.split(' ') : []
}

/** 单参考的 token 级 F1，重复 token 按出现次数取 min 计入共同数。 */
export function tokenF1(prediction: string, reference: string): number {
  const pred = tokenize(prediction)
  const ref = tokenize(reference)
  if (pred.length === 0 || ref.length === 0) return 0

  const refCount = new Map<string, number>()
  for (const t of ref) refCount.set(t, (refCount.get(t) ?? 0) + 1)

  let common = 0
  for (const t of pred) {
    const left = refCount.get(t) ?? 0
    if (left > 0) {
      common++
      refCount.set(t, left - 1)
    }
  }
  if (common === 0) return 0

  const precision = common / pred.length
  const recall = common / ref.length
  return (2 * precision * recall) / (precision + recall)
}

/** 多参考答案取最高 F1（QASPER 有多标注者）。 */
export function answerF1(prediction: string, references: string[]): number {
  if (references.length === 0) return 0
  return Math.max(...references.map(ref => tokenF1(prediction, ref)))
}

/**
 * 拒答模式表。改动此表必须同步 bump 版本号——报表会打印版本，
 * 否则跨版本的 unanswerableAccuracy 数字无法对比。
 */
export const REFUSAL_PATTERN_VERSION = 'v1'

export const REFUSAL_PATTERNS: RegExp[] = [
  /无法回答/,
  /没有(提到|提及|说明|给出)/,
  /(未|没有).{0,6}(涉及|涵盖)/,
  /(参考内容|上下文|文中|论文中).{0,10}(没有|未|不包含)/,
  /信息不足/,
  /\b(does|do|did)\s+not\s+(mention|specify|state|discuss|provide)\b/i,
  /\b(cannot|can't|unable to)\s+(answer|determine|find)\b/i,
  /\bnot\s+(mentioned|specified|stated|provided)\b/i,
  /\bno\s+information\b/i,
  /\binsufficient\s+(context|information)\b/i,
]

export function isRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some(p => p.test(text))
}
