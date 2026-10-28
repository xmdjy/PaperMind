# Parsed Summary Implementation Plan

**Goal:** HTML 原生解析和 PDF Docling 解析统一后，一次提交 LLM 生成摘要。
**Architecture:** 主进程 documentSummary.parse 负责来源读取、解析和材料缓存；渲染进程 store 保留任务状态和版本保护，统一组装文本及原图请求，保存报告。
**Spec:** docs/superpowers/specs/2026-10-28-parsed-summary-design.md

## Global Constraints

- 所有改动限 feat/parsed-summary worktree；不同贡献者写入不同文件。
- 保留历史快照身份、取消保护、原图 allowlist、备份兼容和 API 密钥隔离。
- 不重新抓网页，不引入新依赖，不静默截断材料。

## Tasks

- [x] HTML 原生解析：electron/htmlSummary.ts，输入 PreviewSnapshot，输出 Promise<ParsedDocument>。正文、列表、标题层级、表格、数学表达式和离线原图；测试历史快照、缺资源、复杂表格与内容安全。
- [x] PDF 摘要解析：扩展 doclingDocument.ts 保留标题/表格；doclingClient.ts 导出 convertPdfForSummary；旧 convertPdf 行为保持兼容。回归中文/无图注图、表格和协议错误。
- [x] LLM 请求：src/utils/parsedSummary.ts 定义统一输入，序列化全文和全部可用原图，使用新提示词，一次请求；验证空输入、超限、来源信息、响应错误和取消。
- [x] 主进程解析服务与 IPC：添加 documentSummary.parse，复用 SQLite 材料/资产存储，PDF/HTML 分派与内容版本校验；同步 preload/contract/mock。
- [x] 摘要 store、网页 composable 和论文入口迁移，去除常规路径的页面渲染/视觉定位；回归去重、缓存、取消、来源切换与续写。
- [x] 全量 npm test、npm run typecheck、源码 bundle 验证及独立代码审查。
- [ ] 实际远端 Docling + LLM 联调，以及通过运行时门禁后的安装包验证。

## Review Focus

HTML 图像必须来自同一归档；取消后的旧响应不能覆盖新任务；旧缓存不能跳过新解析；表格和标题不能在适配层丢失结构；离线/解析失败不可悄悄回退到不完整材料。

## Progress

基线 origin/main 089d88d。实施与验证使用独立 Node 24.22.1 / npm 10.9.4，保持系统运行时不变。

已完成独立代码审查并修复：MathML 保结构、内联 SVG/Canvas 缺失表达、同源三任务队列、输出预算调整后的完整续写、未关联表注保留、sharp 原生模块解包。每项行为修复有先失败再通过的回归。

构建安装包仍受基线 Electron/Node 安全门禁阻止，服务器 SSH 当前不可达。这两项作为实际联调/发布前置事项保留，不能以本地测试和源码 bundle 通过替代。

最终本地验证完成：2153 项 Vitest + 23 项脚本检查通过，1 项 desktop-file-validate 环境跳过；typecheck、三端源码 bundle 和 diff check 通过。完整安装包与实际远端联调仍按上文标记未验证。
