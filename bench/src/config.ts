import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { BenchConfig, ConfigFile, PaperMindConfig, TraditionalRagConfig } from './types'
import { benchPath } from './paths'

const DEFAULT_CONFIG_DIR = () => benchPath(import.meta.url, '../configs/')
const fail = (path: string, field: string, reason = '无效'): never => { throw new Error(`配置文件 ${path} 的 ${field} ${reason}`) }
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const positiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0
const nonNegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

export function expandMatrix(file: ConfigFile): PaperMindConfig[] {
  const keys = Object.keys(file.matrix) as Array<Exclude<keyof PaperMindConfig, 'name' | 'kind'>>
  if (!keys.length) return [{ name: file.name }]
  let combos: Array<Record<string, number | boolean>> = [{}]
  for (const key of keys) combos = combos.flatMap(combo => file.matrix[key]!.map(v => ({ ...combo, [key]: v })))
  const single = combos.length === 1
  return combos.map(combo => ({ ...combo, name: single ? file.name : `${file.name}[${Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(',')}]` })) as PaperMindConfig[]
}

function validateTraditional(raw: Record<string, unknown>, path: string): TraditionalRagConfig {
  if (typeof raw.name !== 'string' || !raw.name) fail(path, 'name', '缺失或不是非空字符串')
  if (!obj(raw.chunking)) fail(path, 'chunking', '缺失或不是对象')
  if (!obj(raw.retrieval)) fail(path, 'retrieval', '缺失或不是对象')
  if (!obj(raw.generationContext)) fail(path, 'generationContext', '缺失或不是对象')
  const c = raw.chunking as Record<string, unknown>; const r = raw.retrieval as Record<string, unknown>; const g = raw.generationContext as Record<string, unknown>; const name = raw.name as string
  if (c.tokenizer !== 'bge-m3' || !positiveInt(c.chunkSize)) fail(path, 'chunking', 'tokenizer 必须为 bge-m3 且 chunkSize 为正整数')
  if (!nonNegative(c.overlap) || !Number.isInteger(c.overlap) || (c.overlap as number) >= (c.chunkSize as number)) fail(path, 'chunking.overlap', '必须为非负整数且小于 chunkSize')
  if (!positiveInt(r.topK)) fail(path, 'retrieval.topK', '必须为正整数')
  if (!positiveInt(g.topK) || (g.topK as number) > (r.topK as number)) fail(path, 'generationContext.topK', '必须为正整数且不大于 retrieval.topK')
  if (!positiveInt(g.maxTokens) || (g.maxTokens as number) < (c.chunkSize as number)) fail(path, 'generationContext.maxTokens', '必须为不小于 chunkSize 的正整数')
  const base = { name, kind: 'traditional-rag' as const, chunking: { tokenizer: 'bge-m3' as const, chunkSize: c.chunkSize as number, overlap: c.overlap as number }, generationContext: { topK: g.topK as number, maxTokens: g.maxTokens as number } }
  if (r.algorithm === 'bm25') {
    if (!nonNegative(r.k1) || !nonNegative(r.b) || (r.b as number) > 1) fail(path, 'retrieval.k1/b', 'k1 必须非负且 b 必须在 [0,1]')
    return { ...base, retrieval: { algorithm: 'bm25', topK: r.topK as number, k1: r.k1 as number, b: r.b as number } }
  }
  if (r.algorithm === 'jaccard') return { ...base, retrieval: { algorithm: 'jaccard', topK: r.topK as number } }
  if (r.algorithm === 'cosine') {
    if (!obj(r.embedding)) fail(path, 'retrieval.embedding', '缺失或不是对象')
    const e = r.embedding as Record<string, unknown>
    if (typeof e.model !== 'string' || typeof e.revision !== 'string' || typeof e.queryPrefix !== 'string' || e.normalize !== true || !positiveInt(e.maxLength)) fail(path, 'retrieval.embedding', '字段不完整，且 normalize 必须为 true')
    return { ...base, retrieval: { algorithm: 'cosine', topK: r.topK as number, embedding: { model: e.model as string, revision: e.revision as string, queryPrefix: e.queryPrefix as string, normalize: true, maxLength: e.maxLength as number } } }
  }
  return fail(path, 'retrieval.algorithm', '非法')
}

function validatePaperMind(raw: Record<string, unknown>, path: string): ConfigFile {
  if (typeof raw.name !== 'string' || !raw.name) fail(path, 'name', '缺失或不是非空字符串')
  if (!obj(raw.matrix)) fail(path, 'matrix', '缺失或不是对象')
  const matrix = raw.matrix as Record<string, unknown>
  const allowed = new Set(['topK', 'minScore', 'chunkPages', 'minSectionPages', 'maxSectionPages', 'maxContextChars', 'forceFixedChunk', 'enableRewrite'])
  for (const [key, values] of Object.entries(matrix)) {
    if (!allowed.has(key)) fail(path, `matrix.${key}`, '不是支持的 PaperMind 参数')
    if (!Array.isArray(values)) fail(path, `matrix.${key}`, '必须为 number/boolean 数组')
    const list = values as unknown[]
    if (list.some(v => typeof v !== 'number' && typeof v !== 'boolean')) fail(path, `matrix.${key}`, '必须为 number/boolean 数组')
    if (!list.length) fail(path, `matrix.${key}`, '展开为 0 个配置')
  }
  return { name: raw.name as string, kind: 'papermind', matrix: matrix as ConfigFile['matrix'] }
}

export async function loadConfigs(nameOrPath: string, configDir: string = DEFAULT_CONFIG_DIR()): Promise<BenchConfig[]> {
  const path = nameOrPath.endsWith('.json') || isAbsolute(nameOrPath) ? nameOrPath : join(configDir, `${nameOrPath}.json`)
  if (!existsSync(path)) throw new Error(`配置文件不存在：${path}（--config 接受配置名或 .json 路径）`)
  let raw: unknown
  try { raw = JSON.parse(await readFile(path, 'utf-8')) } catch (e) { throw new Error(`配置文件 ${path} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`) }
  if (!obj(raw)) fail(path, '根对象', '必须为对象')
  const record = raw as Record<string, unknown>
  if (record.kind !== undefined && record.kind !== 'papermind' && record.kind !== 'traditional-rag') fail(path, 'kind', '未知')
  return record.kind === 'traditional-rag' ? [validateTraditional(record, path)] : expandMatrix(validatePaperMind(record, path))
}

export function configLabel(config: BenchConfig): string { return config.name.replace(/[^\w.=,[\]-]/g, '_').replace(/[[\],=]/g, '.').replace(/\.+$/, '') }
