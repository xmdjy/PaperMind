import { describe, it, expect } from 'vitest'
import { rougeN, rougeL, computeSummaryMetrics } from '../metrics/rouge'

describe('rougeN', () => {
  it('完全一致时 ROUGE-1 为 1', () => {
    expect(rougeN('the cat sat', 'the cat sat', 1)).toBe(1)
  })

  it('无重叠时为 0', () => {
    expect(rougeN('alpha beta', 'gamma delta', 1)).toBe(0)
  })

  it('ROUGE-2 用 bigram：词都在但顺序不同时为 0', () => {
    expect(rougeN('cat the', 'the cat', 1)).toBe(1)   // unigram 全中
    expect(rougeN('cat the', 'the cat', 2)).toBe(0)   // bigram 不匹配
  })

  it('文本短于 n 时为 0，不产生 NaN', () => {
    expect(rougeN('cat', 'cat', 2)).toBe(0)
    expect(Number.isNaN(rougeN('cat', 'cat', 2))).toBe(false)
  })

  it('任一侧为空时为 0', () => {
    expect(rougeN('', 'the cat', 1)).toBe(0)
    expect(rougeN('the cat', '', 1)).toBe(0)
  })
})

describe('rougeL', () => {
  it('完全一致时为 1', () => {
    expect(rougeL('the cat sat on the mat', 'the cat sat on the mat')).toBe(1)
  })

  it('按最长公共子序列计算，允许跳词', () => {
    // pred: [a,b,c,d]，ref: [a,c,d] → LCS = [a,c,d] 长 3
    // precision 3/4, recall 3/3 → F1 ≈ 0.857
    expect(rougeL('alpha beta gamma delta', 'alpha gamma delta')).toBeCloseTo(6 / 7)
  })

  it('无重叠时为 0', () => {
    expect(rougeL('alpha beta', 'gamma delta')).toBe(0)
  })

  it('任一侧为空时为 0', () => {
    expect(rougeL('', 'the cat')).toBe(0)
  })
})

describe('computeSummaryMetrics', () => {
  it('正常摘要给出三个 ROUGE 与压缩比，empty=0', () => {
    const m = computeSummaryMetrics('the cat sat', 'the cat sat', 100)
    expect(m.rouge1).toBe(1)
    expect(m.rougeL).toBe(1)
    expect(m.compressionRatio).toBeCloseTo(11 / 100)
    expect(m.empty).toBe(0)
  })

  it('摘要为空或纯空白时 empty=1，ROUGE 全 0', () => {
    const m = computeSummaryMetrics('   ', 'the cat sat', 100)
    expect(m.empty).toBe(1)
    expect(m.rouge1).toBe(0)
    expect(m.rouge2).toBe(0)
    expect(m.rougeL).toBe(0)
  })

  it('原文长度为 0 时压缩比记 0，不产生除零', () => {
    const m = computeSummaryMetrics('abc', 'abc', 0)
    expect(m.compressionRatio).toBe(0)
    expect(Number.isFinite(m.compressionRatio)).toBe(true)
  })
})
