[根目录](../../CLAUDE.md) > [src/](../) > **views/**

# src/views/ — 页面视图模块

**变更记录**
- 2026-06-07T21:33:55: 初始化文档

## 模块职责

四个路由页面组件，构成应用的全部用户界面。路由为 hash 模式，在 `src/router/index.ts` 中配置。

## 路由与页面

| 路由 | 组件 | 职责 |
|------|------|------|
| `/library` | `LibraryView.vue` | 知识库管理、论文列表（卡片网格）、PDF 导入 |
| `/library/:id` | `ReaderView.vue` | 论文阅读器（PDF + 对话分屏） |
| `/chat` | `ChatView.vue` | 多论文上下文对话中心 |
| `/settings` | `SettingsView.vue` | LLM 配置、生成参数、数据管理 |

## 各页面说明

**LibraryView** — 知识库主页
- 知识库 Tab 切换，卡片网格展示论文
- 拖入或点击导入 PDF，调用 `parsePdfMeta` 自动提取标题/作者/摘要/年份
- 支持新建知识库（选色）、删除知识库（级联删除论文文件）、论文移动/删除/标记状态

**ReaderView** — 阅读器（`/library/:id`）
- 左侧 `PdfViewer`，右侧 `ChatPanel`，支持鼠标拖动中间分割条调整比例（25%–75%）
- 进入时自动将状态改为 `reading`，自动创建或选择关联对话
- 选中 PDF 文本后弹出菜单，点击「发送到对话」将文本作为 context 注入 ChatPanel

**ChatView** — 多论文对话
- 三栏布局：左侧论文选择列表 + 历史对话列表，中间 ChatPanel，右侧 ParamPanel（可收起）
- 多选论文后创建对话，对话关联的 paperIds 实时同步到 store

**SettingsView** — 设置
- 直接绑定 `useChatStore` 的 `config`，`@change` 时调用 `updateConfig` 持久化
- 数据导出为 JSON 文件，清空数据需二次确认

## 相关文件

- `src/views/LibraryView.vue`
- `src/views/ReaderView.vue`
- `src/views/ChatView.vue`
- `src/views/SettingsView.vue`
- `src/router/index.ts`
