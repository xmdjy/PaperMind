import { describe, expect, it } from 'vitest'
import { chunkPages } from '../traditionalRag/chunker'

const tokenizer = { tokenize: (text: string) => text.split(' ') }

describe('chunkPages', () => {
  it('uses sliding windows, preserves a final short chunk, and maps pages', () => {
    const chunks = chunkPages(['a b c', 'd e f g h'], tokenizer, { chunkSize: 4, overlap: 1 })
    expect(chunks.map(c => c.tokenCount)).toEqual([4, 4, 2])
    expect(chunks.map(c => c.startPage)).toEqual([0, 1, 1])
    expect(chunks.map(c => c.endPage)).toEqual([1, 1, 1])
  })

  it('removes SentencePiece metaspace markers and inserts page separators', () => {
    const chunks = chunkPages(['We propose', 'a method'], { tokenize: text => text === 'We propose' ? ['▁We', '▁propose'] : ['▁a', '▁method'] }, { chunkSize: 4, overlap: 0 })
    expect(chunks[0].text).toBe('We propose\n a method')
    expect(chunks[0]).toMatchObject({ startPage: 0, endPage: 1 })
  })
})
