import type { EmbeddingProvider, TextTokenizer } from './types'

export function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0))
  if (!Number.isFinite(norm) || norm === 0) throw new Error('embedding 向量范数为 0 或非有限数')
  return vector.map(n => n / norm)
}

export async function createBgeM3Tokenizer(options: { model: string; revision: string; cacheDir?: string }): Promise<TextTokenizer> {
  const transformers = await import('@huggingface/transformers')
  if (options.cacheDir) (transformers.env as { cacheDir?: string }).cacheDir = options.cacheDir
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(options.model, { revision: options.revision })
  return { tokenize: (text) => tokenizer.tokenize(text) }
}

/** 仅本文件接触 Transformers；动态导入避免非 cosine benchmark 加载大模型运行时。 */
export async function createBgeM3Provider(options: { model: string; revision: string; maxLength: number; cacheDir?: string }): Promise<{ provider: EmbeddingProvider; tokenizer: TextTokenizer }> {
  const transformers = await import('@huggingface/transformers')
  const env = transformers.env as { cacheDir?: string }
  if (options.cacheDir) env.cacheDir = options.cacheDir
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(options.model, { revision: options.revision })
  const extractor = await transformers.pipeline('feature-extraction', options.model, { revision: options.revision })
  ;(extractor as unknown as { tokenizer: { model_max_length: number } }).tokenizer.model_max_length = options.maxLength
  return {
    tokenizer: { tokenize: (text) => tokenizer.tokenize(text) },
    provider: { async embed(texts) {
      if (!texts.length) return []
      // 一个 batch 一次前向传播；maxLength 必须真正传给 tokenizer/pipeline。
      const vectors: number[][] = []
      for (let start = 0; start < texts.length; start += 32) {
        const batch = texts.slice(start, start + 32)
        const output = await extractor(batch, { pooling: 'cls', normalize: false }) as unknown as { data: Float32Array | number[]; dims: number[] }
        const width = output.dims.at(-1)
        if (!width || output.data.length !== batch.length * width) throw new Error('embedding batch 输出维度异常')
        const data = Array.from(output.data)
        vectors.push(...batch.map((_, i) => data.slice(i * width, (i + 1) * width)))
      }
      return vectors
    } },
  }
}
