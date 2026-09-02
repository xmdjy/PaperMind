import { describe, it, expect, vi } from 'vitest'
import type { IndexNode } from '../utils/pageIndex'

// Node 环境缺 DOMMatrix，pageIndex 顶层会初始化 pdfjs worker
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

const { runRagPipeline, MATH_FORMAT_INSTRUCTION } = await import('../utils/ragPipeline')

function leaf(id: string, start: number, end: number): IndexNode {
  return { title: `S${id}`, nodeId: id, startPage: start, endPage: end, summary: `sum ${id}`, nodes: [] }
}

/** 多叶索引：scoreAndSelect 会实际发出打分请求 */
const multiLeafTree: IndexNode = {
  title: 'Paper', nodeId: 'root', startPage: 0, endPage: 3, summary: '', nodes: [leaf('0', 0, 1), leaf('1', 2, 3)],
}
/** 单叶索引：scoreAndSelect 短路，不发请求 */
const singleLeafTree: IndexNode = leaf('only', 0, 1)

const pages = ['p1', 'p2', 'p3', 'p4']

describe('runRagPipeline', () => {
  it('无历史 + 单叶索引时只发生成这一次调用', async () => {
    const llm = vi.fn()
    const generate = vi.fn().mockResolvedValue('answer')

    const result = await runRagPipeline(
      [{ tree: singleLeafTree, pages }], '什么是注意力机制', [], llm, generate, 'sys',
    )

    expect(result.llmCalls).toBe(1)
    expect(llm).not.toHaveBeenCalled()
    expect(result.rewritten).toBe(false)
    expect(result.retrievalQuery).toBe('什么是注意力机制')
    expect(result.answer).toBe('answer')
    expect(result.sources).toEqual(['Pages 1–2: Sonly'])
  })

  it('历史达 2 轮 + 多叶索引时为改写/打分/生成三次调用', async () => {
    const llm = vi.fn()
      .mockResolvedValueOnce('自注意力机制的定义')          // rewriteQuery
      .mockResolvedValueOnce('[{"id":0,"score":9},{"id":1,"score":2}]') // scoreAndSelect
    const generate = vi.fn().mockResolvedValue('answer')

    const result = await runRagPipeline(
      [{ tree: multiLeafTree, pages }],
      '它的定义是什么',
      [{ role: 'user', content: '讲讲 transformer' }, { role: 'assistant', content: '好的' }],
      llm, generate, 'sys',
    )

    expect(result.llmCalls).toBe(3)
    expect(result.retrievalQuery).toBe('自注意力机制的定义')
    expect(result.rewritten).toBe(true)
    // score=2 未达 minScore 默认值 4，只选中首节点
    expect(result.retrievals[0].selected.map(n => n.nodeId)).toEqual(['0'])
  })

  it('enableRewrite=false 时跳过改写', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":9}]')
    const generate = vi.fn().mockResolvedValue('answer')

    const result = await runRagPipeline(
      [{ tree: multiLeafTree, pages }],
      '原始问题',
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      llm, generate, 'sys', { enableRewrite: false },
    )

    expect(result.llmCalls).toBe(2)
    expect(result.retrievalQuery).toBe('原始问题')
  })

  it('externalContext 提供时跳过改写与检索', async () => {
    const llm = vi.fn()
    const generate = vi.fn().mockResolvedValue('answer')

    const result = await runRagPipeline(
      [{ tree: multiLeafTree, pages }],
      '解释这段',
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
      llm, generate, 'sys', { externalContext: '用户划选的原文' },
    )

    expect(llm).not.toHaveBeenCalled()
    expect(result.llmCalls).toBe(1)
    expect(result.retrievals).toEqual([])
    expect(result.sources).toEqual([])
    expect(result.context).toBe('用户划选的原文')
    expect(generate.mock.calls[0][0][0].content).toContain('用户划选的原文')
  })

  it('system 提示词包含数学格式约束与参考内容，末条为当前提问', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":9}]')
    const generate = vi.fn().mockResolvedValue('answer')

    await runRagPipeline(
      [{ tree: multiLeafTree, pages }], '问题', [{ role: 'user', content: '早先的话' }],
      llm, generate, '你是助手',
    )

    const messages = generate.mock.calls[0][0]
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('你是助手')
    expect(messages[0].content).toContain(MATH_FORMAT_INSTRUCTION)
    expect(messages[0].content).toContain('参考内容：')
    expect(messages[1]).toEqual({ role: 'user', content: '早先的话' })
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '问题' })
  })

  it('多篇论文的检索结果按入参顺序聚合，来源合并', async () => {
    const llm = vi.fn().mockResolvedValue('[{"id":0,"score":9},{"id":1,"score":8}]')
    const generate = vi.fn().mockResolvedValue('answer')

    const result = await runRagPipeline(
      [{ tree: multiLeafTree, pages }, { tree: singleLeafTree, pages }],
      '问题', [], llm, generate, 'sys',
    )

    expect(result.retrievals).toHaveLength(2)
    // 第一篇发一次打分，第二篇单叶短路；加生成共 2 次
    expect(result.llmCalls).toBe(2)
    expect(result.sources).toHaveLength(3)
    expect(result.context).toContain('---')
  })
})
