# 高优先级缺陷修复与备份恢复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 LLM 错误静默、Anthropic 失效、高亮未持久化、备份无法恢复四个缺陷，并补全 `.gitignore`。

**Architecture:** 遵循现有分层——渲染层 store 包装 `window.db`，主进程 `electron/db/index.ts` 提供同步 better-sqlite3 API，经 `ipc.ts` / `preload.ts` 暴露。本计划不引入新依赖、不改动整体结构，只做针对性修补与增量字段。

**Tech Stack:** Vue 3 + Pinia + TypeScript(strict) + Electron + better-sqlite3 + Vitest。

---

## 前置说明（重要）

工作区当前存在**未提交的既有 WIP**（`chat.ts` 中 queryRewrite 抽取、`pageIndex.ts` 的 scoreAndSelect 结构化返回、`pageIndex.test.ts` 新增用例、新增 `queryRewrite.ts`/`llm.ts`/`queryRewrite.test.ts`）。本计划在它们之上叠加修改，**不要 revert 它们**。`git add <file>` 时这些既有改动会一并进入 diff，属于可接受的范围。

`electron/**` 被 vitest 排除（`vite.config.ts` test.exclude），因此 DB 层（schema 迁移、export/import）靠 `npm run typecheck` 覆盖，不写单测。

---

## Task 1: 补全 `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 追加忽略规则**

在文件末尾追加：

```
# Tooling caches
.codegraph/
.cursor/
```

- [ ] **Step 2: 验证 untracked 目录消失**

Run: `git status --short`
Expected: 不再出现 `?? .codegraph/` 与 `?? .cursor/`

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore codegraph and cursor tool caches"
```

---

## Task 2: LLM 错误可见 + Anthropic Messages API

**Files:**
- Modify: `src/stores/chat.ts`（`callLLM` 及新增 `readErrorBody`）
- Test: `src/tests/chat.store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/tests/chat.store.test.ts` 的 `describe('useChatStore', ...)` 末尾（最后一个 `it` 之后、`})` 之前）追加两个用例：

```ts
  it('sendMessage rejects with a readable error when the LLM returns non-200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    }) as any
    const store = useChatStore()
    await store.init()
    await store.updateProfile(store.chatProfile.id, { apiKey: 'sk-bad' })
    const conv = await store.newConversation('Chat', [])

    await expect(store.sendMessage(conv.id, 'hi'))
      .rejects.toThrow(/LLM 请求失败 \(401\).*Invalid API key/)
  })

  it('anthropic provider calls the Messages API and parses content[0].text', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ content: [{ type: 'text', text: 'Bonjour' }] }),
    }) as any
    const store = useChatStore()
    await store.init()
    await store.updateProfile(store.chatProfile.id, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      apiKey: 'sk-ant-1',
      baseUrl: 'https://api.anthropic.com',
    })
    const conv = await store.newConversation('Chat', [])
    const reply = await store.sendMessage(conv.id, 'hello')
    expect(reply).toBe('Bonjour')

    const [url, init] = (global.fetch as any).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-1', 'anthropic-version': '2023-06-01' })
    const body = JSON.parse(init.body)
    expect(body.model).toBe('claude-3-5-sonnet')
    expect(body.max_tokens).toBe(2048)
    expect(body.messages.every((m: any) => m.role !== 'system')).toBe(true)
    expect(body.system).toContain('学术论文阅读助手')
  })
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/tests/chat.store.test.ts`
Expected: FAIL——`sendMessage rejects` 用例因当前无错误抛出而失败；`anthropic provider` 用例因当前走 `/chat/completions` 而失败。

- [ ] **Step 3: 实现 `readErrorBody` + 重写 `callLLM`**

在 `src/stores/chat.ts` 的 `MATH_FORMAT_INSTRUCTION` 定义之后、`PROMPT_TEMPLATES` 之前，新增模块级辅助函数：

```ts
async function readErrorBody(res: Response): Promise<string> {
  try {
    const data = await res.json()
    const err = data?.error
    if (typeof err === 'string' && err) return err
    if (err && typeof err === 'object' && typeof err.message === 'string') return err.message
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof data?.detail === 'string' && data.detail) return data.detail
  } catch { /* fall through to status text */ }
  return `${res.status} ${res.statusText}`.trim()
}
```

将现有 `callLLM` 方法体整体替换为：

```ts
  async function callLLM(
    messages: { role: string; content: string }[],
    profileId?: string,
  ): Promise<string> {
    const profile =
      (profileId ? profiles.value.find(p => p.id === profileId) : undefined) ??
      chatProfile.value

    // ---------- Ollama ----------
    if (profile.provider === 'ollama') {
      const body: Record<string, unknown> = { model: profile.model, messages, stream: false }
      if (profile.topK > 0) body.options = { top_k: profile.topK }
      const res = await fetch(`${profile.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`LLM 请求失败 (${res.status})：${await readErrorBody(res)}`)
      const data = await res.json()
      if (typeof data.message?.content !== 'string') throw new Error('Ollama 未返回有效响应')
      return data.message.content
    }

    // ---------- Anthropic (Messages API) ----------
    if (profile.provider === 'anthropic') {
      const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
      const chatMessages = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }))
      while (chatMessages.length > 0 && chatMessages[0].role === 'assistant') chatMessages.shift()

      const body: Record<string, unknown> = {
        model: profile.model,
        max_tokens: profile.maxTokens,
        messages: chatMessages,
        temperature: Math.min(profile.temperature, 1),
      }
      if (system) body.system = system
      if (profile.topK > 0) body.top_k = profile.topK

      const res = await fetch(`${profile.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': profile.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`LLM 请求失败 (${res.status})：${await readErrorBody(res)}`)
      const data = await res.json()
      const content = data.content?.[0]?.text
      if (typeof content !== 'string') throw new Error('Anthropic 未返回有效响应')
      return content
    }

    // ---------- OpenAI / OpenAI-compatible ----------
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${profile.apiKey}`,
    }
    const body: Record<string, unknown> = {
      model: profile.model,
      messages,
      temperature: profile.temperature,
      max_tokens: profile.maxTokens,
    }

    const res = await fetch(`${profile.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`LLM 请求失败 (${res.status})：${await readErrorBody(res)}`)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('LLM 未返回有效响应')
    return content
  }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/tests/chat.store.test.ts`
Expected: PASS（含新增两用例及既有用例）

- [ ] **Step 5: Commit**

```bash
git add src/stores/chat.ts src/tests/chat.store.test.ts
git commit -m "fix: surface LLM errors and implement real Anthropic Messages API"
```

---

## Task 3: 高亮 schema 与 DB 层

**Files:**
- Modify: `electron/db/schema.ts`
- Modify: `electron/db/index.ts`

- [ ] **Step 1: schema 增列**

在 `electron/db/schema.ts` 的 `highlights` 建表语句中，`note TEXT DEFAULT '',` 之后新增两行：

```sql
  start_offset INTEGER DEFAULT 0,
  end_offset   INTEGER DEFAULT 0,
```

- [ ] **Step 2: initDb 幂等迁移**

在 `electron/db/index.ts` 的 `initDb()` 中，`db.exec(SCHEMA)` 之后、`// Seed default knowledge base` 注释之前插入：

```ts
  // Migration: highlight character offsets (added 2026-08-16)
  const highlightCols = (db.prepare('PRAGMA table_info(highlights)').all() as Array<{ name: string }>).map(c => c.name)
  if (!highlightCols.includes('start_offset')) db.exec('ALTER TABLE highlights ADD COLUMN start_offset INTEGER DEFAULT 0')
  if (!highlightCols.includes('end_offset')) db.exec('ALTER TABLE highlights ADD COLUMN end_offset INTEGER DEFAULT 0')
```

- [ ] **Step 3: highlightApi 读写偏移**

将 `highlightApi.create` 替换为：

```ts
  create: (h: { id: string; paperId: string; text: string; pageNum: number; color: string; note: string; startOffset?: number; endOffset?: number; createdAt: number }) => {
    db.prepare('INSERT INTO highlights (id, paper_id, text, page_num, color, note, start_offset, end_offset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(h.id, h.paperId, h.text, h.pageNum, h.color, h.note, h.startOffset ?? 0, h.endOffset ?? 0, h.createdAt)
    return h
  },
```

将 `highlightApi.listByPaper` 替换为：

```ts
  listByPaper: (paperId: string) => {
    const rows = db.prepare('SELECT * FROM highlights WHERE paper_id = ? ORDER BY created_at ASC').all(paperId) as any[]
    return rows.map(r => ({
      id: r.id,
      paperId: r.paper_id,
      text: r.text,
      pageNum: r.page_num,
      color: r.color,
      note: r.note,
      startOffset: r.start_offset,
      endOffset: r.end_offset,
      createdAt: r.created_at,
    }))
  },
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS（无新错误；`create` 的调用方 PdfViewer 尚未改动，先不引入）

- [ ] **Step 5: Commit**

```bash
git add electron/db/schema.ts electron/db/index.ts
git commit -m "feat: persist highlight character offsets in schema and db layer"
```

---

## Task 4: paper store 高亮方法 + 测试

**Files:**
- Modify: `src/stores/paper.ts`
- Test: `src/tests/paper.store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/tests/paper.store.test.ts` 的 `getPapersByKb` 用例之后、`})` 之前追加：

```ts
  it('addHighlight persists via IPC and returns the highlight', async () => {
    const store = usePaperStore()
    await store.init()
    const h = await store.addHighlight({
      paperId: 'p1', text: 'important', pageNum: 2, color: '#c9a84c',
      note: '', startOffset: 10, endOffset: 19,
    })
    expect(h.id).toBeTruthy()
    expect((globalThis as any).mockDb.highlight.create).toHaveBeenCalledWith(
      expect.objectContaining({ paperId: 'p1', startOffset: 10, endOffset: 19 }),
    )
  })

  it('getHighlights returns highlights for a paper', async () => {
    ;(globalThis as any).mockDb.highlight.listByPaper.mockResolvedValue([
      { id: 'h1', paperId: 'p1', text: 'x', pageNum: 1, color: '#c9a84c', note: '', startOffset: 0, endOffset: 1, createdAt: 0 },
    ])
    const store = usePaperStore()
    await store.init()
    const list = await store.getHighlights('p1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('h1')
  })
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx vitest run src/tests/paper.store.test.ts`
Expected: FAIL——`store.addHighlight` / `store.getHighlights` 未定义（TypeError）。

- [ ] **Step 3: 实现 store 方法**

在 `src/stores/paper.ts` 的 `getPaper` 函数之后、`return {` 之前新增：

```ts
  // ---------- Highlights ----------

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
    return highlight
  }

  async function getHighlights(paperId: string) {
    return window.db.highlight.listByPaper(paperId)
  }

  async function removeHighlight(id: string) {
    await window.db.highlight.remove(id)
  }
```

并在 `return { ... }` 对象末尾追加 `addHighlight, getHighlights, removeHighlight,`（加在 `getPapersByKb, getPaper,` 之后）。

- [ ] **Step 4: 运行测试验证通过**

Run: `npx vitest run src/tests/paper.store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/paper.ts src/tests/paper.store.test.ts
git commit -m "feat: add highlight methods to paper store"
```

---

## Task 5: PdfViewer 高亮加载与持久化

**Files:**
- Modify: `src/components/PdfViewer.vue`
- Modify: `src/views/ReaderView.vue`

- [ ] **Step 1: PdfViewer 增加 paperId prop 与 store**

`src/components/PdfViewer.vue` 中：

将 props 定义改为：

```ts
const props = defineProps<{ src: string; paperId: string }>()
```

在 `import { ref, onMounted, onBeforeUnmount, computed } from 'vue'` 之后新增：

```ts
import { usePaperStore } from '../stores/paper'
```

在 `const scale = ref(1.3)` 附近新增：

```ts
const paperStore = usePaperStore()
```

- [ ] **Step 2: 挂载时加载历史高亮**

将 `onMounted` 替换为：

```ts
onMounted(async () => {
  try {
    const stored = await paperStore.getHighlights(props.paperId)
    highlightSegments.push(...stored.map((h: any) => ({ page: h.pageNum, start: h.startOffset, end: h.endOffset })))
  } catch { /* highlights unavailable */ }
  renderPdf()
  scrollRef.value?.addEventListener('scroll', onScroll)
  containerRef.value?.addEventListener('mouseup', onMouseUp)
})
```

- [ ] **Step 3: 高亮选中后持久化**

在 `highlightSelection()` 中，将 `const added: HighlightSegment[] = []` 之后的内层循环替换为（在 push 到 `highlightSegments` 后追加持久化调用）：

```ts
    const added: HighlightSegment[] = []
    for (const candidate of candidates) {
      for (const segment of subtractExisting(candidate)) {
        highlightSegments.push(segment)
        added.push(segment)
        paperStore.addHighlight({
          paperId: props.paperId,
          text: selectedText.value,
          pageNum: segment.page,
          color: '#c9a84c',
          note: '',
          startOffset: segment.start,
          endOffset: segment.end,
        }).catch(() => {})
      }
    }
```

（后面的 `for (const segment of added.sort(...)) drawSegment(...)` 保持不变。）

- [ ] **Step 4: ReaderView 传 paper-id**

`src/views/ReaderView.vue` 中，将：

```html
<PdfViewer v-if="pdfUrl" :src="pdfUrl" @select-text="onSelectText" />
```

改为：

```html
<PdfViewer v-if="pdfUrl" :src="pdfUrl" :paper-id="paper.id" @select-text="onSelectText" />
```

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/PdfViewer.vue src/views/ReaderView.vue
git commit -m "feat: persist and reload PDF highlights by character offsets"
```

---

## Task 6: 完整导出/导入（DB + IPC + preload + types）

**Files:**
- Modify: `electron/db/index.ts`（`exportAll` 扩展 + 新增 `importAll` + 顶部 `fs` 导入补 `readdirSync`）
- Modify: `electron/ipc.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/db.d.ts`

- [ ] **Step 1: 补 `readdirSync` 导入**

`electron/db/index.ts` 顶部，将：

```ts
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
```

改为：

```ts
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs'
```

- [ ] **Step 2: 扩展 `exportAll`**

将 `exportAll` 整体替换为：

```ts
export function exportAll() {
  const paperRows = db.prepare('SELECT * FROM papers ORDER BY added_at DESC').all() as any[]
  const papers = paperRows.map(row => ({
    ...deserializePaper(row),
    fileData: existsSync(row.file_path) ? readFileSync(row.file_path).toString('base64') : null,
  }))
  return {
    version: 1,
    exportedAt: Date.now(),
    knowledgeBases: kbApi.list(),
    papers,
    conversations: chatApi.listConversations(),
    highlights: db.prepare('SELECT * FROM highlights').all(),
    paperIndexes: db.prepare('SELECT paper_id, index_json, pages_json FROM paper_indexes').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
  }
}
```

- [ ] **Step 3: 新增 `importAll`**

在 `clearAll` 之后新增：

```ts
export function importAll(data: any) {
  if (!data || data.version !== 1) throw new Error('不支持的备份文件格式（version 必须为 1）')

  const kbs = Array.isArray(data.knowledgeBases) ? data.knowledgeBases : []
  const papers = Array.isArray(data.papers) ? data.papers : []
  const conversations = Array.isArray(data.conversations) ? data.conversations : []
  const highlights = Array.isArray(data.highlights) ? data.highlights : []
  const indexes = Array.isArray(data.paperIndexes) ? data.paperIndexes : []
  const settings = Array.isArray(data.settings) ? data.settings : []

  // 1) 先写回备份中的 PDF（幂等覆盖，不影响旧库）
  for (const p of papers) {
    if (p && typeof p.id === 'string' && typeof p.fileData === 'string') {
      writeFileSync(join(papersDir, `${p.id}.pdf`), Buffer.from(p.fileData, 'base64'))
    }
  }

  // 2) DB 事务：清空旧行并按依赖顺序写入
  const insert = db.transaction(() => {
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM highlights; DELETE FROM paper_indexes; DELETE FROM papers; DELETE FROM knowledge_bases; DELETE FROM settings;')

    for (const kb of kbs) {
      db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(kb.id, kb.name, kb.description ?? '', kb.color ?? '#3db8a0', kb.createdAt ?? Date.now())
    }

    for (const p of papers) {
      db.prepare(`INSERT INTO papers
        (id, knowledge_base_id, title, authors, abstract, year, tags, status, file_name, file_path, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.id, p.knowledgeBaseId, p.title ?? '', JSON.stringify(p.authors ?? []),
          p.abstract ?? '', p.year ?? 0, JSON.stringify(p.tags ?? []), p.status ?? 'unread',
          p.fileName ?? '', join(papersDir, `${p.id}.pdf`), p.addedAt ?? Date.now())
    }

    for (const c of conversations) {
      db.prepare('INSERT INTO conversations (id, title, paper_ids, created_at) VALUES (?, ?, ?, ?)')
        .run(c.id, c.title, JSON.stringify(c.paperIds ?? []), c.createdAt ?? Date.now())
      for (const m of (c.messages ?? [])) {
        db.prepare('INSERT INTO messages (id, conversation_id, role, content, sources, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
          .run(m.id, c.id, m.role, m.content, JSON.stringify(m.sources ?? []), m.timestamp ?? Date.now())
      }
    }

    for (const h of highlights) {
      db.prepare('INSERT INTO highlights (id, paper_id, text, page_num, color, note, start_offset, end_offset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(h.id, h.paper_id ?? h.paperId, h.text, h.page_num ?? h.pageNum ?? 0, h.color ?? '#c9a84c',
          h.note ?? '', h.start_offset ?? h.startOffset ?? 0, h.end_offset ?? h.endOffset ?? 0,
          h.created_at ?? h.createdAt ?? Date.now())
    }

    for (const ix of indexes) {
      db.prepare('INSERT INTO paper_indexes (paper_id, index_json, pages_json, created_at) VALUES (?, ?, ?, ?)')
        .run(ix.paper_id ?? ix.paperId, ix.index_json ?? ix.indexJson, ix.pages_json ?? ix.pagesJson, Date.now())
    }

    for (const s of settings) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value)
    }
  })

  insert()

  // 3) 清理未被备份引用的孤儿 PDF
  const wanted = new Set(papers.filter(p => typeof p.id === 'string').map(p => `${p.id}.pdf`))
  for (const name of readdirSync(papersDir)) {
    if (name.endsWith('.pdf') && !wanted.has(name)) unlinkSync(join(papersDir, name))
  }

  // 4) 保证至少一个知识库
  const kbCount = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get() as { n: number }).n
  if (kbCount === 0) {
    db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('default', '默认知识库', '未分类论文', '#3db8a0', Date.now())
  }
}
```

- [ ] **Step 4: 注册 IPC handler**

`electron/ipc.ts` 顶部导入行追加 `importAll`：

```ts
import { kbApi, paperApi, chatApi, highlightApi, settingsApi, indexApi, exportAll, clearAll, importAll } from './db'
```

在 `handlers` 对象的 `'data:clear'` 之后新增：

```ts
    'data:import': (_e, data) => importAll(data),
```

- [ ] **Step 5: preload 暴露 `data.import`**

`electron/preload.ts` 的 `data` 对象中，在 `clear` 之后新增：

```ts
    import: (data: unknown) => ipcRenderer.invoke('data:import', data),
```

- [ ] **Step 6: 更新 renderer 类型**

`src/types/db.d.ts` 的 `data` 对象中，在 `clear` 之后新增：

```ts
    import: (data: any) => Promise<void>
```

- [ ] **Step 7: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add electron/db/index.ts electron/ipc.ts electron/preload.ts src/types/db.d.ts
git commit -m "feat: full backup export and import with PDF restoration"
```

---

## Task 7: SettingsView 导入按钮 + provider 默认 baseUrl

**Files:**
- Modify: `src/views/SettingsView.vue`

- [ ] **Step 1: 数据管理区新增导入按钮与隐藏 input**

在「数据管理」section 中，将：

```html
        <div class="action-row">
          <el-button @click="exportData">导出数据</el-button>
          <el-button type="danger" plain @click="clearData">清空所有数据</el-button>
        </div>
```

替换为：

```html
        <div class="action-row">
          <el-button @click="exportData">导出数据</el-button>
          <el-button @click="triggerImport">导入数据</el-button>
          <el-button type="danger" plain @click="clearData">清空所有数据</el-button>
        </div>
        <input
          ref="importInput"
          type="file"
          accept="application/json,.json"
          style="display:none"
          @change="onImportFile"
        />
```

- [ ] **Step 2: provider 下拉切换默认 baseUrl**

将 provider 的 `<el-select>` 改为：

```html
          <el-select v-model="form.provider" style="width:100%" @change="onProviderChange">
```

- [ ] **Step 3: script 增加常量与处理函数**

在 `<script setup>` 中，`const EMPTY_FORM = ...` 之前新增：

```ts
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  ollama: 'http://localhost:11434',
}
```

在 `saveAbstractToken` 函数之后新增：

```ts
function onProviderChange() {
  const known = new Set(Object.values(PROVIDER_BASE_URLS))
  if (!form.baseUrl || known.has(form.baseUrl)) {
    form.baseUrl = PROVIDER_BASE_URLS[form.provider] ?? ''
  }
}
```

在 `exportData` 函数之后新增：

```ts
const importInput = ref<HTMLInputElement>()

function triggerImport() { importInput.value?.click() }

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    await window.db.data.import(data)
    ElMessage.success('已导入，正在刷新…')
    setTimeout(() => location.reload(), 800)
  } catch (err) {
    ElMessage.error(`导入失败：${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    input.value = ''
  }
}
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/SettingsView.vue
git commit -m "feat: import backup and auto-set provider base url"
```

---

## Task 8: setup mock 补 `data.import` + 全量验证

**Files:**
- Modify: `src/tests/setup.ts`

- [ ] **Step 1: mock 补 import**

`src/tests/setup.ts` 的 `data` 对象中，在 `clear` 之后新增：

```ts
    import: vi.fn().mockResolvedValue(undefined),
```

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: 全量类型检查**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tests/setup.ts
git commit -m "test: mock data.import in test setup"
```

---

## 自审结论

- **Spec 覆盖**：5 个目标全部有对应 Task（Task1 gitignore / Task2 错误+Anthropic / Task3+4+5 高亮 / Task6+7 备份恢复）。`data:import` 的 mock 在 Task8 补齐。
- **占位符**：无 TBD/TODO，每步含完整代码与命令。
- **类型一致性**：`addHighlight` 参数名（`startOffset`/`endOffset`）在 store、PdfViewer 调用、测试三处一致；`importAll` 兼容 snake_case 与 camelCase 两种来源。
