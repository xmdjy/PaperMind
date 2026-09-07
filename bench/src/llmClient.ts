import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatLLMFn, ChatMessage, LLMFn } from '../../src/utils/llm'

export interface LlmClientOptions {
  provider?: string
  model?: string
  apiKey?: string
  baseUrl?: string
  cacheDir?: string
  useCache?: boolean
  /** 注入 fetch，测试用 */
  fetchImpl?: typeof fetch
}

/** 一次 LLM 调用的观测记录：区分缓存命中与真实网络请求。 */
export interface LlmRequestTiming {
  cacheHit: boolean
  /** 对 hit：缓存读取；对 miss：完整 HTTP 请求 */
  elapsedMs: number
  /** 仅 miss 存在：真实网络延迟（含服务端排队与生成） */
  networkLatencyMs?: number
}

export interface LlmClient {
  complete: LLMFn
  chat: ChatLLMFn
  stats(): { hits: number; misses: number }
  latencies(): number[]
  /** 请求级 telemetry，仅内存中供测试与未来诊断；结果 JSON 只写聚合计数与网络分位数 */
  requestTimings(): LlmRequestTiming[]
}

/**
 * 默认缓存目录 bench/cache/。
 * 用 fileURLToPath 而非 .pathname：后者保留百分号转义（路径含空格时得到字面量 %20 的目录，
 * 缓存永不命中且不报错），在 Windows 上还会多出前导斜杠（/C:/...）。
 * 惰性求值：Vitest 会把 import.meta.url 改写成 http:// 的模块 URL，
 * 此时回落到基于 cwd 的路径（测试均显式传 cacheDir，实际用不到）。
 */
function defaultCacheDir(): string {
  const url = new URL('../cache/', import.meta.url)
  return url.protocol === 'file:' ? fileURLToPath(url) : resolve(process.cwd(), 'bench/cache')
}

/** provider 未显式指定 baseUrl 时的默认端点。 */
function defaultBaseUrl(provider: string): string {
  return provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
}

/**
 * 纯环境变量配置（不掺入显式 opts），供外部脚本预检配置用。
 * 对外签名与「缺 model 抛错」的行为是稳定契约，改动需同步现有用例。
 */
export function resolveEnvConfig(env: Record<string, string | undefined>) {
  return mergeConfig({}, readEnvPartial(env))
}

// key 必须包含 provider 与 baseUrl：同名模型（如 llama3）在不同端点上是不同的被测对象，
// 否则配置矩阵对比会因跨端点命中缓存而得到错误结论。分隔符用 \0，避免字段内容拼接歧义。
function cacheKey(provider: string, baseUrl: string, model: string, messages: ChatMessage[]): string {
  const raw = [provider, baseUrl, model, JSON.stringify(messages)].join('\0')
  return createHash('sha256').update(raw).digest('hex')
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

/** 把响应体截断成可放进错误信息的片段，便于诊断非预期结构。 */
function previewBody(data: unknown): string {
  try {
    return JSON.stringify(data).slice(0, 300)
  } catch {
    return String(data).slice(0, 300)
  }
}

/**
 * 校验 provider 返回的正文。HTTP 200 但缺 content（内容过滤、限流软失败、
 * 代理返回 {error:...}、schema 变化）必须当作失败抛出，绝不能降级成空答案落盘缓存。
 */
function requireContent(content: unknown, data: unknown): string {
  if (typeof content !== 'string' || content.trim() === '') {
    throw new Error(`LLM 响应缺少 content（HTTP 200）：${previewBody(data)}`)
  }
  return content
}

export function createLlmClient(opts: LlmClientOptions = {}): LlmClient {
  const env = mergeConfig(opts, readEnvPartial(process.env))
  const cacheDir = opts.cacheDir ?? defaultCacheDir()
  const useCache = opts.useCache !== false
  const doFetch = opts.fetchImpl ?? fetch

  let hits = 0
  let misses = 0
  const latencyList: number[] = []
  const requestTimingList: LlmRequestTiming[] = []

  if (useCache) mkdirSync(cacheDir, { recursive: true })

  async function chat(messages: ChatMessage[]): Promise<string> {
    const key = cacheKey(env.provider, env.baseUrl, env.model, messages)
    const cachePath = join(cacheDir, `${key}.json`)
    const callStartedMs = Date.now()

    if (useCache) {
      // 缓存文件可能被中断的写入或外部改动损坏；读失败一律当 miss 处理，
      // 后续的原子写入会覆盖掉坏文件，实现自愈，不让单样本失败中断整轮评测。
      // 不先 existsSync：readCache 的 try/catch 已经吞掉 ENOENT，多一次 syscall
      // 只会引入无意义的 TOCTOU 窗口。
      const cached = readCache(cachePath)
      if (cached !== null) {
        hits++
        // 命中只记缓存读取成本，不计入 latencies()（latency 语义为真实网络延迟）
        requestTimingList.push({ cacheHit: true, elapsedMs: Date.now() - callStartedMs })
        return cached
      }
    }
    misses++

    const started = Date.now()
    const content = await request(messages)
    const networkLatencyMs = Date.now() - started
    latencyList.push(networkLatencyMs)
    // 请求失败不追加成功 latency（misses 已增加），但 request 内抛错走不到这里
    requestTimingList.push({ cacheHit: false, elapsedMs: Date.now() - callStartedMs, networkLatencyMs })

    // 只缓存成功响应；失败会在 request 内抛出，走不到这里。
    // 载荷与 cacheKey 同构（带上 provider / baseUrl），否则拿到一个缓存文件无法反查它属于哪个端点。
    if (useCache) {
      writeCacheAtomic(cachePath, {
        provider: env.provider,
        baseUrl: env.baseUrl,
        model: env.model,
        messages,
        content,
      })
    }
    return content
  }

  async function request(messages: ChatMessage[]): Promise<string> {
    if (env.provider === 'ollama') {
      const res = await doFetch(`${env.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: env.model, messages, stream: false }),
      })
      if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await readErrorBody(res)}`)
      const data = await res.json()
      return requireContent(data?.message?.content, data)
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (env.provider === 'anthropic') {
      headers['x-api-key'] = env.apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers['Authorization'] = `Bearer ${env.apiKey}`
    }

    const res = await doFetch(`${env.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: env.model, messages, temperature: 0 }),
    })
    if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${await readErrorBody(res)}`)
    const data = await res.json()
    return requireContent(data?.choices?.[0]?.message?.content, data)
  }

  return {
    complete: (prompt: string) => chat([{ role: 'user', content: prompt }]),
    chat,
    stats: () => ({ hits, misses }),
    latencies: () => [...latencyList],
    requestTimings: () => [...requestTimingList],
  }
}

/** 读缓存；文件损坏或结构不符（如 content 为 null）时返回 null，由调用方当 miss 处理。 */
function readCache(cachePath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as unknown
    const content = (parsed as { content?: unknown } | null)?.content
    return typeof content === 'string' ? content : null
  } catch {
    return null
  }
}

/**
 * 原子写：先写同目录临时文件再 rename（同文件系统内 rename 原子），
 * 避免 Ctrl-C 打断或并发写留下半截 JSON 文件。
 * 仍有一个残留窗口：写完 tmp、rename 之前进程被杀，`.tmp.<pid>` 会留在缓存目录
 * （内容完整但不会被读到，只占磁盘）；异常路径下这里会主动清理。
 * 写盘失败一律吞掉：缓存只是加速手段，不能让一次已付费且成功的 LLM 响应变成 reject。
 */
function writeCacheAtomic(cachePath: string, payload: unknown): void {
  const tmpPath = `${cachePath}.tmp.${process.pid}`
  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2))
    renameSync(tmpPath, cachePath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // tmp 可能压根没写成功，清理失败无需再处理
    }
    console.warn(`[bench] 缓存写入失败（不影响本次结果）：${cachePath}`, err)
  }
}

/** 环境变量里的配置片段；缺失字段保持 undefined，交由 mergeConfig 决定回落。 */
function readEnvPartial(env: Record<string, string | undefined>) {
  return {
    provider: env.BENCH_LLM_PROVIDER,
    model: env.BENCH_LLM_MODEL,
    apiKey: env.BENCH_LLM_API_KEY,
    baseUrl: env.BENCH_LLM_BASE_URL,
  }
}

/**
 * 逐字段合并显式配置与环境变量：opts 的每个字段各自独立覆盖，未给出的字段
 * 分别回落到对应环境变量 / provider 默认值——两个方向都不做「全有或全无」。
 * 这对 judge 客户端是必需的：`createLlmClient({ model: BENCH_JUDGE_MODEL })`
 * 只想换模型，凭据与端点必须继续沿用 BENCH_LLM_API_KEY / BENCH_LLM_BASE_URL。
 * model 用 `||` 而非 `??`：空串视同未提供，就地抛出可诊断错误，
 * 而不是把配置错误顺出去变成远端 400。
 */
function mergeConfig(opts: LlmClientOptions, env: ReturnType<typeof readEnvPartial>) {
  const model = opts.model || env.model
  if (!model) {
    throw new Error('缺少环境变量 BENCH_LLM_MODEL（例：export BENCH_LLM_MODEL=gpt-4o）')
  }
  const provider = opts.provider ?? env.provider ?? 'openai'
  return {
    provider,
    model,
    apiKey: opts.apiKey ?? env.apiKey ?? '',
    baseUrl: opts.baseUrl ?? env.baseUrl ?? defaultBaseUrl(provider),
  }
}
