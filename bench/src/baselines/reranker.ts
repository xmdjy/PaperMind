/**
 * 交叉编码器重排 provider（计划 §2.2 指定 BAAI/bge-reranker-v2-m3 权重）。
 * 仅本文件接触 Transformers（动态导入，非 hybrid-rerank 路径不加载大模型）。
 * 模型 id / revision 必须来自配置显式 pin；输出原始 logit，单调于相关性，排序语义足够。
 */
import type { TextTokenizer } from '../traditionalRag/types'
import { applyHfEndpoint } from '../hub'

export interface RerankerProvider {
  /** 逐对打分，返回与入参同序的分数数组 */
  score(pairs: Array<{ query: string; document: string }>): Promise<number[]>
}

export interface RerankerRuntime extends RerankerProvider {
  tokenizer: TextTokenizer
}

const RERANK_BATCH = 8

export async function createCrossEncoderProvider(options: { model: string; revision: string; maxLength: number; cacheDir?: string }): Promise<RerankerRuntime> {
  const transformers = await import('@huggingface/transformers')
  applyHfEndpoint(transformers)
  const env = transformers.env as { cacheDir?: string }
  if (options.cacheDir) env.cacheDir = options.cacheDir
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(options.model, { revision: options.revision })
  // pinned 仓库（rozgo/bge-reranker-v2-m3）的 ONNX 权重在仓库根目录而非 transformers.js
  // 默认的 onnx/ 子目录。权重主体是外部数据文件（model.onnx.data）：不启用
  // use_external_data_format（它会按 model.onnx_data 命名找不到文件），而是让
  // onnxruntime-node 以文件路径方式加载缓存好的 model.onnx，按相对路径自然解析外部数据
  const model = await transformers.AutoModelForSequenceClassification.from_pretrained(options.model, {
    revision: options.revision,
    subfolder: '',
  })
  return {
    tokenizer: { tokenize: (text) => tokenizer.tokenize(text) },
    async score(pairs) {
      const out: number[] = []
      for (let start = 0; start < pairs.length; start += RERANK_BATCH) {
        const batch = pairs.slice(start, start + RERANK_BATCH)
        // bge-reranker 系列为 query</s></s>passenger 的句对编码；transformers.js 直接用 text_pair
        const inputs = tokenizer(batch.map(p => p.query), {
          text_pair: batch.map(p => p.document),
          padding: true,
          truncation: true,
          max_length: options.maxLength,
        })
        const output = await model(inputs) as unknown as { logits: { data: Float32Array | number[]; dims: number[] } }
        const width = output.logits.dims.at(-1)
        if (width !== 1) throw new Error(`reranker 输出维度异常：期望单 logit，得到 ${width}`)
        const data = output.logits.data
        for (let i = 0; i < batch.length; i++) out.push(Number(data[i]))
      }
      return out
    },
  }
}
