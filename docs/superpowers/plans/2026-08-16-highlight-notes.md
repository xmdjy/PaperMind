# 高亮批注笔记 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阅读器提供「高亮/笔记」面板，支持跳页、行内写笔记、删除高亮，复用现有 `highlights.note` 字段。

**Architecture:** 沿用现有分层——store 包装 `window.db`，主进程同步 better-sqlite3，经 IPC/preload 暴露。新增 `highlightApi.update` + 响应式 `highlights` ref + `NotesPanel.vue` 组件，右栏改 Tab。

**Tech Stack:** Vue 3 + Pinia + TypeScript(strict) + Electron + better-sqlite3 + Vitest。

---

## Task 1: 数据层 update 通道

**Files:**
- Modify: `electron/db/index.ts`
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/db.d.ts`
- Modify: `src/tests/setup.ts`

- [ ] **Step 1: `highlightApi.update`**

在 `electron/db/index.ts` 的 `highlightApi` 中，`remove` 之前新增：

```ts
  update: (id: string, patch: { note?: string }) => {
    const cur = db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any
    if (!cur) return
    db.prepare('UPDATE highlights SET note = ? WHERE id = ?').run(patch.note ?? cur.note, id)
  },
```

- [ ] **Step 2: IPC handler**

`electron/ipc.ts` 的 `handlers` 中，`'highlight:remove'` 之后新增：

```ts
    'highlight:update': (_e, id, patch) => highlightApi.update(id, patch),
```

- [ ] **Step 3: preload 暴露**

`electron/preload.ts` 的 `highlight` 对象中，`remove` 之后新增：

```ts
    update: (id: string, patch: unknown) => ipcRenderer.invoke('highlight:update', id, patch),
```

- [ ] **Step 4: renderer 类型**

`src/types/db.d.ts` 的 `highlight` 对象中，`remove` 之后新增：

```ts
    update: (id: string, patch: any) => Promise<void>
```

- [ ] **Step 5: setup mock**

`src/tests/setup.ts` 的 `highlight` 对象中，`remove` 之后新增：

```ts
    update: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add electron/db/index.ts electron/ipc.ts electron/preload.ts src/types/db.d.ts src/tests/setup.ts
git commit -m "feat: add highlight update channel for notes"
```

---

## Task 2: 响应式 highlights 状态 + 测试

**Files:**
- Modify: `src/stores/paper.ts`
- Test: `src/tests/paper.store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/tests/paper.store.test.ts` 的 `getHighlights` 用例之后追加：

```ts
  it('loadHighlights populates the reactive highlights list', async () => {
    ;(globalThis as any).mockDb.highlight.listByPaper.mockResolvedValue([
      { id: 'h1', paperId: 'p1', text: 'x', pageNum: 1, color: '#c9a84c', note: '', startOffset: 0, endOffset: 1, createdAt: 0 },
    ])
    const store = usePaperStore()
    await store.init()
    await store.loadHighlights('p1')
    expect(store.highlights).toHaveLength(1)
    expect(store.highlights[0].id).toBe('h1')
  })

  it('updateHighlight calls IPC and merges locally', async () => {
    ;(globalThis as any).mockDb.highlight.listByPaper.mockResolvedValue([
      { id: 'h1', paperId: 'p1', text: 'x', pageNum: 1, color: '#c9a84c', note: '', startOffset: 0, endOffset: 1, createdAt: 0 },
    ])
    const store = usePaperStore()
    await store.init()
    await store.loadHighlights('p1')
    await store.updateHighlight('h1', { note: 'my note' })
    expect((globalThis as any).mockDb.highlight.update).toHaveBeenCalledWith('h1', { note: 'my note' })
    expect(store.highlights[0].note).toBe('my note')
  })

  it('removeHighlight filters the reactive list', async () => {
    ;(globalThis as any).mockDb.highlight.listByPaper.mockResolvedValue([
      { id: 'h1', paperId: 'p1', text: 'x', pageNum: 1, color: '#c9a84c', note: '', startOffset: 0, endOffset: 1, createdAt: 0 },
    ])
    const store = usePaperStore()
    await store.init()
    await store.loadHighlights('p1')
    await store.removeHighlight('h1')
    expect((globalThis as any).mockDb.highlight.remove).toHaveBeenCalledWith('h1')
    expect(store.highlights).toHaveLength(0)
  })
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/tests/paper.store.test.ts`
Expected: FAIL——`store.loadHighlights` / `store.updateHighlight` / `store.highlights` 未定义。

- [ ] **Step 3: 实现 store 状态**

`src/stores/paper.ts`：

在 `export interface KnowledgeBase` 之后新增：

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

在 `const loaded = ref(false)` 之后新增：

```ts
  const highlights = ref<Highlight[]>([])
```

将 `addHighlight` 替换为（在 return 之前追加 push）：

```ts
  async function addHighlight(h: {
    paperId: string
    text: string
    pageNum: number
    color: string
    note: string
    startOffset: number
    endOffset: number
  }) {
    const highlight = { id: crypto.randomUUID(), ...h, createdAt: Date.now() }
    await window.db.highlight.create(highlight)
    highlights.value.push(highlight)
    return highlight
  }
```

将 `removeHighlight` 替换为：

```ts
  async function removeHighlight(id: string) {
    await window.db.highlight.remove(id)
    highlights.value = highlights.value.filter(h => h.id !== id)
  }
```

在 `getHighlights` 之后新增：

```ts
  async function loadHighlights(paperId: string) {
    highlights.value = await window.db.highlight.listByPaper(paperId)
  }

  async function updateHighlight(id: string, patch: Partial<Pick<Highlight, 'note'>>) {
    await window.db.highlight.update(id, patch)
    const idx = highlights.value.findIndex(h => h.id === id)
    if (idx !== -1) highlights.value[idx] = { ...highlights.value[idx], ...patch }
  }
```

在 `return { ... }` 中，将 `getPapersByKb, getPaper, addHighlight, getHighlights, removeHighlight,` 改为 `getPapersByKb, getPaper, highlights, addHighlight, getHighlights, loadHighlights, updateHighlight, removeHighlight,`。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/tests/paper.store.test.ts`
Expected: PASS（12 用例）

- [ ] **Step 5: Commit**

```bash
git add src/stores/paper.ts src/tests/paper.store.test.ts
git commit -m "feat: reactive highlights state with load/update/remove"
```

---

## Task 3: PdfViewer 暴露跳页

**Files:**
- Modify: `src/components/PdfViewer.vue`

- [ ] **Step 1: 暴露 scrollToPage**

在 `onBeforeUnmount` 之前新增一行：

```ts
defineExpose({ scrollToPage })
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/PdfViewer.vue
git commit -m "feat: expose scrollToPage on PdfViewer"
```

---

## Task 4: NotesPanel 组件

**Files:**
- Create: `src/components/NotesPanel.vue`

- [ ] **Step 1: 创建组件**

写入完整组件：

```vue
<template>
  <div class="notes-panel">
    <div class="notes-header">
      <span class="notes-title">高亮与笔记</span>
      <span class="notes-count tabular-nums">{{ highlights.length }} 条</span>
    </div>
    <el-scrollbar class="notes-body">
      <div v-if="highlights.length === 0" class="notes-empty">
        暂无高亮。划词后在浮层点击「高亮」，即可在此写笔记。
      </div>
      <div v-for="h in highlights" :key="h.id" class="note-item">
        <button type="button" class="note-jump" @click="emit('jump', h.pageNum)">
          第 {{ h.pageNum }} 页
        </button>
        <div class="note-text">{{ h.text }}</div>
        <el-input
          v-model="h.note"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="写笔记…"
          @blur="save(h)"
        />
        <button type="button" class="note-del" @click="del(h.id)">删除</button>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { usePaperStore } from '../stores/paper'

const props = defineProps<{ paperId: string }>()
const emit = defineEmits<{ (e: 'jump', page: number): void }>()

const paperStore = usePaperStore()
const highlights = computed(() => paperStore.highlights)

onMounted(async () => {
  await paperStore.loadHighlights(props.paperId)
})
watch(() => props.paperId, (id) => {
  paperStore.loadHighlights(id)
})

function save(h: { id: string; note: string }) {
  paperStore.updateHighlight(h.id, { note: h.note })
}

async function del(id: string) {
  await ElMessageBox.confirm('删除这条高亮？', '删除', { type: 'warning' })
  await paperStore.removeHighlight(id)
}
</script>

<style scoped>
.notes-panel { display: flex; flex-direction: column; height: 100%; background: transparent; }
.notes-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
}
.notes-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.notes-count { font-size: 11px; color: var(--text-muted); background: var(--bg-hover); padding: 1px 7px; border-radius: 999px; }
.notes-body { flex: 1; padding: 12px; }
.notes-empty { font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 8px; line-height: 1.6; }
.note-item {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; margin-bottom: 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.note-jump {
  align-self: flex-start; border: none; background: var(--accent-dim); color: var(--accent);
  font-size: 11px; padding: 2px 8px; border-radius: 999px; cursor: pointer; font-family: inherit;
}
.note-jump:hover { background: color-mix(in srgb, var(--accent) 28%, transparent); }
.note-text {
  font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.note-del {
  align-self: flex-end; border: none; background: transparent; color: var(--text-muted);
  font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-family: inherit;
}
.note-del:hover { color: var(--danger); background: var(--bg-hover); }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/NotesPanel.vue
git commit -m "feat: add highlight notes panel component"
```

---

## Task 5: ReaderView 右栏 Tab + 跳页

**Files:**
- Modify: `src/views/ReaderView.vue`

- [ ] **Step 1: 模板改造**

将右栏（`split-right`）内从 `<div class="chat-header">` 到 `</ChatPanel>` 的部分替换为 Tab 结构：

```html
      <div class="split-right" :style="{ width: `${100 - splitRatio}%` }">
        <div class="right-tabs">
          <button
            type="button"
            class="right-tab"
            :class="{ active: rightTab === 'chat' }"
            @click="rightTab = 'chat'"
          >对话</button>
          <button
            type="button"
            class="right-tab"
            :class="{ active: rightTab === 'notes' }"
            @click="rightTab = 'notes'"
          >笔记</button>
        </div>
        <template v-if="rightTab === 'chat'">
          <div class="chat-header">
            <el-select v-model="activeConvId" size="small" placeholder="选择对话" style="flex:1">
              <el-option v-for="c in paperConversations" :key="c.id" :label="c.title" :value="c.id" />
            </el-select>
            <el-button size="small" @click="createConv"><el-icon><Plus /></el-icon></el-button>
          </div>
          <ChatPanel ref="chatPanelRef" :conversation="activeConv" />
        </template>
        <NotesPanel v-else :paper-id="paper.id" @jump="jumpToPage" />
      </div>
```

并将 PDF 行改为（加 ref）：

```html
        <PdfViewer ref="pdfViewerRef" v-if="pdfUrl" :src="pdfUrl" :paper-id="paper.id" @select-text="onSelectText" />
```

- [ ] **Step 2: script 改造**

`import` 区新增：

```ts
import NotesPanel from '../components/NotesPanel.vue'
```

在 `const chatPanelRef = ...` 之后新增：

```ts
const pdfViewerRef = ref<InstanceType<typeof PdfViewer>>()
const rightTab = ref<'chat' | 'notes'>('chat')

function jumpToPage(page: number) {
  pdfViewerRef.value?.scrollToPage(page)
}
```

- [ ] **Step 3: 样式**

在 `<style scoped>` 内新增：

```css
.right-tabs {
  display: flex; border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
}
.right-tab {
  flex: 1; padding: 9px 0; border: none; background: transparent;
  font-size: 12px; color: var(--text-secondary); cursor: pointer; font-family: inherit;
  border-bottom: 2px solid transparent;
}
.right-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 500; }
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/ReaderView.vue
git commit -m "feat: tabbed right panel with notes in reader"
```

---

## Task 6: 全量验证

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 2: 全量类型检查**

Run: `npm run typecheck`
Expected: PASS

---

## 自审结论

- **Spec 覆盖**：数据层（Task1）、状态层（Task2）、跳页（Task3）、面板组件（Task4）、ReaderView 集成（Task5）、验证（Task6）——全覆盖。
- **占位符**：无 TBD/TODO，每步含完整代码。
- **类型一致性**：`updateHighlight(id, { note })` 的 patch 类型与 DB `update(id, { note? })`、IPC `(id, patch)`、store 调用三处一致；`highlight.pageNum` 为 1-based，与 `scrollToPage` 的 `data-page` 匹配。
