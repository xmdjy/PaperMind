import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BenchConfig, ConfigFile } from './types'

const DEFAULT_CONFIG_DIR = new URL('../configs/', import.meta.url).pathname

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
  configDir: string = DEFAULT_CONFIG_DIR,
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

/** 报表行标签与结果文件名用；剔除文件名非法字符。 */
export function configLabel(config: BenchConfig): string {
  return config.name.replace(/[^\w.=,[\]-]/g, '_').replace(/[[\],=]/g, '.')
}
