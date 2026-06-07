# PaperMind

本地运行的学术论文阅读助手，类 alphaXiv 体验，数据完全私有。纯本地原生应用，无需任何后端服务器，所有数据存于本地 SQLite。

## 功能

- **知识库管理** — 自定义多个知识库，分类组织论文，颜色标识
- **PDF 阅读** — 内置 PDF 渲染，支持翻页、缩放、文本选中、高亮标记
- **划词对话** — 阅读时选中原文，一键同步到对话作为上下文
- **多论文对话** — 选择若干论文作为上下文，进行跨文检索问答
- **自定义参数** — 实时调整 provider / model / temperature / max_tokens / 系统提示词
- **提示词模板** — 内置精读、通俗解释、要点提取、批判分析、翻译等模板
- **多 LLM 支持** — OpenAI / Anthropic / Ollama（本地模型），一键切换

## 数据存储

数据位于系统 userData 目录（如 Linux `~/.config/papermind/`）：

- `papermind.db` — SQLite 数据库（WAL 模式）
- `papers/<id>.pdf` — 论文 PDF 原文件

表结构：`knowledge_bases`、`papers`、`conversations`、`messages`、`highlights`、`settings`。

## 快速开始

### 前置依赖

- Node.js >= 20

### 安装

```bash
npm install
```


### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

产物在 `release/` 目录。better-sqlite3 通过 `asarUnpack` 解包，确保原生模块可加载。

## 目录结构

```
PaperMind/
├── electron/
│   ├── main.ts          主进程入口
│   ├── ipc.ts           IPC handler 注册
│   ├── preload.ts       contextBridge
│   └── db/
│       ├── schema.ts    表结构
│       └── index.ts     数据库访问层
├── src/
│   ├── views/
│   │   ├── LibraryView.vue   知识库 + 论文卡片网格
│   │   ├── ReaderView.vue    左 PDF / 右对话 分栏阅读
│   │   ├── ChatView.vue      左论文列表 / 中对话 / 右参数 三栏
│   │   └── SettingsView.vue  全局设置 + 数据管理
│   ├── components/
│   │   ├── PdfViewer.vue     PDF 渲染 + 选中 + 高亮
│   │   ├── ChatPanel.vue     可复用对话面板
│   │   └── ParamPanel.vue    参数 + 提示词模板
│   ├── stores/
│   │   ├── paper.ts          论文 + 知识库（异步 SQLite）
│   │   └── chat.ts           对话 + LLM 配置（异步 SQLite）
│   ├── utils/pdfUtils.ts     PDF 元数据解析、base64 互转
│   └── types/db.d.ts         window.db API 类型声明
└── vite.config.ts
```

## 提示词模板

`ParamPanel` 内置模板，点击即套用为系统提示词：逐段精读、通俗解释、提取要点、批判性分析、翻译为中文。系统提示词也可完全自定义。

## 配置

在设置页或对话页右侧参数面板配置 LLM：

- **OpenAI**：填入 API Key，地址默认 `https://api.openai.com/v1`
- **Anthropic**：填入 API Key
- **Ollama**：填入本地地址（默认 `http://localhost:11434`）

> 注意：当前 API Key 以明文存于本地 SQLite `settings` 表。纯本地单机场景可接受；如需加固，可改用 Electron `safeStorage` 加密。

## 参与贡献

欢迎任何形式的贡献！

**提交 Issue**：遇到 bug 或有功能建议，请[新建 Issue](../../issues/new)，说明复现步骤或需求背景。

**提交 PR**：
1. Fork 本仓库，基于 `main` 创建功能分支（`git checkout -b feat/your-feature`）
2. 遵循现有代码风格（TypeScript strict、Vue3 `<script setup>`、DRY/KISS）
3. 若涉及逻辑变更，请在 `src/tests/` 中补充对应测试（`npm test` 全部通过）
4. 提交 PR 时描述变更内容、测试方式，以及是否有破坏性改动

## License

[MIT](./LICENSE) © 2026 Dregen_Yor
