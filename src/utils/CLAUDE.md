> [根目录](../CLAUDE.md) / src/utils

# src/utils

PDF 工具函数模块。

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

**注意**：`fileData` 仅用于传输给 `window.db.paper.create`，写入磁盘后不再保留在 Pinia store 内存中。

#### `base64ToUrl(base64: string)`

```ts
function base64ToUrl(base64: string): string
// 返回 blob: URL，type = 'application/pdf'
// 调用方负责在组件卸载时 URL.revokeObjectURL()
```

将主进程读回的 base64 字符串转为可直接传给 pdfjs `getDocument({ url })` 的 Blob URL。

## 测试

`src/tests/pdfUtils.test.ts` — 覆盖 `base64ToUrl` 的 URL 格式和 Blob type。
`parsePdfMeta` 的完整测试需要真实 PDF 文件，建议作 fixture 测试补充。
