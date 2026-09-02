# PaperMind 评测 Benchmark 设计

- 日期：2026-09-02
- 状态：设计已确认，待实现
- 目标：量化衡量论文问答（RAG 检索 + 答案生成）与摘要生成两条链路的性能，支持配置消融对比

---

## 1. 背景与目标

PaperMind 的问答链路为三步 RAG（查询改写 → 节点评分多选 → 生成回答），摘要链路为 T5-small 递归归约。两条链路都有大量可调参数（`topK`、`minScore`、分块策略等），但此前无任何量化手段，参数取值靠直觉。

本 benchmark 要回答三个问题：

1. **现在多好** —— 给出检索、答案、摘要三层的基线分数
2. **改动是否有增益** —— 改一版策略后重跑，分数可对比
3. **哪组参数最好** —— 通过配置矩阵做消融

非目标：不追求与学界 SOTA 对齐排名；不评测 UI/交互；不做性能压测。

---

## 2. 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 数据集 | QASPER（主量化）+ 真实 PDF 冒烟集（混合） | QASPER 有 evidence 标注且样本量足够；真实 PDF 才能暴露 `extractPages`/`detectSectionBoundaries` 的解析质量问题 |
| 执行环境 | Node CLI 脚本（`npm run bench`） | 可 CI、可批量、可缓存 LLM 响应、结果可留档；不污染 `npm test` 的确定性 |
| 质量打分 | 双轨：自动指标常跑 + LLM-as-judge 按需 | 自动指标是便宜的回归哨兵，judge 抓自动指标看不见的幻觉；摘要侧只用 ROUGE（T5 输出抽取性强，ROUGE 区分度足够） |
| 配置消融 | 支持矩阵 | `scoreAndSelect` 已接受 `ScoreOptions`，边际成本低；有矩阵才能用数据决定参数取值 |

---

## 3. 前置重构（已完成）

评测必须与应用跑**同一份代码**，否则评测的是影子实现。原 `sendMessage` 将 RAG 管线与 Pinia store、`window.db` IPC、消息持久化耦合，Node 侧无法调用。

已落地的改动：

| 文件 | 变更 |
|------|------|
| `src/utils/ragPipeline.ts`（新增） | 纯函数 `runRagPipeline(papers, query, history, llm, generate, systemPrompt, opts)`，返回 `{ answer, retrievals, retrievalQuery, rewritten, context, sources, llmCalls }`；`MATH_FORMAT_INSTRUCTION` 迁入此处 |
| `src/utils/pageIndex.ts` | `buildPageIndex` 新增 `IndexOptions`（`chunkPages`/`minSectionPages`/`forceFixedChunk`），默认值不变；`RetrievalResult` 新增 `llmCalled` 字段用于精确统计调用数 |
| `src/utils/llm.ts` | 新增 `ChatMessage` / `ChatLLMFn` 类型 |
| `src/stores/chat.ts` | `sendMessage` 只负责取索引与落库，管线逻辑外移；行为等价 |
| `src/tests/ragPipeline.test.ts`（新增） | 6 用例覆盖调用次数、改写触发条件、`externalContext` 短路、prompt 组装、多篇聚合 |

验证：`npm test` 73 用例全绿，`npm run typecheck` 通过。

---

## 4. 目录结构

```
bench/
├── datasets/
│   ├── qasper/
│   │   ├── fetch.ts            # 拉取 QASPER dev split → 归一化
│   │   └── qasper.jsonl        # 归一化产物（git-ignored）
│   └── smoke/
│       ├── papers/*.pdf        # 5–10 篇真实论文（git-ignored）
│       ├── manifest.json       # 论文来源与获取方式，供他人复现
│       └── annotations.json    # 人工标注的 QA + 参考摘要
├── configs/
│   ├── default.json
│   └── ablation-topk.json
├── cache/                      # LLM 响应缓存（git-ignored）
├── results/                    # 评测输出 JSON + Markdown 报表
└── src/
    ├── cli.ts                  # 参数解析与入口
    ├── runner.ts               # 编排：加载 → 建索引 → 跑管线 → 打分
    ├── llmClient.ts            # 带磁盘缓存的 LLM 客户端，凭据读环境变量
    ├── metrics/
    │   ├── retrieval.ts
    │   ├── answerF1.ts
    │   ├── rouge.ts
    │   └── judge.ts
    └── report.ts
```

执行方式：`tsx`（或 `vite-node`）直接运行 TS，import `src/utils/*`。

---

## 5. 数据集规格

### 5.1 QASPER 归一化

QASPER 提供分段落全文，无 PDF 页码。将每篇论文的段落按约 3000 字符（近似一页）切成**伪页** `pages[]`，evidence 段落映射到对应伪页号。

这样 `buildPageIndex` / `scoreAndSelect` 的接口完全不变，检索命中定义为「选中的页码区间覆盖 evidence 伪页」。

**已知局限**：伪页边界与真实排版不同，语义分块（`detectSectionBoundaries`）的效果在 QASPER 上不可信 —— 这是必须同时保留冒烟集的原因。报表中语义分块相关指标只从冒烟集统计。

归一化格式：

```json
{
  "paperId": "1234.5678",
  "title": "...",
  "pages": ["page 1 text", "..."],
  "questions": [
    {
      "q": "How many attention heads are used?",
      "answers": ["8", "eight heads"],
      "evidencePages": [3],
      "unanswerable": false
    }
  ]
}
```

### 5.2 冒烟集标注

每篇 3–5 问，人工标注（可用强模型起草后人工校对）：

```json
{
  "file": "attention.pdf",
  "referenceAbstract": "...",
  "questions": [
    { "q": "多头注意力有几个头？", "answer": "8", "evidencePages": [4] }
  ]
}
```

`evidencePages` 为 1-based 真实页码，加载时转为 0-based 与 `IndexNode` 对齐。

---

## 6. 指标定义

### 6.1 检索指标（依赖 evidence 标注，无 judge 成本）

| 指标 | 定义 |
|------|------|
| `evidenceRecall` | 选中页码区间覆盖的 evidence 页数 / evidence 总页数 |
| `evidenceHitRate` | 至少命中 1 个 evidence 页的问题占比 |
| `contextPrecision` | evidence 页数 / 选中总页数 |
| `mrr` | evidence 页首次出现在打分排序中的名次倒数；`degraded` 时记 0 |
| `contextTokens` | 选中上下文估算 token 数（字符数 / 4），成本代理指标 |

`evidenceRecall` 与 `contextPrecision` 必须并列查看：调大 `topK` 会让前者升、后者降，只看单个会得出错误结论。

### 6.2 生成指标

**QA**
- `answerF1`：QASPER 官方口径 —— 归一化（小写、去冠词、去标点、压缩空白）后 token 级 F1，多参考答案取 max
- `unanswerableAccuracy`：QASPER `unanswerable` 样本上，模型是否正确表达「无法回答」。默认用拒答模式匹配（正则表，如「无法回答」「上下文中没有」「not mentioned」等，模式表纳入版本管理）；`--judge` 启用时改用 judge 做二分类判定，结果字段标注 `method: "pattern" | "judge"` 以免两种口径的数字被混着对比
- `judgeFactuality` / `judgeCompleteness` / `judgeGroundedness`（`--judge` 时）：1–5 分。judge 输入为 `(question, evidence 原文, 生成答案)`，**不含参考答案**，以保证与 F1 的互补性；固定 judge 模型 + `temperature=0` + 缓存以保证可复现

**摘要**
- `rouge1` / `rouge2` / `rougeL`：F-measure
- `compressionRatio`：摘要长度 / 原文长度
- `emptyRate`：T5 端点失败或返回空的比例。HF 社区 Inference API 不稳定，不显式记录会让 ROUGE 被静默拉低而误判为模型质量问题

### 6.3 管线诊断指标（无需标注）

`degradedRate`（评分 JSON 解析失败率）、`rewriteRate`、`semanticChunkRate`（语义分块 vs 固定切块触发比，仅冒烟集）、`leafCountDist`（分块数 p50/p95）、`llmCallsPerQuery`、`latencyP50` / `latencyP95`。

这些指标定位问题往往比质量分更快。

---

## 7. CLI 契约

```bash
npm run bench -- --task qa      --dataset qasper --config default
npm run bench -- --task summary --dataset smoke  --config default
npm run bench -- --task qa --config configs/ablation-topk.json --judge
npm run bench -- --compare results/a.json results/b.json
```

| Flag | 作用 | 默认 |
|------|------|------|
| `--task` | `qa` / `summary` / `all` | `all` |
| `--dataset` | `qasper` / `smoke` / `all` | `all` |
| `--config` | 配置名或路径 | `default` |
| `--limit N` | 只跑前 N 个样本 | 不限 |
| `--judge` | 启用 LLM-as-judge | 关闭 |
| `--no-cache` | 绕过 LLM 响应缓存 | 关闭 |
| `--out` | 结果落盘路径 | `results/<task>-<config>-<timestamp>.json` |
| `--compare A B` | 对比两份结果，输出差异表 | — |

配置文件（矩阵靠数组展开为笛卡尔积）：

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

凭据从环境变量读取：`BENCH_LLM_PROVIDER` / `BENCH_LLM_MODEL` / `BENCH_LLM_API_KEY` / `BENCH_LLM_BASE_URL`、`BENCH_JUDGE_MODEL`、`HF_TOKEN`。不复用 SQLite 的 `settings` 表，避免 Node 侧引入 better-sqlite3 与 Electron 原生模块依赖。

---

## 8. 缓存策略

- 普通 LLM 调用：key = `sha256(model + prompt)`，存 `bench/cache/<hash>.json`
- 索引构建：key 额外拼入 `IndexOptions` 序列化值，避免不同分块配置之间串味
- judge 调用：key 含 judge 模型名与 rubric 版本号，rubric 改动后自动失效
- `--no-cache` 强制重跑并覆写缓存

缓存是矩阵评测可行的前提：三组 `topK` 共享同一份索引构建结果，只有评分调用需要重发。

---

## 9. 错误处理

单样本失败（网络超时、PDF 解析异常、HF 端点 503）**不中断整轮**：

- 记入结果 JSON 的 `errors[]`（含 sampleId、阶段、错误信息）
- 从对应指标的分母中剔除
- 报表顶部显式打印 `completed / total`

否则 5% 的超时会被误读为 5% 的质量下降。

---

## 10. 结果与报表

结果 JSON 结构：

```json
{
  "config": { "name": "default", "topK": 2, "...": "..." },
  "meta": { "model": "gpt-4o", "timestamp": "2026-09-02T12:00:00Z", "gitSha": "1b630d7", "completed": 98, "total": 100 },
  "metrics": { "evidenceRecall": 0.71, "answerF1": 0.43, "...": "..." },
  "perSample": [ { "id": "...", "metrics": {}, "retrievalQuery": "...", "selectedPages": [] } ],
  "errors": []
}
```

`report.ts` 渲染 Markdown 表格；矩阵模式下每组参数一行并标出最优行。`gitSha` 用于把分数追溯到代码版本。`perSample` 保留是为了做错误分析 —— 聚合分数只告诉你好不好，逐样本记录才告诉你为什么。

---

## 11. 待验证的改进项

benchmark 出基线后再用数据决定，本设计不改动生产代码：

1. **拒答指令**：当前 system prompt 无「上下文不足时应明确说明」的约束，`unanswerableAccuracy` 预期会很差。若基线证实，考虑加入指令并用 benchmark 验证增益，同时观察是否引起过度拒答（`answerF1` 下降）。
2. **`topK` 默认值**：现为 2，由消融矩阵给出依据。
3. **摘要模型**：若 `emptyRate` 偏高或 ROUGE 偏低，考虑更换 HF 模型或改为复用对话 LLM 做摘要。

---

## 12. 实施顺序

1. 骨架：`bench/src/cli.ts` + `llmClient.ts`（含缓存）+ 最小 runner，跑通单篇冒烟 PDF
2. 检索指标 + 冒烟集标注（先小样本验证指标计算正确）
3. QASPER 拉取与归一化，跑通主量化集
4. `answerF1` + ROUGE
5. 配置矩阵展开 + 报表
6. LLM-as-judge（可选路径，最后加）

每步产出可运行的东西，避免最后集成时才发现管线不通。
