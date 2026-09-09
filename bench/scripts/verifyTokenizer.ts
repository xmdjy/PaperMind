// 一次性验证脚本：经 hf-mirror 拉取 BGE-M3 分词器并验证 tokenize 路径。
// 运行：HF_ENDPOINT=https://hf-mirror.com npx tsx bench/scripts/verifyTokenizer.ts
import { createBgeM3Tokenizer } from '../src/traditionalRag/embedding'
import { benchPath } from '../src/paths'

const t = await createBgeM3Tokenizer({ model: 'BAAI/bge-m3', revision: 'main', cacheDir: benchPath(import.meta.url, '../cache/models/') })
const tokens = t.tokenize('Retrieval augmented generation')
console.log('tokens:', tokens.slice(0, 8))
if (tokens.length < 3) throw new Error('tokenize 输出异常')
console.log('ok')
