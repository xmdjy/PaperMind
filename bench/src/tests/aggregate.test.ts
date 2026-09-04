import { describe, it, expect } from 'vitest'
import type { PerSampleRecord } from '../types'
import { mean, percentile, aggregate, withLatencyStats } from '../metrics/aggregate'

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
})
