[根目录](../../CLAUDE.md) > [src/](../) > **utils/**

# src/utils/ — 工具函数与 RAG 检索

**变更记录**
- 2026-08-02T15:49:42: 修正面包屑；新增 `markdown.ts`（Markdown+KaTeX 渲染）与 `abstractSummarizer.ts`（Hugging Face 摘要）文档
- 2026-07-18T00:00:00: pageIndex 语义分块 + 评分多选

## 模块职责

无状态工具集合：PDF 元数据解析、PageIndex RAG 检索、消息 Markdown/数学渲染、学术长文摘要分块。均为纯函数，便于单测。

---

## pdfUtils.ts

pdfjs-dist worker 初始化（`workerSrc = './pdf.worker.min.mjs'`，由 `vite.config.ts` 复制到 `public/`，离线可用、不依赖 CDN）+ 两个导出：

### `parsePdfMeta(file: File): Promise<{ title, authors[], abstract, year, fileData }>`
提取元数据并返回 base64 原始内容。优先用 PDF metadata（Title/Author，作者按 `,`/`;` 分割），fallback 到第 1 页文本启发式：`abstract` 匹配 `/abstract[:\s]+.{100,600}/i`、`year` 匹配 `\b(19|20)\d{2}\b`；提取失败静默返回空值。`fileData` 为 base64，供主进程写盘（内存不保留）。

### `base64ToUrl(base64: string): string`
返回 `blob:` URL（`type: application/pdf`）；调用方负责组件卸载时 `URL.revokeObjectURL()`。

---

## pageIndex.ts — RAG 检索管线

### 核心类型
```ts
interface IndexNode { title; nodeId; startPage; endPage; summary; nodes: IndexNode[] }  // page 均 0-based inclusive
type LLMFn = (prompt: string) => Promise<string>
```

### 导出函数
| 函数 | 作用 |
|------|------|
| `extractPages(base64)` | 逐页提取 PDF 文本，返回 `string[]`（0-based） |
| `detectSectionBoundaries(pages)` | 用 `SECTION_PATTERNS`（英文编号/全大写/常见节名/中文章节/中文编号）扫描，返回节标题所在页码索引；无标题返回 `[]` |
| `mergeSmallSections(ranges, minPages=2)` | 将不足 `minPages` 页的节并入前一节（首节并入后节），避免碎块 |
| `buildPageIndex(pages, llm)` | 构建 2 层树：边界 ≥2 时按语义分块（保留封面/摘要预边界页）并 `mergeSmallSections`，否则降级为 5 页固定切块（`CHUNK`）；每 leaf 调 `summarizeRange` 生成 title/summary，再汇总 root |
| `scoreAndSelect(root, pages, query, llm)` | 对叶节点打分（0-10），取 Top-2（第二节点需 ≥4）按 `startPage` 升序合并（`\n\n---\n\n` 分隔）；JSON 解析失败降级首节点；单叶节点直接返回、**不发 LLM** |

> `summarizeRange` / `buildPageIndex` 的 LLM 返回按 `{"title","summary"}` JSON 解析，失败时保留默认标题。
> ⚠️ 旧 `retrieve` API 已删除，检索统一走 `scoreAndSelect`。

---

## markdown.ts — 消息渲染

单一导出 `renderMarkdown(content: string): string`：
- `markdown-it`（`html:false, breaks:true, linkify:true`）+ `markdown-it-texmath`（`delimiters:'dollars'`，KaTeX `throwOnError:false`）
- **LaTeX 归一**：先把模型常输出的 `\[...\]` → `$$...$$`、`\(...\)` → `$...$`（markdown 会把反斜杠当转义，故需预处理）
- **链接强化**：`link_open` 规则强制 `target=_blank` + `rel=noopener noreferrer`
- **安全**：输出经 `DOMPurify.sanitize`（`USE_PROFILES: { html, mathMl }`，放行 `target`）；净化掉 `<script>`/`onerror`、拦截 `javascript:` 协议
- 引入 `katex/dist/katex.min.css`

---

## abstractSummarizer.ts — Hugging Face 摘要

服务于 `chat.ts` 的 `/abstract`。模型 `ABSTRACT_MODEL = 'Bashaarat1/t5-small-arxiv-summarizer'`，端点 `ABSTRACT_API_URL`（HF Inference API）。

| 导出 | 作用 |
|------|------|
| `splitAbstractText(text, maxChars=1600)` | 按句子边界（中英标点）切块且不超长（T5 ≤512 token）；超长句按空格硬切，保证 `join(' ')` 无损 |
| `callAbstractModel(text, token)` | `POST` HF（`inputs: "summarize: ..."`，`max_length:128/min_length:30`，`wait_for_model:true`）；解析 `summary_text`/`generated_text`；错误经 `readErrorMessage` 提取中文提示 |
| `summarizeAcademicText(text, token, summarizeChunk?)` | **递归归约**：分块 → 逐块摘要（顺序，避免压垮社区端点）→ 若 >1 块则 `join` 后再分块摘要，直至 1 块；`MAX_REDUCTION_ROUNDS=6` 上限；`summarizeChunk` 可注入（测试用） |

---

## 测试

- `pdfUtils.test.ts` — `base64ToUrl`、`detectSectionBoundaries`（英/中/大写/降级）、`mergeSmallSections`（11 用例）
- `pageIndex.test.ts` — `scoreAndSelect`（Top-2/阈值/降级/单节点短路）、`buildPageIndex`（预边界页面覆盖，6 用例）
- `abstractSummarizer.test.ts` — `splitAbstractText` 无损、`summarizeAcademicText` 递归 3 次归一（2 用例）
- `markdown.test.ts` — 结构渲染、外链、XSS 净化、危险协议、`$`/`\(\)`/`\[\]` LaTeX 归一（7 用例）

> 依赖 `pageIndex.ts` 的测试需 `vi.mock('pdfjs-dist/legacy/build/pdf.mjs')`（Node 无 DOMMatrix）。
