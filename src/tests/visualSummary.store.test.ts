import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
vi.mock('../utils/parsedSummary', async original => ({ ...await original<object>(), requestParsedSummary: vi.fn() }))
import { requestParsedSummary } from '../utils/parsedSummary'
import { useVisualSummaryStore } from '../stores/visualSummary'
const input = { kind: 'paper' as const, sourceId: 'p', title: 'paper', sourceHash: 'hash', parserKey: 'parser',
  document: { version: 1 as const, warnings: [], items: [{ id: 'text-1', kind: 'text' as const, text: 'Full source', caption: '', pages: [0], regions: [], images: [] }] } }
const profile = { id: 'p', name: '', provider: 'openai' as const, model: 'model', apiKey: 'key', baseUrl: 'https://test', temperature: 1, maxTokens: 0, topK: 0, systemPrompt: '' }
beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(requestParsedSummary).mockReset().mockResolvedValue({ content: '# Result', truncated: false, usage: null, elapsedMs: 1 })
  Object.assign(window.db, { documentSummary: { parse: vi.fn().mockResolvedValue(input), get: vi.fn().mockResolvedValue(null), save: vi.fn().mockResolvedValue({}), saveAsset: vi.fn() } })
})
describe('parsed material summaries', () => {
  it('generates from complete structured material in one call and reuses the report', async () => {
    const store = useVisualSummaryStore()
    expect(await store.generate(input, profile)).toMatchObject({ content: '# Result' })
    expect(await store.generate(input, profile)).toMatchObject({ content: '# Result' })
    expect(requestParsedSummary).toHaveBeenCalledTimes(1)
    expect(vi.mocked(requestParsedSummary).mock.calls[0][0].document.items[0].text).toBe('Full source')
    expect(window.db.documentSummary.save).toHaveBeenCalledWith(expect.objectContaining({ slot: 'report', sourceHash: 'hash' }))
  })
  it('parses PDF once for concurrent preparations without paid requests or PDF rasterization', async () => {
    const store = useVisualSummaryStore()
    await Promise.all([store.preparePaper('p', profile), store.preparePaper('p', profile)])
    expect(window.db.documentSummary.parse).toHaveBeenCalledTimes(1)
    expect(window.db.documentSummary.parse).toHaveBeenCalledWith('paper', 'p')
    expect(requestParsedSummary).not.toHaveBeenCalled()
    expect(store.states['paper:p'].preparing).toBe(false)
  })
  it('regenerates after model changes but does not need to reparse', async () => {
    const store = useVisualSummaryStore()
    await store.generate(input, profile)
    await store.generate(input, { ...profile, model: 'other' })
    expect(requestParsedSummary).toHaveBeenCalledTimes(2)
  })
  it('does not reuse reports from the old whole-page pipeline', async () => {
    vi.mocked(window.db.documentSummary.get).mockResolvedValue({ sourceHash: 'hash', payload: JSON.stringify({ content: 'Old result', sourceHash: 'hash', truncated: false, promptVersion: 'original-pdf-summary-v1' }) } as any)
    expect(await useVisualSummaryStore().generate(input, profile)).toMatchObject({ content: '# Result' })
    expect(requestParsedSummary).toHaveBeenCalledTimes(1)
  })
  it('keeps the full report when chat supplies only the final continuation window', async () => {
    const full = 'Original opening\n' + 'x'.repeat(10_000)
    vi.mocked(requestParsedSummary).mockResolvedValueOnce({ content: full, truncated: true, usage: null, elapsedMs: 1 })
      .mockResolvedValueOnce({ content: 'Ending', truncated: false, usage: null, elapsedMs: 1 })
    const store = useVisualSummaryStore()
    await store.generate(input, profile)
    const result = await store.generate(input, profile, false, full.slice(-9000))
    expect(result.content).toBe(full + '\n\nEnding')
    expect(result.delta).toBe('Ending')
  })
  it('preserves full partial content when the output budget changes before continuing', async () => {
    const full = '# Original opening\n' + 'x'.repeat(10_000)
    vi.mocked(requestParsedSummary).mockResolvedValueOnce({ content: full, truncated: true, usage: null, elapsedMs: 1 })
      .mockResolvedValueOnce({ content: 'Ending', truncated: false, usage: null, elapsedMs: 1 })
    const store = useVisualSummaryStore()
    await store.generate(input, { ...profile, maxTokens: 2048 })
    const result = await store.generate(input, { ...profile, maxTokens: 4096 }, false, full.slice(-9000))
    expect(result.content).toBe(full + '\n\nEnding')
    expect(vi.mocked(requestParsedSummary).mock.calls[1][2]).toBe(full)
  })
  it('serializes three distinct requests for the same document in arrival order', async () => {
    const requests: Array<{ model: string; resolve: (value: any) => void }> = []
    vi.mocked(requestParsedSummary).mockImplementation((_input, model) => new Promise(resolve => { requests.push({ model: model.model, resolve }) }))
    const store = useVisualSummaryStore()
    const first = store.generate(input, { ...profile, model: 'first' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const second = store.generate(input, { ...profile, model: 'second' })
    const third = store.generate(input, { ...profile, model: 'third' })
    await new Promise(resolve => setTimeout(resolve, 20))
    requests[0].resolve({ content: 'First', truncated: false, usage: null, elapsedMs: 1 })
    await first
    await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    const afterFirst = requests.map(request => request.model)
    requests[1].resolve({ content: 'Second', truncated: false, usage: null, elapsedMs: 1 })
    await second
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    requests[2].resolve({ content: 'Third', truncated: false, usage: null, elapsedMs: 1 })
    await third
    expect(afterFirst).toEqual(['first', 'second'])
    expect(store.states['paper:p'].content).toBe('Third')
  })
  it('honors immediate cancellation before fingerprint calculation starts', async () => {
    const store = useVisualSummaryStore()
    const run = store.generate(input, profile)
    store.cancel('paper', 'p')
    await expect(run).rejects.toThrow(/取消/)
    expect(requestParsedSummary).not.toHaveBeenCalled()
  })
  it('cancels parsing without starting a late LLM request', async () => {
    let resolve!: (value: any) => void
    vi.mocked(window.db.documentSummary.parse).mockImplementation(() => new Promise(r => { resolve = r }))
    const store = useVisualSummaryStore()
    const run = store.generatePaper('p', profile)
    const failed = expect(run).rejects.toThrow(/取消/)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    store.cancel('paper', 'p')
    resolve(input)
    await failed
    expect(requestParsedSummary).not.toHaveBeenCalled()
    expect(store.states['paper:p'].generating).toBe(false)
  })
  it('prevents an old response from overwriting a new source version', async () => {
    let resolve!: (value: any) => void
    vi.mocked(requestParsedSummary).mockImplementationOnce(() => new Promise(r => { resolve = r }))
      .mockResolvedValue({ content: 'New result', truncated: false, usage: null, elapsedMs: 1 })
    const store = useVisualSummaryStore()
    const old = store.generate(input, profile)
    const failed = expect(old).rejects.toThrow(/取消|版本/)
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    const next = store.generate({ ...input, sourceHash: 'new' }, profile)
    resolve({ content: 'Old result', truncated: false, usage: null, elapsedMs: 1 })
    await failed
    await next
    const reports = vi.mocked(window.db.documentSummary.save).mock.calls.filter(([row]) => row.slot === 'report')
    expect(reports.map(([row]) => row.sourceHash)).toEqual(['new'])
  })
})
