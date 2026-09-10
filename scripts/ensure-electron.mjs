// dev 前置自愈：确保 Electron 二进制就绪、清掉过期拷贝。
//
// 背景：Electron 44 起 npm 包不再自带 postinstall 下载二进制（registry 元数据
// scripts 为 null），npm install 后 dist/ 与 path.txt 会缺失；而 scripts/dev.mjs
// 设置的 ELECTRON_OVERRIDE_DIST_PATH 会短路 node_modules/electron/index.js 的
// 兜底下载，最终以 spawn ENOENT 的形式在启动末尾报错。此脚本在 dev 前把这三处
// 坑补齐：二进制缺失自动下载、版本变化自动清 .papermind-electron 拷贝缓存。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const electronDir = resolve(root, 'node_modules/electron')
const overrideDir = resolve(root, 'node_modules/.papermind-electron')
const markerFile = resolve(overrideDir, '.electron-version')

// dev.mjs 的拷贝目标与 index.js 的路径拼接都是 darwin 形态，此脚本与之保持同平台口径
function distBinaryPath() {
  if (process.platform === 'darwin') return resolve(electronDir, 'dist/Electron.app')
  if (process.platform === 'win32') return resolve(electronDir, 'dist/electron.exe')
  return resolve(electronDir, 'dist/electron')
}

function binaryReady() {
  return existsSync(resolve(electronDir, 'path.txt')) && existsSync(distBinaryPath())
}

function electronVersion() {
  try {
    return JSON.parse(readFileSync(resolve(electronDir, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

function download() {
  // @electron/get 认 ELECTRON_MIRROR；无代理环境时回落 npmmirror（境内直连可用）
  const env = { ...process.env }
  if (!env.ELECTRON_MIRROR && !env.HTTPS_PROXY && !env.HTTP_PROXY) {
    env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  console.log('[ensure-electron] Electron 二进制缺失，开始下载（首次需要几分钟）…')
  const result = spawnSync(process.execPath, [resolve(electronDir, 'install.js')], {
    stdio: 'inherit',
    cwd: electronDir,
    env,
  })
  if (result.status !== 0 || !binaryReady()) {
    console.error(
      '[ensure-electron] Electron 二进制下载失败。\n' +
        '  请配置代理（或 ELECTRON_MIRROR）后重试，例如：\n' +
        '  HTTP_PROXY=http://127.0.0.1:7897 HTTPS_PROXY=http://127.0.0.1:7897 npm run dev',
    )
    process.exit(1)
  }
  console.log('[ensure-electron] Electron 二进制下载完成。')
}

// ---- 主流程 ----

if (!existsSync(electronDir)) {
  console.error('[ensure-electron] 未找到 node_modules/electron，请先运行 npm install。')
  process.exit(1)
}

const version = electronVersion()

// dev.mjs 只在目标不存在时拷贝（existsSync 缓存），electron 升级后会残留旧版 App；
// 这里用版本标记在版本变化时清掉，让 dev.mjs 重新拷贝
if (existsSync(overrideDir)) {
  let marker = null
  try {
    marker = readFileSync(markerFile, 'utf8').trim()
  } catch { /* 无标记 = 旧格式缓存，一并清理 */ }
  if (marker !== version) {
    rmSync(overrideDir, { recursive: true, force: true })
    console.log(`[ensure-electron] Electron ${marker ?? '(未知版本)'} → ${version}，已清理旧拷贝缓存。`)
  }
}

if (!binaryReady()) download()

// 就绪后记录版本标记，供下次版本比对
mkdirSync(overrideDir, { recursive: true })
writeFileSync(markerFile, version ?? 'unknown')
