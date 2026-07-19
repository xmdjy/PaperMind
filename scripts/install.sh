#!/usr/bin/env bash
# PaperMind 一键安装脚本 — Linux / macOS
# 用法：curl -fsSL https://raw.githubusercontent.com/OWNER/PaperMind/main/scripts/install.sh | bash
set -euo pipefail

REPO="OWNER/PaperMind"   # ← 替换为你的 GitHub 用户名/仓库名
APP="papermind"
GH_API="https://api.github.com/repos/${REPO}/releases/latest"

# ── 颜色输出 ──────────────────────────────────────────────────────────────────
red()  { printf '\033[31m%s\033[0m\n' "$*"; }
green(){ printf '\033[32m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

# ── 检测平台 & 架构 ────────────────────────────────────────────────────────────
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Linux)  PLATFORM="linux" ;;
  Darwin) PLATFORM="darwin" ;;
  *)      red "不支持的操作系统：$OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64)          ARCH_TAG="x64" ;;
  aarch64 | arm64) ARCH_TAG="arm64" ;;
  *)               red "不支持的架构：$ARCH"; exit 1 ;;
esac

TARGET="${PLATFORM}-${ARCH_TAG}"

# ── 获取最新 Release 下载地址 ──────────────────────────────────────────────────
bold "→ 查询最新 Release（${REPO}）..."
RELEASE_JSON=$(curl -fsSL "$GH_API")
VERSION=$(printf '%s' "$RELEASE_JSON" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

# 按扩展名匹配对应平台的文件
case "$PLATFORM" in
  linux)  EXT="AppImage" ;;
  darwin) EXT="dmg"      ;;
esac

DOWNLOAD_URL=$(printf '%s' "$RELEASE_JSON" \
  | grep '"browser_download_url"' \
  | grep "${TARGET}\.${EXT}" \
  | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

if [ -z "$DOWNLOAD_URL" ]; then
  red "未找到适用于 ${TARGET} 的下载包（版本 ${VERSION}）"
  red "请前往 https://github.com/${REPO}/releases 手动下载"
  exit 1
fi

FILENAME="${APP}-${VERSION}-${TARGET}.${EXT}"
bold "→ 下载 ${FILENAME}..."
curl -fSL --progress-bar "$DOWNLOAD_URL" -o "/tmp/${FILENAME}"

# ── 平台安装 ───────────────────────────────────────────────────────────────────
if [ "$PLATFORM" = "linux" ]; then
  INSTALL_DIR="${HOME}/.local/bin"
  mkdir -p "$INSTALL_DIR"
  mv "/tmp/${FILENAME}" "${INSTALL_DIR}/${APP}.AppImage"
  chmod +x "${INSTALL_DIR}/${APP}.AppImage"

  # 创建 .desktop 启动项（可选）
  DESKTOP_DIR="${HOME}/.local/share/applications"
  mkdir -p "$DESKTOP_DIR"
  cat > "${DESKTOP_DIR}/papermind.desktop" <<EOF
[Desktop Entry]
Name=PaperMind
Exec=${INSTALL_DIR}/${APP}.AppImage
Type=Application
Categories=Education;Science;
Comment=本地学术论文阅读助手
EOF

  green "✓ 已安装至 ${INSTALL_DIR}/${APP}.AppImage"
  echo "  运行：${INSTALL_DIR}/${APP}.AppImage"
  echo "  或通过应用菜单搜索 PaperMind 启动"

elif [ "$PLATFORM" = "darwin" ]; then
  MOUNT_POINT="/Volumes/PaperMind"
  bold "→ 挂载 dmg..."
  hdiutil attach "/tmp/${FILENAME}" -mountpoint "$MOUNT_POINT" -quiet -nobrowse

  bold "→ 安装到 /Applications..."
  # 删除旧版本（如存在）
  rm -rf "/Applications/PaperMind.app" 2>/dev/null || true
  cp -R "${MOUNT_POINT}/PaperMind.app" "/Applications/"

  hdiutil detach "$MOUNT_POINT" -quiet
  rm "/tmp/${FILENAME}"

  green "✓ PaperMind.app 已安装到 /Applications"
  echo ""
  echo "  ⚠️  首次运行提示（未签名应用）："
  echo "  方法一：右键单击图标 → 打开 → 确认"
  echo "  方法二：sudo xattr -cr /Applications/PaperMind.app"
fi
