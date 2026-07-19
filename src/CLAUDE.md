> [根目录](../../CLAUDE.md) / src/

# src/ — 应用入口与全局配置

**变更记录**
- 2026-07-19T14:49:32: UI 美化——主色改为青绿、侧栏/卡片/空态/对话气泡视觉升级
- 2026-06-07T21:33:55: 初始化
- 2026-06-07T21:51:00: 补全 App.vue / global.css / router 文档

---

## App.vue — 应用根组件

布局结构：固定侧边栏 + 路由内容区，应用全局唯一入口。

```
┌─ sidebar (220px) ─┬─ main-content (flex:1) ─────┐
│  logo             │  <router-view>               │
│  nav-items        │  (fade 过渡)                  │
│  settings link    │                              │
└───────────────────┴──────────────────────────────┘
```

**关键行为**
- `onMounted` 并行调用 `paperStore.init()` + `chatStore.init()`，确保 SQLite 数据在首次路由渲染前就绪
- 使用 `<transition name="fade" mode="out-in">` 包裹路由切换（0.2s opacity）
- `navItems` 只包含知识库 + 对话；设置页通过底部独立链接访问

---

## src/styles/global.css — 全局样式与 CSS 变量

### 颜色变量

| 变量 | 值 | 用途 |
|------|----|------|
| `--bg-base` | `#0c0e11` | 页面最底层背景 |
| `--bg-surface` | `#13161b` | 侧边栏、卡片底色 |
| `--bg-elevated` | `#1a1f27` | 弹窗、悬浮面板 |
| `--bg-hover` | `#222830` | 悬停高亮 |
| `--border` | `#2a313c` | 默认边框 |
| `--border-light` | `#3a4452` | 次级边框 |
| `--text-primary` | `#e6e9ef` | 主要文字 |
| `--text-secondary` | `#8b95a8` | 次要文字 |
| `--text-muted` | `#5a6578` | 占位 / 辅助 |
| `--accent` | `#3db8a0` | 主色调（青绿） |
| `--accent-dim` | `rgba(61,184,160,.14)` | 主色调背景 |
| `--gold` | `#d4a84b` | AI 消息 / 高亮颜色 |
| `--sidebar-width` | `220px` | 侧边栏宽度 |

### 字体

- 正文：`DM Sans`（Google Fonts，`font-family: 'DM Sans', sans-serif`）
- 标题：`Playfair Display`（serif，通过 `.font-display` 类应用）

### Element Plus 主题覆盖

通过全局 CSS 覆盖 Element Plus CSS 变量，使组件与暗色主题一致：
- `.el-input__wrapper` — `--bg-surface` 背景，focus 时 `--accent` 描边
- `.el-select-dropdown` — `--bg-elevated` 背景
- `.el-tag` — `--accent-dim` 背景，`--accent` 文字
- `.el-slider` — `--accent` 填充色
- 所有覆盖均用 `!important` 确保优先级

### 全局动画类

- `.fade-enter-active / .fade-leave-active` — 路由切换 opacity 过渡（`transition: opacity 0.2s ease`）

---

## src/router/index.ts — 路由配置

Hash 模式（`createWebHashHistory`），兼容 Electron `file://` 协议。

| 路由 | 组件 | 加载方式 |
|------|------|---------|
| `/` | → 重定向 `/library` | — |
| `/library` | `LibraryView` | 同步（首屏） |
| `/library/:id` | `ReaderView` | 懒加载 |
| `/chat` | `ChatView` | 懒加载 |
| `/settings` | `SettingsView` | 懒加载 |

---

## src/tests/ — 测试目录

| 文件 | 覆盖 |
|------|------|
| `setup.ts` | 全局 `window.db` mock（`vi.fn()`），所有测试自动注入 |
| `paper.store.test.ts` | usePaperStore 7 个用例 |
| `chat.store.test.ts` | useChatStore 8 个用例，含 LLM fetch mock |
| `pdfUtils.test.ts` | `base64ToUrl` 2 个用例，mock pdfjs-dist |
