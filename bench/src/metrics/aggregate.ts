import type { PerSampleRecord } from '../types'

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** 最近秩法分位数：排序后取 ceil(p/100 * n) - 1 位。 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/**
 * 逐样本指标 → 聚合均值。
 * 只在「拥有该指标」的样本上求均值：失败样本不写指标，
 * 从而自动从分母中剔除，不会把网络超时误算成质量下降。
 */
export function aggregate(records: PerSampleRecord[]): Record<string, number> {
  const buckets = new Map<string, number[]>()
  for (const r of records) {
    for (const [key, value] of Object.entries(r.metrics)) {
      if (!Number.isFinite(value)) continue
      const list = buckets.get(key) ?? []
      list.push(value)
      buckets.set(key, list)
    }
  }
  const out: Record<string, number> = {}
  for (const [key, values] of buckets) out[key] = mean(values)
  return out
}

export function withLatencyStats(
  metrics: Record<string, number>,
  latencies: number[],
): Record<string, number> {
  return {
    ...metrics,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  }
}
