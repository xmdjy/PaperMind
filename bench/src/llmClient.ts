import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

export interface LlmClient {
  complete: LLMFn
  chat: ChatLLMFn
  stats(): { hits: number; misses: number }
  latencies(): number[]
}

const DEFAULT_CACHE_DIR = new URL('../cache/', import.meta.url).pathname

export function resolveEnvConfig(env: Record<string, string | undefined>) {
  const model = env.BENCH_LLM_MODEL
  if (!model) {
    throw new Error('缺少环境变量 BENCH_LLM_MODEL（例：export BENCH_LLM_MODEL=gpt-4o）')
  }
  const provider = env.BENCH_LLM_PROVIDER ?? 'openai'
  const defaultBase = provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
  return {
    provider,
    model,
    apiKey: env.BENCH_LLM_API_KEY ?? '',
    baseUrl: env.BENCH_LLM_BASE_URL ?? defaultBase,
  }
}

function cacheKey(model: string, messages: ChatMessage[]): string {
  return createHash('sha256').update(`${model} ${JSON.stringify(messages)}`).digest('hex')
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

export function createLlmClient(opts: LlmClientOptions = {}): LlmClient {
  const env = resolveEnvConfigSafe(opts)
  const cacheDir = opts.cacheDir ?? DEFAULT_CACHE_DIR
  const useCache = opts.useCache !== false
  const doFetch = opts.fetchImpl ?? fetch

  let hits = 0
  let misses = 0
  const latencyList: number[] = []

  if (useCache) mkdirSync(cacheDir, { recursive: true })

  async function chat(messages: ChatMessage[]): Promise<string> {
    const key = cacheKey(env.model, messages)
    const cachePath = join(cacheDir, `${key}.json`)

    if (useCache && existsSync(cachePath)) {
      hits++
      return JSON.parse(readFileSync(cachePath, 'utf-8')).content as string
    }
    misses++

    const started = Date.now()
    const content = await request(messages)
    latencyList.push(Date.now() - started)

    // 只缓存成功响应；失败会在 request 内抛出，走不到这里
    if (useCache) {
      writeFileSync(cachePath, JSON.stringify({ model: env.model, messages, content }, null, 2))
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
      return data?.message?.content ?? ''
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
    return data?.choices?.[0]?.message?.content ?? ''
  }

  return {
    complete: (prompt: string) => chat([{ role: 'user', content: prompt }]),
    chat,
    stats: () => ({ hits, misses }),
    latencies: () => [...latencyList],
  }
}

/** opts 显式给了 model 就用它，否则回落到环境变量。 */
function resolveEnvConfigSafe(opts: LlmClientOptions) {
  if (opts.model) {
    const provider = opts.provider ?? 'openai'
    const defaultBase = provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'
    return {
      provider,
      model: opts.model,
      apiKey: opts.apiKey ?? '',
      baseUrl: opts.baseUrl ?? defaultBase,
    }
  }
  return resolveEnvConfig(process.env)
}
