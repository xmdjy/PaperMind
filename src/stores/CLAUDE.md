[根目录](../../CLAUDE.md) > [src/](../) > **stores/**

# src/stores/ — 状态管理模块

**变更记录**
- 2026-08-02T15:49:42: 重写以反映多 LLM 配置（profiles）、`indexPaper`/`indexedPapers`、`/abstract` 摘要（`generateAbstract`）、旧 `llm_config` 迁移、反 Proxy 持久化
- 2026-07-18T00:00:00: 更新 sendMessage RAG 管线文档（3-call 流程）
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

Pinia 全局状态管理，封装所有与主进程的 IPC 通信、LLM API 请求、PageIndex 构建与 `/abstract` 摘要逻辑。渲染层组件通过 store 方法操作数据，不直接调用 `window.db`。

## 入口

两个 store，均为 Pinia setup 函数风格，均有幂等 `init()`（`loaded` flag），在 `App.vue` 挂载时并行调用：

- `paper.ts` — `usePaperStore`：论文列表与知识库
- `chat.ts` — `useChatStore`：对话、消息、**多 LLM 配置**、PageIndex 索引、摘要

## usePaperStore（paper.ts）

| 方法/属性 | 说明 |
|-----------|------|
| `papers` / `knowledgeBases` / `loaded` | 响应式状态 |
| `init()` | 加载 kb 列表 + 论文列表 |
| `addPaper(paper)` | 接受含 `fileData`(base64) 的对象；IPC 写盘后**内存仅保留元数据**（解构剥离 `fileData`） |
| `updatePaper(id, patch)` / `removePaper(id)` | 部分更新 / 删除（主进程同步删盘） |
| `readPaperFile(id)` | 按需读取 PDF base64（透传 `window.db.paper.readFile`） |
| `addKnowledgeBase / removeKnowledgeBase` | 知识库 CRUD（删 KB 时前端同步剔除其论文） |
| `getPapersByKb(kbId)` | 返回 `computed` 过滤结果 |
| `getPaper(id)` | 内存查找单篇 |

接口 `Paper`（`status: 'unread' | 'reading' | 'done'`）与 `KnowledgeBase` 在此定义。

## useChatStore（chat.ts）

### 状态

| 属性 | 说明 |
|------|------|
| `conversations` | 对话列表（含 messages） |
| `profiles` | **`LLMProfile[]`**，默认含一个 `DEFAULT_PROFILE`（openai/gpt-4o） |
| `chatProfileId` / `indexProfileId` | 对话用 / 索引用的当前 profile id |
| `chatProfile` / `indexProfile` | 上述 id 对应的 computed profile（回退首个） |
| `indexingPapers` / `indexedPapers` | 正在构建 / 已建索引的 paperId 集合（`Set`） |
| `abstractToken` | Hugging Face token |

### Profile 与设置持久化

- `addProfile / updateProfile / removeProfile`（至少保留 1 个；删当前项自动切首个）
- `setChatProfileId / setIndexProfileId / setAbstractToken` — 分别写 `llm_profile_chat` / `llm_profile_index` / `huggingface_token`
- `persistProfiles()` 将 `profiles` **深拷贝为普通对象**再 `settings.set('llm_profiles', ...)`——因 Electron 结构化克隆无法序列化 Vue 响应式 Proxy（`chat.store.test.ts` 有 `isProxy` 校验）
- `init()`：加载 `llm_profiles`；**旧版迁移**——无 profiles 但存在旧 `llm_config` 时，包装为单条 profile 并落盘；再恢复 `llm_profile_chat/index` 选择、`index.list()` 已建索引集合、`huggingface_token`

### LLM 调用（`callLLM`）

直接从渲染进程 `fetch`，按 provider 适配：
- **ollama**：`POST {baseUrl}/api/chat`，`stream:false`，`topK>0` 时附 `options.top_k`
- **openai / anthropic**：`POST {baseUrl}/chat/completions`（OpenAI 兼容）
  - openai：`Authorization: Bearer {apiKey}`
  - anthropic：`x-api-key` + `anthropic-version: 2023-06-01`，`topK>0` 时附 `top_k`
- 可传 `profileId` 指定配置（默认用 `chatProfile`）

### 索引构建（`indexPaper`）

`indexingPapers` 去重 → 读 PDF base64 → `extractPages` → `buildPageIndex`（用 `indexProfile` 的 LLM）→ `window.db.index.set(paperId, indexJson, pagesJson)` → 加入 `indexedPapers`。由 `LibraryView` 导入后**后台触发**，或 `ChatView` 手动触发。

### 对话主流程（`sendMessage`）

```
addMessage(user)
├─ 若 == "/abstract" → generateAbstract(conv) → addMessage(assistant, sources) ── return
└─ 否则 RAG（无外部 context 且 conv.paperIds 非空时）：
   Call 1（有历史时，slice(-4,-1) ≥ 2 条）rewriteQuery → retrievalQuery
   对每篇 paper：window.db.index.get（缺失则兜底 indexPaper）→ Call 2 scoreAndSelect
   合并各篇 context / sources
   Call 3 callLLM（system=systemPrompt + 数学格式指令 + 参考内容；带最近 20 条历史）
```

- system 提示词固定追加 `MATH_FORMAT_INSTRUCTION`（要求用 `$...$` / `$$...$$`，禁用 `\(\)`/`\[\]`）
- 单节点索引（root 无子节点）时 `scoreAndSelect` 不发 LLM 调用——故首条消息实际仅 1 次 LLM 调用

### `/abstract` 摘要（`generateAbstract`）

- 前置校验：conv 需选 ≥1 篇论文、需已配置 `abstractToken`
- 逐篇：`readPaperPages`（优先读 `paper_indexes.pages_json` 缓存，否则 `extractPages`）→ `summarizeAcademicText`（见 [utils](../utils/CLAUDE.md)）
- 多篇时以 `## 标题` 分段，段间 `\n\n---\n\n`；`sources` 为论文标题列表
- 导出 `ABSTRACT_MODEL` 常量供设置页展示

### 其它导出

`newConversation / addMessage / removeConversation / syncPaperIds`；`PROMPT_TEMPLATES`（5 个系统提示词模板）；接口 `LLMProfile` / `Message` / `Conversation`。

## 常见问题

**Q: 对话和索引为什么用不同 profile？**
索引构建（生成节标题/摘要、评分）可用便宜/本地模型，对话回答用更强模型，分开配置更经济。

**Q: 首次对话时论文还没建好索引怎么办？**
`sendMessage` 内有兜底：`index.get` 为空时即时 `indexPaper` 再重取；失败则该篇跳过（无索引即退化为无 RAG 回答）。

**Q: LLM 请求为什么不走主进程？**
减少 IPC 往返，渲染层直接 fetch 更简单；凭据存 `settings` 表，不额外暴露到 preload 之外。

## 相关文件

- `src/stores/paper.ts` — usePaperStore
- `src/stores/chat.ts` — useChatStore（LLM/RAG/索引/摘要）
- `src/utils/pageIndex.ts` — `extractPages`/`buildPageIndex`/`scoreAndSelect`
- `src/utils/abstractSummarizer.ts` — `summarizeAcademicText`/`ABSTRACT_MODEL`
- `src/types/db.d.ts` — `window.db` 类型声明（含 `index`）
