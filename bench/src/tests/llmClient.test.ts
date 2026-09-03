import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLlmClient, resolveEnvConfig } from '../llmClient'

let cacheDir: string

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'bench-cache-'))
})
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true })
})

function okResponse(content: string): Response {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response
}

describe('resolveEnvConfig', () => {
  it('从 BENCH_* 环境变量读取配置', () => {
    const cfg = resolveEnvConfig({
      BENCH_LLM_PROVIDER: 'openai',
      BENCH_LLM_MODEL: 'gpt-4o',
      BENCH_LLM_API_KEY: 'sk-test',
      BENCH_LLM_BASE_URL: 'https://example.com/v1',
    })
    expect(cfg).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
    })
  })

  it('缺 model 时抛出可诊断的错误', () => {
    expect(() => resolveEnvConfig({ BENCH_LLM_API_KEY: 'k' })).toThrow(/BENCH_LLM_MODEL/)
  })
})

describe('createLlmClient 缓存', () => {
  it('相同 prompt 第二次命中缓存，不再发请求', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(await client.complete('hello')).toBe('answer')
    expect(await client.complete('hello')).toBe('answer')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(client.stats()).toEqual({ hits: 1, misses: 1 })
    expect(readdirSync(cacheDir)).toHaveLength(1)
  })

  it('不同 model 不共享缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const base = { provider: 'openai', apiKey: 'k', baseUrl: 'http://x/v1', cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch }

    await createLlmClient({ ...base, model: 'm1' }).complete('hello')
    await createLlmClient({ ...base, model: 'm2' }).complete('hello')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('useCache=false 时绕过缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, useCache: false, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.complete('hello')
    await client.complete('hello')

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('HTTP 失败时抛错并带状态码，不写缓存', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false, status: 503, text: async () => 'overloaded',
    } as unknown as Response)
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await expect(client.complete('hello')).rejects.toThrow(/503/)
    expect(readdirSync(cacheDir)).toHaveLength(0)
  })

  it('ollama provider 走 /api/chat 并解析 message.content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ message: { content: 'ollama-answer' } }),
    } as unknown as Response)
    const client = createLlmClient({
      provider: 'ollama', model: 'llama3', apiKey: '', baseUrl: 'http://localhost:11434',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(await client.complete('hello')).toBe('ollama-answer')
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:11434/api/chat')
  })

  it('记录每次真实请求的耗时', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse('answer'))
    const client = createLlmClient({
      provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://x/v1',
      cacheDir, fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await client.complete('a')
    await client.complete('a') // 命中缓存，不计入延迟

    expect(client.latencies()).toHaveLength(1)
  })
})
