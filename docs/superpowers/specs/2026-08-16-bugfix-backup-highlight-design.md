# PaperMind 高优先级缺陷修复与备份恢复设计

**日期：** 2026-08-16
**状态：** 待实现
**涉及文件：** `src/stores/chat.ts`、`src/stores/paper.ts`、`src/views/SettingsView.vue`、`src/views/ReaderView.vue`、`src/components/PdfViewer.vue`、`electron/db/schema.ts`、`electron/db/index.ts`、`electron/ipc.ts`、`electron/preload.ts`、`src/types/db.d.ts`、`.gitignore`

---

## 背景与问题

代码走查发现四个高优先级缺陷：

1. **LLM 错误静默** — `callLLM` 从不检查 `res.ok`，401/429/500 时返回空串，渲染为空白 assistant 气泡，用户看不到任何报错。
2. **Anthropic provider 名不副实** — 请求体走 OpenAI 兼容 `/chat/completions` 端点，真正的 Anthropic API（`/v1/messages`）无法工作。
3. **高亮未持久化** — `PdfViewer` 的高亮只写内存数组 `highlightSegments`，从未调用 `window.db.highlight.create`，翻页/缩放/重开后全部消失。DB 层的 `highlightApi` 成为死代码。
4. **备份无法恢复** — `data:export` 不含 PDF 二进制、高亮、索引，且没有对应的 `data:import`，设置页「导出备份」实为不可恢复的导出。

另有工程卫生问题：`.codegraph/`、`.cursor/` 工具缓存目录未被 `.gitignore` 忽略。

---

## 目标

修复上述四个缺陷，并使「导出/恢复」成为真正的整库备份能力；补全 `.gitignore`。

**不在本次范围内：** API key 加密（`safeStorage`）、高亮删除 UI、向量检索、导入的「合并」语义、CI 流程改动。

---

## 设计决策

- **Anthropic**：接入真正的 Messages API（`POST {baseUrl}/v1/messages`）；`openai` 继续作为 OpenAI 兼容兜底。
- **备份/恢复**：整库替换语义——导入时清空现有数据后写入备份。
- **高亮**：在 `highlights` 表新增字符偏移列，以「文本层字符偏移」精确定位重渲染位置（比按文本子串匹配更稳健）。

---

## 架构变更

### 1. LLM 错误可见（`src/stores/chat.ts`）

新增本地辅助 `readErrorBody(res: Response): Promise<string>`，从响应 JSON 的 `error.message` / `error` / `message` / `detail` 提取信息，回退到 `${status} ${statusText}`。

三个 provider 分支统一：

```ts
const res = await fetch(...)
if (!res.ok) throw new Error(`LLM 请求失败 (${res.status})：${await readErrorBody(res)}`)
```

OpenAI / Anthropic 响应内容字段缺失时（非字符串）抛错，不再静默返回空串。`sendMessage` 不捕获该异常，由 `ChatPanel` 的 catch 展示给用户；后台索引的 `indexPaper` 由调用方 `.catch(() => {})` 吞掉，不影响导入流程。

### 2. Anthropic Messages API（`src/stores/chat.ts` + `src/views/SettingsView.vue`）

`callLLM` 的 anthropic 分支：

- 端点：`POST {baseUrl}/v1/messages`
- 头：`x-api-key`、`anthropic-version: 2023-06-01`、`Content-Type: application/json`
- body：
  - `model`
  - `max_tokens`（必填，来自 `profile.maxTokens`）
  - `messages`（去掉 `role === 'system'` 的消息，且去掉开头的 assistant 消息）
  - `system`（从 messages 中拆出的 system 内容拼接，顶层字段）
  - `temperature`（钳制到 ≤1）
  - `top_k`（`topK > 0` 时）
- 响应：`data.content?.[0]?.text`

`SettingsView.vue` 的 provider 下拉增加 `@change`：当 baseUrl 为空或仍是某 provider 的默认值时，切换到对应默认值（openai → `https://api.openai.com/v1`、anthropic → `https://api.anthropic.com`、ollama → `http://localhost:11434`）。

### 3. 高亮持久化（schema + db + store + PdfViewer）

**schema.ts** — `highlights` 表新增两列：

```sql
start_offset INTEGER DEFAULT 0,
end_offset   INTEGER DEFAULT 0
```

**index.ts**：

- `initDb` 增加幂等迁移：`PRAGMA table_info(highlights)` 检查缺列则 `ALTER TABLE highlights ADD COLUMN ...`。
- `highlightApi.create` 写入 `start_offset`/`end_offset`（默认 0）。
- `highlightApi.listByPaper` 映射为 camelCase，返回含 `startOffset`/`endOffset` 的对象。

**paper store** — 新增：

```ts
addHighlight(h: { paperId; text; pageNum; color; note; startOffset; endOffset })
getHighlights(paperId)
removeHighlight(id)
```

**PdfViewer.vue**：

- 新增 `paperId: string` prop。
- `onMounted`：先 `getHighlights(paperId)` 填充 `highlightSegments`，再 `renderPdf()`（`restorePageHighlights` 已在每页渲染时绘制）。
- `highlightSelection()`：对每个新 segment（经 `subtractExisting` 去重后）调用 `addHighlight` 持久化，固定金色 `#c9a84c`，`note` 为空。

**ReaderView.vue**：向 PdfViewer 传 `:paper-id="paper.id"`。

### 4. 完整备份与恢复（db + ipc + preload + types + SettingsView）

**exportAll** 返回结构：

```ts
{
  version: 1,
  exportedAt: number,
  knowledgeBases: [...],
  papers: [...],            // 每个含 fileData (base64) 与元数据
  conversations: [...],     // 含嵌套 messages
  highlights: [...],
  paperIndexes: [...],      // { paper_id, index_json, pages_json }
  settings: [...],          // 原始 { key, value } 行（value 为 JSON 字符串）
}
```

papers 的 `fileData` 由 `readFileSync(file_path).toString('base64')` 生成（文件不存在时置 `null`）。

**importAll(data)**（`data:import` IPC）：

1. 校验 `data.version === 1`，否则抛错。
2. 清空 `papersDir` 内 PDF 文件。
3. `db.transaction` 内：按 FK 安全顺序删除现有行（messages → conversations → highlights → paper_indexes → papers → knowledge_bases → settings），再按依赖顺序插入 kb → papers（先写盘后插入）→ conversations(+messages) → highlights → paper_indexes → settings。
4. 备份无知识库时补种 default 知识库。

失败时 DB 回滚；已写盘的 PDF 可能残留为孤儿文件（未被引用，无害）。

**ipc.ts / preload.ts / db.d.ts**：新增 `data:import` 通道与类型。

**SettingsView.vue**：新增「导入数据」按钮 + 隐藏 `input[type=file]`，`JSON.parse` 后 `window.db.data.import(...)`，成功后提示并 `location.reload()`。

### 5. `.gitignore`

新增两行：

```
.codegraph/
.cursor/
```

---

## 错误处理汇总

| 场景 | 行为 |
|------|------|
| LLM 非 2xx | `throw` 可读错误，ChatPanel 展示，后台索引静默 |
| LLM 响应内容缺失 | OpenAI/Anthropic 抛错；Ollama 无 `message.content` 抛错 |
| Anthropic 首条为 assistant | 去掉开头的 assistant 消息 |
| Anthropic temperature > 1 | 钳制为 1 |
| 导入版本不符 | 抛错，不触碰现有数据 |
| 导入中途失败 | DB 回滚，PDF 孤儿文件残留（无害） |
| 高亮重渲染定位 | 按 start/end 偏移重绘，无匹配则不绘制 |
| 高亮持久化失败 | `.catch(() => {})` 静默，不影响选中流程 |

---

## 数据兼容性

- `highlights` 表新增两列；老库经 `initDb` 幂等迁移自动补齐，默认 0。
- 备份文件含 `version` 字段，未来可平滑升级格式。
- 其余表结构不变。

---

## 测试计划

| 文件 | 测试用例 |
|------|---------|
| `src/tests/chat.store.test.ts` | 非 200 响应 `sendMessage` rejects 且含状态码；anthropic 走 `/v1/messages`、头正确、body 拆分 system / max_tokens、解析 `content[0].text` |
| `src/tests/paper.store.test.ts` | `addHighlight` 经 IPC 持久化；`getHighlights` 返回列表 |
| `src/tests/setup.ts` | `data` mock 补 `import` |

**说明：** `electron/**` 被 vitest 排除，DB 导入/导出与迁移逻辑靠 `npm run typecheck` + 手动验证覆盖（与现有测试策略一致）。

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `.gitignore` | 修改 | 忽略 `.codegraph/`、`.cursor/` |
| `src/stores/chat.ts` | 修改 | `callLLM` 错误检查 + Anthropic Messages API |
| `src/stores/paper.ts` | 修改 | 新增 highlight 方法 |
| `src/views/SettingsView.vue` | 修改 | provider 默认 baseUrl + 导入数据按钮 |
| `src/views/ReaderView.vue` | 修改 | 传 `paper-id` 给 PdfViewer |
| `src/components/PdfViewer.vue` | 修改 | 高亮加载与持久化 |
| `electron/db/schema.ts` | 修改 | highlights 增两列 |
| `electron/db/index.ts` | 修改 | 迁移、highlight camelCase、export/import |
| `electron/ipc.ts` | 修改 | `data:import` handler |
| `electron/preload.ts` | 修改 | `data.import` |
| `src/types/db.d.ts` | 修改 | highlight 类型 + `data.import` |
| `src/tests/setup.ts` | 修改 | `data.import` mock |
| `src/tests/chat.store.test.ts` | 修改 | 新增错误/Anthropic 用例 |
| `src/tests/paper.store.test.ts` | 修改 | 新增 highlight 用例 |
