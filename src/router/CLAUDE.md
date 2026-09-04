[根目录](../../CLAUDE.md) > [src](../CLAUDE.md) > **router**

# src/router/ — 路由配置

**变更记录**
- 2026-08-02T15:49:42: 新建独立模块文档（原并入 `src/CLAUDE.md`）

## 模块职责

集中式 Vue Router 配置，单文件 `src/router/index.ts`。使用 **hash 模式**（`createWebHashHistory`）以兼容 Electron 打包后的 `file://` 协议（history 模式在 `file://` 下刷新会 404）。

## 路由表

| 路由 | 组件 | 加载方式 | 页面职责 |
|------|------|---------|---------|
| `/` | → 重定向 `/library` | — | 默认入口 |
| `/library` | `LibraryView` | **同步**（首屏，静态 import） | 知识库 + 论文卡片网格 + PDF 导入 |
| `/library/:id` | `ReaderView` | 懒加载（动态 import） | 阅读器（PDF + 对话分屏） |
| `/chat` | `ChatView` | 懒加载 | 多论文上下文对话 |
| `/settings` | `SettingsView` | 懒加载 | LLM 配置、HF token、数据管理 |

- 仅 `LibraryView` 静态导入（首屏即用），其余三页动态 `() => import(...)` 分包按需加载。
- `App.vue` 侧栏仅显示「知识库」「对话」两个 `nav-item`；「设置」在侧栏底部单独链接；`ReaderView` 由知识库卡片跳转进入。

## 相关文件

- `src/router/index.ts` — 路由定义（本模块唯一文件）
- 消费方：`src/App.vue`（`<router-view>` + `nav-item`）、`src/main.ts`（`app.use(router)`）
- 页面组件：见 [src/views](../views/CLAUDE.md)

## 常见问题

**Q: 为什么必须用 hash 模式？**
打包后渲染层通过 `win.loadFile(dist/index.html)` 以 `file://` 加载，HTML5 history 模式在此协议下无法正确解析路径；hash（`#/library`）不触发实际导航，安全可靠。
