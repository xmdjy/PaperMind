import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BenchConfig, ConfigFile } from './types'
import { benchPath } from './paths'

// 惰性求值：不能用 new URL(...).pathname，其保留百分号转义且 Vitest 下会被改写，
// 用共享的 benchPath 在每次调用时解析（默认参数每次调用求值）。
const DEFAULT_CONFIG_DIR = () => benchPath(import.meta.url, '../configs/')

/** 矩阵字段取值展开为笛卡尔积，每个组合一个 BenchConfig。 */
export function expandMatrix(file: ConfigFile): BenchConfig[] {
  // Object.keys 返回 string[]，这里收窄回 ConfigFile.matrix 的合法键，避免 strict 下索引报 any
  const keys = Object.keys(file.matrix) as Array<Exclude<keyof BenchConfig, 'name'>>
  if (keys.length === 0) return [{ name: file.name }]

  let combos: Array<Record<string, number | boolean>> = [{}]
  for (const key of keys) {
    // 键来自同一对象的 Object.keys，取值必然存在，用非空断言收窄 Partial
    const values = file.matrix[key]!
    combos = combos.flatMap(combo => values.map(v => ({ ...combo, [key]: v })))
  }

  const single = combos.length === 1
  return combos.map(combo => ({
    ...combo,
    name: single ? file.name : `${file.name}[${describeCombo(combo)}]`,
  })) as BenchConfig[]
}

function describeCombo(combo: Record<string, number | boolean>): string {
  return Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(',')
}

export async function loadConfigs(
  nameOrPath: string,
  configDir: string = DEFAULT_CONFIG_DIR(),
): Promise<BenchConfig[]> {
  const path = nameOrPath.endsWith('.json') || isAbsolute(nameOrPath)
    ? nameOrPath
    : join(configDir, `${nameOrPath}.json`)

  if (!existsSync(path)) {
    throw new Error(`配置文件不存在：${path}（--config 接受配置名或 .json 路径）`)
  }
  const file = JSON.parse(await readFile(path, 'utf-8')) as ConfigFile
  return expandMatrix(file)
}

/** 结果文件名用（报表行标签直接用配置名）；剔除文件名非法字符（Windows 不允许文件名以点结尾）。 */
export function configLabel(config: BenchConfig): string {
  return config.name.replace(/[^\w.=,[\]-]/g, '_').replace(/[[\],=]/g, '.').replace(/\.+$/, '')
}
