> [根目录](../CLAUDE.md) / src/utils

# src/utils

PDF 工具函数与 RAG 检索索引模块。

## 文件

### `pdfUtils.ts`

两个导出函数 + pdfjs-dist worker 初始化。

**Worker 配置**
```ts
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
// 文件由 vite.config.ts 启动时从 node_modules/pdfjs-dist/build/ 复制到 public/
// 离线可用，不依赖 CDN
```

#### `parsePdfMeta(file: File)`

从 PDF File 对象提取元数据并返回 base64 编码的原始内容。

```ts
async function parsePdfMeta(file: File): Promise<{
  title: string      // PDF metadata Title，fallback 文件名（去扩展名）
  authors: string[]  // PDF metadata Author，按 , ; 分割
  abstract: string   // 第 1 页文本正则匹配 /abstract[:\s]+.{100,600}/i
  year: number       // 第 1 页文本匹配 \b(19|20)\d{2}\b
  fileData: string   // PDF 二进制的 base64（传给主进程写盘，内存不保留）
}>
```

提取策略：优先用 PDF 元数据字段，fallback 到第 1 页文本启发式解析。`abstract` 和 `year` 提取失败时静默返回空值，不抛错。

#### `base64ToUrl(base64: string)`

```ts
function base64ToUrl(base64: string): string
// 返回 blob: URL，type = 'application/pdf'
// 调用方负责在组件卸载时 URL.revokeObjectURL()
```

---

### `pageIndex.ts`

论文 RAG 检索管线：构建分层索引、评分多选检索。

#### 核心类型

```ts
export interface IndexNode {
  title: string
  nodeId: string
  startPage: number  // 0-based inclusive
  endPage: number    // 0-based inclusive
  summary: string
  nodes: IndexNode[]
}
export type LLMFn = (prompt: string) => Promise<string>
```

#### `extractPages(base64: string): Promise<string[]>`

从 base64 PDF 中逐页提取文本，返回页面文本数组（0-based）。

#### `detectSectionBoundaries(pages: string[]): number[]`

扫描页面文本，识别节标题（英文编号/全大写/常见名称，中文章节），返回节标题所在的页码索引列表。无标题时返回空数组，调用方降级为固定切块。

#### `mergeSmallSections(ranges, minPages?): ranges`

将不足 `minPages`（默认2）页的节并入前一节（首节则并入后节）。避免摘要/致谢等短节产生碎块。

#### `buildPageIndex(pages, llm): Promise<IndexNode>`

构建2层树形索引（root → leaf nodes）：
1. 调用 `detectSectionBoundaries` 识别节边界，按语义分块；边界 <2 个时降级为5页固定切块
2. 预边界页面（封面、摘要等）自动作为第一个 range 保留
3. 每个 leaf 调用 `llm` 生成 `title` 和 `summary`
4. 生成 root 汇总节点

#### `scoreAndSelect(root, pages, query, llm): Promise<{ context, sources }>`

对所有叶节点打分（0-10），取 Top-2 合并上下文：
- 第二节点需 score ≥ 4 才纳入
- 选中节点按 `startPage` 升序（文档顺序）合并，节间用 `\n\n---\n\n` 分隔
- JSON 解析失败时降级为第一节点
- 单节点根节点直接返回，不发 LLM 调用

> ⚠️ **`retrieve` 已删除**（旧 API）。所有检索统一使用 `scoreAndSelect`。

## 测试

- `src/tests/pdfUtils.test.ts` — `base64ToUrl`（URL/Blob type）、`detectSectionBoundaries`（英/中标题、降级）、`mergeSmallSections`（边界合并4用例）
- `src/tests/pageIndex.test.ts` — `scoreAndSelect`（5用例：Top-2、阈值、降级、单节点短路）、`buildPageIndex`（预边界页面覆盖）
