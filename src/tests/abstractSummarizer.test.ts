import { describe, expect, it, vi } from 'vitest'
import { splitAbstractText, summarizeAcademicText } from '../utils/abstractSummarizer'

describe('abstractSummarizer', () => {
  it('splits long text without dropping content', () => {
    const text = 'First sentence. Second sentence is longer. Third sentence.'
    const chunks = splitAbstractText(text, 25)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join(' ')).toBe(text)
    expect(chunks.every(chunk => chunk.length <= 25)).toBe(true)
  })

  it('recursively summarizes chunks until one final abstract remains', async () => {
    const summarize = vi.fn()
      .mockResolvedValueOnce('Section one summary.')
      .mockResolvedValueOnce('Section two summary.')
      .mockResolvedValueOnce('Final paper summary.')
    const text = `${'A'.repeat(1500)}. ${'B'.repeat(1500)}.`

    const result = await summarizeAcademicText(text, 'hf-test', summarize)

    expect(result).toBe('Final paper summary.')
    expect(summarize).toHaveBeenCalledTimes(3)
  })
})
