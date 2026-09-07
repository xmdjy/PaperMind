# 传统 RAG 基线测评设计

## 目标与边界

在现有 PaperMind RAG 与 `--mode full-context`（整篇论文直投 LLM）之外，新增三个**可复现、可直接比较**的传统检索增强生成基线：

| 配置 | 检索算法 | 用途 |
| --- | --- | --- |
| `rag-cosine` | `BAAI/bge-m3` dense embedding，L2-normalized cosine | 稠密向量 RAG 主基线 |
| `rag-bm25` | BM25，`k1=1.2`、`b=0.75` | 经典词项稀疏检索基线 |
| `rag-jaccard` | Jaccard token-set similarity | 极简词法匹配基线 |

三者必须使用完全相同的输入文本、分块、召回数、上下文预算、生成模型、system prompt、数据集与指标；唯一变化是检索得分函数。它们是 bench 专用实现，不替换产品中的 PaperMind 章节树 + LLM 评分检索。

不在本次范围：hybrid/RRF、reranker、BM25 stopword/stem 消融、多向量/late-interaction BGE-M3、查询改写、多论文联合检索、产品 UI 接入。

## 已有基线与现状

- PaperMind 原生 RAG 由 `bench/src/runner/qa.ts` 驱动，复用 `src/utils/pageIndex.ts` 与 `src/utils/ragPipeline.ts`；它按章节/页构建树并让 LLM 给叶节点打分。
- 无检索 LLM 基线为 `bench/src/runner/fullContextQa.ts`，CLI 参数为 `--mode full-context`。
- CLI 入口和结果落盘在 `bench/src/cli.ts`；配置解析在 `bench/src/config.ts`；配置类型在 `bench/src/types.ts`。
- 当前 `rag-*.json` 是描述性文件，既没有 `matrix` 也没有对应 runner，不能被 `loadConfigs()` 运行。本方案完成后它们必须变为可解析、可执行的配置，不能保留“字段被静默忽略”的状态。

## 固定实验口径

### 文本与分块

1. 输入为数据集 loader 已提供的 `EvalSample.pages`，不重新解析 PDF；这样传统 RAG 与 PaperMind 使用同一份文本。
2. 将页文本按原顺序拼接，但每个 token 保留其来源 `page`。页与页间插入一个换行分隔符；分隔符不计入 chunk token。
3. 用 **BGE-M3 tokenizer** 计算 chunk token，固定 `chunkSize=512`、`overlap=64`，步长为 448。末尾不足 512 token 的部分保留为一个 chunk；若全文不足 512 token，仅建一个 chunk。
4. 每个 chunk 记录 `id`、`text`、`tokenCount`、`startPage`、`endPage`。跨页 chunk 的页码范围为该 chunk 中 token 所覆盖的最小/最大页号（0-based、inclusive）。不得按字符截断后猜测页码。
5. chunk 原文（而非摘要）是所有检索器的语料和最终上下文。不得删除参考文献、公式、停用词或标题；这是为了使基线输入与 PaperMind 一致。

### 稀疏检索 tokenization

BM25 与 Jaccard 共享 `lexicalTokenize(text)`，以保证只有评分函数不同：

- 使用 `Intl.Segmenter('und', { granularity: 'word' })`；仅保留 `isWordLike` token。
- 对 token 做 Unicode `NFKC` 归一化与 `toLocaleLowerCase('und')`。
- 不移除 stopwords，不做 stemming/lemmatization，不去重（Jaccard 在自己的得分函数内去重）。
- `Intl.Segmenter` 在 Node 20+ 是必须能力；初始化时不存在则直接抛明确错误，不得退化到不同 tokenizer。

### 召回、排序与生成

- 每个问题只用原始 `question` 检索；传统 baseline 的 `enableRewrite` 固定为 false。
- 每种算法先对**全部 chunk**给出一个有限数值分数，按 `score` 降序排序；相同分数以较小 `id` 优先，保证确定性。
- 排序后取 `retrieval.topK=10`，再从其前部按排序依次选取最多 `generationContext.topK=5` 个 chunk。若加入下一个 chunk 会使实际 BGE token 数超过 `generationContext.maxTokens=4096`，停止加入；不截断单个 chunk。
- 最终上下文按**检索排序**拼接，chunk 之间用 `\n\n---\n\n` 分隔。这样答案模型接收的证据顺序就是检索顺序，且可计算 MRR。
- 回答阶段复用现有 `DEFAULT_SYSTEM_PROMPT`、`MATH_FORMAT_INSTRUCTION`、`LlmClient.chat`、QASPER 英文回答覆写和答案/LLM judge 指标。传统检索不得调用 LLM；因此正常样本 `llmCalls` 固定为 1。

### 三种得分函数

`q` 为 query，`c` 为 chunk。所有值必须为有限数；空 query/chunk 的分数为 0。

1. **Cosine / BGE-M3**

   - 使用 `BAAI/bge-m3` 的 dense embedding 输出；不使用 sparse、colbert 或 hybrid 输出。
   - BGE-M3 dense embedding 不使用检索前缀；query 与 chunk 均直接输入模型。
   - 对 query 与每个 chunk 向量做 L2 normalization；分数为归一化向量内积，即 cosine similarity：`dot(normalize(E(q)), normalize(E(c)))`。
   - BGE 模型加载和推理封装为 `EmbeddingProvider`。生产实现使用 Node 侧 Hugging Face Transformers runtime（新增并锁定 `@huggingface/transformers` 依赖）；模型名称、revision、pooling 策略与最大 embedding token 长度均由配置显式记录。模型权重下载缓存放在 `bench/cache/models/`，不得写入仓库。
   - embedding provider 必须支持批量 chunk embedding，且索引阶段每篇论文仅计算一次 chunk 向量；问题阶段只计算一次 query 向量。单测全部注入 fake provider，绝不下载模型。

2. **BM25**

   - 对每个 chunk 保存词频 `tf`、文档频次 `df`、总文档数 `N`、平均 chunk 长度 `avgdl`。
   - 令 `idf(t)=ln(1 + (N-df(t)+0.5)/(df(t)+0.5))`，分数为 query 中每个 token 的累计：

     `idf(t) * tf(t,c) * (k1 + 1) / (tf(t,c) + k1 * (1 - b + b * |c| / avgdl))`

   - 固定 `k1=1.2`、`b=0.75`；query token 重复时按重复次数累计。空 corpus 返回空结果，空 query 的所有分数为 0。

3. **Jaccard**

   - 对 query 与每个 chunk 分别由 lexical token 构造集合 `Q`、`C`。
   - `score=|Q ∩ C| / |Q ∪ C|`；任一集合为空时为 0。
   - 同词多次出现不改变集合，也不改变分数。

## 可执行的配置格式

将配置模型扩展为以 `kind` 判别的联合类型。原有 `default.json` / `ablation-topk.json` 显式写入 `"kind": "papermind"`（缺省时为了兼容旧文件也按 `papermind` 处理），保留原有 `matrix` 语义。

传统配置为单点配置，不使用 `matrix`。三个 JSON 都应采用下列结构，只有 `name`、`retrieval.algorithm` 和算法参数不同：

```json
{
  "name": "rag-cosine",
  "kind": "traditional-rag",
  "chunking": {
    "tokenizer": "bge-m3",
    "chunkSize": 512,
    "overlap": 64
  },
  "retrieval": {
    "algorithm": "cosine",
    "topK": 10,
    "embedding": {
      "model": "BAAI/bge-m3",
      "revision": "main",
      "queryPrefix": "",
      "normalize": true,
      "maxLength": 8192
    }
  },
  "generationContext": {
    "topK": 5,
    "maxTokens": 4096
  }
}
```

- `rag-bm25.json`：`algorithm: "bm25"`，`k1: 1.2`，`b: 0.75`；没有 embedding 字段。
- `rag-jaccard.json`：`algorithm: "jaccard"`；没有 embedding 字段。

`loadConfigs()` 必须在读 JSON 后做运行时结构验证：未知 `kind`、缺失字段、负数、`overlap >= chunkSize`、`generationContext.topK > retrieval.topK`、非法 algorithm、cosine 配置未启用 normalize，均抛带配置路径的中文错误。传统配置的 `loadConfigs()` 返回长度为 1 的具体配置；PaperMind 配置仍然按矩阵展开。不要通过 `as ConfigFile` 直接断言未校验 JSON。

## 代码结构与职责

新增目录 `bench/src/traditionalRag/`：

| 文件 | 导出与职责 |
| --- | --- |
| `types.ts` | `BenchChunk`、`ScoredChunk`、`Retriever`、`BuiltRetriever`、`EmbeddingProvider`、传统配置类型；所有页码为 0-based inclusive。 |
| `chunker.ts` | `chunkPages(pages, tokenizer, options): BenchChunk[]`；负责 token 到页号映射、512/64 滑窗和 chunk 文本复原。 |
| `lexicalTokenizer.ts` | `lexicalTokenize`；唯一的 BM25/Jaccard 分词实现。 |
| `bm25.ts` | `buildBm25Retriever(chunks)`；构建倒排统计并返回 `score(query)`。 |
| `jaccard.ts` | `buildJaccardRetriever(chunks)`；预计算每个 chunk 的 token set。 |
| `embedding.ts` | BGE-M3 Transformers adapter 与 L2 normalize helper；仅此文件接触第三方模型 runtime。 |
| `cosine.ts` | `buildCosineRetriever(chunks, provider, options)`；批量建向量，query 向量化并计算 dot product。 |
| `context.ts` | 稳定排序、top-10/top-5、token-budget 选择、上下文拼接与 source 格式化。 |

新增 `bench/src/runner/traditionalRagQa.ts`。它模仿 `runQaTask` 的返回结构和错误处理，但依赖注入以下三项：`buildRetriever`、`generateAnswer`（默认 `LlmClient.chat`）和 `now`。每篇论文执行一次：`chunkPages → buildRetriever`；每个问题执行一次：`retriever.score(question) → selectContext → generateAnswer`。索引、检索、生成分别计时，并将 index build / query retrieval 的耗时写入已有 `PaperTimingRecord` 与 `PipelineTiming` 字段。

`BenchChunk` 不应伪装为生产 `IndexNode`。将 `bench/src/metrics/retrieval.ts` 改为依赖 bench 自有的最小 `PageSpan { startPage, endPage }` 与 `{ id, score }`，使原生节点与传统 chunk 均可传入；`expandPages`、`computeRetrievalMetrics` 和 MRR 的数值含义保持不变。传统 runner 向它传入完整排序的 `ScoredChunk[]`，以产生真实 MRR；原生 runner 仍传 LLM 的完整叶节点打分。

在 `bench/src/cli.ts` 中，保留 `--mode full-context` 的最高优先级。其余 QA 任务按 `config.kind` 分发：`papermind` 调 `runQaTask`，`traditional-rag` 调 `runTraditionalRagQaTask`。摘要任务只接受 `papermind` 配置；若传 traditional 配置，立即报“传统 RAG 不支持 summary task”，不得看似成功地忽略参数。

在 `BenchResult.meta` 增加可选 `retrievalAlgorithm?: 'papermind-llm' | 'cosine' | 'bm25' | 'jaccard' | 'none'`，并在各 runner 写入。报告把该字段显示为一列，防止同名/不同机制结果被混淆。

## 实施顺序

1. 先扩展 `bench/src/types.ts`、`bench/src/config.ts` 与配置单测，使三份 `rag-*.json` 能被加载并经过严格校验；更新三个 JSON 为上文格式。
2. 实现 `types.ts`、词法 tokenizer、chunker、BM25、Jaccard 与 context selection。此阶段不安装模型依赖，也不改 CLI。
3. 实现 embedding provider / cosine retriever，新增依赖并以 fake provider 测试；真实模型下载仅作为手工冒烟，不进入自动化测试。
4. 抽象 retrieval metric 的最小 page-span 类型，保证原生 benchmark 既有测试不变且传统排序可计算 MRR。
5. 实现 `traditionalRagQa.ts`，复用现有答案评分、judge、错误记录、统计聚合和 QASPER 英文覆写。
6. 接到 CLI，完善 `meta.retrievalAlgorithm` 和 report，最后跑全量 typecheck 与测试。

## 最小单元验证清单

所有测试放在 `bench/src/tests/`，不调用真实 LLM、Hugging Face、PDF 或网络。

1. `traditionalConfig.test.ts`
   - 三个 JSON 可加载，名称和算法正确；传统配置返回一个点而非矩阵展开。
   - 缺 `kind` 的旧 default 仍能加载为 PaperMind。
   - 覆盖每个非法约束和未知字段/算法，断言错误带配置路径和字段名。
2. `traditionalChunker.test.ts`
   - 验证 512/64 时窗口起点为 0、448、896；最后短块保留。
   - 跨页 token 的 `startPage/endPage` 正确；空页和短文档不产生越界 chunk。
3. `lexicalRetrieval.test.ts`
   - `Intl.Segmenter` 的大小写、NFKC 和中文词切分归一化可预测。
   - 用一个小语料手算断言 BM25 排名与数值（容差 `1e-12`）；验证 `k1`/`b` 影响。
   - 手算 Jaccard 的交/并集；重复词不影响 Jaccard，空 query 分数为 0。
4. `cosine.test.ts`
   - fake embedding provider 返回已知向量，验证 L2 normalization、dot product、query prefix、batch 调用次数（建索引一次批量、每个 query 一次）。
   - 验证同分按 chunk id 排序，NaN/维度不一致 provider 输出抛明确错误。
5. `context.test.ts`
   - top-10 后仅取 top-5；4096 budget 边界、超预算 chunk 不被部分截断；source 与分隔符顺序正确。
6. `traditionalRagQa.test.ts`
   - 注入假 retriever 与假生成器，验证每篇只建一次索引、多问题重复使用、`llmCalls=1`、时延字段完整。
   - 已知 evidence 页验证 `evidenceRecall`、`contextPrecision`、MRR；无 evidence 不进入 retrieval quality 分母。
   - retriever/生成器任一抛错时记录正确 `stage`，后续样本仍继续。
7. 回归运行已有 `qaRunner.test.ts`、`config.test.ts`、`retrieval.test.ts`，确认 PaperMind 原生指标与结果格式不回归。

实现完成后至少执行：

```bash
npm test -- bench/src/tests/traditionalConfig.test.ts bench/src/tests/traditionalChunker.test.ts bench/src/tests/lexicalRetrieval.test.ts bench/src/tests/cosine.test.ts bench/src/tests/context.test.ts bench/src/tests/traditionalRagQa.test.ts
npm test -- bench/src/tests/config.test.ts bench/src/tests/retrieval.test.ts bench/src/tests/qaRunner.test.ts
npm run typecheck
```

可选手工烟测（需要模型下载与有效 LLM 环境变量）应使用 `--dataset smoke --limit 1 --config rag-cosine`，再分别运行 BM25 和 Jaccard；确认三份结果的 `meta.retrievalAlgorithm`、检索指标和结果文件名都不同。不得将这种联网检查作为 CI 或最小单元验证前提。
