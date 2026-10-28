import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import type { LLMProfile } from '../stores/chat'
import type { DocumentItem } from '../utils/doclingDocument'
import { parsedSummaryFingerprint, requestParsedSummary, type ParsedSummaryInput } from '../utils/parsedSummary'

const assetId = 'a'.repeat(64)
const imageData = 'data:image/png;base64,aGVsbG8='
const profile: LLMProfile = {
  id: 'profile', name: '摘要', provider: 'openai', model: 'text-or-vision',
  apiKey: 'secret-api-key', baseUrl: 'https://model.example/v1', temperature: 0.4,
  maxTokens: 2048, topK: 0, systemPrompt: '用中文解释专业名词。',
}
const item = (value: Partial<DocumentItem>): DocumentItem => ({
  id: 'text-1', kind: 'text', text: '', caption: '', pages: [0], regions: [], images: [], ...value,
})
const input = (items: DocumentItem[] = [item({ text: '研究正文。' })]): ParsedSummaryInput => ({
  kind: 'paper', sourceId: 'paper-1', title: '研究论文', sourceHash: 'b'.repeat(64), parserKey: 'parser-v2',
  document: { version: 1, items, warnings: [] },
})
const completion = (content = '# 中文摘要', finish = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: finish }], usage: { total_tokens: 42 },
}))

describe('parsed document summary transport', () => {
  let fetcher: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetcher = vi.fn().mockImplementation(() => Promise.resolve(completion()))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('crypto', webcrypto)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('sends the complete ordered text, heading, table, formula and all original images in one request', async () => {
    const longText = `全文开始${'正文'.repeat(35_000)}全文结束`
    const document = input([
      item({ id: 'heading-1', kind: 'heading', text: '方法', level: 2, anchor: 'methods' }),
      item({ text: longText }),
      item({ id: 'table-1', kind: 'table', text: 'A 90', caption: '表1：准确率', table: {
        numRows: 1, numCols: 2, cells: [
          { text: 'A', row: 0, column: 0, rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: true },
          { text: '90', row: 0, column: 1, rowSpan: 1, colSpan: 1, columnHeader: false, rowHeader: false },
        ],
      } }),
      item({ id: 'formula-1', kind: 'formula', text: 'E = mc^2', pages: [2] }),
      item({ id: 'picture-1', kind: 'picture', caption: '图1：体系结构', pages: [3], images: [{ assetId, data: imageData, page: 3 }] }),
    ])
    Object.assign(document, { filePath: '/private/source.pdf' })
    Object.assign(document.document.items[1], { filePath: '/private/image.png', apiKey: 'hidden-secret' })

    const result = await requestParsedSummary(document, profile)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0]
    expect(url).toBe('https://model.example/v1/chat/completions')
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer secret-api-key' } })
    const body = JSON.parse(request.body)
    const parts = body.messages[1].content
    const source = parts.filter((part: { type: string }) => part.type === 'text').map((part: { text: string }) => part.text).join('\n')
    expect(source).toContain(longText)
    expect(source).toContain('"materialId":"heading-1"')
    expect(source).toContain('"level":2')
    expect(source).toContain('"anchor":"methods"')
    expect(source).toContain('"columnHeader":false')
    expect(source).toContain('"latex":"E = mc^2"')
    expect(source).toContain('"pages":[3]')
    expect(source).toContain('图1：体系结构')
    expect(source).toContain(assetId)
    expect(source).not.toContain(imageData)
    expect(source).not.toContain('/private/')
    expect(request.body).not.toContain('secret-api-key')
    expect(request.body).not.toContain('hidden-secret')
    expect(parts.filter((part: { type: string }) => part.type === 'image_url')).toEqual([{ type: 'image_url', image_url: { url: imageData } }])
    expect(body).toMatchObject({ model: 'text-or-vision', temperature: 0.4, max_tokens: 2048 })
    expect(body.messages[0].content).toContain(profile.systemPrompt)
    expect(result).toMatchObject({ content: '# 中文摘要', truncated: false, usage: { total_tokens: 42 } })
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('preserves MathML structure without labelling it as LaTeX', async () => {
    const formula = item({ id: 'formula-1', kind: 'formula', text: '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>' })
    Object.assign(formula, { formulaFormat: 'mathml' })
    await requestParsedSummary({ ...input([formula]), kind: 'web' }, profile)
    const content = JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content
    expect(content).toContain('"mathml":"<math><mfrac>')
    expect(content).not.toContain('"latex"')
  })

  it('uses ordinary text input for HTML without images or invented PDF page numbers', async () => {
    const source = { ...input([item({ text: '网页正文', anchor: 'intro', pages: [8] })]), kind: 'web' as const }
    await requestParsedSummary(source, { ...profile, maxTokens: 0 })
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(typeof body.messages[1].content).toBe('string')
    expect(body.messages[1].content).toContain('"anchor":"intro"')
    expect(body.messages[1].content).not.toMatch(/"pages":\[[0-9]/)
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('reports missing source images in the material packet without claiming they were supplied', async () => {
    const source = input([item({ id: 'picture-1', kind: 'picture', caption: '图1缺失', images: [{ assetId }] })])
    source.document.warnings.push('原图未随归档保存')
    await requestParsedSummary(source, profile)
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.messages[1].content).toContain('"availability":"unavailable"')
    expect(body.messages[1].content).toContain('原图未随归档保存')
  })

  it('sends previous output as assistant context and returns only the new completion with a truncation marker', async () => {
    fetcher.mockImplementation(() => Promise.resolve(completion('后续内容。', 'length')))
    const result = await requestParsedSummary(input(), profile, '已有内容。')
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body.messages[2]).toEqual({ role: 'assistant', content: '已有内容。' })
    expect(body.messages[3].role).toBe('user')
    expect(result.content).toBe('后续内容。')
    expect(result.truncated).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('only permits original attached asset IDs and normalizes formula delimiters', async () => {
    const source = input([item({ id: 'picture-1', kind: 'picture', images: [{ assetId, data: imageData }] })])
    fetcher.mockImplementation(() => Promise.resolve(completion(`\\(x_i\\)\n![原图](asset:${assetId})\n![外图](https://example.org/foreign.png)\n![虚构](asset:${'c'.repeat(64)})`)))
    const result = await requestParsedSummary(source, profile)
    expect(result.content).toContain('$x_i$')
    expect(result.content).toContain(`![原图](asset:${assetId})`)
    expect(result.content).not.toContain('https://example.org')
    expect(result.content).not.toContain('c'.repeat(64))
  })

  it('refuses oversized UTF-8 text rather than sending a partial source', async () => {
    await expect(requestParsedSummary(input([item({ text: '中'.repeat(720_000) })]), profile)).rejects.toThrow(/上限/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['single image', () => [{ data: `data:image/png;base64,${'A'.repeat(17 * 1024 * 1024)}` }]],
    ['image count', () => Array.from({ length: 121 }, () => ({ data: imageData }))],
    ['total image bytes', () => Array.from({ length: 5 }, () => ({ data: `data:image/png;base64,${'A'.repeat(14 * 1024 * 1024)}` }))],
  ])('refuses excessive %s without omitting any image', async (_name, images) => {
    await expect(requestParsedSummary(input([item({ images: images() })]), profile)).rejects.toThrow(/上限/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    [{ baseUrl: 'http://remote.example/v1' }, /HTTPS/],
    [{ baseUrl: 'https://user:password@model.example/v1' }, /凭据/],
    [{ baseUrl: 'https://model.example/v1?api_key=secret' }, /查询参数/],
    [{ apiKey: '' }, /API Key/],
    [{ provider: 'anthropic' as const }, /OpenAI/],
  ] satisfies Array<[Partial<LLMProfile>, RegExp]>)('rejects invalid configuration before sending source data: %j', async (change, reason) => {
    await expect(requestParsedSummary(input(), { ...profile, ...change })).rejects.toThrow(reason)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not echo upstream error bodies containing private provider details', async () => {
    fetcher.mockResolvedValue(new Response('private-provider-secret', { status: 429 }))
    const error = await requestParsedSummary(input(), profile).catch(error => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('429')
    expect(error.message).not.toContain('private-provider-secret')
  })

  it('rejects empty model output and oversized response bodies', async () => {
    fetcher.mockImplementationOnce(() => Promise.resolve(completion('   ')))
    await expect(requestParsedSummary(input(), profile)).rejects.toThrow(/空摘要/)
    fetcher.mockResolvedValueOnce(new Response('{}', { headers: { 'content-length': String(33 * 1024 * 1024) } }))
    await expect(requestParsedSummary(input(), profile)).rejects.toThrow(/响应超过大小上限/)
  })

  it('honors cancellation before transmission and while the request is pending', async () => {
    const cancelled = new AbortController()
    cancelled.abort(new Error('取消摘要'))
    await expect(requestParsedSummary(input(), profile, '', cancelled.signal)).rejects.toThrow('取消摘要')
    expect(fetcher).not.toHaveBeenCalled()

    fetcher.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
    }))
    const controller = new AbortController()
    const result = requestParsedSummary(input(), profile, '', controller.signal)
    controller.abort(new Error('用户取消'))
    await expect(result).rejects.toThrow('用户取消')
  })

  it('aborts requests that exceed the existing fifteen minute deadline', async () => {
    vi.useFakeTimers()
    fetcher.mockImplementation((_url, request) => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
    }))
    const pending = requestParsedSummary(input(), profile).catch(error => error)
    await vi.advanceTimersByTimeAsync(900_000)
    expect(await pending).toBeInstanceOf(Error)
    expect((await pending).message).toMatch(/超时/)
  })

  it('keys reports by source, parsed content and effective summary configuration, excluding credentials and display identity', async () => {
    const source = input()
    const original = await parsedSummaryFingerprint(source, profile)
    expect(original).toMatch(/^[a-f0-9]{64}$/)
    expect(await parsedSummaryFingerprint(source, { ...profile, apiKey: 'rotated', id: 'other-id', name: '改名', topK: 12 })).toBe(original)
    for (const change of [
      { model: 'other-model' }, { baseUrl: 'https://other.example/v1' }, { temperature: 0.8 },
      { maxTokens: 4096 }, { systemPrompt: '不同要求' }, { provider: 'ollama' as const },
    ]) expect(await parsedSummaryFingerprint(source, { ...profile, ...change })).not.toBe(original)
    expect(await parsedSummaryFingerprint({ ...source, parserKey: 'parser-v3' }, profile)).not.toBe(original)
    expect(await parsedSummaryFingerprint({ ...source, sourceHash: 'd'.repeat(64) }, profile)).not.toBe(original)
    expect(await parsedSummaryFingerprint(input([item({ text: '修改后的解析正文' })]), profile)).not.toBe(original)
  })

  it('keeps the same report key before and after hydrating a content-addressed original image', async () => {
    const stored = input([item({ images: [{ assetId, page: 0 }] })])
    const hydrated = input([item({ images: [{ assetId, page: 0, data: imageData }] })])
    expect(await parsedSummaryFingerprint(stored, profile)).toBe(await parsedSummaryFingerprint(hydrated, profile))
  })
})
