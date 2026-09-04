[根目录](../../CLAUDE.md) > [src/](../) > **components/**

# src/components/ — 公共组件模块

**变更记录**
- 2026-08-02T15:49:42: 补记 ChatPanel 的 `renderMarkdown`/KaTeX 渲染与 `/abstract` 命令提示、头像资源、IME 组合态处理；PdfViewer 高亮叠加层与 HiDPI 渲染；ParamPanel 改为多 profile 选择
- 2026-07-19T14:49:32: ChatPanel / ParamPanel / PdfViewer 视觉与 a11y 微调
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

三个可复用 UI 组件，被 `ReaderView` / `ChatView` 引用。

## PdfViewer.vue

- **Props**：`src: string`（Blob URL）　**Emits**：`select-text(text: string)`
- 基于 `pdfjs-dist/legacy/build/pdf.mjs`（兼容 Electron 31）；worker 相对路径 `./pdf.worker.min.mjs`
- 一次性渲染全部页面：每页 `canvas`（按 `devicePixelRatio` 放大以适配 HiDPI，避免模糊）+ 透明 `TextLayer`（原生文本选择）
- 工具栏：分页跳转（滚动定位当前页）、缩放 0.5x–3x（缩放会 `renderPdf()` 全量重渲，大文档有开销）
- 选中文本弹浮层：**发送到对话**（emit `select-text`）/ **高亮**
- **高亮**为前端内存实现：`highlightSegments` 记录 page+offset 区间，`subtractExisting` 去重叠、`drawSegment` 按文本节点 caret 矩形绘制 `.pdf-highlight-overlay`（`mix-blend-mode: multiply`）；**尚未接入 IPC 落库**

## ChatPanel.vue

- **Props**：`conversation: Conversation | null`　**Exposes**：`addContext(text: string)`（`defineExpose`）
- 消息列表：用户/助手头像（`assets/user.png` / `assets/agent.png`），内容经 **`renderMarkdown`**（`v-html`）渲染——支持标题/列表/表格/代码块/引用/链接与 **KaTeX 数学公式**；`:deep()` 样式定制 `.katex-display`、`pre`、`table` 等
- `msg.sources` 以 chip 展示（RAG 命中的页码区间或 `/abstract` 的论文标题）
- **上下文 chip**：`addContext` 接收 PdfViewer 选中文本，暂存 `pendingContext`，发送时 `join('\n---\n')` 作为 `context` 传给 `sendMessage`
- **`/abstract` 命令提示**：输入以 `/` 开头且为 `/abstract` 前缀时，输入框上方浮出命令建议，点击填入
- 输入：`Enter` 发送、`Shift+Enter` 换行；`handleEnter` 检测 `isComposing`/`keyCode 229` 以避免中文 IME 组合期误发
- `loading` 时显示 typing 三点动画；发送异常 `ElMessage.error`

## ParamPanel.vue

- **Emits**：`close`
- 可折叠的对话参数面板（`ChatView` 右栏）：
  - **对话模型选择**：下拉切换 `chatProfileId`（`setChatProfileId`），显示 provider·model 元信息 chip
  - **Temperature / Top-K** 滑块：`updateCurrent` → `chatStore.updateProfile(chatProfile.id, {...})` 即时持久化
  - 底部「前往设置」链接到 `/settings` 做完整配置
- 通过 `storeToRefs` 读取 `profiles` / `chatProfileId` / `chatProfile`

## 相关文件

- `src/components/PdfViewer.vue` / `ChatPanel.vue` / `ParamPanel.vue`
- `assets/user.png`、`assets/agent.png` — 对话头像
- `src/utils/pdfUtils.ts` — `base64ToUrl`（由 ReaderView 调用后传入 `src`）
- `src/utils/markdown.ts` — `renderMarkdown`（ChatPanel 消息渲染）
- 状态：[src/stores](../stores/CLAUDE.md)
