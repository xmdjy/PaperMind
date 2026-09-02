# PaperMind 评测 Benchmark 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 `bench/` 目录下的 Node CLI 评测套件，量化 PaperMind 论文问答（RAG 检索 + 答案生成）与摘要生成两条链路的性能，并支持配置消融对比。

**Architecture:** 独立 `bench/` 目录以 ESM 运行（`bench/package.json` 声明 `type: module`），通过 `tsx` 直接执行 TypeScript，import `src/utils/*` 复用生产管线代码（`runRagPipeline` / `buildPageIndex` / `summarizeAcademicText`），不引入 Electron 或 better-sqlite3 依赖。所有 LLM 请求走带磁盘缓存的 `llmClient`，使配置矩阵评测不重复计费。纯函数指标模块（retrieval / answerF1 / rouge）各自独立，用 Vitest 测试。

**Tech Stack:** TypeScript 5.4、Node 22、tsx 4、Vitest 4、pdfjs-dist 6（legacy 构建）

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-09-02-benchmark-design.md`，实现不得偏离其指标口径
- **不修改生产 prompt**：`src/utils/ragPipeline.ts` 的 `MATH_FORMAT_INSTRUCTION` 与 system prompt 组装逻辑保持原样。拒答指令属 spec 第 11 节「待验证改进项」，本计划不实现
- **不执行任何 git 操作**（提交、分支、push）——项目 CLAUDE.md 明确禁止未经用户主动要求的 git 操作。每个 Task 以「测试通过」而非「提交」收尾
- TypeScript strict 模式，路径别名 `@/*` → `src/*` 可用
- 交付前必须 `npm test` 与 `npm run typecheck` 全绿（这是项目 CLAUDE.md 的硬要求）
- `bench/` 下所有源文件必须是 ESM（顶层 await 可用）；由 `bench/package.json` 的 `type: module` 保证
- 页码统一 **0-based inclusive**，与 `IndexNode.startPage` / `endPage` 对齐。冒烟集标注文件中人工写的是 1-based，加载时转换
- LLM 凭据只从环境变量读取，禁止读 SQLite `settings` 表
- 已验证事实（无需重新探查）：pdfjs legacy 构建在纯 Node 22 下可抽取文本；`atob` 是 Node 22 全局函数；`standardFontDataUrl` 警告对纯文本抽取无影响，可忽略

---

## 文件结构

| 路径 | 职责 |
|------|------|
| `bench/package.json` | 仅声明 `{"type": "module"}`，使 `bench/` 下 `.ts` 按 ESM 解析 |
| `bench/src/types.ts` | 全部共享类型：数据集样本、配置、指标、结果 JSON |
| `bench/src/llmClient.ts` | 带磁盘缓存的 LLM 客户端；从 env 读凭据；导出 `LLMFn` / `ChatLLMFn` 兼容的调用器 |
| `bench/src/config.ts` | 配置文件加载 + 矩阵笛卡尔积展开 |
| `bench/src/metrics/retrieval.ts` | 检索指标：`evidenceRecall` / `evidenceHitRate` / `contextPrecision` / `mrr` / `contextTokens` |
| `bench/src/metrics/answerF1.ts` | QASPER token-level F1 + 拒答模式匹配 |
| `bench/src/metrics/rouge.ts` | ROUGE-1 / ROUGE-2 / ROUGE-L（F-measure） |
| `bench/src/metrics/judge.ts` | LLM-as-judge（rubric 版本化 + 缓存） |
| `bench/src/metrics/aggregate.ts` | 逐样本指标 → 聚合指标（含 p50/p95、分母剔除） |
| `bench/src/datasets/smoke.ts` | 加载 `bench/datasets/smoke/`：PDF → pages + 标注 |
| `bench/src/datasets/qasper.ts` | 加载归一化后的 `qasper.jsonl` |
| `bench/datasets/qasper/fetch.ts` | 拉取 QASPER dev split 并归一化为伪页格式（一次性脚本） |
| `bench/src/runner/qa.ts` | QA 任务编排：建索引 → `runRagPipeline` → 打分 |
| `bench/src/runner/summary.ts` | 摘要任务编排：pages → `summarizeAcademicText` → ROUGE |
| `bench/src/report.ts` | 结果 JSON → Markdown 表格；`--compare` 差异表 |
| `bench/src/cli.ts` | 参数解析与入口 |
| `bench/src/tests/*.test.ts` | 各纯函数模块的 Vitest 用例 |

**新增 devDependency：** `tsx@^4.23.0`（`npm install --save-dev --ignore-scripts tsx`，用 `--ignore-scripts` 避免触发 `electron-rebuild`）

**新增 npm script：** `"bench": "tsx bench/src/cli.ts"`

**新增 .gitignore 条目：** `bench/cache/`、`bench/results/`、`bench/datasets/qasper/qasper.jsonl`、`bench/datasets/smoke/papers/`

---

## Task 1: bench 骨架与共享类型

**Files:**
- Create: `bench/package.json`
- Create: `bench/src/types.ts`
- Modify: `package.json`（加 `bench` script 与 `tsx` devDependency）
- Modify: `.gitignore`
- Test: `bench/src/tests/skeleton.test.ts`

**Interfaces:**
- Consumes: 无（首个 Task）
- Produces: `bench/src/types.ts` 的全部类型，后续所有 Task 都从这里 import：
  - `EvalSample`、`QaQuestion`、`SummarySample`
  - `BenchConfig`、`ConfigFile`
  - `SampleError`、`BenchResult`、`PerSampleRecord`

- [ ] **Step 1: 创建 `bench/package.json`**

这个文件只有一个作用：让 Node 与 tsx 把 `bench/` 下的 `.ts` 当 ESM 处理，从而支持顶层 await 并能 import pdfjs 的 `.mjs` 构建。根 `package.json` 没有 `"type": "module"`（Electron 主进程需要 CJS），不能在根上改。

```json
{
  "name": "papermind-bench",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 2: 安装 tsx 并加 npm script**

Run:
```bash
npm install --save-dev --ignore-scripts tsx@^4.23.0
```

`--ignore-scripts` 是必需的：项目 `postinstall` 会跑 `electron-rebuild -f -w better-sqlite3`，那是个耗时的原生模块重建，与本 Task 无关。

然后在根 `package.json` 的 `scripts` 中，`"test:ui"` 之后加一行：

```json
    "bench": "tsx bench/src/cli.ts",
```

- [ ] **Step 3: 更新 .gitignore**

在文件末尾追加：

```
# Benchmark 产物
bench/cache/
bench/results/
bench/datasets/qasper/qasper.jsonl
bench/datasets/smoke/papers/
```

数据集 PDF 与 QASPER 原始数据体积大且有版权考虑，只提交 `manifest.json` 描述来源。

- [ ] **Step 4: 写 `bench/src/types.ts`**

```typescript
import type { IndexOptions } from '../../src/utils/pageIndex'
import type { RagOptions } from '../../src/utils/ragPipeline'

/** 单个问答样本。evidencePages 为 0-based inclusive 页号。 */
export interface QaQuestion {
  id: string
  question: string
  /** 参考答案，可有多个（QASPER 多标注者）；unanswerable 样本为空数组 */
  answers: string[]
  evidencePages: number[]
  unanswerable: boolean
}

/** 一篇论文及其挂载的问答/摘要标注。 */
export interface EvalSample {
  paperId: string
  title: string
  /** 逐页文本，0-based。QASPER 为伪页，冒烟集为真实 PDF 页 */
  pages: string[]
  questions: QaQuestion[]
  /** 参考摘要；QASPER 样本可能没有，为 undefined 时跳过摘要任务 */
  referenceAbstract?: string
  /** 数据来源，用于报表中分开统计语义分块指标 */
  source: 'qasper' | 'smoke'
}

/** 一组具体参数取值（矩阵展开后的单点）。 */
export interface BenchConfig extends IndexOptions, RagOptions {
  name: string
}

/** 配置文件形态：matrix 各字段取值数组，展开为笛卡尔积。 */
export interface ConfigFile {
  name: string
  matrix: Record<string, Array<number | boolean>>
}

export interface SampleError {
  sampleId: string
  /** 失败阶段，用于区分「网络问题」与「代码问题」 */
  stage: 'load' | 'index' | 'retrieve' | 'generate' | 'summarize' | 'judge'
  message: string
}

/** 逐样本记录，用于错误分析——聚合分数只说好不好，这里说为什么。 */
export interface PerSampleRecord {
  id: string
  paperId: string
  source: 'qasper' | 'smoke'
  metrics: Record<string, number>
  /** QA 专有 */
  retrievalQuery?: string
  selectedPages?: number[]
  evidencePages?: number[]
  answer?: string
  /** 摘要专有 */
  summary?: string
}

export interface BenchResult {
  task: 'qa' | 'summary'
  config: BenchConfig
  meta: {
    model: string
    judgeModel?: string
    timestamp: string
    gitSha: string
    completed: number
    total: number
    /** unanswerableAccuracy 的判定口径，避免两种口径的数字被混着对比 */
    unanswerableMethod?: 'pattern' | 'judge'
  }
  metrics: Record<string, number>
  perSample: PerSampleRecord[]
  errors: SampleError[]
}
```

- [ ] **Step 5: 写骨架测试**

这个测试的价值不在断言逻辑，而在验证 ESM 配置正确、bench 能 import 生产代码、且 Vitest 能收集 `bench/` 下的用例。如果 `bench/package.json` 缺失或路径写错，这里会立刻炸。

Create `bench/src/tests/skeleton.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

// Node 环境缺 DOMMatrix，pageIndex 顶层会初始化 pdfjs worker
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

describe('bench 骨架', () => {
  it('可以 import 生产管线代码', async () => {
    const { runRagPipeline, MATH_FORMAT_INSTRUCTION } = await import('../../../src/utils/ragPipeline')
    expect(typeof runRagPipeline).toBe('function')
    expect(MATH_FORMAT_INSTRUCTION).toContain('$')
  })

  it('可以 import bench 共享类型模块（编译期存在即通过）', async () => {
    const mod = await import('../types')
    expect(mod).toBeDefined()
  })
})
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/skeleton.test.ts`
Expected: `Test Files 1 passed`、`Tests 2 passed`

若报 `Cannot find module '../../../src/utils/ragPipeline'`，说明相对路径层数错了：`bench/src/tests/` 到项目根是三层。

- [ ] **Step 7: 跑全量测试与类型检查确认没有回归**

Run: `npm test && npm run typecheck`
Expected: 75 passed（原 73 + 本 Task 新增 2）、`typecheck` 无输出

---

## Task 2: 带缓存的 LLM 客户端

**Files:**
- Create: `bench/src/llmClient.ts`
- Test: `bench/src/tests/llmClient.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `createLlmClient(opts?: LlmClientOptions): LlmClient`
  - `interface LlmClient { complete: LLMFn; chat: ChatLLMFn; stats(): { hits: number; misses: number }; latencies(): number[] }`
  - `interface LlmClientOptions { provider?: string; model?: string; apiKey?: string; baseUrl?: string; cacheDir?: string; useCache?: boolean; fetchImpl?: typeof fetch }`
  - `resolveEnvConfig(env: Record<string, string | undefined>): { provider: string; model: string; apiKey: string; baseUrl: string }`

缓存 key 为 `sha256(model + ' ' + JSON.stringify(messages))`。**注意**：spec 第 8 节要求索引构建缓存 key 包含 `IndexOptions`。按 prompt 哈希天然满足——不同 `chunkPages` 会产生不同的分块边界，从而产生不同的 prompt 文本，key 自动不同。因此**不需要**额外的索引级缓存层，这是对 spec 的简化实现，行为等价。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/llmClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlmClient, resolveEnvConfig } from '../llmClient'

let cacheDir: string

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'bench-cache-'))
})
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

function okResponse(content: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

describe('resolveEnvConfig', () => {
  it('从 BENCH_* 环境变量读取配置', () => {
    const cfg = resolveEnvConfig({
      BENCH_LLM_PROVIDER: 'openai',
      BENCH_LLM_MODEL: 'gpt-4o',
      BENCH_LLM_API_KEY: 'sk-test',
      BENCH_LLM_BASE_URL: 'https://example.com/v1',
    })
    expect(cfg).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
    })
  })

  it('缺 model 时抛出可诊断的错误', () => {
    expect(() => resolveEnvConfig({ BENCH_LLM_API_KEY: 'k' })).toThrow(/BENCH_LLM_MODEL/)
  })
})

describe('createLlmClient 缓存', () => {
  it('相同 prompt 第二次命中缓存，不再发请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(await client.complete('hello')).toBe('answer')
    expect(await client.complete('hello')).toBe('answer')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(client.stats()).toEqual({ hits: 1, misses: 1 })
    expect(readdirSync(cacheDir)).toHaveLength(1)
  })

  it('不同 model 不共享缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const base = { provider: 'openai', apiKey: 'k', baseUrl: 'http://x/v1', cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch }

    await createLlmClient({ ...base, model: 'm1' }).complete('hello')
    await createLlmClient({ ...base, model: 'm2' }).complete('hello')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('useCache=false 时绕过缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, useCache: false, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.complete('hello')
    await client.complete('hello')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('HTTP 失败时抛错并带状态码，不写缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'overloaded',
    } as unknown as Response)
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.complete('hello')).rejects.toThrow(/503/)
    expect(readdirSync(cacheDir)).toHaveLength(0)
  })

  it('ollama provider 走 /api/chat 并解析 message.content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message: { content: 'ollama-answer' } }),
    } as unknown as Response)
    const client = createLlmClient({
      provider: 'ollama', model: 'llama3', apiKey: '', baseUrl: 'http://localhost:11434',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(await client.complete('hello')).toBe('ollama-answer')
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
  })

  it('记录每次真实请求的耗时', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.complete('a')
    await client.complete('a') // 命中缓存，不计入延迟

    expect(client.latencies()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/llmClient.test.ts`
Expected: FAIL，报 `Failed to resolve import "../llmClient"`

- [ ] **Step 3: 实现 `bench/src/llmClient.ts`**

```typescript
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatLLMFn, ChatMessage, LLMFn } from '../../src/utils/llm'

export interface LlmClientOptions {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  cacheDir?: string
  useCache?: boolean
  /** 注入 fetch，测试用 */
  fetchImpl?: typeof fetch
}

export interface LlmClient {
  complete: LLMFn
  chat: ChatLLMFn
  stats(): { hits: number; misses: number }
  latencies(): number[]
}

const DEFAULT_CACHE_DIR = new URL('../cache/', import.meta.url).pathname

export function resolveEnvConfig(env: Record<string, string | undefined>) {
  const model = env.BENCH_LLM_MODEL
  if (!model) {
    throw new Error('缺少环境变量 BENCH_LLM_MODEL（例：export BENCH_LLM_MODEL=gpt-4o）')
  }
  const provider = env.BENCH_LLM_PROVIDER ?? 'openai'
  const defaultBase = provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
  return {
    provider,
    model,
    apiKey: env.BENCH_LLM_API_KEY ?? '',
    baseUrl: env.BENCH_LLM_BASE_URL ?? defaultBase,
  }
}

function cacheKey(model: string, messages: ChatMessage[]): string {
  return createHash('sha256').update(`${model} ${JSON.stringify(messages)}`).digest('hex')
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

export function createLlmClient(opts: LlmClientOptions = {}): LlmClient {
  const env = resolveEnvConfigSafe(opts)
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR
  const useCache = opts.useCache !== false
  const doFetch = opts.fetchImpl ?? fetch

  let hits = 0
  let misses = 0
  const latencyList: number[] = []

  if (useCache) mkdirSync(cacheDir, { recursive: true })

  async function chat(messages: ChatMessage[]): Promise<string> {
    const key = cacheKey(env.model, messages)
    const cachePath = join(cacheDir, `${key}.json`)

    if (useCache && existsSync(cachePath)) {
      hits++
      return JSON.parse(readFileSync(cachePath, 'utf-8')).content as string
    }
    misses++

    const started = Date.now()
    const content = await request(messages)
    latencyList.push(Date.now() - started)

    // 只缓存成功响应；失败会在 request 内抛出，走不到这里
    if (useCache) {
      writeFileSync(cachePath, JSON.stringify({ model: env.model, messages, content }, null, 2))
    }
    return content
  }

  async function request(messages: ChatMessage[]): Promise<string> {
    if (env.provider === 'ollama') {
      const res = await doFetch(`${env.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.model, messages, stream: false }),
      })
      if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await readErrorBody(res)}`)
      const data = await res.json()
      return data?.message?.content ?? ''
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (env.provider === 'anthropic') {
      headers['x-api-key'] = env.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${env.apiKey}`
    }

    const res = await doFetch(`${env.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: env.model, messages, temperature: 0 }),
    })
    if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await readErrorBody(res)}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }

  return {
    complete: (prompt: string) => chat([{ role: 'user', content: prompt }]),
    chat,
    stats: () => ({ hits, misses }),
    latencies: () => [...latencyList],
  }
}

/** opts 显式给了 model 就用它，否则回落到环境变量。 */
function resolveEnvConfigSafe(opts: LlmClientOptions) {
  if (opts.model) {
    const provider = opts.provider ?? 'openai'
    const defaultBase = provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
    return {
      provider,
      model: opts.model,
      apiKey: opts.apiKey ?? '',
      baseUrl: opts.baseUrl ?? defaultBase,
    }
  }
  return resolveEnvConfig(process.env)
}
```

**为什么 `temperature: 0`**：评测必须可复现。生产对话用 profile 里的 0.7，但评测固定 0，否则重跑分数会漂移而无法判断改动是否有效。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/llmClient.test.ts`
Expected: `Tests 8 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 83 passed、typecheck 无输出

---

## Task 3: 检索指标

**Files:**
- Create: `bench/src/metrics/retrieval.ts`
- Test: `bench/src/tests/retrieval.test.ts`

**Interfaces:**
- Consumes: `IndexNode` / `NodeScore` from `src/utils/pageIndex`
- Produces:
  - `expandPages(nodes: IndexNode[]): number[]` — 节点页码区间展开为去重升序页号数组
  - `computeRetrievalMetrics(args: RetrievalMetricArgs): RetrievalMetrics`
  - `interface RetrievalMetricArgs { selected: IndexNode[]; leaves: IndexNode[]; scores: NodeScore[]; evidencePages: number[]; context: string; degraded: boolean }`
  - `interface RetrievalMetrics { evidenceRecall: number; evidenceHit: number; contextPrecision: number; mrr: number; contextTokens: number }`

`evidenceHit` 是单样本的 0/1 值，聚合后才成为 spec 里的 `evidenceHitRate`。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/retrieval.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { IndexNode } from '../../../src/utils/pageIndex'
import { expandPages, computeRetrievalMetrics } from '../metrics/retrieval'

function node(id: string, start: number, end: number): IndexNode {
  return { title: `S${id}`, nodeId: id, startPage: start, endPage: end, summary: '', nodes: [] }
}

const leaves = [node('0', 0, 1), node('1', 2, 3), node('2', 4, 5)]

describe('expandPages', () => {
  it('把页码区间展开为去重升序页号', () => {
    expect(expandPages([node('a', 0, 2), node('b', 2, 3)])).toEqual([0, 1, 2, 3])
  })

  it('空输入返回空数组', () => {
    expect(expandPages([])).toEqual([])
  })
})

describe('computeRetrievalMetrics', () => {
  it('全部 evidence 被覆盖时 recall=1、hit=1', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }, { id: 1, score: 2 }, { id: 2, score: 1 }],
      evidencePages: [0, 1],
      context: 'x'.repeat(400),
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(1)
    expect(m.evidenceHit).toBe(1)
    expect(m.contextPrecision).toBe(1)   // 选中 2 页，2 页都是 evidence
    expect(m.mrr).toBe(1)                // evidence 所在节点排在第 1 位
    expect(m.contextTokens).toBe(100)    // 400 字符 / 4
  })

  it('部分覆盖时 recall 为覆盖比例', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }],
      evidencePages: [0, 4],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0.5)
    expect(m.evidenceHit).toBe(1)
    expect(m.contextPrecision).toBe(0.5)  // 选中 2 页，其中 1 页是 evidence
  })

  it('完全捞空时 recall=0、hit=0、precision=0', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }, { id: 2, score: 8 }],
      evidencePages: [4, 5],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0)
    expect(m.evidenceHit).toBe(0)
    expect(m.contextPrecision).toBe(0)
  })

  it('mrr 取 evidence 节点在打分排序中的首个名次倒数', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      // 排序后为 [1(9分), 2(7分), 0(1分)]；evidence 在页 4-5 即节点 2，排第 2 位
      scores: [{ id: 0, score: 1 }, { id: 1, score: 9 }, { id: 2, score: 7 }],
      evidencePages: [4],
      context: '',
      degraded: false,
    })
    expect(m.mrr).toBeCloseTo(0.5)
  })

  it('降级时 mrr 记 0（打分不可用，排序无意义）', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [],
      evidencePages: [0],
      context: '',
      degraded: true,
    })
    expect(m.mrr).toBe(0)
    expect(m.evidenceRecall).toBe(1)  // 降级但恰好命中，recall 照算
  })

  it('evidence 标注为空时 recall/precision 记 0 但不崩', () => {
    const m = computeRetrievalMetrics({
      selected: [leaves[0]],
      leaves,
      scores: [{ id: 0, score: 9 }],
      evidencePages: [],
      context: '',
      degraded: false,
    })
    expect(m.evidenceRecall).toBe(0)
    expect(m.contextPrecision).toBe(0)
    expect(m.mrr).toBe(0)
  })

  it('未选中任何节点时不产生除零', () => {
    const m = computeRetrievalMetrics({
      selected: [],
      leaves,
      scores: [],
      evidencePages: [0],
      context: '',
      degraded: false,
    })
    expect(m.contextPrecision).toBe(0)
    expect(m.evidenceRecall).toBe(0)
    expect(Number.isNaN(m.contextPrecision)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/retrieval.test.ts`
Expected: FAIL，报 `Failed to resolve import "../metrics/retrieval"`

- [ ] **Step 3: 实现 `bench/src/metrics/retrieval.ts`**

```typescript
import type { IndexNode, NodeScore } from '../../../src/utils/pageIndex'

/** 估算 token 数：英文约 4 字符/token，够用作成本代理指标。 */
const CHARS_PER_TOKEN = 4

/** 把节点的页码区间展开为去重升序页号数组（0-based）。 */
export function expandPages(nodes: IndexNode[]): number[] {
  const set = new Set<number>()
  for (const n of nodes) {
    for (let p = n.startPage; p <= n.endPage; p++) set.add(p)
  }
  return [...set].sort((a, b) => a - b)
}

export interface RetrievalMetricArgs {
  /** scoreAndSelect 选中的节点 */
  selected: IndexNode[]
  /** 全部叶节点，用于把 scores 的 id 映射回页码区间 */
  leaves: IndexNode[]
  /** LLM 原始打分；降级时为空 */
  scores: NodeScore[]
  /** 标注的 evidence 页号（0-based） */
  evidencePages: number[]
  /** 合并后的上下文文本，用于估算 token */
  context: string
  degraded: boolean
}

export interface RetrievalMetrics {
  evidenceRecall: number
  /** 单样本 0/1；聚合后成为 evidenceHitRate */
  evidenceHit: number
  contextPrecision: number
  mrr: number
  contextTokens: number
}

export function computeRetrievalMetrics(args: RetrievalMetricArgs): RetrievalMetrics {
  const { selected, leaves, scores, evidencePages, context, degraded } = args

  const selectedPages = expandPages(selected)
  const evidenceSet = new Set(evidencePages)
  const covered = selectedPages.filter(p => evidenceSet.has(p))

  const evidenceRecall = evidencePages.length > 0 ? covered.length / evidencePages.length : 0
  const contextPrecision = selectedPages.length > 0 ? covered.length / selectedPages.length : 0

  return {
    evidenceRecall,
    evidenceHit: covered.length > 0 ? 1 : 0,
    contextPrecision,
    mrr: computeMrr(leaves, scores, evidenceSet, degraded),
    contextTokens: Math.round(context.length / CHARS_PER_TOKEN),
  }
}

/**
 * evidence 页首次出现在打分排序中的名次倒数。
 * 降级（打分不可用）或无 evidence 时记 0——排序本身无意义，不该给分。
 */
function computeMrr(
  leaves: IndexNode[],
  scores: NodeScore[],
  evidenceSet: Set<number>,
  degraded: boolean,
): number {
  if (degraded || scores.length === 0 || evidenceSet.size === 0) return 0

  const ranked = [...scores].sort((a, b) => b.score - a.score)
  for (let rank = 0; rank < ranked.length; rank++) {
    const leaf = leaves[ranked[rank].id]
    if (!leaf) continue
    for (let p = leaf.startPage; p <= leaf.endPage; p++) {
      if (evidenceSet.has(p)) return 1 / (rank + 1)
    }
  }
  return 0
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/retrieval.test.ts`
Expected: `Tests 9 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 92 passed、typecheck 无输出

---

## Task 4: 答案 F1 与拒答判定

**Files:**
- Create: `bench/src/metrics/answerF1.ts`
- Test: `bench/src/tests/answerF1.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `normalizeAnswer(text: string): string`
  - `tokenF1(prediction: string, reference: string): number`
  - `answerF1(prediction: string, references: string[]): number` — 多参考取 max
  - `REFUSAL_PATTERNS: RegExp[]`（导出以便报表打印口径）
  - `REFUSAL_PATTERN_VERSION: string`
  - `isRefusal(text: string): boolean`

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/answerF1.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeAnswer, tokenF1, answerF1, isRefusal } from '../metrics/answerF1'

describe('normalizeAnswer', () => {
  it('小写化、去冠词、去标点、压缩空白', () => {
    expect(normalizeAnswer('The  Answer, is: 8!')).toBe('answer is 8')
  })

  it('只去独立的冠词，不切词内字母', () => {
    // "a" 是冠词要去掉，但 "attention" 里的 a 不能动
    expect(normalizeAnswer('a attention head')).toBe('attention head')
  })

  it('保留中文字符', () => {
    expect(normalizeAnswer('八个注意力头。')).toBe('八个注意力头')
  })
})

describe('tokenF1', () => {
  it('完全一致时为 1', () => {
    expect(tokenF1('8 heads', 'The 8 heads')).toBe(1)
  })

  it('完全不相交时为 0', () => {
    expect(tokenF1('cats', 'dogs')).toBe(0)
  })

  it('部分重叠时按 precision/recall 调和平均', () => {
    // pred: [a,b]，ref: [b,c] → precision 0.5, recall 0.5, F1 0.5
    expect(tokenF1('alpha beta', 'beta gamma')).toBeCloseTo(0.5)
  })

  it('重复 token 按出现次数取最小值计入', () => {
    // pred: [x,x]，ref: [x] → 共同 1 个；precision 0.5, recall 1 → F1 ≈ 0.667
    expect(tokenF1('x x', 'x')).toBeCloseTo(2 / 3)
  })

  it('任一侧为空时为 0，不产生 NaN', () => {
    expect(tokenF1('', 'answer')).toBe(0)
    expect(tokenF1('answer', '')).toBe(0)
    expect(Number.isNaN(tokenF1('', ''))).toBe(false)
  })
})

describe('answerF1', () => {
  it('多参考答案取最高分', () => {
    expect(answerF1('eight heads', ['8', 'eight heads'])).toBe(1)
  })

  it('参考答案为空数组时为 0', () => {
    expect(answerF1('anything', [])).toBe(0)
  })
})

describe('isRefusal', () => {
  it('识别中文拒答表述', () => {
    expect(isRefusal('抱歉，参考内容中没有提到这一点。')).toBe(true)
    expect(isRefusal('根据提供的上下文无法回答该问题')).toBe(true)
  })

  it('识别英文拒答表述', () => {
    expect(isRefusal('The paper does not mention this.')).toBe(true)
    expect(isRefusal("I cannot answer based on the given context.")).toBe(true)
  })

  it('正常作答不算拒答', () => {
    expect(isRefusal('论文中使用了 8 个注意力头。')).toBe(false)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/answerF1.test.ts`
Expected: FAIL，报 `Failed to resolve import "../metrics/answerF1"`

- [ ] **Step 3: 实现 `bench/src/metrics/answerF1.ts`**

```typescript
/**
 * QASPER 官方口径的答案归一化：小写、去冠词、去标点、压缩空白。
 * 保留中日韩字符——PaperMind 的回答常为中文。
 */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')       // 去标点，保留各语言字母与数字
    .replace(/\b(a|an|the)\b/g, ' ')          // 只去独立冠词
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  const normalized = normalizeAnswer(text)
  return normalized ? normalized.split(' ') : []
}

/** 单参考的 token 级 F1，重复 token 按出现次数取 min 计入共同数。 */
export function tokenF1(prediction: string, reference: string): number {
  const pred = tokenize(prediction)
  const ref = tokenize(reference)
  if (pred.length === 0 || ref.length === 0) return 0

  const refCount = new Map<string, number>()
  for (const t of ref) refCount.set(t, (refCount.get(t) ?? 0) + 1)

  let common = 0
  for (const t of pred) {
    const left = refCount.get(t) ?? 0
    if (left > 0) {
      common++
      refCount.set(t, left - 1)
    }
  }
  if (common === 0) return 0

  const precision = common / pred.length
  const recall = common / ref.length
  return (2 * precision * recall) / (precision + recall)
}

/** 多参考答案取最高 F1（QASPER 有多标注者）。 */
export function answerF1(prediction: string, references: string[]): number {
  if (references.length === 0) return 0
  return Math.max(...references.map(ref => tokenF1(prediction, ref)))
}

/**
 * 拒答模式表。改动此表必须同步 bump 版本号——报表会打印版本，
 * 否则跨版本的 unanswerableAccuracy 数字无法对比。
 */
export const REFUSAL_PATTERN_VERSION = 'v1'

export const REFUSAL_PATTERNS: RegExp[] = [
  /无法回答/,
  /没有(提到|提及|说明|给出)/,
  /(未|没有).{0,6}(涉及|涵盖)/,
  /(参考内容|上下文|文中|论文中).{0,10}(没有|未|不包含)/,
  /信息不足/,
  /\b(does|do|did)\s+not\s+(mention|specify|state|discuss|provide)\b/i,
  /\b(cannot|can't|unable to)\s+(answer|determine|find)\b/i,
  /\bnot\s+(mentioned|specified|stated|provided)\b/i,
  /\bno\s+information\b/i,
  /\binsufficient\s+(context|information)\b/i,
]

export function isRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some(p => p.test(text))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/answerF1.test.ts`
Expected: `Tests 13 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 105 passed、typecheck 无输出

---

## Task 5: ROUGE 指标

**Files:**
- Create: `bench/src/metrics/rouge.ts`
- Test: `bench/src/tests/rouge.test.ts`

**Interfaces:**
- Consumes: `normalizeAnswer` from `bench/src/metrics/answerF1`
- Produces:
  - `rougeN(prediction: string, reference: string, n: number): number`
  - `rougeL(prediction: string, reference: string): number`
  - `computeSummaryMetrics(summary: string, reference: string, sourceLength: number): SummaryMetrics`
  - `interface SummaryMetrics { rouge1: number; rouge2: number; rougeL: number; compressionRatio: number; empty: number }`

`empty` 是单样本 0/1，聚合后成为 spec 的 `emptyRate`。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/rouge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { rougeN, rougeL, computeSummaryMetrics } from '../metrics/rouge'

describe('rougeN', () => {
  it('完全一致时 ROUGE-1 为 1', () => {
    expect(rougeN('the cat sat', 'the cat sat', 1)).toBe(1)
  })

  it('无重叠时为 0', () => {
    expect(rougeN('alpha beta', 'gamma delta', 1)).toBe(0)
  })

  it('ROUGE-2 用 bigram：词都在但顺序不同时为 0', () => {
    expect(rougeN('cat the', 'the cat', 1)).toBe(1)   // unigram 全中
    expect(rougeN('cat the', 'the cat', 2)).toBe(0)   // bigram 不匹配
  })

  it('文本短于 n 时为 0，不产生 NaN', () => {
    expect(rougeN('cat', 'cat', 2)).toBe(0)
    expect(Number.isNaN(rougeN('cat', 'cat', 2))).toBe(false)
  })

  it('任一侧为空时为 0', () => {
    expect(rougeN('', 'the cat', 1)).toBe(0)
    expect(rougeN('the cat', '', 1)).toBe(0)
  })
})

describe('rougeL', () => {
  it('完全一致时为 1', () => {
    expect(rougeL('the cat sat on the mat', 'the cat sat on the mat')).toBe(1)
  })

  it('按最长公共子序列计算，允许跳词', () => {
    // pred: [a,b,c,d]，ref: [a,c,d] → LCS = [a,c,d] 长 3
    // precision 3/4, recall 3/3 → F1 ≈ 0.857
    expect(rougeL('alpha beta gamma delta', 'alpha gamma delta')).toBeCloseTo(6 / 7)
  })

  it('无重叠时为 0', () => {
    expect(rougeL('alpha beta', 'gamma delta')).toBe(0)
  })

  it('任一侧为空时为 0', () => {
    expect(rougeL('', 'the cat')).toBe(0)
  })
})

describe('computeSummaryMetrics', () => {
  it('正常摘要给出三个 ROUGE 与压缩比，empty=0', () => {
    const m = computeSummaryMetrics('the cat sat', 'the cat sat', 100)
    expect(m.rouge1).toBe(1)
    expect(m.rougeL).toBe(1)
    expect(m.compressionRatio).toBeCloseTo(11 / 100)
    expect(m.empty).toBe(0)
  })

  it('摘要为空或纯空白时 empty=1，ROUGE 全 0', () => {
    const m = computeSummaryMetrics('   ', 'the cat sat', 100)
    expect(m.empty).toBe(1)
    expect(m.rouge1).toBe(0)
    expect(m.rouge2).toBe(0)
    expect(m.rougeL).toBe(0)
  })

  it('原文长度为 0 时压缩比记 0，不产生除零', () => {
    const m = computeSummaryMetrics('abc', 'abc', 0)
    expect(m.compressionRatio).toBe(0)
    expect(Number.isFinite(m.compressionRatio)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/rouge.test.ts`
Expected: FAIL，报 `Failed to resolve import "../metrics/rouge"`

- [ ] **Step 3: 实现 `bench/src/metrics/rouge.ts`**

```typescript
import { normalizeAnswer } from './answerF1'

function tokens(text: string): string[] {
  const normalized = normalizeAnswer(text)
  return normalized ? normalized.split(' ') : []
}

function ngrams(list: string[], n: number): string[] {
  if (list.length < n) return []
  const out: string[] = []
  for (let i = 0; i + n <= list.length; i++) out.push(list.slice(i, i + n).join(' '))
  return out
}

function f1(common: number, predLen: number, refLen: number): number {
  if (common === 0 || predLen === 0 || refLen === 0) return 0
  const precision = common / predLen
  const recall = common / refLen
  return (2 * precision * recall) / (precision + recall)
}

/** ROUGE-N F-measure：n-gram 重叠，重复按出现次数取 min。 */
export function rougeN(prediction: string, reference: string, n: number): number {
  const pred = ngrams(tokens(prediction), n)
  const ref = ngrams(tokens(reference), n)
  if (pred.length === 0 || ref.length === 0) return 0

  const refCount = new Map<string, number>()
  for (const g of ref) refCount.set(g, (refCount.get(g) ?? 0) + 1)

  let common = 0
  for (const g of pred) {
    const left = refCount.get(g) ?? 0
    if (left > 0) {
      common++
      refCount.set(g, left - 1)
    }
  }
  return f1(common, pred.length, ref.length)
}

/** ROUGE-L F-measure：基于最长公共子序列。 */
export function rougeL(prediction: string, reference: string): number {
  const pred = tokens(prediction)
  const ref = tokens(reference)
  if (pred.length === 0 || ref.length === 0) return 0

  // 滚动数组的 LCS，空间 O(min(m,n))
  let prev = new Array<number>(ref.length + 1).fill(0)
  let curr = new Array<number>(ref.length + 1).fill(0)
  for (let i = 1; i <= pred.length; i++) {
    for (let j = 1; j <= ref.length; j++) {
      curr[j] = pred[i - 1] === ref[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1])
    }
    ;[prev, curr] = [curr, prev]
    curr.fill(0)
  }
  return f1(prev[ref.length], pred.length, ref.length)
}

export interface SummaryMetrics {
  rouge1: number
  rouge2: number
  rougeL: number
  compressionRatio: number
  /** 单样本 0/1；聚合后成为 emptyRate */
  empty: number
}

/**
 * 摘要为空时显式标记 empty 并把 ROUGE 记 0。
 * HF 社区端点不稳，不区分「模型差」与「端点挂」会导致误判。
 */
export function computeSummaryMetrics(
  summary: string,
  reference: string,
  sourceLength: number,
): SummaryMetrics {
  const isEmpty = summary.trim().length === 0
  return {
    rouge1: isEmpty ? 0 : rougeN(summary, reference, 1),
    rouge2: isEmpty ? 0 : rougeN(summary, reference, 2),
    rougeL: isEmpty ? 0 : rougeL(summary, reference),
    compressionRatio: sourceLength > 0 ? summary.length / sourceLength : 0,
    empty: isEmpty ? 1 : 0,
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/rouge.test.ts`
Expected: `Tests 12 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 117 passed、typecheck 无输出

---

## Task 6: 指标聚合

**Files:**
- Create: `bench/src/metrics/aggregate.ts`
- Test: `bench/src/tests/aggregate.test.ts`

**Interfaces:**
- Consumes: `PerSampleRecord` from `bench/src/types`
- Produces:
  - `mean(values: number[]): number`
  - `percentile(values: number[], p: number): number`
  - `aggregate(records: PerSampleRecord[]): Record<string, number>` — 对每个指标名求均值，`*Hit` / `*empty` 等 0/1 指标自动得到比率
  - `withLatencyStats(metrics: Record<string, number>, latencies: number[]): Record<string, number>`

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/aggregate.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { PerSampleRecord } from '../types'
import { mean, percentile, aggregate, withLatencyStats } from '../metrics/aggregate'

function rec(id: string, metrics: Record<string, number>): PerSampleRecord {
  return { id, paperId: 'p', source: 'qasper', metrics }
}

describe('mean', () => {
  it('求算术平均', () => {
    expect(mean([1, 2, 3])).toBe(2)
  })
  it('空数组返回 0，不产生 NaN', () => {
    expect(mean([])).toBe(0)
  })
})

describe('percentile', () => {
  it('p50 取中位数', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30)
  })
  it('p95 取靠尾部的值', () => {
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100)
  })
  it('空数组返回 0', () => {
    expect(percentile([], 50)).toBe(0)
  })
  it('乱序输入先排序', () => {
    expect(percentile([50, 10, 30], 50)).toBe(30)
  })
})

describe('aggregate', () => {
  it('对每个指标名分别求均值', () => {
    const out = aggregate([
      rec('a', { evidenceRecall: 1, answerF1: 0.5 }),
      rec('b', { evidenceRecall: 0, answerF1: 0.1 }),
    ])
    expect(out.evidenceRecall).toBe(0.5)
    expect(out.answerF1).toBeCloseTo(0.3)
  })

  it('0/1 指标求均值即得比率', () => {
    const out = aggregate([
      rec('a', { evidenceHit: 1 }),
      rec('b', { evidenceHit: 0 }),
      rec('c', { evidenceHit: 1 }),
    ])
    expect(out.evidenceHit).toBeCloseTo(2 / 3)
  })

  it('某样本缺某指标时只在有该指标的样本上求均值', () => {
    // 失败样本不写指标，从分母中剔除——否则超时会被误读为质量下降
    const out = aggregate([
      rec('a', { answerF1: 1 }),
      rec('b', {}),
    ])
    expect(out.answerF1).toBe(1)
  })

  it('空输入返回空对象', () => {
    expect(aggregate([])).toEqual({})
  })
})

describe('withLatencyStats', () => {
  it('把延迟分位数并入指标', () => {
    const out = withLatencyStats({ answerF1: 0.5 }, [100, 200, 300])
    expect(out.answerF1).toBe(0.5)
    expect(out.latencyP50).toBe(200)
    expect(out.latencyP95).toBe(300)
  })

  it('无延迟数据时分位数为 0', () => {
    const out = withLatencyStats({}, [])
    expect(out.latencyP50).toBe(0)
    expect(out.latencyP95).toBe(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/aggregate.test.ts`
Expected: FAIL，报 `Failed to resolve import "../metrics/aggregate"`

- [ ] **Step 3: 实现 `bench/src/metrics/aggregate.ts`**

```typescript
import type { PerSampleRecord } from '../types'

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** 最近秩法分位数：排序后取 ceil(p/100 * n) - 1 位。 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

/**
 * 逐样本指标 → 聚合均值。
 * 只在「拥有该指标」的样本上求均值：失败样本不写指标，
 * 从而自动从分母中剔除，不会把网络超时误算成质量下降。
 */
export function aggregate(records: PerSampleRecord[]): Record<string, number> {
  const buckets = new Map<string, number[]>()
  for (const r of records) {
    for (const [key, value] of Object.entries(r.metrics)) {
      if (!Number.isFinite(value)) continue
      const list = buckets.get(key) ?? []
      list.push(value)
      buckets.set(key, list)
    }
  }
  const out: Record<string, number> = {}
  for (const [key, values] of buckets) out[key] = mean(values)
  return out
}

export function withLatencyStats(
  metrics: Record<string, number>,
  latencies: number[],
): Record<string, number> {
  return {
    ...metrics,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/aggregate.test.ts`
Expected: `Tests 11 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 128 passed、typecheck 无输出

---

## Task 7: 配置加载与矩阵展开

**Files:**
- Create: `bench/src/config.ts`
- Create: `bench/configs/default.json`
- Create: `bench/configs/ablation-topk.json`
- Test: `bench/src/tests/config.test.ts`

**Interfaces:**
- Consumes: `BenchConfig` / `ConfigFile` from `bench/src/types`
- Produces:
  - `expandMatrix(file: ConfigFile): BenchConfig[]`
  - `loadConfigs(nameOrPath: string, configDir?: string): Promise<BenchConfig[]>`
  - `configLabel(config: BenchConfig): string` — 用于报表行标签与结果文件名

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandMatrix, loadConfigs, configLabel } from '../config'

describe('expandMatrix', () => {
  it('单点矩阵展开为一个配置', () => {
    const out = expandMatrix({ name: 'default', matrix: { topK: [2], minScore: [4] } })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ name: 'default', topK: 2, minScore: 4 })
  })

  it('多值字段展开为笛卡尔积', () => {
    const out = expandMatrix({ name: 'ab', matrix: { topK: [1, 2, 3], minScore: [4, 6] } })
    expect(out).toHaveLength(6)
    expect(out.map(c => `${c.topK}/${c.minScore}`)).toEqual([
      '1/4', '1/6', '2/4', '2/6', '3/4', '3/6',
    ])
  })

  it('展开出的每个配置带唯一 name', () => {
    const out = expandMatrix({ name: 'ab', matrix: { topK: [1, 2] } })
    expect(new Set(out.map(c => c.name)).size).toBe(2)
    expect(out[0].name).toContain('ab')
  })

  it('布尔字段正常展开', () => {
    const out = expandMatrix({ name: 'chunk', matrix: { forceFixedChunk: [true, false] } })
    expect(out.map(c => c.forceFixedChunk)).toEqual([true, false])
  })

  it('空矩阵返回单个仅含 name 的配置', () => {
    const out = expandMatrix({ name: 'bare', matrix: {} })
    expect(out).toEqual([{ name: 'bare' }])
  })
})

describe('loadConfigs', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bench-cfg-'))
    writeFileSync(join(dir, 'mine.json'), JSON.stringify({ name: 'mine', matrix: { topK: [1, 2] } }))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('按名称从配置目录加载', async () => {
    const out = await loadConfigs('mine', dir)
    expect(out).toHaveLength(2)
  })

  it('按完整路径加载', async () => {
    const out = await loadConfigs(join(dir, 'mine.json'), dir)
    expect(out).toHaveLength(2)
  })

  it('文件不存在时抛出带路径的错误', async () => {
    await expect(loadConfigs('nope', dir)).rejects.toThrow(/nope/)
  })
})

describe('configLabel', () => {
  it('生成可读且可用作文件名的标签', () => {
    const label = configLabel({ name: 'ab', topK: 2, minScore: 4 })
    expect(label).toMatch(/^[\w.-]+$/)
    expect(label).toContain('ab')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/config.test.ts`
Expected: FAIL，报 `Failed to resolve import "../config"`

- [ ] **Step 3: 实现 `bench/src/config.ts`**

```typescript
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BenchConfig, ConfigFile } from './types'

const DEFAULT_CONFIG_DIR = new URL('../configs/', import.meta.url).pathname

/** 矩阵字段取值展开为笛卡尔积，每个组合一个 BenchConfig。 */
export function expandMatrix(file: ConfigFile): BenchConfig[] {
  const keys = Object.keys(file.matrix)
  if (keys.length === 0) return [{ name: file.name }]

  let combos: Array<Record<string, number | boolean>> = [{}]
  for (const key of keys) {
    const values = file.matrix[key]
    combos = combos.flatMap(combo => values.map(v => ({ ...combo, [key]: v })))
  }

  const single = combos.length === 1
  return combos.map(combo => ({
    ...combo,
    name: single ? file.name : `${file.name}[${describeCombo(combo)}]`,
  })) as BenchConfig[]
}

function describeCombo(combo: Record<string, number | boolean>): string {
  return Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(',')
}

export async function loadConfigs(
  nameOrPath: string,
  configDir: string = DEFAULT_CONFIG_DIR,
): Promise<BenchConfig[]> {
  const path = nameOrPath.endsWith('.json') || isAbsolute(nameOrPath)
    ? nameOrPath
    : join(configDir, `${nameOrPath}.json`)

  if (!existsSync(path)) {
    throw new Error(`配置文件不存在：${path}（--config 接受配置名或 .json 路径）`)
  }
  const file = JSON.parse(await readFile(path, 'utf-8')) as ConfigFile
  return expandMatrix(file)
}

/** 报表行标签与结果文件名用；剔除文件名非法字符。 */
export function configLabel(config: BenchConfig): string {
  return config.name.replace(/[^\w.=,[\]-]/g, '_').replace(/[[\],=]/g, '.')
}
```

- [ ] **Step 4: 创建两个配置文件**

`bench/configs/default.json` —— 当前生产默认值，作为基线：

```json
{
  "name": "default",
  "matrix": {
    "topK": [2],
    "minScore": [4],
    "chunkPages": [5],
    "minSectionPages": [2],
    "forceFixedChunk": [false],
    "enableRewrite": [true]
  }
}
```

`bench/configs/ablation-topk.json` —— 回答「topK 该不该是 2」：

```json
{
  "name": "ablation-topk",
  "matrix": {
    "topK": [1, 2, 3],
    "minScore": [4],
    "chunkPages": [5],
    "minSectionPages": [2],
    "forceFixedChunk": [false],
    "enableRewrite": [true]
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/config.test.ts`
Expected: `Tests 9 passed`

- [ ] **Step 6: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 137 passed、typecheck 无输出

---

## Task 8: 冒烟集数据加载

**Files:**
- Create: `bench/src/datasets/smoke.ts`
- Create: `bench/datasets/smoke/manifest.json`
- Create: `bench/datasets/smoke/annotations.json`
- Create: `bench/datasets/smoke/README.md`
- Test: `bench/src/tests/smoke.test.ts`

**Interfaces:**
- Consumes: `EvalSample` / `QaQuestion` from `bench/src/types`；`extractPages` from `src/utils/pageIndex`
- Produces:
  - `interface SmokeAnnotation { file: string; title?: string; referenceAbstract?: string; questions: Array<{ q: string; answer: string; evidencePages: number[] }> }`
  - `loadSmokeDataset(dir?: string, deps?: { extract?: (b64: string) => Promise<string[]> }): Promise<EvalSample[]>`

标注文件里 `evidencePages` 是人工写的 **1-based**，加载时减 1 转 0-based。这是最容易出错的地方，测试必须覆盖。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/smoke.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

const { loadSmokeDataset } = await import('../datasets/smoke')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-smoke-'))
  mkdirSync(join(dir, 'papers'), { recursive: true })
  writeFileSync(join(dir, 'papers', 'a.pdf'), 'fake-pdf-bytes')
  writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
    {
      file: 'a.pdf',
      title: 'Paper A',
      referenceAbstract: 'ref abstract',
      questions: [{ q: '几个头？', answer: '8', evidencePages: [4] }],
    },
  ]))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const extract = async () => ['p1', 'p2', 'p3', 'p4', 'p5']

describe('loadSmokeDataset', () => {
  it('加载 PDF 并挂上标注', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples).toHaveLength(1)
    expect(samples[0].title).toBe('Paper A')
    expect(samples[0].pages).toHaveLength(5)
    expect(samples[0].source).toBe('smoke')
    expect(samples[0].referenceAbstract).toBe('ref abstract')
  })

  it('把标注的 1-based 页码转为 0-based', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].evidencePages).toEqual([3])
  })

  it('冒烟集问题一律 unanswerable=false 且 answers 为单元素', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].unanswerable).toBe(false)
    expect(samples[0].questions[0].answers).toEqual(['8'])
  })

  it('问题 id 由 paperId 与序号组成，保证全局唯一', async () => {
    const samples = await loadSmokeDataset(dir, { extract })
    expect(samples[0].questions[0].id).toBe('a.pdf#0')
  })

  it('标注引用的 PDF 缺失时抛出带文件名的错误', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: 'missing.pdf', questions: [] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/missing\.pdf/)
  })

  it('annotations.json 不存在时抛出可诊断的错误', async () => {
    rmSync(join(dir, 'annotations.json'))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/annotations\.json/)
  })

  it('页码超出实际页数时抛错，避免静默算成漏检', async () => {
    writeFileSync(join(dir, 'annotations.json'), JSON.stringify([
      { file: 'a.pdf', questions: [{ q: 'x', answer: 'y', evidencePages: [99] }] },
    ]))
    await expect(loadSmokeDataset(dir, { extract })).rejects.toThrow(/99/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/smoke.test.ts`
Expected: FAIL，报 `Failed to resolve import "../datasets/smoke"`

- [ ] **Step 3: 实现 `bench/src/datasets/smoke.ts`**

```typescript
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { extractPages } from '../../../src/utils/pageIndex'
import type { EvalSample, QaQuestion } from '../types'

const DEFAULT_DIR = new URL('../../datasets/smoke/', import.meta.url).pathname

export interface SmokeAnnotation {
  file: string
  title?: string
  referenceAbstract?: string
  /** evidencePages 为人工标注的 1-based 页码 */
  questions: Array<{ q: string; answer: string; evidencePages: number[] }>
}

export interface SmokeDeps {
  extract?: (base64: string) => Promise<string[]>
}

export async function loadSmokeDataset(
  dir: string = DEFAULT_DIR,
  deps: SmokeDeps = {},
): Promise<EvalSample[]> {
  const extract = deps.extract ?? extractPages
  const annotationsPath = join(dir, 'annotations.json')

  if (!existsSync(annotationsPath)) {
    throw new Error(
      `冒烟集标注文件不存在：${annotationsPath}。` +
      `请参考 bench/datasets/smoke/README.md 准备 PDF 与标注。`,
    )
  }
  const annotations = JSON.parse(await readFile(annotationsPath, 'utf-8')) as SmokeAnnotation[]

  const samples: EvalSample[] = []
  for (const ann of annotations) {
    const pdfPath = join(dir, 'papers', ann.file)
    if (!existsSync(pdfPath)) {
      throw new Error(`标注引用的 PDF 不存在：${ann.file}（期望位于 ${join(dir, 'papers')}）`)
    }
    const base64 = (await readFile(pdfPath)).toString('base64')
    const pages = await extract(base64)

    const questions: QaQuestion[] = ann.questions.map((q, i) => {
      const evidencePages = q.evidencePages.map(p => p - 1)  // 1-based → 0-based
      for (const p of evidencePages) {
        if (p < 0 || p >= pages.length) {
          throw new Error(
            `${ann.file} 第 ${i + 1} 问的 evidencePages 含越界页码 ${p + 1}` +
            `（该 PDF 共 ${pages.length} 页）`,
          )
        }
      }
      return {
        id: `${ann.file}#${i}`,
        question: q.q,
        answers: [q.answer],
        evidencePages,
        unanswerable: false,
      }
    })

    samples.push({
      paperId: ann.file,
      title: ann.title ?? ann.file,
      pages,
      questions,
      referenceAbstract: ann.referenceAbstract,
      source: 'smoke',
    })
  }
  return samples
}
```

**为什么越界页码要抛错而不是忽略**：标注笔误会让 `evidenceRecall` 无声地变成 0，被误读为检索质量差。宁可让评测跑不起来，也不要让它给出错误的数字。

- [ ] **Step 4: 创建冒烟集占位文件与说明**

`bench/datasets/smoke/annotations.json` —— 空数组占位，避免加载器在没准备数据时抛错误导人的异常：

```json
[]
```

`bench/datasets/smoke/manifest.json` —— PDF 不入 git，用 manifest 记录来源供他人复现：

```json
{
  "note": "PDF 文件不纳入版本管理（体积与版权）。按下表自行下载至 papers/ 目录。",
  "papers": []
}
```

`bench/datasets/smoke/README.md`:

```markdown
# 冒烟集准备指南

冒烟集用真实 PDF 验证端到端链路，覆盖 QASPER 伪页无法暴露的问题：PDF 文本抽取质量、
`detectSectionBoundaries` 的节标题识别命中率、真实排版下的分块效果。

## 步骤

1. 挑 5–10 篇论文 PDF，放入 `papers/`（该目录已 git-ignored）
2. 在 `manifest.json` 的 `papers` 数组中登记每篇的 `file` / `title` / `url`，供他人复现
3. 在 `annotations.json` 中为每篇写 3–5 个问题：

```json
[
  {
    "file": "attention.pdf",
    "title": "Attention Is All You Need",
    "referenceAbstract": "论文的原始 abstract 原文",
    "questions": [
      { "q": "多头注意力用了几个头？", "answer": "8", "evidencePages": [4] }
    ]
  }
]
```

## 标注约定

- `evidencePages` 写 **1-based 页码**（就是 PDF 阅读器上显示的页码），加载时自动转 0-based
- `answer` 尽量简短（词或短语），因为 `answerF1` 是 token 级 F1，长句参考答案会稀释分数
- `referenceAbstract` 直接抄论文原文 abstract，作为摘要任务的参考
- 页码写错会让评测直接报错而非静默给 0 分——这是故意的
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/smoke.test.ts`
Expected: `Tests 7 passed`

- [ ] **Step 6: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 144 passed、typecheck 无输出

---

## Task 9: QASPER 数据集拉取与加载

**Files:**
- Create: `bench/datasets/qasper/fetch.ts`
- Create: `bench/src/datasets/qasper.ts`
- Test: `bench/src/tests/qasper.test.ts`

**Interfaces:**
- Consumes: `EvalSample` / `QaQuestion` from `bench/src/types`
- Produces:
  - `PSEUDO_PAGE_CHARS = 3000`
  - `paragraphsToPages(paragraphs: string[]): { pages: string[]; paragraphToPage: number[] }`
  - `normalizeQasperEntry(paperId: string, entry: QasperEntry): EvalSample`
  - `loadQasperDataset(path?: string): Promise<EvalSample[]>`

QASPER 原始结构（HuggingFace `allenai/qasper`）中，每篇论文有 `full_text.paragraphs`（按 section 分组的段落数组），每个问题的 `answers[].answer.evidence` 是段落原文字符串。归一化要把 evidence 字符串反查回段落下标，再映射到伪页。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/qasper.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { paragraphsToPages, normalizeQasperEntry, PSEUDO_PAGE_CHARS } from '../datasets/qasper'

describe('paragraphsToPages', () => {
  it('段落按字符数聚成伪页，并记录段落到页的映射', () => {
    const long = 'x'.repeat(PSEUDO_PAGE_CHARS)
    const { pages, paragraphToPage } = paragraphsToPages([long, long, 'short'])
    expect(pages).toHaveLength(3)
    expect(paragraphToPage).toEqual([0, 1, 2])
  })

  it('短段落合并进同一伪页', () => {
    const { pages, paragraphToPage } = paragraphsToPages(['a', 'b', 'c'])
    expect(pages).toHaveLength(1)
    expect(paragraphToPage).toEqual([0, 0, 0])
  })

  it('空段落数组产出空页列表', () => {
    const { pages, paragraphToPage } = paragraphsToPages([])
    expect(pages).toEqual([])
    expect(paragraphToPage).toEqual([])
  })

  it('单个超长段落独占一页，不被切断', () => {
    const huge = 'y'.repeat(PSEUDO_PAGE_CHARS * 3)
    const { pages } = paragraphsToPages([huge])
    expect(pages).toHaveLength(1)
    expect(pages[0].length).toBe(huge.length)
  })
})

describe('normalizeQasperEntry', () => {
  const entry = {
    title: 'Test Paper',
    abstract: 'the abstract',
    full_text: {
      section_name: ['Intro', 'Methods'],
      paragraphs: [['intro para one', 'intro para two'], ['methods para']],
    },
    qas: {
      question: ['Q1?', 'Q2?'],
      answers: [
        [{ answer: { free_form_answer: 'A1', extractive_spans: [], unanswerable: false, evidence: ['methods para'] } }],
        [{ answer: { free_form_answer: '', extractive_spans: [], unanswerable: true, evidence: [] } }],
      ],
    },
  }

  it('产出 EvalSample，source 为 qasper', () => {
    const s = normalizeQasperEntry('1234.5678', entry)
    expect(s.paperId).toBe('1234.5678')
    expect(s.title).toBe('Test Paper')
    expect(s.source).toBe('qasper')
    expect(s.referenceAbstract).toBe('the abstract')
  })

  it('把 evidence 原文反查回段落并映射到伪页', () => {
    const s = normalizeQasperEntry('p', entry)
    // 三个段落都很短，全在伪页 0
    expect(s.questions[0].evidencePages).toEqual([0])
  })

  it('保留 unanswerable 标签，且该问题 answers 为空', () => {
    const s = normalizeQasperEntry('p', entry)
    expect(s.questions[1].unanswerable).toBe(true)
    expect(s.questions[1].answers).toEqual([])
  })

  it('free_form_answer 与 extractive_spans 都收作参考答案', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'eight', extractive_spans: ['8 heads'], unanswerable: false, evidence: [] } },
        ]],
      },
    })
    expect(s.questions[0].answers).toEqual(['eight', '8 heads'])
  })

  it('多标注者的答案合并为多参考', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'eight', extractive_spans: [], unanswerable: false, evidence: [] } },
          { answer: { free_form_answer: '8', extractive_spans: [], unanswerable: false, evidence: [] } },
        ]],
      },
    })
    expect(s.questions[0].answers).toEqual(['eight', '8'])
  })

  it('evidence 匹配不上任何段落时该问题 evidencePages 为空', () => {
    const s = normalizeQasperEntry('p', {
      ...entry,
      qas: {
        question: ['Q?'],
        answers: [[
          { answer: { free_form_answer: 'x', extractive_spans: [], unanswerable: false, evidence: ['不存在的段落'] } },
        ]],
      },
    })
    expect(s.questions[0].evidencePages).toEqual([])
  })

  it('问题 id 由 paperId 与序号组成', () => {
    const s = normalizeQasperEntry('1234.5678', entry)
    expect(s.questions[0].id).toBe('1234.5678#0')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/qasper.test.ts`
Expected: FAIL，报 `Failed to resolve import "../datasets/qasper"`

- [ ] **Step 3: 实现 `bench/src/datasets/qasper.ts`**

```typescript
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { EvalSample, QaQuestion } from '../types'

/** 伪页大小：约等于一页学术论文的字符数。 */
export const PSEUDO_PAGE_CHARS = 3000

const DEFAULT_PATH = new URL('../../datasets/qasper/qasper.jsonl', import.meta.url).pathname

/** QASPER 原始条目（HuggingFace allenai/qasper 的字段布局）。 */
export interface QasperEntry {
  title: string
  abstract: string
  full_text: {
    section_name: string[]
    paragraphs: string[][]
  }
  qas: {
    question: string[]
    answers: Array<Array<{
      answer: {
        free_form_answer: string
        extractive_spans: string[]
        unanswerable: boolean
        evidence: string[]
      }
    }>>
  }
}

/**
 * 段落按累计字符数聚成伪页。段落不切断——切断会让 evidence 跨页归属含糊。
 * 返回每个段落所属的伪页号，供 evidence 映射使用。
 */
export function paragraphsToPages(paragraphs: string[]): {
  pages: string[]
  paragraphToPage: number[]
} {
  const pages: string[] = []
  const paragraphToPage: number[] = []
  let buffer: string[] = []
  let bufferLen = 0

  for (const para of paragraphs) {
    // 当前页已有内容且加上这段会超限 → 先封页
    if (bufferLen > 0 && bufferLen + para.length > PSEUDO_PAGE_CHARS) {
      pages.push(buffer.join('\n\n'))
      buffer = []
      bufferLen = 0
    }
    paragraphToPage.push(pages.length)
    buffer.push(para)
    bufferLen += para.length
  }
  if (buffer.length > 0) pages.push(buffer.join('\n\n'))

  return { pages, paragraphToPage }
}

export function normalizeQasperEntry(paperId: string, entry: QasperEntry): EvalSample {
  const flatParagraphs = entry.full_text.paragraphs.flat()
  const { pages, paragraphToPage } = paragraphsToPages(flatParagraphs)

  // evidence 是段落原文字符串，建索引以便反查段落下标
  const paragraphIndex = new Map<string, number>()
  flatParagraphs.forEach((p, i) => {
    if (!paragraphIndex.has(p)) paragraphIndex.set(p, i)
  })

  const questions: QaQuestion[] = entry.qas.question.map((question, i) => {
    const annotations = entry.qas.answers[i] ?? []
    const unanswerable = annotations.length > 0 && annotations.every(a => a.answer.unanswerable)

    const answers: string[] = []
    const evidencePages = new Set<number>()
    for (const { answer } of annotations) {
      if (answer.unanswerable) continue
      if (answer.free_form_answer) answers.push(answer.free_form_answer)
      answers.push(...answer.extractive_spans)
      for (const ev of answer.evidence) {
        const paraIdx = paragraphIndex.get(ev)
        if (paraIdx !== undefined) evidencePages.add(paragraphToPage[paraIdx])
      }
    }

    return {
      id: `${paperId}#${i}`,
      question,
      answers,
      evidencePages: [...evidencePages].sort((a, b) => a - b),
      unanswerable,
    }
  })

  return {
    paperId,
    title: entry.title,
    pages,
    questions,
    referenceAbstract: entry.abstract,
    source: 'qasper',
  }
}

/** 加载 fetch.ts 归一化后的 jsonl（每行一个 EvalSample）。 */
export async function loadQasperDataset(path: string = DEFAULT_PATH): Promise<EvalSample[]> {
  if (!existsSync(path)) {
    throw new Error(
      `QASPER 数据集不存在：${path}。` +
      `先运行 npx tsx bench/datasets/qasper/fetch.ts 拉取并归一化。`,
    )
  }
  const content = await readFile(path, 'utf-8')
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as EvalSample)
}
```

- [ ] **Step 4: 写 `bench/datasets/qasper/fetch.ts`**

一次性脚本，从 HuggingFace datasets-server 拉 dev split 并归一化落 jsonl。不写单测——它是纯 I/O 脚本，且依赖外部服务。

```typescript
import { writeFile } from 'node:fs/promises'
import { normalizeQasperEntry, type QasperEntry } from '../../src/datasets/qasper'
import type { EvalSample } from '../../src/types'

const ROWS_URL = 'https://datasets-server.huggingface.co/rows'
const DATASET = 'allenai/qasper'
const CONFIG = 'qasper'
const SPLIT = 'validation'
const PAGE_SIZE = 100
const OUT_PATH = new URL('./qasper.jsonl', import.meta.url).pathname

/** 目标论文篇数；QASPER validation split 共 281 篇。 */
const LIMIT = Number(process.env.QASPER_LIMIT ?? '60')

async function fetchRows(offset: number, length: number) {
  const url = `${ROWS_URL}?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}&offset=${offset}&length=${length}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`QASPER 拉取失败 ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = await res.json()
  return data.rows as Array<{ row: QasperEntry & { id: string } }>
}

const samples: EvalSample[] = []
for (let offset = 0; offset < LIMIT; offset += PAGE_SIZE) {
  const length = Math.min(PAGE_SIZE, LIMIT - offset)
  process.stdout.write(`拉取 offset=${offset} length=${length}...\n`)
  const rows = await fetchRows(offset, length)
  if (rows.length === 0) break

  for (const { row } of rows) {
    const sample = normalizeQasperEntry(row.id, row)
    // 剔除没有任何可评测问题的论文
    if (sample.questions.length > 0 && sample.pages.length > 0) samples.push(sample)
  }
}

await writeFile(OUT_PATH, samples.map(s => JSON.stringify(s)).join('\n') + '\n')

const questionCount = samples.reduce((n, s) => n + s.questions.length, 0)
const unanswerableCount = samples.reduce(
  (n, s) => n + s.questions.filter(q => q.unanswerable).length, 0,
)
const noEvidenceCount = samples.reduce(
  (n, s) => n + s.questions.filter(q => !q.unanswerable && q.evidencePages.length === 0).length, 0,
)

process.stdout.write(
  `\n已写入 ${OUT_PATH}\n` +
  `论文 ${samples.length} 篇，问题 ${questionCount} 个\n` +
  `其中 unanswerable ${unanswerableCount} 个，evidence 反查失败 ${noEvidenceCount} 个\n`,
)
```

**为什么要打印 `evidence 反查失败` 数**：evidence 字符串反查段落靠精确匹配，若 QASPER 的字段布局变化导致大面积匹配失败，检索指标会全线偏低。这个数字让问题在拉取阶段就暴露，而不是在看报表时困惑。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/qasper.test.ts`
Expected: `Tests 12 passed`

- [ ] **Step 6: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 156 passed、typecheck 无输出

- [ ] **Step 7: 实跑拉取脚本验证 QASPER 可获取**

Run: `QASPER_LIMIT=5 npx tsx bench/datasets/qasper/fetch.ts`
Expected: 打印 `已写入 .../qasper.jsonl`，论文数 ≤5，且 `evidence 反查失败` 数应远小于问题总数。

若 `evidence 反查失败` 占比超过 30%，说明字段布局与假设不符——检查 datasets-server 返回的实际 JSON 结构（`curl` 上面那个 URL 看一眼），修正 `normalizeQasperEntry` 的 evidence 反查逻辑后再继续。

---

## Task 10: QA 任务 Runner

**Files:**
- Create: `bench/src/runner/qa.ts`
- Test: `bench/src/tests/qaRunner.test.ts`

**Interfaces:**
- Consumes: 全部前序模块 —— `EvalSample` / `BenchConfig` / `BenchResult` / `PerSampleRecord` / `SampleError`、`LlmClient`、`computeRetrievalMetrics`、`answerF1` / `isRefusal` / `REFUSAL_PATTERN_VERSION`、`aggregate` / `withLatencyStats`；生产代码 `buildPageIndex` / `runRagPipeline`
- Produces:
  - `runQaTask(args: QaTaskArgs): Promise<BenchResult>`
  - `interface QaTaskArgs { samples: EvalSample[]; config: BenchConfig; client: LlmClient; systemPrompt: string; limit?: number; gitSha: string; model: string; deps?: { buildIndex?: typeof buildPageIndex; runPipeline?: typeof runRagPipeline } }`

`deps` 注入让单测无需真实 LLM。生产 system prompt 从 `DEFAULT_SYSTEM_PROMPT` 常量取，与 `src/stores/chat.ts` 的 `DEFAULT_PROFILE.systemPrompt` 保持一致的字面值。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/qaRunner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { EvalSample } from '../types'
import type { IndexNode } from '../../../src/utils/pageIndex'

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}))

const { runQaTask, DEFAULT_SYSTEM_PROMPT } = await import('../runner/qa')

function leaf(id: string, start: number, end: number): IndexNode {
  return { title: `S${id}`, nodeId: id, startPage: start, endPage: end, summary: '', nodes: [] }
}

const tree: IndexNode = {
  title: 'P', nodeId: 'root', startPage: 0, endPage: 3, summary: '',
  nodes: [leaf('0', 0, 1), leaf('1', 2, 3)],
}

const sample: EvalSample = {
  paperId: 'p1',
  title: 'Paper 1',
  pages: ['a', 'b', 'c', 'd'],
  source: 'qasper',
  questions: [
    { id: 'p1#0', question: 'Q1?', answers: ['8'], evidencePages: [0], unanswerable: false },
  ],
}

const fakeClient = {
  complete: vi.fn(),
  chat: vi.fn(),
  stats: () => ({ hits: 0, misses: 0 }),
  latencies: () => [120, 340],
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    buildIndex: vi.fn().mockResolvedValue(tree),
    runPipeline: vi.fn().mockResolvedValue({
      answer: '8',
      retrievals: [{
        context: 'a\n\nb',
        sources: ['Pages 1–2: S0'],
        selected: [leaf('0', 0, 1)],
        scores: [{ id: 0, score: 9 }, { id: 1, score: 1 }],
        degraded: false,
        llmCalled: true,
      }],
      retrievalQuery: 'Q1?',
      rewritten: false,
      context: 'a\n\nb',
      sources: ['Pages 1–2: S0'],
      llmCalls: 2,
    }),
    ...overrides,
  }
}

const baseArgs = {
  samples: [sample],
  config: { name: 'default', topK: 2, minScore: 4 },
  client: fakeClient as never,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  gitSha: 'abc1234',
  model: 'test-model',
}

describe('runQaTask', () => {
  it('产出 BenchResult，含聚合指标与逐样本记录', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })

    expect(result.task).toBe('qa')
    expect(result.meta.completed).toBe(1)
    expect(result.meta.total).toBe(1)
    expect(result.meta.gitSha).toBe('abc1234')
    expect(result.metrics.evidenceRecall).toBe(1)
    expect(result.metrics.answerF1).toBe(1)
    expect(result.perSample).toHaveLength(1)
    expect(result.perSample[0].selectedPages).toEqual([0, 1])
    expect(result.errors).toEqual([])
  })

  it('把 config 的分块参数传给 buildPageIndex', async () => {
    const deps = makeDeps()
    await runQaTask({
      ...baseArgs,
      config: { name: 'c', chunkPages: 3, minSectionPages: 1, forceFixedChunk: true },
      deps: deps as never,
    })
    expect(deps.buildIndex.mock.calls[0][2]).toEqual({
      chunkPages: 3, minSectionPages: 1, forceFixedChunk: true,
    })
  })

  it('把 config 的检索参数传给 runRagPipeline', async () => {
    const deps = makeDeps()
    await runQaTask({
      ...baseArgs,
      config: { name: 'c', topK: 3, minScore: 6, enableRewrite: false },
      deps: deps as never,
    })
    expect(deps.runPipeline.mock.calls[0][6]).toEqual({
      topK: 3, minScore: 6, enableRewrite: false,
    })
  })

  it('每篇论文只建一次索引，多个问题复用', async () => {
    const deps = makeDeps()
    const twoQuestions: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
      ],
    }
    await runQaTask({ ...baseArgs, samples: [twoQuestions], deps: deps as never })

    expect(deps.buildIndex).toHaveBeenCalledTimes(1)
    expect(deps.runPipeline).toHaveBeenCalledTimes(2)
  })

  it('单样本失败不中断整轮，记入 errors 并从分母剔除', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn()
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce({
          answer: '9', retrievals: [], retrievalQuery: 'Q2?', rewritten: false,
          context: '', sources: [], llmCalls: 1,
        }),
    })
    const twoQuestions: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
      ],
    }
    const result = await runQaTask({ ...baseArgs, samples: [twoQuestions], deps: deps as never })

    expect(result.meta.completed).toBe(1)
    expect(result.meta.total).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatchObject({ sampleId: 'p1#0', stage: 'generate' })
    expect(result.errors[0].message).toContain('network timeout')
  })

  it('建索引失败时该论文全部问题记为 index 阶段错误', async () => {
    const deps = makeDeps({ buildIndex: vi.fn().mockRejectedValue(new Error('bad pdf')) })
    const result = await runQaTask({ ...baseArgs, deps: deps as never })

    expect(result.meta.completed).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].stage).toBe('index')
  })

  it('unanswerable 样本按拒答模式判定，不计入 answerF1', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '参考内容中没有提到这一点。',
        retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({ ...baseArgs, samples: [unanswerableSample], deps: deps as never })

    expect(result.metrics.unanswerableAccuracy).toBe(1)
    expect(result.metrics.answerF1).toBeUndefined()
    expect(result.meta.unanswerableMethod).toBe('pattern')
  })

  it('硬答 unanswerable 问题时 unanswerableAccuracy 为 0', async () => {
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '论文中使用了 8 个注意力头。',
        retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({ ...baseArgs, samples: [unanswerableSample], deps: deps as never })
    expect(result.metrics.unanswerableAccuracy).toBe(0)
  })

  it('limit 限制处理的问题数', async () => {
    const deps = makeDeps()
    const many: EvalSample = {
      ...sample,
      questions: [
        sample.questions[0],
        { id: 'p1#1', question: 'Q2?', answers: ['9'], evidencePages: [2], unanswerable: false },
        { id: 'p1#2', question: 'Q3?', answers: ['7'], evidencePages: [3], unanswerable: false },
      ],
    }
    const result = await runQaTask({ ...baseArgs, samples: [many], limit: 2, deps: deps as never })

    expect(result.meta.total).toBe(2)
    expect(deps.runPipeline).toHaveBeenCalledTimes(2)
  })

  it('记录管线诊断指标：降级率、改写率、调用数、分块数', async () => {
    const result = await runQaTask({ ...baseArgs, deps: makeDeps() as never })
    expect(result.metrics.degradedRate).toBe(0)
    expect(result.metrics.rewriteRate).toBe(0)
    expect(result.metrics.llmCallsPerQuery).toBe(2)
    expect(result.metrics.leafCount).toBe(2)
    expect(result.metrics.latencyP50).toBe(340)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/qaRunner.test.ts`
Expected: FAIL，报 `Failed to resolve import "../runner/qa"`

- [ ] **Step 3: 实现 `bench/src/runner/qa.ts`**

```typescript
import { buildPageIndex, type IndexNode } from '../../../src/utils/pageIndex'
import { runRagPipeline } from '../../../src/utils/ragPipeline'
import type { BenchConfig, BenchResult, EvalSample, PerSampleRecord, SampleError } from '../types'
import type { LlmClient } from '../llmClient'
import { computeRetrievalMetrics, expandPages } from '../metrics/retrieval'
import { answerF1, isRefusal, REFUSAL_PATTERN_VERSION } from '../metrics/answerF1'
import { aggregate, withLatencyStats } from '../metrics/aggregate'

/** 与 src/stores/chat.ts 的 DEFAULT_PROFILE.systemPrompt 保持一致。 */
export const DEFAULT_SYSTEM_PROMPT =
  '你是一个专业的学术论文阅读助手，帮助用户理解和分析论文内容。'

export interface QaTaskDeps {
  buildIndex?: typeof buildPageIndex
  runPipeline?: typeof runRagPipeline
}

export interface QaTaskArgs {
  samples: EvalSample[]
  config: BenchConfig
  client: LlmClient
  systemPrompt: string
  limit?: number
  gitSha: string
  model: string
  deps?: QaTaskDeps
}

function indexOptions(config: BenchConfig) {
  const out: Record<string, number | boolean> = {}
  if (config.chunkPages !== undefined) out.chunkPages = config.chunkPages
  if (config.minSectionPages !== undefined) out.minSectionPages = config.minSectionPages
  if (config.forceFixedChunk !== undefined) out.forceFixedChunk = config.forceFixedChunk
  return out
}

function ragOptions(config: BenchConfig) {
  const out: Record<string, number | boolean> = {}
  if (config.topK !== undefined) out.topK = config.topK
  if (config.minScore !== undefined) out.minScore = config.minScore
  if (config.enableRewrite !== undefined) out.enableRewrite = config.enableRewrite
  return out
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runQaTask(args: QaTaskArgs): Promise<BenchResult> {
  const { samples, config, client, systemPrompt, limit, gitSha, model } = args
  const buildIndex = args.deps?.buildIndex ?? buildPageIndex
  const runPipeline = args.deps?.runPipeline ?? runRagPipeline

  const perSample: PerSampleRecord[] = []
  const errors: SampleError[] = []
  let total = 0
  let sawUnanswerable = false

  for (const sample of samples) {
    if (limit !== undefined && total >= limit) break

    // 每篇论文只建一次索引，同篇的多个问题复用
    let tree: IndexNode
    try {
      tree = await buildIndex(sample.pages, client.complete, indexOptions(config))
    } catch (e) {
      for (const q of sample.questions) {
        if (limit !== undefined && total >= limit) break
        total++
        errors.push({ sampleId: q.id, stage: 'index', message: errorMessage(e) })
      }
      continue
    }

    const leaves = tree.nodes.length > 0 ? tree.nodes : [tree]

    for (const question of sample.questions) {
      if (limit !== undefined && total >= limit) break
      total++

      try {
        const result = await runPipeline(
          [{ tree, pages: sample.pages }],
          question.question,
          [],                       // 单轮评测，无历史；改写率因此只在多轮评测中非 0
          client.complete,
          client.chat,
          systemPrompt,
          ragOptions(config),
        )

        const retrieval = result.retrievals[0]
        const metrics: Record<string, number> = {
          llmCalls: result.llmCalls,
          rewrite: result.rewritten ? 1 : 0,
          leafCount: leaves.length,
        }

        if (retrieval) {
          Object.assign(metrics, computeRetrievalMetrics({
            selected: retrieval.selected,
            leaves,
            scores: retrieval.scores,
            evidencePages: question.evidencePages,
            context: result.context,
            degraded: retrieval.degraded,
          }))
          metrics.degraded = retrieval.degraded ? 1 : 0
        }

        if (question.unanswerable) {
          sawUnanswerable = true
          metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
        } else {
          metrics.answerF1 = answerF1(result.answer, question.answers)
        }

        perSample.push({
          id: question.id,
          paperId: sample.paperId,
          source: sample.source,
          metrics,
          retrievalQuery: result.retrievalQuery,
          selectedPages: retrieval ? expandPages(retrieval.selected) : [],
          evidencePages: question.evidencePages,
          answer: result.answer,
        })
      } catch (e) {
        errors.push({ sampleId: question.id, stage: 'generate', message: errorMessage(e) })
      }
    }
  }

  const raw = aggregate(perSample)
  // 重命名 0/1 指标的聚合结果为「率」，让报表列名自解释
  const metrics = withLatencyStats(renameRates(raw), client.latencies())

  return {
    task: 'qa',
    config,
    meta: {
      model,
      timestamp: new Date().toISOString(),
      gitSha,
      completed: perSample.length,
      total,
      ...(sawUnanswerable ? { unanswerableMethod: 'pattern' as const } : {}),
    },
    metrics,
    perSample,
    errors,
  }
}

/** evidenceHit → evidenceHitRate 等；均值本身就是比率，只是改个名。 */
function renameRates(metrics: Record<string, number>): Record<string, number> {
  const renames: Record<string, string> = {
    evidenceHit: 'evidenceHitRate',
    degraded: 'degradedRate',
    rewrite: 'rewriteRate',
    llmCalls: 'llmCallsPerQuery',
  }
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(metrics)) {
    out[renames[key] ?? key] = value
  }
  return out
}

export { REFUSAL_PATTERN_VERSION }
```

**为什么 history 传空数组**：QASPER 与冒烟集都是单轮问答，没有对话历史。这意味着 `rewriteRate` 在本评测中恒为 0，`rewriteQuery` 的效果无法被覆盖。这是已知局限，应在报表中标注；要评测改写需要构造多轮数据集，不在本计划范围内。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/qaRunner.test.ts`
Expected: `Tests 10 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 166 passed、typecheck 无输出

---

## Task 11: 摘要任务 Runner

**Files:**
- Create: `bench/src/runner/summary.ts`
- Test: `bench/src/tests/summaryRunner.test.ts`

**Interfaces:**
- Consumes: `EvalSample` / `BenchConfig` / `BenchResult`；`computeSummaryMetrics`；`aggregate`；`summarizeAcademicText` from `src/utils/abstractSummarizer`
- Produces:
  - `runSummaryTask(args: SummaryTaskArgs): Promise<BenchResult>`
  - `interface SummaryTaskArgs { samples: EvalSample[]; config: BenchConfig; hfToken: string; limit?: number; gitSha: string; model: string; deps?: { summarize?: typeof summarizeAcademicText } }`

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/summaryRunner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { EvalSample } from '../types'
import { runSummaryTask } from '../runner/summary'

const sample: EvalSample = {
  paperId: 'p1',
  title: 'Paper 1',
  pages: ['the cat sat on the mat', 'more text here'],
  source: 'smoke',
  questions: [],
  referenceAbstract: 'the cat sat on the mat',
}

const baseArgs = {
  samples: [sample],
  config: { name: 'default' },
  hfToken: 'hf_test',
  gitSha: 'abc1234',
  model: 't5-small',
}

describe('runSummaryTask', () => {
  it('产出 BenchResult 与 ROUGE 指标', async () => {
    const summarize = vi.fn().mockResolvedValue('the cat sat on the mat')
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.task).toBe('summary')
    expect(result.metrics.rouge1).toBe(1)
    expect(result.metrics.rougeL).toBe(1)
    expect(result.metrics.emptyRate).toBe(0)
    expect(result.meta.completed).toBe(1)
    expect(result.perSample[0].summary).toBe('the cat sat on the mat')
  })

  it('把全文页拼接后交给 summarizeAcademicText', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(summarize.mock.calls[0][0]).toContain('the cat sat')
    expect(summarize.mock.calls[0][0]).toContain('more text here')
    expect(summarize.mock.calls[0][1]).toBe('hf_test')
  })

  it('跳过没有参考摘要的样本，不计入 total', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    const noRef: EvalSample = { ...sample, referenceAbstract: undefined }
    const result = await runSummaryTask({ ...baseArgs, samples: [noRef], deps: { summarize } as never })

    expect(result.meta.total).toBe(0)
    expect(summarize).not.toHaveBeenCalled()
  })

  it('返回空摘要时 emptyRate 为 1 而非算作低质量', async () => {
    const summarize = vi.fn().mockResolvedValue('   ')
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.metrics.emptyRate).toBe(1)
    expect(result.metrics.rouge1).toBe(0)
    expect(result.errors).toEqual([])
  })

  it('摘要调用抛错时记入 errors 并从分母剔除', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('HF 503'))
    const result = await runSummaryTask({ ...baseArgs, deps: { summarize } as never })

    expect(result.meta.completed).toBe(0)
    expect(result.meta.total).toBe(1)
    expect(result.errors[0]).toMatchObject({ sampleId: 'p1', stage: 'summarize' })
    expect(result.errors[0].message).toContain('HF 503')
  })

  it('limit 限制处理的论文数', async () => {
    const summarize = vi.fn().mockResolvedValue('s')
    const result = await runSummaryTask({
      ...baseArgs,
      samples: [sample, { ...sample, paperId: 'p2' }],
      limit: 1,
      deps: { summarize } as never,
    })

    expect(result.meta.total).toBe(1)
    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('缺 hfToken 时抛出可诊断的错误', async () => {
    await expect(runSummaryTask({ ...baseArgs, hfToken: '' })).rejects.toThrow(/HF_TOKEN/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/summaryRunner.test.ts`
Expected: FAIL，报 `Failed to resolve import "../runner/summary"`

- [ ] **Step 3: 实现 `bench/src/runner/summary.ts`**

```typescript
import { summarizeAcademicText } from '../../../src/utils/abstractSummarizer'
import type { BenchConfig, BenchResult, EvalSample, PerSampleRecord, SampleError } from '../types'
import { computeSummaryMetrics } from '../metrics/rouge'
import { aggregate } from '../metrics/aggregate'

export interface SummaryTaskArgs {
  samples: EvalSample[]
  config: BenchConfig
  hfToken: string
  limit?: number
  gitSha: string
  model: string
  deps?: { summarize?: typeof summarizeAcademicText }
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runSummaryTask(args: SummaryTaskArgs): Promise<BenchResult> {
  const { samples, config, hfToken, limit, gitSha, model } = args
  const summarize = args.deps?.summarize ?? summarizeAcademicText

  if (!hfToken) {
    throw new Error('缺少环境变量 HF_TOKEN（Hugging Face Inference API token）')
  }

  const perSample: PerSampleRecord[] = []
  const errors: SampleError[] = []
  let total = 0

  for (const sample of samples) {
    // 没有参考摘要无法算 ROUGE，直接跳过且不计入分母
    if (!sample.referenceAbstract) continue
    if (limit !== undefined && total >= limit) break
    total++

    const fullText = sample.pages.join('\n\n')
    try {
      const summary = await summarize(fullText, hfToken)
      perSample.push({
        id: sample.paperId,
        paperId: sample.paperId,
        source: sample.source,
        metrics: computeSummaryMetrics(summary, sample.referenceAbstract, fullText.length),
        summary,
      })
    } catch (e) {
      errors.push({ sampleId: sample.paperId, stage: 'summarize', message: errorMessage(e) })
    }
  }

  const raw = aggregate(perSample)
  const metrics: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    metrics[key === 'empty' ? 'emptyRate' : key] = value
  }

  return {
    task: 'summary',
    config,
    meta: {
      model,
      timestamp: new Date().toISOString(),
      gitSha,
      completed: perSample.length,
      total,
    },
    metrics,
    perSample,
    errors,
  }
}
```

**注意 `computeSummaryMetrics` 返回的 `empty` 字段**：`aggregate` 求均值后即为比率，这里只重命名为 `emptyRate`。空摘要不算错误（`errors` 为空）——端点返回了空串是一种「成功但无输出」，与网络异常语义不同，必须分开统计。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/summaryRunner.test.ts`
Expected: `Tests 7 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 173 passed、typecheck 无输出

---

## Task 12: 报表与对比

**Files:**
- Create: `bench/src/report.ts`
- Test: `bench/src/tests/report.test.ts`

**Interfaces:**
- Consumes: `BenchResult` from `bench/src/types`；`configLabel` from `bench/src/config`
- Produces:
  - `renderReport(results: BenchResult[], opts?: { primaryMetric?: string }): string`
  - `renderComparison(a: BenchResult, b: BenchResult): string`
  - `PRIMARY_METRIC: Record<'qa' | 'summary', string>`

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { BenchResult } from '../types'
import { renderReport, renderComparison } from '../report'

function result(name: string, metrics: Record<string, number>, over: Partial<BenchResult> = {}): BenchResult {
  return {
    task: 'qa',
    config: { name },
    meta: {
      model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
      completed: 10, total: 10,
    },
    metrics,
    perSample: [],
    errors: [],
    ...over,
  }
}

describe('renderReport', () => {
  it('单结果渲染为含指标的 Markdown', () => {
    const md = renderReport([result('default', { evidenceRecall: 0.71, answerF1: 0.43 })])
    expect(md).toContain('| default |')
    expect(md).toContain('0.710')
    expect(md).toContain('evidenceRecall')
    expect(md).toContain('gpt-4o')
    expect(md).toContain('abc1234')
  })

  it('多结果一行一组配置，并标出主指标最优行', () => {
    const md = renderReport([
      result('topK=1', { evidenceRecall: 0.6 }),
      result('topK=2', { evidenceRecall: 0.8 }),
      result('topK=3', { evidenceRecall: 0.7 }),
    ])
    const bestLine = md.split('\n').find(l => l.includes('topK=2'))
    expect(bestLine).toContain('**')
  })

  it('打印 completed/total，让部分失败可见', () => {
    const md = renderReport([
      result('default', { evidenceRecall: 0.7 }, {
        meta: {
          model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
          completed: 95, total: 100,
        },
      }),
    ])
    expect(md).toContain('95/100')
  })

  it('有错误时列出按阶段的计数', () => {
    const md = renderReport([
      result('default', { evidenceRecall: 0.7 }, {
        errors: [
          { sampleId: 'a', stage: 'generate', message: 'timeout' },
          { sampleId: 'b', stage: 'generate', message: 'timeout' },
          { sampleId: 'c', stage: 'index', message: 'bad pdf' },
        ],
      }),
    ])
    expect(md).toContain('generate')
    expect(md).toContain('2')
    expect(md).toContain('index')
  })

  it('空结果列表返回提示而非崩溃', () => {
    expect(renderReport([])).toContain('无结果')
  })

  it('unanswerableMethod 存在时在报表中标注口径', () => {
    const md = renderReport([
      result('default', { unanswerableAccuracy: 0.3 }, {
        meta: {
          model: 'gpt-4o', timestamp: '2026-09-02T12:00:00.000Z', gitSha: 'abc1234',
          completed: 10, total: 10, unanswerableMethod: 'pattern',
        },
      }),
    ])
    expect(md).toContain('pattern')
  })
})

describe('renderComparison', () => {
  it('输出指标差值与方向', () => {
    const md = renderComparison(
      result('before', { evidenceRecall: 0.6, answerF1: 0.5 }),
      result('after', { evidenceRecall: 0.8, answerF1: 0.4 }),
    )
    expect(md).toContain('evidenceRecall')
    expect(md).toContain('+0.200')
    expect(md).toContain('-0.100')
  })

  it('只在一侧出现的指标也列出', () => {
    const md = renderComparison(
      result('before', { evidenceRecall: 0.6 }),
      result('after', { mrr: 0.9 }),
    )
    expect(md).toContain('mrr')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/report.test.ts`
Expected: FAIL，报 `Failed to resolve import "../report"`

- [ ] **Step 3: 实现 `bench/src/report.ts`**

```typescript
import type { BenchResult } from './types'

/** 各任务的主指标，用于在矩阵报表中标出最优行。 */
export const PRIMARY_METRIC: Record<'qa' | 'summary', string> = {
  qa: 'evidenceRecall',
  summary: 'rougeL',
}

function fmt(value: number): string {
  return Number.isInteger(value) && Math.abs(value) >= 10
    ? String(value)
    : value.toFixed(3)
}

function collectMetricNames(results: BenchResult[]): string[] {
  const names = new Set<string>()
  for (const r of results) for (const k of Object.keys(r.metrics)) names.add(k)
  return [...names].sort()
}

export function renderReport(
  results: BenchResult[],
  opts: { primaryMetric?: string } = {},
): string {
  if (results.length === 0) return '## 评测报表\n\n无结果。\n'

  const first = results[0]
  const primary = opts.primaryMetric ?? PRIMARY_METRIC[first.task]
  const metricNames = collectMetricNames(results)

  // 主指标最高的行加粗
  let bestIndex = -1
  let bestValue = -Infinity
  results.forEach((r, i) => {
    const v = r.metrics[primary]
    if (v !== undefined && v > bestValue) {
      bestValue = v
      bestIndex = i
    }
  })

  const lines: string[] = []
  lines.push(`## 评测报表：${first.task}`)
  lines.push('')
  lines.push(`- 模型：\`${first.meta.model}\``)
  if (first.meta.judgeModel) lines.push(`- Judge 模型：\`${first.meta.judgeModel}\``)
  lines.push(`- 代码版本：\`${first.meta.gitSha}\``)
  lines.push(`- 时间：${first.meta.timestamp}`)
  lines.push(`- 主指标：\`${primary}\`（加粗行为最优）`)
  if (first.meta.unanswerableMethod) {
    lines.push(`- \`unanswerableAccuracy\` 判定口径：\`${first.meta.unanswerableMethod}\``)
  }
  lines.push('')

  lines.push(`| 配置 | 完成 | ${metricNames.join(' | ')} |`)
  lines.push(`| --- | --- | ${metricNames.map(() => '---').join(' | ')} |`)
  results.forEach((r, i) => {
    const cells = metricNames.map(n => {
      const v = r.metrics[n]
      if (v === undefined) return '—'
      return i === bestIndex && n === primary ? `**${fmt(v)}**` : fmt(v)
    })
    const label = i === bestIndex ? `**${r.config.name}**` : r.config.name
    lines.push(`| ${label} | ${r.meta.completed}/${r.meta.total} | ${cells.join(' | ')} |`)
  })
  lines.push('')

  const errorLines = renderErrors(results)
  if (errorLines.length > 0) {
    lines.push('### 失败样本')
    lines.push('')
    lines.push('| 配置 | 阶段 | 次数 | 示例信息 |')
    lines.push('| --- | --- | --- | --- |')
    lines.push(...errorLines)
    lines.push('')
  }

  return lines.join('\n')
}

function renderErrors(results: BenchResult[]): string[] {
  const lines: string[] = []
  for (const r of results) {
    const byStage = new Map<string, { count: number; sample: string }>()
    for (const e of r.errors) {
      const entry = byStage.get(e.stage) ?? { count: 0, sample: e.message }
      entry.count++
      byStage.set(e.stage, entry)
    }
    for (const [stage, { count, sample }] of byStage) {
      lines.push(`| ${r.config.name} | ${stage} | ${count} | ${sample.slice(0, 80)} |`)
    }
  }
  return lines
}

export function renderComparison(a: BenchResult, b: BenchResult): string {
  const names = collectMetricNames([a, b])
  const lines: string[] = []
  lines.push(`## 结果对比：${a.config.name} → ${b.config.name}`)
  lines.push('')
  lines.push(`- A：\`${a.meta.gitSha}\` @ ${a.meta.timestamp}（完成 ${a.meta.completed}/${a.meta.total}）`)
  lines.push(`- B：\`${b.meta.gitSha}\` @ ${b.meta.timestamp}（完成 ${b.meta.completed}/${b.meta.total}）`)
  lines.push('')
  lines.push('| 指标 | A | B | 差值 |')
  lines.push('| --- | --- | --- | --- |')
  for (const name of names) {
    const va = a.metrics[name]
    const vb = b.metrics[name]
    const delta = va !== undefined && vb !== undefined
      ? `${vb - va >= 0 ? '+' : ''}${fmt(vb - va)}`
      : '—'
    lines.push(`| ${name} | ${va !== undefined ? fmt(va) : '—'} | ${vb !== undefined ? fmt(vb) : '—'} | ${delta} |`)
  }
  lines.push('')
  return lines.join('\n')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/report.test.ts`
Expected: `Tests 8 passed`

- [ ] **Step 5: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 181 passed、typecheck 无输出

---

## Task 13: CLI 组装

**Files:**
- Create: `bench/src/cli.ts`
- Create: `bench/src/args.ts`
- Test: `bench/src/tests/args.test.ts`

**Interfaces:**
- Consumes: 全部前序模块
- Produces:
  - `parseArgs(argv: string[]): BenchArgs`
  - `interface BenchArgs { task: 'qa' | 'summary' | 'all'; dataset: 'qasper' | 'smoke' | 'all'; config: string; limit?: number; judge: boolean; useCache: boolean; out?: string; compare?: [string, string] }`

`cli.ts` 本身是薄编排层不写单测（它只做 I/O 与拼装），参数解析这个易错的纯函数部分单独抽到 `args.ts` 并测试。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/args.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseArgs } from '../args'

describe('parseArgs', () => {
  it('无参数时用默认值', () => {
    const a = parseArgs([])
    expect(a).toMatchObject({
      task: 'all', dataset: 'all', config: 'default', judge: false, useCache: true,
    })
    expect(a.limit).toBeUndefined()
  })

  it('解析 --task 与 --dataset', () => {
    const a = parseArgs(['--task', 'qa', '--dataset', 'qasper'])
    expect(a.task).toBe('qa')
    expect(a.dataset).toBe('qasper')
  })

  it('解析 --limit 为数字', () => {
    expect(parseArgs(['--limit', '20']).limit).toBe(20)
  })

  it('解析布尔 flag', () => {
    const a = parseArgs(['--judge', '--no-cache'])
    expect(a.judge).toBe(true)
    expect(a.useCache).toBe(false)
  })

  it('解析 --compare 的两个路径', () => {
    const a = parseArgs(['--compare', 'a.json', 'b.json'])
    expect(a.compare).toEqual(['a.json', 'b.json'])
  })

  it('--task 取值非法时抛出列出合法值的错误', () => {
    expect(() => parseArgs(['--task', 'nope'])).toThrow(/qa.*summary.*all/)
  })

  it('--dataset 取值非法时抛错', () => {
    expect(() => parseArgs(['--dataset', 'nope'])).toThrow(/qasper/)
  })

  it('--limit 非正整数时抛错', () => {
    expect(() => parseArgs(['--limit', '0'])).toThrow(/--limit/)
    expect(() => parseArgs(['--limit', 'abc'])).toThrow(/--limit/)
  })

  it('--compare 只给一个路径时抛错', () => {
    expect(() => parseArgs(['--compare', 'a.json'])).toThrow(/两个/)
  })

  it('未知 flag 时抛错，避免拼错静默生效', () => {
    expect(() => parseArgs(['--topk', '2'])).toThrow(/--topk/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/args.test.ts`
Expected: FAIL，报 `Failed to resolve import "../args"`

- [ ] **Step 3: 实现 `bench/src/args.ts`**

```typescript
export interface BenchArgs {
  task: 'qa' | 'summary' | 'all'
  dataset: 'qasper' | 'smoke' | 'all'
  config: string
  limit?: number
  judge: boolean
  useCache: boolean
  out?: string
  compare?: [string, string]
}

const TASKS = ['qa', 'summary', 'all'] as const
const DATASETS = ['qasper', 'smoke', 'all'] as const

export function parseArgs(argv: string[]): BenchArgs {
  const args: BenchArgs = {
    task: 'all',
    dataset: 'all',
    config: 'default',
    judge: false,
    useCache: true,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    switch (flag) {
      case '--task': {
        const v = argv[++i]
        if (!TASKS.includes(v as never)) {
          throw new Error(`--task 取值非法：${v}（合法值：qa / summary / all）`)
        }
        args.task = v as BenchArgs['task']
        break
      }
      case '--dataset': {
        const v = argv[++i]
        if (!DATASETS.includes(v as never)) {
          throw new Error(`--dataset 取值非法：${v}（合法值：qasper / smoke / all）`)
        }
        args.dataset = v as BenchArgs['dataset']
        break
      }
      case '--config':
        args.config = argv[++i]
        break
      case '--limit': {
        const v = Number(argv[++i])
        if (!Number.isInteger(v) || v <= 0) {
          throw new Error(`--limit 需要正整数，收到：${argv[i]}`)
        }
        args.limit = v
        break
      }
      case '--out':
        args.out = argv[++i]
        break
      case '--judge':
        args.judge = true
        break
      case '--no-cache':
        args.useCache = false
        break
      case '--compare': {
        const a = argv[++i]
        const b = argv[++i]
        if (!a || !b) throw new Error('--compare 需要两个结果文件路径')
        args.compare = [a, b]
        break
      }
      default:
        throw new Error(`未知参数：${flag}`)
    }
  }
  return args
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/args.test.ts`
Expected: `Tests 10 passed`

- [ ] **Step 5: 实现 `bench/src/cli.ts`**

```typescript
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from './args'
import { loadConfigs, configLabel } from './config'
import { createLlmClient, resolveEnvConfig } from './llmClient'
import { loadQasperDataset } from './datasets/qasper'
import { loadSmokeDataset } from './datasets/smoke'
import { runQaTask, DEFAULT_SYSTEM_PROMPT } from './runner/qa'
import { runSummaryTask } from './runner/summary'
import { renderReport, renderComparison } from './report'
import type { BenchResult, EvalSample } from './types'

const RESULTS_DIR = new URL('../results/', import.meta.url).pathname

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

async function loadDatasets(which: string): Promise<EvalSample[]> {
  const out: EvalSample[] = []
  if (which === 'qasper' || which === 'all') out.push(...await loadQasperDataset())
  if (which === 'smoke' || which === 'all') out.push(...await loadSmokeDataset())
  if (out.length === 0) {
    throw new Error(
      `数据集为空（--dataset ${which}）。QASPER 需先运行 ` +
      `npx tsx bench/datasets/qasper/fetch.ts；冒烟集见 bench/datasets/smoke/README.md`,
    )
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

// --compare 是独立路径：只读两份结果输出差异表，不跑评测
if (args.compare) {
  const [pathA, pathB] = args.compare
  const a = JSON.parse(readFileSync(pathA, 'utf-8')) as BenchResult
  const b = JSON.parse(readFileSync(pathB, 'utf-8')) as BenchResult
  process.stdout.write(renderComparison(a, b))
  process.exit(0)
}

const sha = gitSha()
const configs = await loadConfigs(args.config)
const samples = await loadDatasets(args.dataset)
mkdirSync(RESULTS_DIR, { recursive: true })

process.stdout.write(
  `配置 ${configs.length} 组，样本 ${samples.length} 篇论文，代码版本 ${sha}\n`,
)

const qaResults: BenchResult[] = []
const summaryResults: BenchResult[] = []

for (const config of configs) {
  if (args.task === 'qa' || args.task === 'all') {
    const env = resolveEnvConfig(process.env)
    const client = createLlmClient({ ...env, useCache: args.useCache })

    process.stdout.write(`\n[QA] ${config.name}...\n`)
    const result = await runQaTask({
      samples,
      config,
      client,
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      limit: args.limit,
      gitSha: sha,
      model: env.model,
    })
    const { hits, misses } = client.stats()
    process.stdout.write(
      `  完成 ${result.meta.completed}/${result.meta.total}，` +
      `缓存命中 ${hits}/${hits + misses}，失败 ${result.errors.length}\n`,
    )
    qaResults.push(result)
    writeResult(result)
  }

  if (args.task === 'summary' || args.task === 'all') {
    process.stdout.write(`\n[摘要] ${config.name}...\n`)
    const result = await runSummaryTask({
      samples,
      config,
      hfToken: process.env.HF_TOKEN ?? '',
      limit: args.limit,
      gitSha: sha,
      model: process.env.HF_MODEL ?? 'Bashaarat1/t5-small-arxiv-summarizer',
    })
    process.stdout.write(
      `  完成 ${result.meta.completed}/${result.meta.total}，失败 ${result.errors.length}\n`,
    )
    summaryResults.push(result)
    writeResult(result)
  }
}

function writeResult(result: BenchResult) {
  const stamp = result.meta.timestamp.replace(/[:.]/g, '-')
  const path = args.out ?? join(RESULTS_DIR, `${result.task}-${configLabel(result.config)}-${stamp}.json`)
  writeFileSync(path, JSON.stringify(result, null, 2))
  process.stdout.write(`  结果已写入 ${path}\n`)
}

process.stdout.write('\n')
if (qaResults.length > 0) process.stdout.write(renderReport(qaResults) + '\n')
if (summaryResults.length > 0) process.stdout.write(renderReport(summaryResults) + '\n')
```

**注意 `--judge` 此时尚未接线**：Task 14 才实现 judge。在 Task 13 完成后 `--judge` 会被解析但无效果。这是有意的分层——judge 是可选质量信号，不该阻塞主链路可用。

- [ ] **Step 6: 端到端跑通冒烟路径**

先准备最小冒烟数据：把任意一篇 PDF 放入 `bench/datasets/smoke/papers/`，在 `annotations.json` 里写一条标注（1 篇 1 问 + `referenceAbstract`）。

Run:
```bash
export BENCH_LLM_PROVIDER=openai
export BENCH_LLM_MODEL=<你的模型>
export BENCH_LLM_API_KEY=<你的 key>
export BENCH_LLM_BASE_URL=<你的 base url>
npm run bench -- --task qa --dataset smoke --limit 1
```
Expected: 打印 `完成 1/1`、结果 JSON 路径、以及含 `evidenceRecall` / `answerF1` 的 Markdown 表格。

再跑第二次验证缓存：
Run: 同上命令
Expected: `缓存命中` 的分子等于分母（全部命中），耗时显著下降。

- [ ] **Step 7: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 191 passed、typecheck 无输出

---

## Task 14: LLM-as-judge

**Files:**
- Create: `bench/src/metrics/judge.ts`
- Modify: `bench/src/runner/qa.ts`（接入 judge）
- Modify: `bench/src/cli.ts`（`--judge` 接线）
- Test: `bench/src/tests/judge.test.ts`

**Interfaces:**
- Consumes: `LlmClient`；`isRefusal` from `bench/src/metrics/answerF1`
- Produces:
  - `RUBRIC_VERSION: string`
  - `buildJudgePrompt(args: { question: string; evidence: string; answer: string }): string`
  - `parseJudgeResponse(raw: string): JudgeScores | null`
  - `judgeAnswer(args: JudgeArgs): Promise<JudgeScores | null>`
  - `judgeUnanswerable(args: { question: string; answer: string; client: LlmClient }): Promise<boolean | null>`
  - `interface JudgeScores { factuality: number; completeness: number; groundedness: number }`

judge 输入**不含参考答案**——与 `answerF1` 同源会失去互补性，这是 spec 第 6.2 节的明确要求。

- [ ] **Step 1: 写失败测试**

Create `bench/src/tests/judge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import {
  buildJudgePrompt, parseJudgeResponse, judgeAnswer, judgeUnanswerable, RUBRIC_VERSION,
} from '../metrics/judge'

function client(response: string) {
  return {
    complete: vi.fn().mockResolvedValue(response),
    chat: vi.fn(),
    stats: () => ({ hits: 0, misses: 0 }),
    latencies: () => [],
  } as never
}

describe('buildJudgePrompt', () => {
  it('包含问题、evidence 与待评答案', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E text', answer: 'A text' })
    expect(p).toContain('Q?')
    expect(p).toContain('E text')
    expect(p).toContain('A text')
  })

  it('不包含参考答案字段——避免与 answerF1 同源', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E', answer: 'A' })
    expect(p).not.toMatch(/参考答案|reference answer|gold answer/i)
  })

  it('要求三维 1-5 分的 JSON 输出', () => {
    const p = buildJudgePrompt({ question: 'Q?', evidence: 'E', answer: 'A' })
    expect(p).toContain('factuality')
    expect(p).toContain('completeness')
    expect(p).toContain('groundedness')
  })
})

describe('parseJudgeResponse', () => {
  it('解析纯 JSON', () => {
    expect(parseJudgeResponse('{"factuality":5,"completeness":4,"groundedness":3}'))
      .toEqual({ factuality: 5, completeness: 4, groundedness: 3 })
  })

  it('剥离 markdown 代码块围栏', () => {
    expect(parseJudgeResponse('```json\n{"factuality":1,"completeness":2,"groundedness":3}\n```'))
      .toEqual({ factuality: 1, completeness: 2, groundedness: 3 })
  })

  it('非法 JSON 返回 null 而非抛错', () => {
    expect(parseJudgeResponse('抱歉我无法评分')).toBeNull()
  })

  it('分数越界时返回 null——宁可缺数据也不要错数据', () => {
    expect(parseJudgeResponse('{"factuality":9,"completeness":4,"groundedness":3}')).toBeNull()
    expect(parseJudgeResponse('{"factuality":0,"completeness":4,"groundedness":3}')).toBeNull()
  })

  it('缺字段时返回 null', () => {
    expect(parseJudgeResponse('{"factuality":5}')).toBeNull()
  })
})

describe('judgeAnswer', () => {
  it('返回解析后的三维分数', async () => {
    const scores = await judgeAnswer({
      question: 'Q?', evidence: 'E', answer: 'A',
      client: client('{"factuality":5,"completeness":4,"groundedness":5}'),
    })
    expect(scores).toEqual({ factuality: 5, completeness: 4, groundedness: 5 })
  })

  it('judge 调用抛错时返回 null，不打断评测', async () => {
    const failing = {
      complete: vi.fn().mockRejectedValue(new Error('judge 503')),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    } as never
    expect(await judgeAnswer({ question: 'Q?', evidence: 'E', answer: 'A', client: failing }))
      .toBeNull()
  })

  it('prompt 中嵌入 rubric 版本号，使缓存在 rubric 改动后失效', async () => {
    const c = client('{"factuality":5,"completeness":5,"groundedness":5}')
    await judgeAnswer({ question: 'Q?', evidence: 'E', answer: 'A', client: c })
    expect((c as unknown as { complete: { mock: { calls: string[][] } } }).complete.mock.calls[0][0])
      .toContain(RUBRIC_VERSION)
  })
})

describe('judgeUnanswerable', () => {
  it('judge 回 REFUSAL 时判为拒答', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('REFUSAL') }))
      .toBe(true)
  })

  it('judge 回 ANSWERED 时判为未拒答', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('ANSWERED') }))
      .toBe(false)
  })

  it('回复无法识别时返回 null', async () => {
    expect(await judgeUnanswerable({ question: 'Q?', answer: 'A', client: client('嗯') }))
      .toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run bench/src/tests/judge.test.ts`
Expected: FAIL，报 `Failed to resolve import "../metrics/judge"`

- [ ] **Step 3: 实现 `bench/src/metrics/judge.ts`**

```typescript
import type { LlmClient } from '../llmClient'

/**
 * Rubric 版本号。嵌在 prompt 中，因此改动 rubric 会自动使缓存失效
 * （缓存 key 按 prompt 哈希）。改 rubric 必须 bump 此值。
 */
export const RUBRIC_VERSION = 'rubric-v1'

export interface JudgeScores {
  factuality: number
  completeness: number
  groundedness: number
}

export interface JudgeArgs {
  question: string
  /** evidence 原文。刻意不传参考答案——与 answerF1 同源会失去互补性 */
  evidence: string
  answer: string
  client: LlmClient
}

export function buildJudgePrompt(args: { question: string; evidence: string; answer: string }): string {
  return `[${RUBRIC_VERSION}] 你是学术问答质量评审。仅依据给出的论文原文片段评估回答，不要使用你自己的知识。

问题：
${args.question}

论文原文片段：
${args.evidence}

待评估回答：
${args.answer}

按三个维度各打 1-5 分（5 最好）：
- factuality：回答中的陈述是否与原文片段一致（有事实错误则低分）
- completeness：是否完整回答了问题（遗漏关键信息则低分）
- groundedness：是否只用了原文片段中的信息（引入片段外内容则低分）

只回 JSON，不要解释：{"factuality":N,"completeness":N,"groundedness":N}`
}

const DIMENSIONS = ['factuality', 'completeness', 'groundedness'] as const

export function parseJudgeResponse(raw: string): JudgeScores | null {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const dim of DIMENSIONS) {
      const v = parsed[dim]
      // 越界或非数值一律作废——缺数据好过错数据
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 5) return null
      out[dim] = v
    }
    return out as unknown as JudgeScores
  } catch {
    return null
  }
}

export async function judgeAnswer(args: JudgeArgs): Promise<JudgeScores | null> {
  try {
    const raw = await args.client.complete(buildJudgePrompt(args))
    return parseJudgeResponse(raw)
  } catch {
    return null
  }
}

/** 用 judge 做「是否拒答」二分类，比正则表更宽容于表述变体。 */
export async function judgeUnanswerable(args: {
  question: string
  answer: string
  client: LlmClient
}): Promise<boolean | null> {
  const prompt = `[${RUBRIC_VERSION}] 判断下面的回答是否表达了「无法根据给定内容回答」。

问题：${args.question}

回答：${args.answer}

只回一个词：REFUSAL（表达了无法回答）或 ANSWERED（给出了实质回答）。`

  try {
    const raw = (await args.client.complete(prompt)).trim().toUpperCase()
    if (raw.includes('REFUSAL')) return true
    if (raw.includes('ANSWERED')) return false
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/judge.test.ts`
Expected: `Tests 14 passed`

- [ ] **Step 5: 在 `bench/src/runner/qa.ts` 中接入 judge**

在 `QaTaskArgs` 中加两个字段：

```typescript
export interface QaTaskArgs {
  samples: EvalSample[]
  config: BenchConfig
  client: LlmClient
  systemPrompt: string
  limit?: number
  gitSha: string
  model: string
  /** 提供时启用 LLM-as-judge；通常与 client 用不同模型 */
  judgeClient?: LlmClient
  judgeModel?: string
  deps?: QaTaskDeps
}
```

顶部加 import：

```typescript
import { judgeAnswer, judgeUnanswerable } from '../metrics/judge'
```

把原来的 unanswerable / answerF1 分支替换为下面这段（`evidenceText` 需在其上方计算）：

```typescript
        // judge 只看 evidence 原文，不看检索到的上下文——避免检索失败连带压低 judge 分
        const evidenceText = question.evidencePages
          .map(p => sample.pages[p] ?? '')
          .join('\n\n')

        if (question.unanswerable) {
          sawUnanswerable = true
          if (args.judgeClient) {
            const verdict = await judgeUnanswerable({
              question: question.question,
              answer: result.answer,
              client: args.judgeClient,
            })
            // judge 不可用时回落到正则口径，并如实记录用了哪种
            if (verdict === null) {
              metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
              usedPatternFallback = true
            } else {
              metrics.unanswerableAccuracy = verdict ? 1 : 0
            }
          } else {
            metrics.unanswerableAccuracy = isRefusal(result.answer) ? 1 : 0
            usedPatternFallback = true
          }
        } else {
          metrics.answerF1 = answerF1(result.answer, question.answers)

          if (args.judgeClient && evidenceText) {
            const scores = await judgeAnswer({
              question: question.question,
              evidence: evidenceText,
              answer: result.answer,
              client: args.judgeClient,
            })
            if (scores) {
              metrics.judgeFactuality = scores.factuality
              metrics.judgeCompleteness = scores.completeness
              metrics.judgeGroundedness = scores.groundedness
            }
            // scores 为 null 时不写指标 → aggregate 自动从分母剔除
          }
        }
```

在函数开头 `let sawUnanswerable = false` 旁边加：

```typescript
  let usedPatternFallback = false
```

并把 `meta` 的构造改为：

```typescript
    meta: {
      model,
      ...(args.judgeModel ? { judgeModel: args.judgeModel } : {}),
      timestamp: new Date().toISOString(),
      gitSha,
      completed: perSample.length,
      total,
      ...(sawUnanswerable
        ? { unanswerableMethod: (args.judgeClient && !usedPatternFallback ? 'judge' : 'pattern') as 'judge' | 'pattern' }
        : {}),
    },
```

- [ ] **Step 6: 在 `bench/src/cli.ts` 中接线 `--judge`**

在 QA 分支里，`runQaTask` 调用前加：

```typescript
    const judgeModel = process.env.BENCH_JUDGE_MODEL
    if (args.judge && !judgeModel) {
      throw new Error('--judge 需要设置环境变量 BENCH_JUDGE_MODEL')
    }
    const judgeClient = args.judge
      ? createLlmClient({ ...env, model: judgeModel!, useCache: args.useCache })
      : undefined
```

并把调用参数补上：

```typescript
      model: env.model,
      judgeClient,
      judgeModel: args.judge ? judgeModel : undefined,
```

- [ ] **Step 7: 加 judge 接入的 runner 测试**

在 `bench/src/tests/qaRunner.test.ts` 末尾追加：

```typescript
describe('runQaTask + judge', () => {
  const judgeClient = {
    complete: vi.fn().mockResolvedValue('{"factuality":5,"completeness":4,"groundedness":5}'),
    chat: vi.fn(),
    stats: () => ({ hits: 0, misses: 0 }),
    latencies: () => [],
  }

  it('启用 judge 时记录三维分数并标注 judgeModel', async () => {
    const result = await runQaTask({
      ...baseArgs,
      judgeClient: judgeClient as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })

    expect(result.metrics.judgeFactuality).toBe(5)
    expect(result.metrics.judgeCompleteness).toBe(4)
    expect(result.metrics.judgeGroundedness).toBe(5)
    expect(result.meta.judgeModel).toBe('judge-model')
  })

  it('judge prompt 用 evidence 原文而非检索上下文', async () => {
    judgeClient.complete.mockClear()
    await runQaTask({
      ...baseArgs,
      judgeClient: judgeClient as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })
    // sample.pages[0] === 'a'，evidencePages 为 [0]
    expect(judgeClient.complete.mock.calls[0][0]).toContain('a')
  })

  it('judge 返回不可解析内容时不写 judge 指标，其余指标照常', async () => {
    const badJudge = {
      complete: vi.fn().mockResolvedValue('我拒绝评分'),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    }
    const result = await runQaTask({
      ...baseArgs,
      judgeClient: badJudge as never,
      judgeModel: 'judge-model',
      deps: makeDeps() as never,
    })

    expect(result.metrics.judgeFactuality).toBeUndefined()
    expect(result.metrics.answerF1).toBe(1)
  })

  it('judge 判定 unanswerable 时 meta 标注口径为 judge', async () => {
    const refusalJudge = {
      complete: vi.fn().mockResolvedValue('REFUSAL'),
      chat: vi.fn(), stats: () => ({ hits: 0, misses: 0 }), latencies: () => [],
    }
    const deps = makeDeps({
      runPipeline: vi.fn().mockResolvedValue({
        answer: '无从判断', retrievals: [], retrievalQuery: 'Q?', rewritten: false,
        context: '', sources: [], llmCalls: 1,
      }),
    })
    const unanswerableSample: EvalSample = {
      ...sample,
      questions: [{ id: 'p1#0', question: 'Q?', answers: [], evidencePages: [], unanswerable: true }],
    }
    const result = await runQaTask({
      ...baseArgs,
      samples: [unanswerableSample],
      judgeClient: refusalJudge as never,
      judgeModel: 'judge-model',
      deps: deps as never,
    })

    expect(result.metrics.unanswerableAccuracy).toBe(1)
    expect(result.meta.unanswerableMethod).toBe('judge')
  })
})
```

- [ ] **Step 8: 跑测试确认通过**

Run: `npx vitest run bench/src/tests/qaRunner.test.ts bench/src/tests/judge.test.ts`
Expected: `Tests 18 passed`（qaRunner 14 + judge 14 = 28；具体数以实际为准，关键是全绿）

- [ ] **Step 9: 确认无回归**

Run: `npm test && npm run typecheck`
Expected: 全绿、typecheck 无输出

---

## Task 15: 使用文档

**Files:**
- Create: `bench/README.md`
- Create: `bench/CLAUDE.md`
- Modify: `CLAUDE.md`（根目录，加 bench 模块条目与变更记录）

**Interfaces:**
- Consumes: 全部前序模块的最终形态
- Produces: 无代码产物

- [ ] **Step 1: 写 `bench/README.md`**

```markdown
# PaperMind Benchmark

量化衡量论文问答（RAG）与摘要生成性能，支持配置消融对比。

设计文档：[docs/superpowers/specs/2026-09-02-benchmark-design.md](../docs/superpowers/specs/2026-09-02-benchmark-design.md)

## 准备

### 1. 环境变量

```bash
export BENCH_LLM_PROVIDER=openai        # openai | anthropic | ollama，默认 openai
export BENCH_LLM_MODEL=gpt-4o           # 必填
export BENCH_LLM_API_KEY=sk-...
export BENCH_LLM_BASE_URL=https://api.openai.com/v1
export BENCH_JUDGE_MODEL=gpt-4o         # 仅 --judge 时需要
export HF_TOKEN=hf_...                  # 仅摘要任务需要
```

评测固定 `temperature=0`，与生产 profile 的 0.7 不同 —— 分数必须可复现。

### 2. 数据集

```bash
# QASPER（默认 60 篇，可用 QASPER_LIMIT 调整）
npx tsx bench/datasets/qasper/fetch.ts

# 冒烟集：见 datasets/smoke/README.md 自行准备 PDF 与标注
```

## 运行

```bash
npm run bench -- --task qa      --dataset qasper --config default
npm run bench -- --task summary --dataset smoke  --config default
npm run bench -- --task qa --config ablation-topk         # 跑 topK 消融矩阵
npm run bench -- --task qa --dataset smoke --limit 5      # 快速迭代
npm run bench -- --task qa --judge                        # 加 LLM-as-judge
npm run bench -- --compare results/a.json results/b.json  # 对比两次结果
```

结果 JSON 落 `results/`，Markdown 报表打到 stdout。

## 指标速查

**检索** —— `evidenceRecall`（主指标）、`evidenceHitRate`、`contextPrecision`、`mrr`、`contextTokens`

`evidenceRecall` 与 `contextPrecision` 必须一起看：调大 `topK` 会让前者升、后者降。

**答案** —— `answerF1`（QASPER token 级 F1）、`unanswerableAccuracy`（该拒答时是否拒答）、`judge*`（三维 1-5 分，仅 `--judge`）

**摘要** —— `rouge1` / `rouge2` / `rougeL`、`compressionRatio`、`emptyRate`

`emptyRate` 高意味着 HF 端点在返回空串，而非模型质量差 —— 这两种情况必须分开看。

**管线诊断** —— `degradedRate`、`rewriteRate`、`llmCallsPerQuery`、`leafCount`、`latencyP50` / `latencyP95`

## 已知局限

- **QASPER 用伪页**：段落按约 3000 字符聚成伪页，与真实排版不同。因此语义分块（`detectSectionBoundaries`）的效果只在冒烟集上可信
- **`rewriteRate` 恒为 0**：两个数据集都是单轮问答，无对话历史，`rewriteQuery` 不会触发。评测查询改写需要多轮数据集
- **`unanswerableAccuracy` 有两种口径**：默认正则模式匹配，`--judge` 时用 judge 判定。结果 JSON 的 `meta.unanswerableMethod` 标注了实际口径，跨口径的数字不可直接对比

## 缓存

LLM 响应按 `sha256(model + messages)` 缓存到 `cache/`。这让配置矩阵可行：不同 `topK` 共享同一份索引构建结果，只有评分调用需要重发。

`--no-cache` 强制重跑。改动 judge rubric 需 bump `RUBRIC_VERSION`（版本号嵌在 prompt 里，所以会自动使缓存失效）。
```

- [ ] **Step 2: 写 `bench/CLAUDE.md`**

遵循项目现有模块文档的格式（面包屑 + 变更记录 + 模块职责 + 表格）：

```markdown
[根目录](../CLAUDE.md) > **bench/**

# bench/ — 评测 Benchmark

**变更记录**
- 2026-09-02: 初始化——QA（检索 + 答案）与摘要评测，支持配置矩阵消融

---

## 模块职责

Node CLI 评测套件。以 ESM 运行（`bench/package.json` 声明 `type: module`），通过 `tsx` 直接执行 TypeScript，import `src/utils/*` 复用生产管线，**不引入 Electron 与 better-sqlite3**。

使用方式见 [README.md](./README.md)，设计依据见 [设计文档](../docs/superpowers/specs/2026-09-02-benchmark-design.md)。

## 结构

| 路径 | 职责 |
|------|------|
| `src/types.ts` | 全部共享类型：`EvalSample` / `BenchConfig` / `BenchResult` 等 |
| `src/llmClient.ts` | 带磁盘缓存的 LLM 客户端，凭据读 `BENCH_*` 环境变量，固定 `temperature=0` |
| `src/config.ts` | 配置加载 + 矩阵笛卡尔积展开 |
| `src/args.ts` | CLI 参数解析（纯函数，单独测试） |
| `src/cli.ts` | 入口，薄编排层 |
| `src/metrics/retrieval.ts` | `evidenceRecall` / `evidenceHit` / `contextPrecision` / `mrr` / `contextTokens` |
| `src/metrics/answerF1.ts` | QASPER token 级 F1 + 拒答模式表（`REFUSAL_PATTERN_VERSION`） |
| `src/metrics/rouge.ts` | ROUGE-1/2/L F-measure + 摘要指标 |
| `src/metrics/judge.ts` | LLM-as-judge，rubric 版本化（`RUBRIC_VERSION`） |
| `src/metrics/aggregate.ts` | 逐样本 → 聚合均值、分位数；缺指标的样本自动从分母剔除 |
| `src/datasets/qasper.ts` | QASPER 归一化（段落 → 伪页）与加载 |
| `src/datasets/smoke.ts` | 真实 PDF 冒烟集加载（1-based 标注 → 0-based） |
| `src/runner/qa.ts` | QA 编排：建索引 → `runRagPipeline` → 打分 |
| `src/runner/summary.ts` | 摘要编排：全文 → `summarizeAcademicText` → ROUGE |
| `src/report.ts` | 结果 → Markdown 表格 / 差异表 |
| `datasets/qasper/fetch.ts` | 一次性拉取脚本（HF datasets-server） |

## 设计约束

- **必须复用生产代码**：评测调 `runRagPipeline` / `buildPageIndex` / `summarizeAcademicText`，不重写管线。否则评测的是影子实现，结果无意义
- **失败不中断**：单样本失败记入 `errors[]` 并从指标分母剔除，报表打印 `completed/total`。否则超时会被误读为质量下降
- **口径必须自证**：`unanswerableMethod`、`REFUSAL_PATTERN_VERSION`、`RUBRIC_VERSION`、`gitSha` 都写进结果 JSON，让任何一个数字都能追溯到产生它的口径与代码版本
- **不改生产 prompt**：拒答指令等改进属设计文档第 11 节「待验证改进项」，须先有基线数据

## 常见问题

**Q: 为什么 bench 要单独一个 `package.json`？**
根 `package.json` 不能声明 `type: module`（Electron 主进程需要 CJS），但 bench 需要 ESM 才能 import pdfjs 的 `.mjs` 构建并使用顶层 await。

**Q: 为什么 `evidenceRecall` 是主指标而不是 `answerF1`？**
漏检直接导致幻觉，是链路上游的根因。`answerF1` 受生成模型能力影响大，对检索策略改动的敏感度低。

**Q: 单测在 `npm test` 里跑吗？**
是。`vite.config.ts` 的 `test.exclude` 未排除 `bench/`，`bench/src/tests/*.test.ts` 会被一并收集。涉及 `pageIndex` 的测试需 `vi.mock('pdfjs-dist/legacy/build/pdf.mjs')`。

## 相关文件

- `src/utils/ragPipeline.ts` — 被测的 RAG 主流程
- `src/utils/pageIndex.ts` — `buildPageIndex` / `scoreAndSelect`
- `src/utils/abstractSummarizer.ts` — `summarizeAcademicText`
```

- [ ] **Step 3: 更新根 `CLAUDE.md`**

在「模块结构」的 mermaid 图中，`A` 的子节点追加一行：

```
    A --> J["bench"]
```

并在 `click` 列表末尾追加：

```
    click J "./bench/CLAUDE.md" "评测 Benchmark"
```

在「模块索引」表格末尾追加一行：

```
| 评测 | `bench/` | QA / 摘要 benchmark，配置矩阵消融，Node CLI |
```

在「运行与开发」的命令块末尾追加：

```bash
# 评测（需先配置 BENCH_* 环境变量，见 bench/README.md）
npm run bench -- --task qa --dataset smoke --limit 5
```

在「变更记录」最上方插入一行（保持倒序）：

```
- 2026-09-02: 新增 `bench/` 评测套件（QA 检索/答案 + 摘要，配置矩阵消融）；RAG 管线抽出为 `src/utils/ragPipeline.ts` 纯函数以供评测复用
```

- [ ] **Step 4: 确认文档链接可达**

Run: `ls bench/README.md bench/CLAUDE.md docs/superpowers/specs/2026-09-02-benchmark-design.md`
Expected: 三个文件都存在

- [ ] **Step 5: 最终全量验证**

Run: `npm test && npm run typecheck`
Expected: 全绿、typecheck 无输出

---

## Self-Review 记录

**Spec 覆盖检查**

| Spec 章节 | 对应 Task |
|-----------|-----------|
| §3 前置重构 | 已在计划前完成（`ragPipeline.ts` 等），Task 1 Step 5 验证可 import |
| §4 目录结构 | Task 1（骨架）、各 Task 创建对应文件 |
| §5.1 QASPER 伪页 | Task 9 |
| §5.2 冒烟集标注 | Task 8 |
| §6.1 检索指标 | Task 3 |
| §6.2 QA 生成指标 | Task 4（F1、拒答）、Task 14（judge） |
| §6.2 摘要指标 | Task 5 |
| §6.3 管线诊断指标 | Task 6（聚合）、Task 10（采集） |
| §7 CLI 契约 | Task 13 |
| §8 缓存策略 | Task 2（按 prompt 哈希，天然覆盖 `IndexOptions`，见 Task 2 说明） |
| §9 错误处理 | Task 10、Task 11（`errors[]` + 分母剔除）、Task 12（报表打印） |
| §10 结果与报表 | Task 12 |
| §11 待验证改进项 | 不实现，记录在 Global Constraints 与 `bench/CLAUDE.md` |
| §12 实施顺序 | 本计划 Task 顺序与之一致，仅将「指标」细分为独立 Task 以便逐个测试 |

**发现并已修正的问题**

1. Spec §8 要求索引缓存 key 含 `IndexOptions`，但按 prompt 哈希已天然满足（分块参数改变会改变 prompt 文本）。Task 2 中显式说明这是等价简化，避免实现者画蛇添足加一层缓存
2. Spec 未提及 `rewriteRate` 在单轮数据集上恒为 0 的问题。已在 Task 10 实现说明与 `bench/README.md`「已知局限」中记录
3. Spec §6.2 的 `unanswerableAccuracy` 有 pattern / judge 两种口径。Task 10 与 Task 14 中通过 `meta.unanswerableMethod` 显式标注，并在 judge 不可用回落时如实记为 `pattern`
4. 类型一致性核对：`RetrievalResult.llmCalled`（生产代码已加）、`SummaryMetrics.empty` → 聚合后重命名 `emptyRate`、`RetrievalMetrics.evidenceHit` → `evidenceHitRate`，重命名逻辑集中在各 runner 的 `renameRates`，报表侧不做二次转换

**未包含的 spec 内容**：无。
