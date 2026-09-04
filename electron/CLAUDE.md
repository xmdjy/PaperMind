[根目录](../CLAUDE.md) > **electron**

# electron/ — 主进程模块

**变更记录**
- 2026-08-02T15:49:42: 补记 `index` IPC 命名空间（PageIndex）、GPU 崩溃修复与外链拦截、7 张表；拆分数据层细节到 `electron/db/CLAUDE.md`
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

Electron 主进程的全部逻辑：应用生命周期管理、BrowserWindow 创建、外部链接拦截、IPC 通道注册、SQLite 数据库初始化与所有 CRUD/索引操作。数据层建表与 API 细节见 [electron/db](./db/CLAUDE.md)。

## 入口与启动

`electron/main.ts` 是主进程入口：
1. 启动即 `appendSwitch('disable-gpu')` + `disable-software-rasterizer`，规避 Linux Intel GBM/Wayland ENOMEM 的 GPU 崩溃
2. `app.whenReady()` 触发后依次调用 `initDb()` → `registerIpc()` → `createWindow()`
3. 开发环境加载 `process.env.VITE_DEV_SERVER_URL`，生产环境加载 `../dist/index.html`
4. `contextIsolation: true` / `nodeIntegration: false`，`preload: preload.js` 安全隔离
5. **外链拦截**：`setWindowOpenHandler` 与 `will-navigate` 拦截所有导航，仅对 `http:`/`https:` 调用 `shell.openExternal`，其余一律 `deny`/`preventDefault`（防止渲染层被导航劫持）

## 对外接口（IPC 通道）

所有通道通过 `ipcMain.handle` 注册（`electron/ipc.ts`），渲染层经 `window.db.*` 调用（`electron/preload.ts` 暴露）：

| 命名空间 | 通道 | 说明 |
|----------|------|------|
| kb | `kb:list/create/remove` | 知识库 CRUD |
| paper | `paper:list/get/create/update/remove/readFile` | 论文 CRUD + 读取 PDF base64 |
| chat | `chat:listConversations/createConversation/updateConversation/removeConversation/addMessage` | 对话与消息 |
| highlight | `highlight:listByPaper/create/remove` | 高亮批注（当前 UI 未直接落库，接口预留） |
| settings | `settings:get/set` | KV 设置（LLM profiles、HF token 等） |
| data | `data:export/clear` | 全量导出 / 清空所有数据 |
| index | `index:list/get/set` | **PageIndex RAG 索引**（新增）：列出/读取/写入论文索引 |

> 新增/修改通道时务必四处同步：`ipc.ts`（handler）、`preload.ts`（`window.db` 方法）、`src/types/db.d.ts`（类型）、以及调用方 store。

## 关键依赖与配置

- `better-sqlite3`：同步 SQLite，native 模块，需 rebuild（`postinstall` 已挂 `electron-rebuild`）；`vite.config.ts` 中标记为 `external`，`electron-builder` 的 `asarUnpack` 解压其原生二进制
- WAL 模式 + 外键约束在 `initDb()` 中通过 `db.pragma` 启用
- 数据存储路径：`app.getPath('userData')/papermind.db` 与 `userData/papers/`（PDF 以 `<paperId>.pdf` 落盘）

## 数据模型

7 张表，定义在 `electron/db/schema.ts`（详见 [electron/db](./db/CLAUDE.md)）：

| 表 | 说明 |
|----|------|
| `knowledge_bases` | 知识库，seed 默认 id=`default` 记录 |
| `papers` | 论文元数据，`file_path` 为磁盘绝对路径，`authors`/`tags` 为 JSON 数组 |
| `conversations` | 对话，`paper_ids` 为 JSON 数组 |
| `messages` | 消息，`sources` 为 JSON 数组，`ON DELETE CASCADE` 关联 conversation |
| `highlights` | 高亮批注，关联 paper |
| `settings` | KV 存储，`value` 为 JSON 字符串 |
| `paper_indexes` | **新增**：PageIndex（`index_json` + `pages_json`），`ON DELETE CASCADE` 关联 paper |

删除知识库或论文时，`index.ts` 会同步 `unlinkSync` 磁盘 PDF；子表（messages/highlights/paper_indexes）由 `ON DELETE CASCADE` 清理。

## 相关文件

- `electron/main.ts` — 应用入口、GPU 修复、外链拦截
- `electron/preload.ts` — contextBridge 注入 `window.db`，导出 `DbApi` 类型
- `electron/ipc.ts` — 所有 IPC handler 注册（channel → db api 映射表）
- `electron/db/schema.ts` — SQL 建表语句
- `electron/db/index.ts` — 数据库初始化 + 所有 API 实现

## 常见问题

**Q: 为什么在 Linux 上禁用 GPU？**
Intel GBM/Wayland 环境下 Electron 31 GPU 进程易 ENOMEM 崩溃，禁用后以软件渲染保证稳定启动（见 `main.ts` 顶部注释）。

**Q: 高亮为什么有表却看不到持久化？**
`highlights` 表与 `highlight:*` 通道已就绪，但当前 `PdfViewer` 的高亮为前端内存态（`highlightSegments`），尚未接入 IPC 落库——属预留能力。
