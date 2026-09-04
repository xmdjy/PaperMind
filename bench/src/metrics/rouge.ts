import { normalizeAnswer } from './answerF1'

function tokens(text: string): string[] {
  const normalized = normalizeAnswer(text)
  return normalized ? normalized.split(' ') : []
}

function ngrams(list: string[], n: number): string[] {
  if (list.length < n) return []
  const out: string[] = []
  for (let i = 0; i + n <= list.length; i++) out.push(list.slice(i, i + n).join(' '))
  return out
}

function f1(common: number, predLen: number, refLen: number): number {
  if (common === 0 || predLen === 0 || refLen === 0) return 0
  const precision = common / predLen
  const recall = common / refLen
  return (2 * precision * recall) / (precision + recall)
}

/** ROUGE-N F-measure：n-gram 重叠，重复按出现次数取 min。 */
export function rougeN(prediction: string, reference: string, n: number): number {
  const pred = ngrams(tokens(prediction), n)
  const ref = ngrams(tokens(reference), n)
  if (pred.length === 0 || ref.length === 0) return 0

  const refCount = new Map<string, number>()
  for (const g of ref) refCount.set(g, (refCount.get(g) ?? 0) + 1)

  let common = 0
  for (const g of pred) {
    const left = refCount.get(g) ?? 0
    if (left > 0) {
      common++
      refCount.set(g, left - 1)
    }
  }
  return f1(common, pred.length, ref.length)
}

/** ROUGE-L F-measure：基于最长公共子序列。 */
export function rougeL(prediction: string, reference: string): number {
  const pred = tokens(prediction)
  const ref = tokens(reference)
  if (pred.length === 0 || ref.length === 0) return 0

  // 滚动数组的 LCS，空间 O(min(m,n))
  let prev = new Array<number>(ref.length + 1).fill(0)
  let curr = new Array<number>(ref.length + 1).fill(0)
  for (let i = 1; i <= pred.length; i++) {
    for (let j = 1; j <= ref.length; j++) {
      curr[j] = pred[i - 1] === ref[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return f1(prev[ref.length], pred.length, ref.length)
}

export interface SummaryMetrics {
  rouge1: number
  rouge2: number
  rougeL: number
  compressionRatio: number
  /** 单样本 0/1；聚合后成为 emptyRate */
  empty: number
}

/**
 * 摘要为空时显式标记 empty 并把 ROUGE 记 0。
 * HF 社区端点不稳，不区分「模型差」与「端点挂」会导致误判。
 */
export function computeSummaryMetrics(
  summary: string,
  reference: string,
  sourceLength: number,
): SummaryMetrics {
  const isEmpty = summary.trim().length === 0
  return {
    rouge1: isEmpty ? 0 : rougeN(summary, reference, 1),
    rouge2: isEmpty ? 0 : rougeN(summary, reference, 2),
    rougeL: isEmpty ? 0 : rougeL(summary, reference),
    compressionRatio: sourceLength > 0 ? summary.length / sourceLength : 0,
    empty: isEmpty ? 1 : 0,
  }
}
