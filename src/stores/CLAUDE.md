[根目录](../../CLAUDE.md) > [src/](../) > **stores/**

# src/stores/ — 状态管理模块

**变更记录**
- 2026-07-18T00:00:00: 更新 sendMessage RAG 管线文档（3-call 流程）
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

Pinia 全局状态管理，封装所有与主进程的 IPC 通信，以及 LLM API 请求逻辑。渲染层组件通过 store 方法操作数据，不直接调用 `window.db`。

## 入口

两个 store，均为 Pinia setup 函数风格：

- `paper.ts` — `usePaperStore`：管理论文列表和知识库
- `chat.ts` — `useChatStore`：管理对话、消息和 LLM 配置

两个 store 均有 `init()` 方法，在 `App.vue` 挂载时调用一次，通过 `loaded` flag 防止重复初始化。

## 数据接口

**usePaperStore** 暴露的接口：

| 方法/属性 | 说明 |
|-----------|------|
| `papers` / `knowledgeBases` | 响应式列表 |
| `init()` | 从 IPC 加载数据 |
| `addPaper(paper)` | 接受含 `fileData`(base64) 的对象，写盘后只在内存保留元数据 |
| `updatePaper(id, patch)` | 部分更新 |
| `removePaper(id)` | 同步删除磁盘文件 |
| `readPaperFile(id)` | 按需读取 PDF base64 |
| `addKnowledgeBase / removeKnowledgeBase` | 知识库 CRUD |
| `getPapersByKb(kbId)` | 返回 `computed` 过滤结果 |

**useChatStore** 暴露的接口：

| 方法/属性 | 说明 |
|-----------|------|
| `conversations` / `config` | 响应式数据 |
| `init()` | 加载对话历史 + 读取 `llm_config` 设置 |
| `newConversation(title, paperIds)` | 创建并持久化 |
| `addMessage(convId, role, content, sources?)` | 追加消息并持久化 |
| `syncPaperIds(convId, paperIds)` | 更新对话关联的论文 |
| `updateConfig(patch)` | 更新 LLM 配置并写入 settings |
| `sendMessage(convId, userMsg, context?)` | 完整的用户消息 → LLM → 助手消息流程 |

## LLM 调用逻辑

`sendMessage` 在 `chat.ts` 中实现，直接从渲染进程发出 fetch 请求。

**RAG 管线（3-call 流程，有索引时触发）：**

1. **Call 1 — 查询改写**（条件：对话有 ≥2 条前置消息）  
   `rewriteQuery(userMessage, historyBeforeCurrent, llmFn)` — 将追问展开为独立检索查询；失败时静默回退原始问题
2. **Call 2 — 评分多选**  
   `scoreAndSelect(tree, pages, retrievalQuery, llmFn)` — 对所有节点打分（0-10），取 Top-2（第二节点需 ≥4 分），按文档顺序合并
3. **Call 3 — 生成回答**  
   注入合并后的上下文，调用 `callLLM`

无索引时退化为单次回答调用（无 RAG）。

**LLM Provider 适配：**
- **ollama**：`POST {baseUrl}/api/chat`，non-stream
- **openai / anthropic**：`POST {baseUrl}/chat/completions`，OpenAI 兼容格式
  - openai 使用 `Authorization: Bearer {apiKey}`
  - anthropic 使用 `x-api-key` + `anthropic-version` header
- 历史消息取最近 20 条；系统提示词附加 `context` 参数内容

## 常见问题

**Q: 为什么 addPaper 需要传 fileData？**
PDF 二进制在渲染层读取后转 base64，通过 IPC 传给主进程写盘，写盘后不再保留在内存中，之后按需通过 `readPaperFile` 读取。

**Q: LLM 请求为什么不走主进程？**
减少 IPC 往返，渲染层直接 fetch 更简单；所有凭据存在 settings 表，不暴露在 preload 之外。

## 相关文件

- `src/stores/paper.ts`
- `src/stores/chat.ts`
- `src/types/db.d.ts` — `window.db` 类型声明
