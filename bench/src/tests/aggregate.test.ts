import { describe, it, expect } from 'vitest'
import type { PerSampleRecord } from '../types'
import { mean, percentile, aggregate, withLatencyStats, withPercentiles } from '../metrics/aggregate'

function rec(id: string, metrics: Record<string, number>): PerSampleRecord {
  return { id, paperId: 'p', source: 'qasper', metrics }
}

describe('mean', () => {
  it('求算术平均', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })
  it('空数组返回 0，不产生 NaN', () => {
    expect(mean([])).toBe(0)
  })
})

describe('percentile', () => {
  it('p50 取中位数', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30)
  })
  it('p95 取靠尾部的值', () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
  })
  it('空数组返回 0', () => {
    expect(percentile([], 50)).toBe(0)
  })
  it('乱序输入先排序', () => {
    expect(percentile([50, 10, 30], 50)).toBe(30)
  })
})

describe('aggregate', () => {
  it('对每个指标名分别求均值', () => {
    const out = aggregate([
      rec('a', { evidenceRecall: 1, answerF1: 0.5 }),
      rec('b', { evidenceRecall: 0, answerF1: 0.1 }),
    ])
    expect(out.evidenceRecall).toBe(0.5)
    expect(out.answerF1).toBeCloseTo(0.3)
  })

  it('0/1 指标求均值即得比率', () => {
    const out = aggregate([
      rec('a', { evidenceHit: 1 }),
      rec('b', { evidenceHit: 0 }),
      rec('c', { evidenceHit: 1 }),
    ])
    expect(out.evidenceHit).toBeCloseTo(2 / 3)
  })

  it('某样本缺某指标时只在有该指标的样本上求均值', () => {
    // 失败样本不写指标，从分母中剔除——否则超时会被误读为质量下降
    const out = aggregate([
      rec('a', { answerF1: 1 }),
      rec('b', {}),
    ])
    expect(out.answerF1).toBe(1)
  })

  it('空输入返回空对象', () => {
    expect(aggregate([])).toEqual({})
  })

  it('NaN 不污染聚合值，被剔除后照常求均值', () => {
    const out = aggregate([
      rec('a', { answerF1: 0.5, broken: NaN }),
      rec('b', { answerF1: 1.0 }),
    ])
    expect(out.answerF1).toBeCloseTo(0.75)
    // NaN 指标被剔除后该键不出现，而不是把 NaN 传播出去
    expect(out.broken).toBeUndefined()
    expect(Number.isNaN(out.broken as number)).toBe(false)
  })

  it('±Infinity 同样被剔除', () => {
    const out = aggregate([
      rec('a', { mrr: Infinity, contextTokens: -Infinity, ok: 1 }),
      rec('b', { ok: 2 }),
    ])
    expect(out.mrr).toBeUndefined()
    expect(out.contextTokens).toBeUndefined()
    expect(out.ok).toBe(1.5)
  })

  it('整列非有限时该指标键直接不出现', () => {
    // 用 `'k' in out` 区分「键存在但值为 undefined」与「键不存在」——守卫的正确行为是后者
    const out = aggregate([
      rec('a', { degraded: NaN }),
      rec('b', { degraded: Infinity }),
    ])
    expect('degraded' in out).toBe(false)
  })
})

describe('withLatencyStats', () => {
  it('把延迟分位数并入指标', () => {
    const out = withLatencyStats({ answerF1: 0.5 }, [100, 200, 300])
    expect(out.answerF1).toBe(0.5)
    expect(out.latencyP50).toBe(200)
    expect(out.latencyP95).toBe(300)
  })

  it('无延迟数据时分位数为 0', () => {
    const out = withLatencyStats({}, [])
    expect(out.latencyP50).toBe(0)
    expect(out.latencyP95).toBe(0)
  })

  it('追加 llmNetworkLatencyP50Ms/P95Ms，值与既有 latency 字段一致', () => {
    const out = withLatencyStats({}, [120, 340])
    expect(out.llmNetworkLatencyP50Ms).toBe(120)
    expect(out.llmNetworkLatencyP95Ms).toBe(340)
    expect(out.latencyP50).toBe(out.llmNetworkLatencyP50Ms)
    expect(out.latencyP95).toBe(out.llmNetworkLatencyP95Ms)
  })

  it('无网络请求时不产生 llmNetworkLatency Ms 字段（而非记 0）', () => {
    const out = withLatencyStats({}, [])
    expect('llmNetworkLatencyP50Ms' in out).toBe(false)
    expect('llmNetworkLatencyP95Ms' in out).toBe(false)
  })

  it('负延迟被过滤，不与合法值混算', () => {
    const out = withLatencyStats({}, [100, -5, 300])
    expect(out.llmNetworkLatencyP50Ms).toBe(100)
  })
})

describe('withPercentiles', () => {
  it('为每个前缀生成 P50Ms / P95Ms', () => {
    const out = withPercentiles({}, { retrievalLatency: [100, 200, 300] })
    expect(out.retrievalLatencyP50Ms).toBe(200)
    expect(out.retrievalLatencyP95Ms).toBe(300)
  })

  it('空数组不产生字段，而非写 0', () => {
    const out = withPercentiles({}, { retrievalLatency: [] })
    expect('retrievalLatencyP50Ms' in out).toBe(false)
    expect('retrievalLatencyP95Ms' in out).toBe(false)
  })

  it('负数与 NaN 被过滤，不产生字段或污染合法值', () => {
    const out = withPercentiles({}, {
      a: [100, NaN, -1, Infinity],
      b: [NaN, -5],
    })
    expect(out.aP50Ms).toBe(100)
    expect('bP50Ms' in out).toBe(false)
  })

  it('保留原有指标并追加分位数', () => {
    const out = withPercentiles({ answerF1: 0.5 }, { retrievalLatency: [10, 20] })
    expect(out.answerF1).toBe(0.5)
    expect(out.retrievalLatencyP50Ms).toBe(10)
  })
})
