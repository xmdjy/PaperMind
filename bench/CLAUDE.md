[根目录](../CLAUDE.md) > **bench/**

# bench/ — 评测 Benchmark

**变更记录**
- 2026-09-04: 补充使用文档（`README.md`）——CLI 契约、指标速查、缓存口径与已知局限
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
| `src/paths.ts` | 从 `import.meta.url` 解析 bench 内相对路径（规避 `.pathname` 的百分号转义坑） |
| `src/cli.ts` | 入口，薄编排层 |
| `src/metrics/retrieval.ts` | `evidenceRecall` / `evidenceHit` / `contextPrecision` / `mrr` / `contextTokens` |
| `src/metrics/answerF1.ts` | QASPER token 级 F1 + 拒答模式表（`REFUSAL_PATTERN_VERSION`） |
| `src/metrics/rouge.ts` | ROUGE-1/2/L F-measure + 摘要指标 |
| `src/metrics/judge.ts` | LLM-as-judge，rubric 版本化（`RUBRIC_VERSION`） |
| `src/metrics/aggregate.ts` | 逐样本 → 聚合均值、分位数；缺指标的样本自动从分母剔除 |
| `src/datasets/qasper.ts` | QASPER 归一化（段落 → 约 3000 字符伪页）与加载 |
| `src/datasets/smoke.ts` | 真实 PDF 冒烟集加载（1-based 标注 → 0-based） |
| `src/runner/qa.ts` | QA 编排：建索引 → `runRagPipeline` → 打分 |
| `src/runner/summary.ts` | 摘要编排：全文 → `summarizeAcademicText` → ROUGE |
| `src/report.ts` | 结果 → Markdown 表格 / 差异表 |
| `configs/*.json` | 配置文件：`default` 基线、`ablation-topk` topK 消融矩阵 |
| `datasets/qasper/fetch.ts` | 一次性拉取脚本（HF datasets-server） |
| `datasets/smoke/` | 冒烟集 manifest / 标注 / 准备指南（PDF 放 `papers/`，git-ignored） |
| `src/tests/*.test.ts` | 15 个单测文件，随 `npm test` 一并收集 |
| `results/`、`cache/` | 运行时产物：结果 JSON / LLM 响应缓存（首次运行生成） |

## 设计约束

- **必须复用生产代码**：评测调 `runRagPipeline` / `buildPageIndex` / `summarizeAcademicText`，不重写管线。否则评测的是影子实现，结果无意义
- **失败不中断**：单样本失败记入 `errors[]` 并从指标分母剔除，报表打印 `completed/total`。否则超时会被误读为质量下降
- **口径必须自证**：`unanswerableMethod`、`cacheMode`、`REFUSAL_PATTERN_VERSION`、`RUBRIC_VERSION`、`gitSha` 都写进结果 JSON，让任何一个数字都能追溯到产生它的口径与代码版本
- **不改生产 prompt**：拒答指令等改进属设计文档第 11 节「待验证改进项」，须先有基线数据

## 常见问题

**Q: 为什么 bench 要单独一个 `package.json`？**
根 `package.json` 不能声明 `type: module`（Electron 主进程需要 CJS），但 bench 需要 ESM 才能 import pdfjs 的 `.mjs` 构建并使用顶层 await。

**Q: 为什么 `evidenceRecall` 是主指标而不是 `answerF1`？**
漏检直接导致幻觉，是链路上游的根因。`answerF1` 受生成模型能力影响大，对检索策略改动的敏感度低。

**Q: 单测在 `npm test` 里跑吗？**
是。`vite.config.ts` 的 `test.exclude` 未排除 `bench/`，`bench/src/tests/*.test.ts` 会被一并收集。涉及 `pageIndex` 的测试需 `vi.mock('pdfjs-dist/legacy/build/pdf.mjs')`。

**Q: 已知口径局限有哪些？**
见 [README.md 的「已知局限」](./README.md#已知局限)：中文不分词导致 F1 退化为完全匹配、ROUGE 分词与官方实现不一致、`rewriteRate` 单轮数据集下恒为 0、evidence 反查天花板约 92%、`--no-cache` 只跳过读不覆写等——解读数字前先读。

## 相关文件

- `src/utils/ragPipeline.ts` — 被测的 RAG 主流程
- `src/utils/pageIndex.ts` — `buildPageIndex` / `scoreAndSelect`
- `src/utils/abstractSummarizer.ts` — `summarizeAcademicText`
