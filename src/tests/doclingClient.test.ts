import { describe, expect, it, vi } from 'vitest'
import { convertPdf, testDoclingConnection } from '../../electron/doclingClient'
import { DEFAULT_DOCLING_SETTINGS } from '../utils/doclingDocument'
const settings = { ...DEFAULT_DOCLING_SETTINGS, baseUrl: 'http://localhost:5001/prefix', apiKey: 'test-key' }
const response = (status = 'success') => new Response(JSON.stringify({ status, document: { json_content: { texts: [{ text: 'Evidence' }] } } }))
describe('Docling HTTP boundary', () => {
  it('uploads to the campus HTTPS endpoint without establishing an SSH connection', async () => {
    const request = vi.fn().mockResolvedValue(response())
    const result = await convertPdf(new Uint8Array([37, 80, 68, 70]), 'paper.pdf', DEFAULT_DOCLING_SETTINGS, request)
    expect(request.mock.calls[0][0]).toBe('https://101.76.222.224/v1/convert/file')
    expect(result.items[0].text).toBe('Evidence')
  })
  it('keeps an explicitly saved localhost service local', async () => {
    const request = vi.fn().mockResolvedValue(response())
    await convertPdf(new Uint8Array(), 'paper.pdf', { ...DEFAULT_DOCLING_SETTINGS, baseUrl: 'http://localhost:5001' }, request)
    expect(request.mock.calls[0][0]).toBe('http://127.0.0.1:5001/v1/convert/file')
  })
  it('explains when the shared server is busy or the PDF is too large', async () => {
    await expect(convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(new Response('', { status: 429 })))).rejects.toThrow('繁忙')
    await expect(convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(new Response('', { status: 413 })))).rejects.toThrow('大小')
  })
  it('uploads local PDF with embedded JSON and optional authentication', async () => {
    const request = vi.fn().mockResolvedValue(response())
    const result = await convertPdf(new Uint8Array([37, 80, 68, 70]), 'paper.pdf', settings, request)
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('http://localhost:5001/prefix/v1/convert/file')
    expect(init.headers['X-Api-Key']).toBe('test-key')
    expect(init.redirect).toBe('error')
    expect(init.body.get('to_formats')).toBe('json')
    expect(init.body.get('target_type')).toBe('inbody')
    expect(init.body.get('image_export_mode')).toBe('embedded')
    expect(init.body.get('do_formula_enrichment')).toBe('true')
    expect(init.body.get('files').name).toBe('paper.pdf')
    expect(result.items[0].text).toBe('Evidence')
  })
  it('preserves partial extraction warnings and rejects failed conversion', async () => {
    expect((await convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(response('partial_success')))).warnings.join()).toContain('部分')
    await expect(convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(response('failure')))).rejects.toThrow('解析失败')
  })
  it('reports HTTP authentication and malformed responses', async () => {
    await expect(convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(new Response('', { status: 401 })))).rejects.toThrow('认证')
    await expect(convertPdf(new Uint8Array(), 'p.pdf', settings, vi.fn().mockResolvedValue(new Response('invalid')))).rejects.toThrow('JSON')
  })
  it('explains direct network and TLS failures without disabling certificate checks', async () => {
    await expect(testDoclingConnection(settings, vi.fn().mockRejectedValue(Object.assign(new Error('connect failed'), { code: 'EHOSTUNREACH' })))).rejects.toThrow('校园网')
    await expect(testDoclingConnection(settings, vi.fn().mockRejectedValue(Object.assign(new Error('expired'), { code: 'CERT_HAS_EXPIRED' })))).rejects.toThrow('证书')
  })
  it('closes an unsuccessful response body before reporting the error', async () => {
    let canceled = false
    const failed = new Response(new ReadableStream({ cancel() { canceled = true } }), { status: 429 })
    await expect(testDoclingConnection(settings, vi.fn().mockResolvedValue(failed))).rejects.toThrow('繁忙')
    expect(canceled).toBe(true)
  })
  it('only accepts an OpenAPI service with the actual conversion endpoint', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ paths: { '/v1/convert/file': { post: {} } } })))
    await expect(testDoclingConnection(settings, request)).resolves.toContain('连接成功')
    await expect(testDoclingConnection(settings, vi.fn().mockResolvedValue(new Response('{}')))).rejects.toThrow('转换接口')
  })
  it('aborts requests at the configured deadline', async () => {
    vi.useFakeTimers()
    try {
      const request = vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
      const result = convertPdf(new Uint8Array(), 'p.pdf', { ...settings, timeoutSeconds: 30 }, request)
      const check = expect(result).rejects.toThrow('超时')
      await vi.advanceTimersByTimeAsync(30_001)
      await check
    } finally { vi.useRealTimers() }
  })
  it('rejects oversized uploads before any request is sent', async () => {
    const request = vi.fn()
    await expect(convertPdf(new Uint8Array(64 * 1024 * 1024 + 1), 'large.pdf', settings, request)).rejects.toThrow('上传大小上限')
    expect(request).not.toHaveBeenCalled()
  })
  it('caps in-flight parsing requests and releases capacity after failures', async () => {
    let reject!: (error: Error) => void
    const pending = new Promise<Response>((_resolve, fail) => { reject = fail })
    const request = vi.fn(() => pending)
    const first = convertPdf(new Uint8Array(), 'a.pdf', settings, request)
    const second = convertPdf(new Uint8Array(), 'b.pdf', settings, request)
    await expect(convertPdf(new Uint8Array(), 'c.pdf', settings, request)).rejects.toThrow('请求过多')
    const settled = Promise.allSettled([first, second])
    reject(new Error('connection closed'))
    await settled
    await expect(convertPdf(new Uint8Array(), 'd.pdf', settings, vi.fn().mockResolvedValue(response()))).resolves.toBeDefined()
  })
})
