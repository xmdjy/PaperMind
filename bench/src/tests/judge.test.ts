import { describe, it, expect, vi } from 'vitest'
import {
  buildJudgePrompt, parseJudgeResponse, judgeAnswer, judgeUnanswerable, RUBRIC_VERSION,
} from '../metrics/judge'

function client(response: string) {
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn(),
    stats: () => ({ hits: 0, misses: 0 }),
    latencies: () => [],
  } as never
}

describe('buildJudgePrompt', () => {
  it('包含问题、evidence 与待评答案', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E text', answer: 'A text' })
    expect(p).toContain('Q?')
    expect(p).toContain('E text')
    expect(p).toContain('A text')
  })

  it('不包含参考答案字段——避免与 answerF1 同源', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E', answer: 'A' })
    expect(p).not.toMatch(/参考答案|reference answer|gold answer/i)
  })

  it('要求三维 1-5 分的 JSON 输出', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E', answer: 'A' })
    expect(p).toContain('factuality')
    expect(p).toContain('completeness')
    expect(p).toContain('groundedness')
  })
})

describe('parseJudgeResponse', () => {
  it('解析纯 JSON', () => {
    expect(parseJudgeResponse('{"factuality":5,"completeness":4,"groundedness":3}'))
      .toEqual({ factuality: 5, completeness: 4, groundedness: 3 })
  })

  it('剥离 markdown 代码块围栏', () => {
    expect(parseJudgeResponse('```json\n{"factuality":1,"completeness":2,"groundedness":3}\n```'))
      .toEqual({ factuality: 1, completeness: 2, groundedness: 3 })
  })

  it('非法 JSON 返回 null 而非抛错', () => {
    expect(parseJudgeResponse('抱歉我无法评分')).toBeNull()
  })

  it('分数越界时返回 null——宁可缺数据也不要错数据', () => {
    expect(parseJudgeResponse('{"factuality":9,"completeness":4,"groundedness":3}')).toBeNull()
    expect(parseJudgeResponse('{"factuality":0,"completeness":4,"groundedness":3}')).toBeNull()
  })

  it('缺字段时返回 null', () => {
    expect(parseJudgeResponse('{"factuality":5}')).toBeNull()
  })
})

describe('judgeAnswer', () => {
  it('返回解析后的三维分数', async () => {
    const scores = await judgeAnswer({
      question: 'Q?', evidence: 'E', answer: 'A',
      client: client('{"factuality":5,"completeness":4,"groundedness":5}'),
    })
    expect(scores).toEqual({ factuality: 5, completeness: 4, groundedness: 5 })
  })

  it('judge 调用抛错时返回 null，不打断评测', async () => {
    const failing = {
      complete: vi.fn().mockRejectedValue(new Error('judge 503')),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    } as never
    expect(await judgeAnswer({ question: 'Q?', evidence: 'E', answer: 'A', client: failing }))
      .toBeNull()
  })

  it('prompt 中嵌入 rubric 版本号，使缓存在 rubric 改动后失效', async () => {
    const c = client('{"factuality":5,"completeness":5,"groundedness":5}')
    await judgeAnswer({ question: 'Q?', evidence: 'E', answer: 'A', client: c })
    expect((c as unknown as { complete: { mock: { calls: string[][] } } }).complete.mock.calls[0][0])
      .toContain(RUBRIC_VERSION)
  })
})

describe('judgeUnanswerable', () => {
  it('judge 回 REFUSAL 时判为拒答', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('REFUSAL') }))
      .toBe(true)
  })

  it('judge 回 ANSWERED 时判为未拒答', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('ANSWERED') }))
      .toBe(false)
  })

  it('回复无法识别时返回 null', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('嗯') }))
      .toBeNull()
  })

  it('judgeUnanswerable 的 client 抛错时返回 null，不打断评测', async () => {
    const failing = {
      complete: vi.fn().mockRejectedValue(new Error('boom')),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    } as never
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: failing })).toBeNull()
  })
})
