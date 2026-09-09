// 一次性验证脚本：验证 BGE-M3 embedding provider 加载与相似度排序。
// 运行：HF_ENDPOINT=https://hf-mirror.com npx tsx bench/scripts/verifyEmbedding.ts
import { createBgeM3Provider } from '../src/traditionalRag/embedding'
import { benchPath } from '../src/paths'

const { provider, tokenizer } = await createBgeM3Provider({
  model: 'BAAI/bge-m3', revision: 'main', maxLength: 8192, cacheDir: benchPath(import.meta.url, '../cache/models/'),
})
console.log('tokenize:', tokenizer.tokenize('检索增强生成').length, 'tokens')
const [v1, v2, v3] = await provider.embed([
  'The retrieval pipeline selects leaf nodes with an LLM.',
  'RAG systems retrieve passages relevant to the question.',
  'We prefer tea over coffee in the office kitchen.',
])
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0)
console.log('dim:', v1.length)
console.log('sim(rel,rel-ish):', dot(v1, v2).toFixed(4), 'sim(rel,tea):', dot(v1, v3).toFixed(4))
if (dot(v1, v2) <= dot(v1, v3)) throw new Error('相似度排序异常')
console.log('ok')
