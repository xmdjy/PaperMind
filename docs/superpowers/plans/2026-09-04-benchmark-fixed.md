# Benchmark 与 PageIndex 修复施工方案

- 日期：2026-09-04
- 状态：待实施
- 目标：修复真实 PDF 语义分块、检索评测口径和评分路由的关键缺陷，使 PageIndex 改进及 benchmark 消融结果可解释、可复现。

## 背景与结论

当前 QA benchmark 确实复用生产的 `buildPageIndex` 与 `runRagPipeline`，避免了影子实现；但以下问题会使生产检索和 benchmark 结论失真：

1. `extractPages` 将 PDF.js 的文本项以空格连接，破坏了节标题识别所需的行首结构，真实 PDF 的语义分块大量退化为固定 5 页块。
2. 无 evidence 的问题仍写入 retrieval metrics，并以 0 计分，污染 QASPER 检索指标的分母。
3. QASPER 标准化没有保留 `section_name`，主量化集无法测到语义分块；仓库中的 smoke 集也尚无样本。
4. `scoreAndSelect` 未校验 LLM 返回的评分 schema，空数组、越界 id、重复 id 或不完整输出会静默走第一节 fallback。
5. 语义节长度与总上下文无预算，长章节可能造成 prompt 无界增长。
6. QASPER 的 evidence 是自由文本，重复段落只能做不确定性标注，不能从数据集中恢复唯一结构化位置。

说明：`scoreAndSelect` 当前的 `picked.sort(...)` 位于 `try` 内，坏评分不会以未捕获 TypeError 直接中断生产流程；它会进入 degraded fallback。修复仍应让解析、校验、选择处于同一个明确失败分支，并保留失败原因。

## 实施顺序

按以下顺序实施：Phase 1 → 2 → 3 → 4 → 5 → 6。完成前两个阶段前，不以 benchmark 分数作为参数消融或语义分块增益的决策依据。

## Phase 1 — P0：重建真实 PDF 行结构并验证语义分块

**改动域：** `src/utils/pageIndex.ts`、相关测试。

- 用 PDF.js `TextItem.transform` 中的 x/y 坐标及可用的 `hasEOL` 重建文本行，而非将全部 item 用空格拼接。
- 同一行按 x 坐标排序，行间保留 `\n`；保持 `extractPages` 输出仍为 `string[]`，不改变现有索引或 IPC 接口。
- 标题识别改为基于行匹配，避免整页正则在正文中误触发。
- 增加真实 PDF.js item mock：标题位于页面中部时，英文编号标题、全大写标题和中文标题均应被识别。
- 增加端到端测试：`extractPages → detectSectionBoundaries → buildPageIndex` 应产生语义范围，而不是固定 5 页范围。

**验收标准：** 带页面中部标题的 fixture 可产生至少两个正确 section range；无标题页仍稳定回退至固定分块。

## Phase 2 — P0：修正无 evidence 样本的检索指标分母

**改动域：** `bench/src/runner/qa.ts`、`bench/src/metrics/retrieval.ts`、结果类型和报表。

- `evidencePages.length === 0` 时，不写 `evidenceRecall`、`evidenceHit`、`contextPrecision`、`mrr`。
- 保留无证据样本的 `contextTokens`、`degradedRate`、`llmCallsPerQuery`、`leafCount`，以及 `unanswerableAccuracy`。
- `mrr` 只在“有 evidence、评分实际执行且评分有效”时写入；无 evidence、单叶短路和 degraded 三类均不写入。
- 在结果 JSON 和报表中增加每个检索质量指标的有效样本数，避免只有均值而没有分母。

**验收标准：** answerable/unanswerable 混合 fixture 中，四项 retrieval quality 指标仅由有 evidence 样本决定；空 evidence 不再以 0 污染任何检索指标。

## Phase 3 — P1：让主集真正覆盖语义分块

**依赖：** Phase 1 完成后确定的文本行/标题结构。

**改动域：** `bench/src/datasets/qasper.ts`、`bench/datasets/smoke/`。

- QASPER 归一化时把 `section_name` 注入每节首段之前，并保留换行，使伪页文本包含可检测标题。
- evidence 映射继续基于原始段落数组，不能用插入标题后的文本做反查。
- 增加归一化测试：标题进入页文本，evidence 仍映射至正确伪页。
- 提供最小可复现的 smoke 集：公开 PDF 的来源、校验和、下载步骤及人工标注 QA；若因版权不能提交 PDF，提供下载脚本和完整生成说明。
- 报表按 source 分开显示，并标注 QASPER 为“标题注入伪页”、smoke 为“真实 PDF”。

**验收标准：** `forceFixedChunk=true/false` 在 QASPER 与 smoke 上均能产生不同的 leaf/range；主集不再只衡量固定块检索。

## Phase 4 — P1：收紧 `scoreAndSelect` 的评分响应契约

**改动域：** `src/utils/pageIndex.ts`、`src/tests/pageIndex.test.ts`。

- 抽出 `parseAndValidateScores(raw, leafCount)`，使解析、校验和选择使用单一受控失败路径。
- 仅接受 JSON 数组；每项必须为对象，`id` 必须是范围内唯一整数，`score` 必须为有限数并限制在 `0–10`。
- 评分必须覆盖全部 leaf；空数组、缺失、重复、越界、非法值均进入 degraded fallback。
- 选择前再次按 id 去重，作为防御性兜底；正常路径不应出现重复。
- 为 `RetrievalResult` 增加可选 `degradedReason`，如 `invalid-json`、`invalid-score-schema`，供 benchmark 汇总。
- 测试覆盖空数组、越界 id、字符串 id、缺失/NaN score、重复/遗漏 id、` ```JSON ` 围栏和正文包裹 JSON。

**验收标准：** 任意 malformed LLM 输出均稳定返回首叶、`degraded=true` 和可诊断原因；不会产生重复上下文。

## Phase 5 — P1：加入章节与总上下文预算

**改动域：** `src/utils/pageIndex.ts`、`src/utils/ragPipeline.ts`、benchmark config/types。

- 新增 `maxSectionPages`：识别到的超长 section 再按页数上限拆分，标题附加 part 编号。
- 新增总 `maxContextChars` 或 token 预算：多节/多论文选择后，在生成前按文档顺序裁剪至总预算。
- 新参数须进入 benchmark matrix 和结果 JSON，支持可复现消融。
- 新增 `selectedContextTokens`（优先采用真实 tokenizer；过渡期可保留字符估计）及 `contextTruncatedRate`。

**验收标准：** 长 Methods/Appendix 不会形成无限大的单节点；多论文问答的生成 prompt 有确定上限。

## Phase 6 — P2：标注 QASPER 重复 evidence 的不确定性

**改动域：** `bench/src/datasets/qasper.ts`、结果元数据。

- 建立 `evidence text → paragraphIndexes[]` 映射。
- 唯一匹配 evidence 正常参与 retrieval 指标。
- 重复或无法匹配的 evidence 标记为 `ambiguous` / `unmapped`；相关问题继续参与答案指标，但不参与 evidence 检索指标。
- 在结果中报告 `evidenceMappingCoverage` 与 `ambiguousEvidenceRate`。

不直接将重复文本映射到所有候选页：那会扩大 gold set 并不公平地压低 Recall。

**验收标准：** benchmark 可量化 evidence 映射覆盖率和不确定性，避免将映射天花板误读为模型检索缺陷。

## 不纳入本轮代码改动：`mergeConfig` 空字符串语义

`bench/src/llmClient.ts` 的 `opts.model || env.model` 将空字符串视为未设置并回退环境变量，属于当前明确的配置契约，而非检索或评测正确性缺陷。本轮仅补充其回归测试；除非产品要求“显式空值必须报错”，否则不改行为。
