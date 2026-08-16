# PaperMind 高亮批注笔记设计

**日期：** 2026-08-16
**状态：** 待实现
**涉及文件：** `src/stores/paper.ts`、`src/components/NotesPanel.vue`（新增）、`src/views/ReaderView.vue`、`src/components/PdfViewer.vue`、`electron/db/index.ts`、`electron/ipc.ts`、`electron/preload.ts`、`src/types/db.d.ts`、`src/tests/paper.store.test.ts`、`src/tests/setup.ts`

---

## 背景与问题

`highlights` 表已有 `note` 字段，但：
1. 全代码库没有任何查看/编辑高亮的界面——高亮是「只写不读」的；
2. `note` 字段在 `PdfViewer.highlightSelection()` 中被写死为空串，笔记功能从未接入；
3. 没有删除高亮的 UI（`highlightApi.remove` 已存在但无界面调用）。

因此用户在阅读器中划词高亮后，既看不到高亮列表，也无法为高亮写笔记。

---

## 目标

在阅读器中提供一个「高亮 / 笔记」面板：列出当前论文的所有高亮，支持点击跳页、行内写笔记、删除高亮。完全复用现有 `highlights` 表与 `note` 字段，不引入新表。

**不在本次范围内：** 笔记富文本、时间戳、高亮改色、论文级总笔记、ChatView 中的跨论文笔记查看、`safeStorage` 加密。

---

## 设计决策

- **笔记形态**：高亮批注笔记——笔记挂在每条高亮上（`highlights.note`）。
- **编辑交互**：行内 `el-input` textarea + 失焦自动保存，无独立「保存」按钮。
- **放置位置**：阅读器右栏顶部加「对话 / 笔记」两个 Tab，避免与既有 PDF/对话分栏冲突。
- **响应式**：store 维护一个响应式 `highlights` 数组，划词新增高亮后面板实时更新，无需手动刷新。

---

## 架构变更

### 1. 数据层（4 文件同步）

**`electron/db/index.ts`** — `highlightApi` 新增 `update`：

```ts
update: (id: string, patch: { note?: string }) => {
  const cur = db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any
  if (!cur) return
  db.prepare('UPDATE highlights SET note = ? WHERE id = ?').run(patch.note ?? cur.note, id)
},
```

**`electron/ipc.ts`** — 新增 handler：

```ts
'highlight:update': (_e, id, patch) => highlightApi.update(id, patch),
```

**`electron/preload.ts`** — 暴露：

```ts
update: (id: string, patch: unknown) => ipcRenderer.invoke('highlight:update', id, patch),
```

**`src/types/db.d.ts`** — `highlight` 增加 `update: (id: string, patch: any) => Promise<void>`。

### 2. 状态层（`src/stores/paper.ts`）

新增 `Highlight` 接口与响应式列表：

```ts
export interface Highlight {
  id: string
  paperId: string
  text: string
  pageNum: number
  color: string
  note: string
  startOffset: number
  endOffset: number
  createdAt: number
}
```

新增 `const highlights = ref<Highlight[]>([])`。

- `loadHighlights(paperId)`：`highlights.value = await window.db.highlight.listByPaper(paperId)`。
- `addHighlight(h)`：现有逻辑之外，`highlights.value.push(highlight)`。
- `updateHighlight(id, patch)`：`await window.db.highlight.update(id, patch)` 后合并本地对应项。
- `removeHighlight(id)`：现有逻辑之外，`highlights.value = highlights.value.filter(h => h.id !== id)`。

既有 `getHighlights(paperId)`（一次性拉取，供 PdfViewer 挂载时填充渲染 segments）保持不变。

### 3. UI

**`PdfViewer.vue`** — 暴露跳页：

```ts
defineExpose({ scrollToPage })
```

（`scrollToPage(num)` 已存在，仅需导出。）

**`ReaderView.vue`** — 右栏改为 Tab 结构：

```
[topbar]
[ PDF | resizer | right ]
                 └─ [对话 | 笔记] tabs
                      ├─ 对话：chat-header + ChatPanel
                      └─ 笔记：NotesPanel
```

- 新增 `rightTab = ref<'chat' | 'notes'>('chat')`、`pdfViewerRef`。
- `jumpToPage(page)` → `pdfViewerRef.value?.scrollToPage(page)`。
- `<PdfViewer ref="pdfViewerRef" ... />`。

**`NotesPanel.vue`（新增）** — 组件职责：

- props：`{ paperId: string }`；emits：`{ jump: (page: number) }`。
- 挂载与 `watch(paperId)` 时调用 `paperStore.loadHighlights`。
- `const highlights = computed(() => paperStore.highlights)`。
- 每条渲染：页码按钮（点击 `emit('jump', h.pageNum)`）+ 摘要句（截断）+ 行内 `el-input` textarea（`v-model="h.note"`，`@blur` 调 `updateHighlight(h.id, { note: h.note })`）+ 删除按钮（`ElMessageBox.confirm` 后 `removeHighlight`）。
- 空态提示。

---

## 错误处理汇总

| 场景 | 行为 |
|------|------|
| 笔记保存失败 | `updateHighlight` 抛错（`window.db` reject），`@blur` 不捕获——由组件静默或后续增强；当前先保证主流程 |
| 删除确认 | `ElMessageBox.confirm`，取消则不动 |
| 跳页到不存在页 | `scrollToPage` 内部 `querySelector` 空安全（`el?.`），无副作用 |
| 高亮列表为空 | 显示空态文案 |

---

## 数据兼容性

- 无 schema 变更（复用上一轮已加的 `start_offset`/`end_offset` 与既有 `note`）。
- 老高亮 `note` 为空串，面板显示空 textarea 占位，用户可填写。

---

## 测试计划

| 文件 | 测试用例 |
|------|---------|
| `src/tests/paper.store.test.ts` | `loadHighlights` 填充 `highlights` ref；`updateHighlight` 调用 `highlight.update` 并合并本地；`removeHighlight` 调用 `highlight.remove` 并过滤 ref |
| `src/tests/setup.ts` | `highlight` mock 补 `update` |

**说明：** DB 层 `update` 靠 `npm run typecheck` 覆盖（electron 被 vitest 排除）。

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `electron/db/index.ts` | 修改 | `highlightApi.update` |
| `electron/ipc.ts` | 修改 | `highlight:update` handler |
| `electron/preload.ts` | 修改 | `highlight.update` |
| `src/types/db.d.ts` | 修改 | `highlight.update` 类型 |
| `src/stores/paper.ts` | 修改 | 响应式 `highlights` + `loadHighlights`/`updateHighlight` + add/remove 维护 ref |
| `src/components/NotesPanel.vue` | 新增 | 高亮笔记面板 |
| `src/views/ReaderView.vue` | 修改 | 右栏 Tab + 跳页 |
| `src/components/PdfViewer.vue` | 修改 | `defineExpose({ scrollToPage })` |
| `src/tests/paper.store.test.ts` | 修改 | 新增用例 |
| `src/tests/setup.ts` | 修改 | highlight mock 补 `update` |
