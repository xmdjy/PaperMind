# Docling 服务器接入

默认 SSH 目标为 `ubuntu@101.76.222.224:22`，远端服务地址为 `127.0.0.1:5001`。PaperMind 设置中的服务根地址保留为 `http://127.0.0.1:5001`，应用自动建立 SSH 转发。自定义 HTTP 服务地址仍按原配置使用。

客户端须具备网络访问和免交互 SSH 登录能力，使用已获授权的密钥。先核对并信任服务器指纹，再确认：

```bash
ssh -o BatchMode=yes -o ConnectTimeout=10 ubuntu@101.76.222.224 true
```

若需指定密钥，可在本机 `~/.ssh/config` 对 `Host 101.76.222.224` 配置 `User ubuntu` 和自己的 `IdentityFile`。不要将私钥放入仓库。

服务端检查：

```bash
ssh -o BatchMode=yes ubuntu@101.76.222.224 'curl --fail http://127.0.0.1:5001/health'
```

若本机已有旧服务的 5001 监听，应用会复用该监听；切换前须确认并停止旧隧道，然后重启应用。不要直接向服务器公网 5001 端口上传论文。

## 2026-11-01 验证

SSH TCP 连接成功，但远端在握手阶段、认证之前关闭连接，返回 `kex_exchange_identification: Connection closed by remote host`。直接访问公网 `http://101.76.222.224:5001/health` 返回 `curl: (52) Empty reply from server`；服务预期经 SSH 访问，公网探测不能证明远端回环服务状态。

当前无法确认 Docling 健康状态、OpenAPI 接口或真实 PDF 转换。需恢复 SSH 访问后，在设置页测试连接，并通过实际 `convertPdfForSummary` 客户端上传测试 PDF，核对正文、图片、表格和公式。摘要继续使用当前配置的 LLM，不涉及数据库迁移。

实际调用 PaperMind 的 `testDoclingConnection(DEFAULT_DOCLING_SETTINGS)`，托管隧道返回 `Connection reset by 101.76.222.224 port 22`；OpenAPI 检查未完成，后续测试 PDF 转换未执行。本机测试前未发现 5001 端口监听。

本地使用 Node 24.22.1：`npm test` 通过 174 个文件 / 2210 项 Vitest 测试；脚本测试 23 通过、1 跳过（缺少 `desktop-file-validate`）。`npm run typecheck` 和 `git diff --check` 通过。隧道回归测试已先确认旧 A100 目标失败，再切换目标后通过。未构建或替换已安装应用。
