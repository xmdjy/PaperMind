import { createCrossEncoderProvider } from '../src/baselines/reranker'

// 一次性验证脚本：拉取 pinned ONNX 重排器并验证相关性排序。
// 运行：HF_ENDPOINT=https://hf-mirror.com npx tsx bench/scripts/verifyReranker.ts
// 验证后可删除；不属于测试资产。
const t0 = Date.now()
const rt = await createCrossEncoderProvider({
  model: 'rozgo/bge-reranker-v2-m3',
  revision: 'fbd57b17b4db111a9d16813bb08b4c804fac18e9',
  maxLength: 512,
  cacheDir: '/Users/xmdjy/cs/PaperMind/bench/cache/models/',
})
console.log('loaded in', Math.round((Date.now() - t0) / 1000), 's')
const scores = await rt.score([
  { query: 'How does the retrieval pipeline score candidates?', document: 'The retrieval pipeline uses an LLM to score each leaf node and selects the top candidates.' },
  { query: 'How does the retrieval pipeline score candidates?', document: 'We prefer tea over coffee in the office kitchen.' },
])
console.log('scores:', scores)
console.log('relevant > irrelevant:', scores[0] > scores[1])
