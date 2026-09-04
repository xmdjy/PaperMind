import { describe, it, expect, vi } from 'vitest'
import type { EvalSample } from '../types'
import { runSummaryTask } from '../runner/summary'

const sample: EvalSample = {
  paperId: 'p1',
  title: 'Paper 1',
  pages: ['the cat sat on the mat', 'more text here'],
  source: 'smoke',
  questions: [],
  referenceAbstract: 'the cat sat on the mat',
}

const baseArgs = {
  samples: [sample],
  config: { name: 'default' },
  hfToken: 'hf_test',
  gitSha: 'abc1234',
  model: 't5-small',
}

describe('runSummaryTask', () => {
  it('产出 BenchResult 与 ROUGE 指标', async () => {
    const summarize = vi.fn().mockResolvedValue('the cat sat on the mat')
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.task).toBe('summary')
    expect(result.metrics.rouge1).toBe(1)
    expect(result.metrics.rougeL).toBe(1)
    expect(result.metrics.emptyRate).toBe(0)
    expect(result.meta.completed).toBe(1)
    expect(result.perSample[0].metrics).toHaveProperty('compressionRatio')
    expect(result.perSample[0].summary).toBe('the cat sat on the mat')
  })

  it('把全文页拼接后交给 summarizeAcademicText', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(summarize.mock.calls[0][0]).toContain('the cat sat')
    expect(summarize.mock.calls[0][0]).toContain('more text here')
    expect(summarize.mock.calls[0][1]).toBe('hf_test')
  })

  it('跳过没有参考摘要的样本，不计入 total', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    const noRef: EvalSample = { ...sample, referenceAbstract: undefined }
    const result = await runSummaryTask({ ...baseArgs, samples: [noRef], deps: { summarize } as never })

    expect(result.meta.total).toBe(0)
    expect(summarize).not.toHaveBeenCalled()
  })

  it('返回空摘要时 emptyRate 为 1 而非算作低质量', async () => {
    const summarize = vi.fn().mockResolvedValue('   ')
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.metrics.emptyRate).toBe(1)
    expect(result.metrics.rouge1).toBe(0)
    expect(result.perSample[0].metrics).not.toHaveProperty('compressionRatio')
    expect(result.errors).toEqual([])
  })

  it('摘要调用抛错时记入 errors 并从分母剔除', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('HF 503'))
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.meta.completed).toBe(0)
    expect(result.meta.total).toBe(1)
    expect(result.errors[0]).toMatchObject({ sampleId: 'p1', stage: 'summarize' })
    expect(result.errors[0].message).toContain('HF 503')
  })

  it('limit 限制处理的论文数', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    const result = await runSummaryTask({
      ...baseArgs,
      samples: [sample, { ...sample, paperId: 'p2' }],
      limit: 1,
      deps: { summarize } as never,
    })

    expect(result.meta.total).toBe(1)
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('缺 hfToken 时抛出可诊断的错误', async () => {
    await expect(runSummaryTask({ ...baseArgs, hfToken: '' })).rejects.toThrow(/HF_TOKEN/)
  })
})
