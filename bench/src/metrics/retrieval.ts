import type { IndexNode, NodeScore } from '../../../src/utils/pageIndex'

/** 估算 token 数：英文约 4 字符/token，够用作成本代理指标。 */
const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.round(text.length / CHARS_PER_TOKEN)
}

/** 把节点的页码区间展开为去重升序页号数组（0-based）。 */
export function expandPages(nodes: IndexNode[]): number[] {
  const set = new Set<number>()
  for (const n of nodes) {
    for (let p = n.startPage; p <= n.endPage; p++) set.add(p)
  }
  return [...set].sort((a, b) => a - b)
}

export interface RetrievalMetricArgs {
  /** scoreAndSelect 选中的节点 */
  selected: IndexNode[]
  /** 全部叶节点，用于把 scores 的 id 映射回页码区间 */
  leaves: IndexNode[]
  /** LLM 原始打分；降级时为空 */
  scores: NodeScore[]
  /** 标注的 evidence 页号（0-based） */
  evidencePages: number[]
  /** 合并后的上下文文本，用于估算 token */
  context: string
  degraded: boolean
}

export interface RetrievalMetrics {
  evidenceRecall?: number
  /** 单样本 0/1；聚合后成为 evidenceHitRate */
  evidenceHit?: number
  contextPrecision?: number
  mrr?: number
  contextTokens: number
}

export function computeRetrievalMetrics(args: RetrievalMetricArgs): RetrievalMetrics {
  const { selected, leaves, scores, evidencePages, context, degraded } = args

  const selectedPages = expandPages(selected)
  const evidenceSet = new Set(evidencePages)
  const covered = selectedPages.filter(p => evidenceSet.has(p))

  // 分母用去重后的页数：分子 covered 来自去重的 selectedPages，
  // evidencePages 里重复的页号（多个 evidence 段落落进同一伪页）不该把 recall 拉低到 1 以下
  if (evidenceSet.size === 0) return { contextTokens: estimateTokens(context) }

  const evidenceRecall = covered.length / evidenceSet.size
  const contextPrecision = selectedPages.length > 0 ? covered.length / selectedPages.length : 0

  return {
    evidenceRecall,
    evidenceHit: covered.length > 0 ? 1 : 0,
    contextPrecision,
    ...(degraded || scores.length === 0 ? {} : { mrr: computeMrr(leaves, scores, evidenceSet) }),
    contextTokens: estimateTokens(context),
  }
}

/**
 * evidence 页首次出现在打分排序中的名次倒数。
 * 调用方仅在有效 evidence 和评分时调用本函数。
 */
function computeMrr(
  leaves: IndexNode[],
  scores: NodeScore[],
  evidenceSet: Set<number>,
): number {
  if (scores.length === 0 || evidenceSet.size === 0) return 0

  const ranked = [...scores].sort((a, b) => b.score - a.score)
  for (let rank = 0; rank < ranked.length; rank++) {
    const leaf = leaves[ranked[rank].id]
    if (!leaf) continue
    for (let p = leaf.startPage; p <= leaf.endPage; p++) {
      if (evidenceSet.has(p)) return 1 / (rank + 1)
    }
  }
  return 0
}
