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
export HF_MODEL=Bashaarat1/t5-small-arxiv-summarizer  # 可选，覆盖摘要模型（此为默认值）
```

评测固定 `temperature=0`，与生产 profile 的 0.7 不同 —— 分数必须可复现。

> **`BENCH_LLM_PROVIDER=anthropic` 注意**：端点形状与生产一致（`POST {baseUrl}/chat/completions` + `x-api-key` 头），仅支持 OpenAI 兼容代理；直接指向 `https://api.anthropic.com` 会 404。原生 Anthropic API 的路径是 `/v1/messages`，与该形状不匹配。

### 2. 数据集

```bash
# QASPER（默认 60 篇，可用 QASPER_LIMIT 调整）
npx tsx bench/datasets/qasper/fetch.ts

# 冒烟集：见 datasets/smoke/README.md 自行准备 PDF 与标注
```

> 端到端评测尚未真实运行过（需要真实凭据）；`bench/datasets/smoke/` 的 PDF（放入 `papers/`，已 git-ignore）与标注需按指南自行准备。

## 运行

```bash
npm run bench -- --task qa      --dataset qasper --config default
npm run bench -- --task summary --dataset smoke  --config default
npm run bench -- --task qa --config ablation-topk         # 跑 topK 消融矩阵
npm run bench -- --task qa --dataset smoke --limit 5      # 快速迭代
npm run bench -- --task qa --judge                        # 加 LLM-as-judge
npm run bench -- --task qa --mode full-context             # 无检索全文直投基线
npm run bench -- --task qa --config rag-bm25               # 传统 BM25 基线
npm run bench -- --compare results/a.json results/b.json  # 对比两次结果
```

结果 JSON 落 `results/`，Markdown 报表打到 stdout。

**QASPER 英文作答**：CLI 按 source 分组跑 QA，qasper 组会在 systemPrompt 后追加英文作答指令——参考答案是英文，模型若用中文作答，中英 token 完全不相交，answerF1 恒≈0。

**`--limit` 语义**：在 `--dataset all` 下为**每组（每个 source）各取 N 条**，不是全局 N 条。

**结果文件命名**：默认 `results/<task>-<config>-<时间戳>.json`；`--dataset all` 时按 source 各写一份（`-qasper` / `-smoke` 后缀）。多配置矩阵 + `--out` 时每个配置追加后缀，形如 `<out>-<config>-<source>.json`（如 `r-topK.1-qasper.json`），防止同名互相覆盖；`--dataset all` 单配置时 QA 报表有两行同名配置，来源靠文件名后缀区分。

**退出码**：单样本失败是正常数据点（记入 `errors[]` 继续，exit 0）；整轮零完成（典型为 API key 配错）报表照常输出后 exit 1。

## 指标速查

**检索** —— `evidenceRecall`（主指标）、`evidenceHitRate`、`contextPrecision`、`mrr`、`contextTokens`

`evidenceRecall` 与 `contextPrecision` 必须一起看：调大 `topK` 会让前者升、后者降。

> 注意天花板：evidence 反查成功率约 92%——图注类 evidence 存于 QASPER 独立字段，不在正文段落中，检索指标读数接近 92% 不代表检索已完美。

**答案** —— `answerF1`（QASPER token 级 F1）、`unanswerableAccuracy`（该拒答时是否拒答）、`judge*`（三维 1-5 分，仅 `--judge`）

**摘要** —— `rouge1` / `rouge2` / `rougeL`、`compressionRatio`、`emptyRate`

`emptyRate` 高意味着 HF 端点在返回空串，而非模型质量差 —— 这两种情况必须分开看。注意：生产 `callAbstractModel` 对空返回会抛错，真实跑分时空串多落在 errors[] 而非 emptyRate；emptyRate 主要捕捉「返回了空白串」的场景。

**管线诊断** —— `degradedRate`、`rewriteRate`、`llmCallsPerQuery`、`leafCount`、`latencyP50` / `latencyP95`。`leafCount` 为均值（分布可由结果 JSON 的 perSample 导出 p50/p95）；`semanticChunkRate` 未实现（可由 perSample 的分块信息后续补充）

## 已知局限

- **QASPER 用伪页**：段落按约 3000 字符聚成伪页，与真实排版不同。因此语义分块（`detectSectionBoundaries`）的效果只在冒烟集上可信
- **`normalizeAnswer` 对中文不分词**：整句按 1 个 token 处理，中文答案的 F1 退化为完全匹配——这是 QASPER 官方口径的固有特性。冒烟集标注指南已要求答案为词或短语；若见中文样本 F1 普遍偏低，是分词口径而非模型质量
- **ROUGE 分词复用 `normalizeAnswer`**（去冠词、无词干化），与官方 ROUGE-1.5.5 不一致，**不宜与论文发表的 ROUGE 分数直接对比**
- **`rewriteRate` 恒为 0**：两个数据集都是单轮问答，无对话历史，`rewriteQuery` 不会触发。评测查询改写需要多轮数据集
- **evidence 反查天花板约 92%**：图注类 evidence 存于 QASPER 独立字段，不在正文段落中——检索指标读数接近 92% 不代表检索已完美
- **`unanswerableAccuracy` 有两种口径**：默认正则模式匹配（`REFUSAL_PATTERN_VERSION`），`--judge` 时用 judge 判定；judge 不可用时会回落到正则并如实记为 `pattern`。结果 JSON 的 `meta.unanswerableMethod` 标注了实际口径，跨口径的数字不可直接对比

## 缓存

LLM 响应按 `sha256(provider + baseUrl + model + messages + maxTokens)` 缓存到 `bench/cache/`（字段以 `\0` 分隔）。key 含 provider、baseUrl 与生成上限——同名模型在不同端点或不同截断口径下不会串用缓存。这让配置矩阵可行：不同 `topK` 共享同一份索引构建结果，只有评分调用需要重发。失败请求也计入 misses，故 `hits/(hits+misses)` 在有错误时会偏低；runner 为纯串行，无并发去重需求——若未来并行跑样本需加 in-flight 去重，否则命中率会塌。

`--no-cache` 当前只跳过**读**缓存、不覆写已有缓存文件（与 spec §8 的「强制重跑并覆写」有差距），`meta.cacheMode` 如实记录实际口径（`normal` / `bypass`）。summary 任务走 HuggingFace 摘要模型、不经过 LLM 缓存，`cacheMode` 仅做口径统一，`--no-cache` 对它无实际作用。

改动 judge rubric 需 bump `RUBRIC_VERSION`（版本号嵌在 prompt 里，而缓存 key 按 prompt 哈希，所以会自动使缓存失效）。

## 口径自证

结果 JSON 的 `meta` 记录了 `model` / `judgeModel` / `gitSha` / `timestamp` / `unanswerableMethod` / `cacheMode`，指标侧有 `REFUSAL_PATTERN_VERSION`（报表打印拒答模式表版本）与 `RUBRIC_VERSION`——任何一个数字都能追溯到产生它的口径与代码版本。
