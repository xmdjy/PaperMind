# Docling 校园网 HTTPS 实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已要求直接配置服务器并修改客户端，在当前任务分支内执行，不再等待设计审批。

**Goal:** 新用户连接可达服务器的校园网后，直接使用 Docling，无需 SSH 或安装系统证书。

**Architecture:** Nginx 在 101.76.222.224:443 接收 HTTPS，转发到现有 127.0.0.1:5001。没有域名和公开证书时，使用专用私有 CA，客户端仅在该固定 origin 下信任其公钥证书；根私钥保存在管理员本机仓库外，服务器只持有叶证书私钥。客户端使用 Node HTTPS，保持证书链、IP、有效期校验，禁止重定向。

**Tech Stack:** Ubuntu systemd / Nginx / OpenSSL / Electron Node HTTPS / Vitest。

**Spec:** 本次对话中校园网 HTTPS 入口方案及用户“直接连接到服务器配置…全部完成后我自己找其他电脑测试”的执行要求。

## Global Constraints

- 所有源码改动位于 codex/docling-campus-https；保留原网页存储设计文件，不提交推送。
- 不修改系统全局 TLS 信任，不关闭证书校验，不在仓库、安装包或日志包含私钥。
- 自定义 HTTPS 和显式 localhost 地址继续可用；不把保存的自建本地服务静默改为远端。
- 入口最大 multipart 请求 65 MiB（客户端 PDF 上限 64 MiB），解析代理等待 1900 秒（客户端最多 1800 秒），转换同时最多 2 个，繁忙返回 429；只开放健康、连接检查、文件转换接口。
- 尚未验证的其他校区、宿舍网络由用户自行测试；不声称校园网之外不可达，不凭猜测添加 SDU 地址范围。

## Review Focus

- 默认连接不再调用 SSH，显式本地设置保留本地语义。
- 专用 CA 只用于固定 origin，错误证书、IP 不匹配、过期均拒绝。
- 重定向不携带 API Key 到其他地址；超时与主动取消终止底层连接。
- multipart 上传、响应流取消、异常断流不留下连接或内存泄漏。
- 已有配置用户可在设置中一键使用校园网地址，失败时保留未保存修改。

### Task 1: HTTPS 客户端与设置

- [x] 修改默认设置和客户端用例，验证旧实现失败。
- [x] 添加固定 origin 的 HTTPS 信任、上传和取消测试，先失败再实现。
- [x] 移除自动 SSH；设置页增加校园网默认恢复入口，保留自建地址。
- [x] 运行相关 Vitest、完整 npm test、npm run typecheck。

### Task 2: 部署与联调

- [x] 生成 CA 与 IP 叶证书，私钥只放仓库外；添加公开 CA 到主进程构建。
- [x] 安装 Nginx，保存配置和回退方法，验证配置后启动；启用 Docling 用户 linger，保证退出登录后运行。
- [x] 从本机直接 HTTPS 测试健康、OpenAPI、错误证书、上传和真实 PDF 中文摘要，不使用 SSH 隧道；真实数据写隔离目录。
- [x] 记录证书更新、运行维护、旧设置切换、其他电脑测试步骤及验证边界。
- [x] 核对 git diff 和私钥/凭据泄漏情况，提供结果；本次不自动 commit/push/发布安装包。

### Task 3: 解除已确认的桌面运行时阻碍

- [x] 官方 44.10.1 发布记录声明 Node 24.22.1；独立下载并检查实际 Electron 44.10.1 / Node 24.22.1 二进制后，更新同一大版本的补丁依赖与锁文件。
- [x] 在 config/runtime-security.json 记录精确组合和官方证据 URL，保持旧版本拒绝、实际版本匹配和打包门禁，不降低版本下限。
- [x] npm 初始查询的 E404 已证实来自旧缓存，独立缓存 --prefer-online 已取得新版本；不得将旧缓存错误描述为版本不存在。
- [x] 待真实摘要任务退出后执行依赖安装/原生模块重建，避免影响正在使用 SQLite 的测试进程。
- [x] 使用正式安装后的运行时通过 security:runtime，重跑完整测试与类型检查，验证打包主进程证书存在并测试真实 IPC 连接；不发布安装包。
