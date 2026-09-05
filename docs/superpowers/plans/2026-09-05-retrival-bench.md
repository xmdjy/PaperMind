# 检索 Benchmark 时延指标施工方案

- 日期：2026-09-05
- 状态：待实施
- 范围：`bench/` 的 QA benchmark 时延可观测性；为保证同一条生产 RAG 路径被测，需在 `src/utils/ragPipeline.ts` 增加只读 timing 输出。
- 不改动：检索排序、分块策略、答案质量指标、QASPER 数据标准化、缓存 key 语义。

> 文件名沿用需求中的 `retrival` 拼写；文档正文与代码统一使用 `retrieval`。

## 1. 问题与目标

现有结果 JSON 只有 `metrics.latencyP50` 与 `metrics.latencyP95`。它们来自 `LlmClient.latencies()`，只记录**未命中缓存的单次 HTTP LLM 请求**。因此它们不能回答下列问题：

1. 检索（query rewrite、节点打分、上下文拼装）本身是否变慢？
2. 慢的是答案生成，还是首次论文索引？
3. 一道题从开始到答案完成的用户可见时延是多少？
4. 一轮 benchmark 实际跑了多久、缓存是否影响了比较？

本方案在不改变生产回答行为的前提下，使 QA 结果同时可衡量：

- **整轮 wall-clock**：这次运行实际耗时；
- **论文索引**：首次为一篇论文构建 PageIndex 的耗时；
- **单题检索**：从开始 query rewrite 到检索上下文准备完成的耗时；
- **答案生成**：最终生成调用的耗时；
- **单题端到端**：检索 + 答案生成（不含预先完成的索引）；
- **LLM 请求**：缓存命中/未命中数量与真实网络请求延迟。

## 2. 指标口径（必须按此实现）

所有时长单位为毫秒，字段名以 `Ms` 结尾。分位数采用仓库已有的最近秩法 `percentile(values, p)`。

| 字段 | 测量起止 | 包含 | 不包含 | 用途 |
| --- | --- | --- | --- | --- |
| `runWallClockMs` | `runQaTask` 进入到结果对象构造完成 | 索引、所有题目、指标计算 | CLI 的数据集加载与结果文件写盘 | 这一轮总耗时 |
| `indexBuildLatencyMs` | 每篇论文调用 `buildPageIndex` 前后 | 分块、摘要 LLM 调用、根索引 LLM 调用、缓存读取 | 数据集下载/解析 | 首次索引成本 |
| `queryRewriteLatencyMs` | `runRagPipeline` 中改写调用前后 | 改写 LLM 或缓存读取 | 节点评分 | 改写开销；未执行时为 `0` |
| `retrievalLatencyMs` | RAG 中检索阶段开始到上下文截断完成 | query rewrite、逐论文 `scoreAndSelect`、上下文合并/截断、缓存读取 | 最终答案生成 | 检索路径时延 |
| `answerGenerationLatencyMs` | 最终 `generate(messages)` 前后 | 生成 LLM 或缓存读取 | query rewrite、评分、上下文拼装 | 模型回答开销 |
| `queryEndToEndLatencyMs` | RAG 函数进入到返回前 | 上述检索与答案生成 | 论文索引 | 用户一次提问的热路径耗时 |
| `llmNetworkLatencyP50Ms/P95Ms` | 每个 cache miss 的 HTTP `request()` 前后 | 网络、服务端排队、模型生成 | cache hit、RAG 本地逻辑 | 上游模型服务稳定性 |

### 2.1 冷启动口径

**不要**把一篇论文的 `indexBuildLatencyMs` 平摊进它的每道题：论文问题数不同，会人为扭曲 per-question 指标。

索引时延应单列在 `perPaper` 和聚合 `indexBuildLatencyP50Ms/P95Ms` 中。需要模拟“首次提问”的产品体验时，由报表明确展示：

```text
首次问题成本（估算）= 해당论文 indexBuildLatencyMs + 该题 queryEndToEndLatencyMs
```

而不是把它与热路径 `queryEndToEndLatencyMs` 混成一个均值。

### 2.2 缓存口径

- `retrievalLatencyMs` / `answerGenerationLatencyMs` / `queryEndToEndLatencyMs` 是用户实际等待时间，**包含** cache hit 的读取成本。
- `llmNetworkLatency*` 只使用 cache miss 的真实 HTTP 时长，保持当前 `latencyP50/P95` 的语义。
- 结果必须写入 `cacheHits`、`cacheMisses` 与 `cacheHitRate`。不同 cache mode 或命中率的结果不能直接比较 wall-clock 或端到端时延。
- `--no-cache` 的现有语义为跳过读缓存但仍写缓存；结果元数据的 `cacheMode: 'bypass'` 必须保留。

## 3. 结果 JSON 数据结构

### 3.1 `bench/src/types.ts`

新增以下接口，避免继续向无类型的 `Record<string, number>` 随意塞时延字段：

```ts
export interface PipelineTiming {
  queryRewriteLatencyMs: number
  retrievalLatencyMs: number
  answerGenerationLatencyMs: number
  queryEndToEndLatencyMs: number
}

export interface PaperTimingRecord {
  paperId: string
  source: SampleSource
  pageCount: number
  questionCount: number
  indexBuildLatencyMs?: number
  indexLlmCalls?: number
  indexCacheHits?: number
  indexCacheMisses?: number
  leafCount?: number
  error?: string
}
```

扩展 `PerSampleRecord`，保留现有 `metrics` 以避免质量指标接口破坏，同时添加：

```ts
timing?: PipelineTiming
```

扩展 `BenchResult`：

```ts
meta: {
  // 保留既有字段
  startedAt: string       // ISO 8601，runQaTask 开始时刻
  finishedAt: string      // ISO 8601，结果构造完成时刻
  runWallClockMs: number
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number    // 无请求时为 0，不能 NaN
}
perPaper?: PaperTimingRecord[]
```

在 `metrics` 新增（仅 QA）：

```text
indexBuildLatencyP50Ms, indexBuildLatencyP95Ms
retrievalLatencyP50Ms, retrievalLatencyP95Ms
answerGenerationLatencyP50Ms, answerGenerationLatencyP95Ms
queryEndToEndLatencyP50Ms, queryEndToEndLatencyP95Ms
llmNetworkLatencyP50Ms, llmNetworkLatencyP95Ms
```

兼容策略：保留旧 `latencyP50` / `latencyP95` 一个发布周期，值与 `llmNetworkLatencyP50Ms` / `llmNetworkLatencyP95Ms` 相同；在 `report.ts` 标注为 deprecated。后续删除旧字段时须单独发 breaking-change PR。

## 4. 生产 RAG 的阶段埋点

### 4.1 `src/utils/ragPipeline.ts`

为 `RagResult` 新增必填字段：

```ts
timing: PipelineTiming
```

为可重复的单测，在最后一个参数新增可选依赖；不可塞入 `RagOptions`，因为该接口会被 benchmark config 展开：

```ts
export interface RagPipelineDeps {
  now?: () => number
}

export async function runRagPipeline(
  papers, query, history, llm, generate, systemPrompt, opts = {}, deps: RagPipelineDeps = {},
)
```

施工细节：

1. `const now = deps.now ?? Date.now`，记录 `pipelineStartedAt`。
2. 初始化 `queryRewriteLatencyMs = 0`；仅在真正满足 `enableRewrite && recentHistory.length >= REWRITE_MIN_HISTORY && !skipRetrieval` 时，包裹 `rewriteQuery` 前后计时。
3. 在 `if (!skipRetrieval)` 之前记录 `retrievalStartedAt`。逐论文 `scoreAndSelect` 维持现有串行顺序，禁止为埋点改为并发。
4. 完成 `unboundedContext`、`contextTruncated`、`context` 和 `sources` 后记录 `retrievalFinishedAt`，得到 `retrievalLatencyMs`。若 `externalContext` 跳过检索，此值仍应测量上下文准备成本，通常接近 0。
5. 在 `generate(messages)` 前后记录 `answerGenerationLatencyMs`。
6. 返回前记录 `queryEndToEndLatencyMs = now() - pipelineStartedAt`。正常情况下它应等于 retrieval + generation 加上极小的本地消息组装差异；不要强行以子阶段相加替代总计时。
7. 所有时长经 `Math.max(0, value)` 钳制，以兼容测试注入时钟与系统时间回拨。

不在 `scoreAndSelect` 内部额外暴露 timing：阶段边界应由 pipeline 统一定义，避免 benchmark 和产品各自计时造成口径漂移。

### 4.2 生产调用兼容性

`src/stores/chat.ts` 继续按现有 7 参数调用 `runRagPipeline`；新增的第 8 个参数可选，因此产品回答行为不变。若 UI 未来需要展示耗时，应单独另开改动，不在本计划内。

## 5. Benchmark Runner 埋点

### 5.1 `bench/src/runner/qa.ts`

扩展 `QaTaskArgs`：

```ts
/** 测试注入单调时钟；生产默认 Date.now。 */
now?: () => number
```

在 `runQaTask` 开始处：

```ts
const now = args.now ?? Date.now
const startedAt = new Date().toISOString()
const runStartedMs = now()
const perPaper: PaperTimingRecord[] = []
```

每篇 `sample` 的施工步骤：

1. 在 `buildIndex(...)` 之前获取 `indexClientBefore = client.stats()` 和 `indexStartedMs = now()`。
2. 成功后获取 `indexFinishedMs` 与 `indexClientAfter`，计算差值；计算 leafCount 时沿用现有 root/leaf 兼容逻辑。
3. 立即 append 一条 `PaperTimingRecord`。`questionCount` 为本篇在 `limit` 约束下实际将执行的问题数，而不是原始总数。
4. 索引抛错时，也 append 记录：写 `error`，其余 index 指标不写。现有按题记录 `errors` 的逻辑不变。
5. 每题在调用 pipeline 前记录 `questionStartedMs`；调用时传入 `{ now }`：

```ts
const result = await runPipeline(..., ragOptions(config), { now })
```

6. `PerSampleRecord.timing = result.timing`。另外把 `queryEndToEndLatencyMs` 与阶段值同步写进 `metrics`，让现有 `aggregate(records)` 能产生均值；分位数由第 6 节新函数计算，不能把 P50/P95 误当均值。
7. `questionStartedMs` 只用于防御性断言/诊断：若 `result.timing.queryEndToEndLatencyMs` 缺失或为负，按 `now() - questionStartedMs` 记录并在测试中失败。正常生产代码不得走 fallback。
8. `/judge` 的耗时不属于 retrieval 或 answer generation。若后续需要 judge 性能，另加 `judgeLatencyMs`，本轮不混入 query end-to-end。

在构造 `meta` 前：

```ts
const finishedAt = new Date().toISOString()
const { hits: cacheHits, misses: cacheMisses } = client.stats()
const runWallClockMs = Math.max(0, now() - runStartedMs)
```

填入 `perPaper`、上述 meta 字段和时延分位数。`timestamp` 保持为 `finishedAt`，避免变更结果文件命名逻辑。

### 5.2 失败样本

- pipeline 抛错的题仅进入 `errors`，不应伪造 `PerSampleRecord.timing` 为 0；否则 P50/P95 被失败样本污染。
- 索引失败论文的时长保留在 `perPaper[indexBuildLatencyMs]`，但没有 `leafCount`；其题目不写 query 时延。
- `completed = 0` 时，所有 P50/P95 保持 0，与既有 `percentile([], p) === 0` 契约一致；报告中以 `—` 而非 `0 ms` 展示，防止被误读为极速完成。

## 6. LLM 客户端的网络与缓存观测

### 6.1 `bench/src/llmClient.ts`

保留 `stats()`，其返回值继续为 `{ hits, misses }`。新增但不强制 runner 使用的接口：

```ts
export interface LlmRequestTiming {
  cacheHit: boolean
  elapsedMs: number       // 对 hit：缓存读取；对 miss：完整 HTTP 请求
  networkLatencyMs?: number // 仅 miss 存在
}

interface LlmClient {
  requestTimings(): LlmRequestTiming[]
}
```

在 `chat(messages)` 中：

1. 进入函数先记录 `callStartedMs = Date.now()`。
2. cache hit 时 append `{ cacheHit: true, elapsedMs: Date.now() - callStartedMs }`，然后返回；**不要**把 hit 加进 `latencies()`。
3. cache miss 时维持现有 `started` 包裹 `request(messages)` 的逻辑；成功后 append `{ cacheHit: false, elapsedMs: Date.now() - callStartedMs, networkLatencyMs }`，并继续向 `latencyList` 追加 `networkLatencyMs`。
4. 请求失败不追加成功 latency，但 `misses` 已增加；失败原因仍由 runner 收集。

不要将请求级 telemetry 直接写入结果 JSON：其中包含太多条目且与 cache key 有关联风险。仅在内存中供测试和未来诊断使用；结果只写聚合计数、网络分位数及阶段时延。

## 7. 聚合与报告

### 7.1 `bench/src/metrics/aggregate.ts`

新增通用辅助函数：

```ts
export function withPercentiles(
  metrics: Record<string, number>,
  values: Record<string, number[]>,
): Record<string, number>
```

约定 `values` 的 key 为前缀，例如 `retrievalLatency`，输出 `${key}P50Ms` 和 `${key}P95Ms`。实现必须：

- 过滤非有限数与负数；
- 使用已有 `percentile`；
- 空数组不产生字段，而不是写 `0`；这让报表能显示 `—`。

`withLatencyStats` 迁移为内部兼容包装：输出既有 `latencyP50/P95`，再追加 `llmNetworkLatencyP50Ms/P95Ms`。不要在同一 PR 删除它，现有单测与历史结果读取依赖它。

在 `qa.ts` 中收集数组并调用该函数：

- `perPaper` 成功索引的 `indexBuildLatencyMs`；
- `perSample.timing` 中的 retrieval、generation、end-to-end；
- `client.latencies()` 的网络 LLM 延迟。

### 7.2 `bench/src/report.ts`

在模型/代码版本元数据下新增“耗时与缓存”区块。单个结果与矩阵结果都必须输出，格式如下：

```md
### 耗时与缓存

- 运行区间：2026-... → 2026-...
- 整轮 wall-clock：29m 10s
- 缓存：125 hits / 394 requests（31.7%）

| 配置 | 索引 P50/P95 | 检索 P50/P95 | 生成 P50/P95 | 单题端到端 P50/P95 | LLM 网络 P50/P95 |
| --- | --- | --- | --- | --- | --- |
| default | 3.2s / 8.1s | 0.9s / 3.0s | 3.5s / 9.0s | 4.7s / 11.2s | 3.5s / 9.0s |
```

新增 `fmtDuration(ms)`：`< 1000` 显示 `N ms`，`< 60_000` 显示 `x.xx s`，否则显示 `Xm Ys`。字段缺失或无完成题时渲染 `—`。

`renderComparison` 的通用 metrics 表可以保留时延字段，但在时延字段前加 `↓` 或在表下注释“时延越低越好”；不得沿用质量主指标的“越高越好”逻辑给时延加粗。

## 8. 测试清单

### 8.1 `src/tests/ragPipeline.test.ts`

使用第 4 节的注入 `now()`（返回预设序列）而非真实 sleep，新增断言：

1. 无历史、单叶检索：`queryRewriteLatencyMs === 0`，retrieval、generation、总时长精确符合时钟差。
2. 有历史触发 rewrite：rewrite 时长独立计入，`retrievalLatencyMs` 覆盖 rewrite + 评分 + 上下文处理。
3. `externalContext`：不调用评分，仍返回有限且非负的 retrieval 与总时长。
4. 生成失败：保留抛错行为，不返回伪 timing 结果。

### 8.2 `bench/src/tests/qaRunner.test.ts`

为现有 `runQaTask` fixture 注入 `now()`，新增断言：

1. 成功索引的 `perPaper[0]` 含 page/question 数、index 时长、cache hit/miss 差值和 leafCount。
2. 每个成功 `perSample` 都有四个非负 timing 字段。
3. `metrics` 正确生成 index/retrieval/generation/end-to-end P50/P95。
4. 索引失败只记录 `perPaper.error` 与现有 errors，不能生成题目时延。
5. `meta.startedAt`、`finishedAt`、`runWallClockMs`、缓存计数存在；零请求时 cacheHitRate 为 0。
6. 原有 `latencyP50/P95` 断言继续通过，并新增对应 `llmNetworkLatencyP50Ms/P95Ms` 相等断言。

### 8.3 `bench/src/tests/llmClient.test.ts`

新增：

1. miss 会记录 `cacheHit: false`、有限 `elapsedMs` 与 `networkLatencyMs`；`latencies()` 仍仅包含 miss。
2. 命中同一缓存第二次调用时，记录 `cacheHit: true`，且 `latencies()` 长度不增加。
3. HTTP 失败计入 miss 但不生成成功网络 latency。

### 8.4 `bench/src/tests/aggregate.test.ts` 与 `bench/src/tests/report.test.ts`

- 验证 `withPercentiles` 的 P50/P95、空数组、负数/NaN 过滤。
- 验证 report 的 `ms`、秒、分钟格式以及缺失字段 `—`。
- 验证缓存行、wall-clock 行和时延表存在；旧 JSON（没有新 meta/perPaper）仍可被 `renderReport` 和 `renderComparison` 读取且不抛错。

## 9. 实施顺序与验收

按顺序提交，避免中间结果口径不完整：

1. `ragPipeline.ts` timing 类型与阶段埋点 + 生产单测。
2. `types.ts`、`llmClient.ts` 的缓存/网络 telemetry + 单测。
3. `qa.ts` 的论文/问题/整轮埋点 + runner 单测。
4. `aggregate.ts` 分位数聚合 + 单测。
5. `report.ts` / compare 输出 + 单测。
6. 跑一次小规模 smoke：`npm run bench -- --task qa --dataset smoke --config default --limit 2 --no-cache`，人工检查 JSON 与控制台报表。
7. 跑 `npm run typecheck && npm test`。

最终验收：

- 结果 JSON 可直接回答“整轮多久、索引多久、检索多久、生成多久、单题多久、缓存影响多少”。
- `retrievalLatency*` 不包含最终生成，也不包含 index build；`queryEndToEndLatency*` 包含前两者中的检索和生成。
- 相同模型、相同配置但 cache mode/hit rate 不同的运行，在报告中可被清楚识别，不能被误作性能回归。
- 旧结果 JSON 仍能读取和比较；新结果所有时长单位均为毫秒且字段名明确。
