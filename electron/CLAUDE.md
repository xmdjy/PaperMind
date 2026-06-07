[根目录](../CLAUDE.md) > **electron/**

# electron/ — 主进程模块

**变更记录**
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

Electron 主进程的全部逻辑：应用生命周期管理、BrowserWindow 创建、IPC 通道注册、SQLite 数据库初始化与所有 CRUD 操作。

## 入口与启动

`electron/main.ts` 是主进程入口：
1. `app.whenReady()` 触发后依次调用 `initDb()` → `registerIpc()` → `createWindow()`
2. 开发环境加载 `VITE_DEV_SERVER_URL`，生产环境加载 `dist/index.html`
3. `contextIsolation: true` / `nodeIntegration: false`，安全隔离

## 对外接口（IPC 通道）

所有通道通过 `ipcMain.handle` 注册，渲染层经 `window.db.*` 调用：

| 命名空间 | 通道 | 说明 |
|----------|------|------|
| kb | `kb:list/create/remove` | 知识库 CRUD |
| paper | `paper:list/get/create/update/remove/readFile` | 论文 CRUD + 读取 PDF base64 |
| chat | `chat:listConversations/createConversation/updateConversation/removeConversation/addMessage` | 对话与消息 |
| highlight | `highlight:listByPaper/create/remove` | 高亮批注 |
| settings | `settings:get/set` | KV 设置（LLM 配置等） |
| data | `data:export/clear` | 全量导出 / 清空所有数据 |

## 关键依赖与配置

- `better-sqlite3`：同步 SQLite，需 native rebuild（`npm run rebuild`）
- WAL 模式 + 外键约束在 `initDb()` 中通过 pragma 启用
- 数据存储路径：`app.getPath('userData')/papermind.db` 和 `userData/papers/`

## 数据模型

6 张表，定义在 `electron/db/schema.ts`：

| 表 | 说明 |
|----|------|
| `knowledge_bases` | 知识库，默认存在 id=`default` 的记录 |
| `papers` | 论文元数据，`file_path` 为磁盘绝对路径，`authors`/`tags` 为 JSON 数组 |
| `conversations` | 对话，`paper_ids` 为 JSON 数组 |
| `messages` | 消息，`sources` 为 JSON 数组，关联 conversation |
| `highlights` | 高亮批注，关联 paper |
| `settings` | KV 存储，`value` 为 JSON 字符串 |

`papers.authors`、`papers.tags`、`conversations.paper_ids`、`messages.sources` 均以 JSON TEXT 存储，`index.ts` 中 `deserializePaper` 负责反序列化。

删除知识库或论文时，`index.ts` 会同步删除磁盘 PDF 文件；`ON DELETE CASCADE` 处理子表清理。

## 相关文件

- `electron/main.ts` — 应用入口
- `electron/preload.ts` — contextBridge 注入 `window.db`
- `electron/ipc.ts` — 所有 IPC handler 注册
- `electron/db/schema.ts` — SQL 建表语句
- `electron/db/index.ts` — 数据库初始化 + 所有 API 实现
