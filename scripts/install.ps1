# PaperMind 一键安装脚本 — Windows (PowerShell)
# 用法（管理员 PowerShell）：
#   irm https://raw.githubusercontent.com/OWNER/PaperMind/main/scripts/install.ps1 | iex
#
# 或下载后运行：
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\install.ps1

$ErrorActionPreference = 'Stop'

$Repo    = "OWNER/PaperMind"   # ← 替换为你的 GitHub 用户名/仓库名
$App     = "papermind"
$ApiUrl  = "https://api.github.com/repos/$Repo/releases/latest"

function Write-Green($msg) { Write-Host $msg -ForegroundColor Green }
function Write-Red($msg)   { Write-Host $msg -ForegroundColor Red }
function Write-Bold($msg)  { Write-Host $msg -ForegroundColor Cyan }

# ── 检测架构 ───────────────────────────────────────────────────────────────────
$Arch = if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -eq 'Arm64') {
    "arm64"
} else {
    "x64"
}
$Target = "win32-$Arch"

# ── 获取最新 Release ────────────────────────────────────────────────────────────
Write-Bold "→ 查询最新 Release ($Repo)..."

$Headers = @{ 'User-Agent' = 'PaperMind-Installer' }
try {
    $Release = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
} catch {
    Write-Red "无法访问 GitHub API：$($_.Exception.Message)"
    exit 1
}

$Version = $Release.tag_name
$Asset   = $Release.assets | Where-Object { $_.name -match "$Target\.exe$" } | Select-Object -First 1

if (-not $Asset) {
    Write-Red "未找到适用于 $Target 的安装包（版本 $Version）"
    Write-Red "请前往 https://github.com/$Repo/releases 手动下载"
    exit 1
}

$DownloadUrl = $Asset.browser_download_url
$FileName    = $Asset.name
$TmpPath     = Join-Path $env:TEMP $FileName

# ── 下载 ───────────────────────────────────────────────────────────────────────
Write-Bold "→ 下载 $FileName..."
$ProgressPreference = 'SilentlyContinue'   # 禁用 PowerShell 默认进度条（极慢）
Invoke-WebRequest -Uri $DownloadUrl -OutFile $TmpPath -Headers $Headers
$ProgressPreference = 'Continue'

# ── 安装 ───────────────────────────────────────────────────────────────────────
Write-Bold "→ 启动安装程序..."
$Process = Start-Process -FilePath $TmpPath -ArgumentList '/S' -PassThru -Wait

if ($Process.ExitCode -eq 0) {
    Write-Green "✓ PaperMind $Version 安装成功"
    Write-Host "  可在开始菜单搜索 PaperMind 启动"
} else {
    Write-Red "安装程序退出码：$($Process.ExitCode)"
    Write-Red "请尝试手动运行：$TmpPath"
    exit $Process.ExitCode
}

Remove-Item $TmpPath -ErrorAction SilentlyContinue
