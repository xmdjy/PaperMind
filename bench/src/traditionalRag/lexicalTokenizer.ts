let segmenter: Intl.Segmenter | undefined
export function lexicalTokenize(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') throw new Error('当前 Node 环境不支持 Intl.Segmenter，传统词法检索无法运行')
  segmenter ??= new Intl.Segmenter('und', { granularity: 'word' })
  return [...segmenter.segment(text)].filter(x => x.isWordLike).map(x => x.segment.normalize('NFKC').toLocaleLowerCase('und'))
}
