import { describe, it, expect, vi } from 'vitest'
import { rewriteQuery } from '../utils/queryRewrite'
import type { ChatTurn } from '../utils/queryRewrite'

const history: ChatTurn[] = [
  { role: 'user', content: 'What dataset does this paper use?' },
  { role: 'assistant', content: 'It uses the WMT 2014 English-German corpus.' },
]

describe('rewriteQuery', () => {
  it('returns the LLM-rewritten self-contained query', async () => {
    const llm = vi.fn().mockResolvedValue('How large is the WMT 2014 English-German corpus?')
    const result = await rewriteQuery('How large is it?', history, llm)

    expect(result).toBe('How large is the WMT 2014 English-German corpus?')
    expect(llm).toHaveBeenCalledTimes(1)
  })

  it('passes the prior turns to the LLM so pronouns can be resolved', async () => {
    const llm = vi.fn().mockResolvedValue('rewritten')
    await rewriteQuery('How large is it?', history, llm)

    const prompt = llm.mock.calls[0][0] as string
    expect(prompt).toContain('What dataset does this paper use?')
    expect(prompt).toContain('WMT 2014 English-German corpus')
    expect(prompt).toContain('How large is it?')
  })

  it('trims surrounding whitespace from the rewritten query', async () => {
    const llm = vi.fn().mockResolvedValue('  a self-contained query  \n')
    const result = await rewriteQuery('it?', history, llm)

    expect(result).toBe('a self-contained query')
  })

  it('falls back to the original query when the LLM throws', async () => {
    const llm = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await rewriteQuery('How large is it?', history, llm)

    expect(result).toBe('How large is it?')
  })

  it('falls back to the original query when the LLM returns only whitespace', async () => {
    const llm = vi.fn().mockResolvedValue('   \n  ')
    const result = await rewriteQuery('How large is it?', history, llm)

    expect(result).toBe('How large is it?')
  })

  it('does not import pdfjs, so it is usable in a bare Node benchmark', async () => {
    // 该模块不得依赖 pdfjs-dist —— 本测试文件没有 mock pdfjs，导入成功即证明解耦
    const mod = await import('../utils/queryRewrite')
    expect(typeof mod.rewriteQuery).toBe('function')
  })
})
