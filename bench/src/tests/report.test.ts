import { describe, it, expect } from 'vitest'
import type { BenchResult } from '../types'
import { renderReport, renderComparison } from '../report'

function result(name: string, metrics: Record<string, number>, over: Partial<BenchResult> = {}): BenchResult {
  return {
    task: 'qa',
    config: { name },
    meta: {
      model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
      completed: 10, total: 10,
    },
    metrics,
    perSample: [],
    errors: [],
    ...over,
  }
}

describe('renderReport', () => {
  it('单结果渲染为含指标的 Markdown', () => {
    const md = renderReport([result('default', { evidenceRecall: 0.71, answerF1: 0.43 })])
    expect(md).toContain('| default |')
    expect(md).toContain('0.710')
    expect(md).toContain('evidenceRecall')
    expect(md).toContain('gpt-4o')
    expect(md).toContain('abc1234')
  })

  it('多结果一行一组配置，并标出主指标最优行', () => {
    const md = renderReport([
      result('topK=1', { evidenceRecall: 0.6 }),
      result('topK=2', { evidenceRecall: 0.8 }),
      result('topK=3', { evidenceRecall: 0.7 }),
    ])
    const bestLine = md.split('\n').find(l => l.includes('topK=2'))
    expect(bestLine).toContain('**')
  })

  it('打印 completed/total，让部分失败可见', () => {
    const md = renderReport([
      result('default', { evidenceRecall: 0.7 }, {
        meta: {
          model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
          completed: 95, total: 100,
        },
      }),
    ])
    expect(md).toContain('95/100')
  })

  it('有错误时列出按阶段的计数', () => {
    const md = renderReport([
      result('default', { evidenceRecall: 0.7 }, {
        errors: [
          { sampleId: 'a', stage: 'generate', message: 'timeout' },
          { sampleId: 'b', stage: 'generate', message: 'timeout' },
          { sampleId: 'c', stage: 'index', message: 'bad pdf' },
        ],
      }),
    ])
    expect(md).toContain('generate')
    expect(md).toContain('2')
    expect(md).toContain('index')
  })

  it('同配置同阶段的错误聚合为一行', () => {
    const md = renderReport([
      result('default', { evidenceRecall: 0.7 }, {
        errors: [
          { sampleId: 'a', stage: 'generate', message: 'timeout' },
          { sampleId: 'b', stage: 'generate', message: 'timeout' },
          { sampleId: 'c', stage: 'index', message: 'bad pdf' },
        ],
      }),
    ])
    expect(md).toContain('| default | generate | 2 | timeout |')
    expect(md).toContain('| default | index | 1 | bad pdf |')
  })

  it('空结果列表返回提示而非崩溃', () => {
    expect(renderReport([])).toContain('无结果')
  })

  it('unanswerableMethod 存在时在报表中标注口径', () => {
    const md = renderReport([
      result('default', { unanswerableAccuracy: 0.3 }, {
        meta: {
          model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
          completed: 10, total: 10, unanswerableMethod: 'pattern',
        },
      }),
    ])
    expect(md).toContain('pattern')
  })

  it('pattern 口径时打印拒答模式表版本，judge 口径不打印', () => {
    const base = { model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234', completed: 10, total: 10 }
    const pattern = renderReport([
      result('default', { unanswerableAccuracy: 0.3 }, { meta: { ...base, unanswerableMethod: 'pattern' } }),
    ])
    expect(pattern).toContain('拒答模式表版本')
    expect(pattern).toContain('v1')
    const judge = renderReport([
      result('default', { unanswerableAccuracy: 0.3 }, { meta: { ...base, unanswerableMethod: 'judge' } }),
    ])
    expect(judge).not.toContain('拒答模式表版本')
    const none = renderReport([result('default', { evidenceRecall: 0.7 })])
    expect(none).not.toContain('拒答模式表版本')
  })
})

describe('renderComparison', () => {
  it('输出指标差值与方向', () => {
    const md = renderComparison(
      result('before', { evidenceRecall: 0.6, answerF1: 0.5 }),
      result('after', { evidenceRecall: 0.8, answerF1: 0.4 }),
    )
    expect(md).toContain('evidenceRecall')
    expect(md).toContain('+0.200')
    expect(md).toContain('-0.100')
  })

  it('只在一侧出现的指标也列出', () => {
    const md = renderComparison(
      result('before', { evidenceRecall: 0.6 }),
      result('after', { mrr: 0.9 }),
    )
    expect(md).toContain('mrr')
  })
})
