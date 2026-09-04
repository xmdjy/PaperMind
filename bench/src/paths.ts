import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/**
 * 从调用方模块的 import.meta.url 解析 bench 内的相对路径。
 * 不能用 new URL(...).pathname——它保留百分号转义，路径含空格/中文时
 * 得到字面量 %20，文件读取静默失败。
 * Vitest 下 Vite 会把 `new URL(字面量, import.meta.url)` 整体改写成 http: 协议，
 * 故对非 file: 协议回落到 cwd 相对路径（仅测试环境的兜底，测试一律显式传路径）。
 */
export function benchPath(moduleUrl: string, relative: string): string {
  const url = new URL(relative, moduleUrl)
  if (url.protocol === 'file:') return fileURLToPath(url)
  return resolve(process.cwd(), 'bench', relative)
}
