# A100 Docling 接入

PDF 解析默认使用 A100 服务器上的 Docling。摘要生成继续使用当前对话或网页摘要所选的 LLM；此变更不会切换到服务器上的 Qwen 模型。

## 客户端配置

当前服务器的 SSH 地址为 `10.30.121.100:30560`，用户为 `root`。客户端机器必须能够访问这个内网地址；若当前网络没有相应路由，需要先连接可访问该地址的 VPN 或使用已获授权的网络通道。登录密钥须由管理员授权，每位使用者配置自己的私钥。

在客户端的 `~/.ssh/config` 中配置：

```sshconfig
Host yrhA100
  HostName 10.30.121.100
  Port 30560
  User root
  IdentityFile /你的私钥文件路径
  IdentitiesOnly yes
```

将 `IdentityFile` 替换为实际路径。首次连接先交互执行以下命令，向管理员核对服务器指纹并完成主机密钥信任：

```bash
ssh yrhA100 true
```

若私钥已加密，通过本机 SSH agent 解锁。然后确认以下命令能够免交互完成，再打开 PaperMind：

```bash
ssh -o BatchMode=yes yrhA100 true
```

PaperMind 中 Docling 根地址保留为 `http://127.0.0.1:5001`。应用首次请求时自动执行 SSH 转发，将本地 `127.0.0.1:5001` 连接到远端 `127.0.0.1:5001`。已存在的本地监听会被复用；可在设置页测试 Docling 连接。也可以手动建立隧道：

```bash
ssh -N -L 127.0.0.1:5001:127.0.0.1:5001 yrhA100
```

应用或隧道在哪台机器上运行，就在哪台机器上配置 SSH 和网络访问；另一台电脑上的 VPN 或 SSH 隧道不会自动提供访问能力。服务绑定远端回环地址，不直接通过服务器 IP 的 5001 端口访问。

## 服务器与验证边界

服务器部署目录为 `/yuruihao/papermind`，原生 Docling 接口为 `/v1/convert/file`，模型配置为 Heron、TableFormer accurate、RapidOCR、CodeFormulaV2。该目录中的 `./start-service.sh` 用于容器重启后恢复服务。

本次仅迁移默认 Docling SSH 目标，并同步连接说明文字，保留现有请求参数、解析缓存和 LLM 配置，不涉及数据库迁移。

2026-10-30 本地验证使用 Node 24.22.1 / npm 10.9.4：全量 Vitest 174 个文件、2210 项测试通过，脚本测试 23 通过、1 跳过（本机缺少 `desktop-file-validate`），类型检查通过。托管隧道回归测试先确认旧目标失败，再修改默认目标使其通过。

直接 SSH 到 A100 查询 Docling `/health` 成功；随后通过实际 `convertPdfForSummary` 客户端和新托管隧道复验公开的 15 页 PDF 时，网络连接中断，请求未完成，另一次 SSH 探测连接超时。因此本轮尚未完成客户端真实 PDF 解析复验，也未重测完整 Electron 界面与当前 LLM 的摘要端到端流程。待网络恢复后，需从默认摘要入口补验正文、图片、公式、表格及摘要生成。服务器端的既有解析验证不替代这项客户端验证。

本轮未重新执行安装包构建；仓库已有的 Electron 运行时安全门禁限制仍需另行处理，未放宽该门禁。
