[根目录](../../CLAUDE.md) > [src/](../) > **components/**

# src/components/ — 公共组件模块

**变更记录**
- 2026-07-19T14:49:32: ChatPanel / ParamPanel / PdfViewer 视觉与 a11y 微调
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

三个可复用 UI 组件，被多个视图页面引用。

## 组件说明

### PdfViewer.vue

Props: `src: string`（Blob URL）
Emits: `select-text(text: string)`

基于 `pdfjs-dist` 的 PDF 渲染器：
- 一次性渲染全部页面到独立 canvas，支持缩放（0.5x–3x）和分页跳转
- 每页叠加透明文本层（`TextLayer`），支持原生文本选择
- 选中文本后弹出浮层，提供「发送到对话」和「高亮」两个操作
- 使用 `pdfjs-dist/legacy/build/pdf.mjs` 兼容 Electron 31；worker 由 `vite.config.ts` 复制到本地并通过相对路径加载，兼容开发服务器与打包后的 `file://`

注意：缩放时重新渲染全部页面（调用 `renderPdf()`），大文档时可能有性能开销。

### ChatPanel.vue

Props: `conversation: Conversation | null`
Exposes: `addContext(text: string)`

对话消息面板：
- 渲染消息列表，用户消息右对齐，助手消息左对齐
- 消息内容支持简易 Markdown（bold、inline code、换行）
- 通过 `addContext` 方法（`defineExpose`）接收来自 PdfViewer 的选中文本，以"上下文 chip"形式展示，发送时拼接为 context 参数
- Enter 发送，Shift+Enter 换行

### ParamPanel.vue

Emits: `close`

可折叠的 LLM 参数面板：
- 直接编辑 `useChatStore` 的 `config`（通过 `storeToRefs`），`@change` 时自动持久化
- 内置 5 个系统提示词模板（逐段精读、通俗解释、提取要点、批判性分析、翻译为中文），点击直接替换系统提示词

## 相关文件

- `src/components/PdfViewer.vue`
- `src/components/ChatPanel.vue`
- `src/components/ParamPanel.vue`
- `src/utils/pdfUtils.ts` — PDF 元数据解析与 base64 转 URL
