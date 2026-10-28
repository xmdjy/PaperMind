import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { useWebSummary } from '../composables/useWebSummary'
import type { WebSnapshotPreview } from '../types/webQa'
const fake = vi.hoisted(() => ({ store: null as any, profile: { id: 'model', model: 'deepseek-flash' }, render: vi.fn() }))
vi.mock('../stores/visualSummary', () => ({ useVisualSummaryStore: () => fake.store }))
vi.mock('../stores/chat', () => ({ useChatStore: () => ({ chatProfile: fake.profile }) }))
vi.mock('../utils/visualSummaryPdf', () => ({ renderSummaryPdf: fake.render }))
const snapshot = (id: string): WebSnapshotPreview => ({ id, pageId: 'page', title: id, finalUrl: 'https://example.org',
  capturedAt: 1, byteLength: 1, contentHash: 'same-text', hasOriginalAppearance: true, preview: { blocks: [], truncated: false } })
const parsed = (id: string) => ({ kind: 'web' as const, sourceId: id, title: id, sourceHash: `${id}:same-text:1`, parserKey: 'html-v1', document: { version: 1 as const, warnings: [], items: [{ id: 'text-1', kind: 'text' as const, text: '正文', caption: '', pages: [], regions: [], images: [] }] } })
beforeEach(() => {
  fake.store = { states: reactive({}), load: vi.fn(async () => {}), prepare: vi.fn(async () => ({})),
    cancel: vi.fn(), generate: vi.fn(async () => ({ content: 'done', truncated: false })) }
  fake.render.mockResolvedValue([{ page: 0, width: 100, height: 100, data: 'data:image/png;base64,a' }])
  window.preview = { summaryPdf: vi.fn(async () => 'pdf') } as any
  window.db.documentSummary.parse = vi.fn(async (_kind, id) => parsed(id))
})
describe('saved webpage HTML summary', () => {
  it('loads saved summary without capturing or sending model requests', async () => {
    const scope = effectScope()
    scope.run(() => useWebSummary(ref(snapshot('a'))))
    await nextTick()
    expect(fake.store.load).toHaveBeenCalledWith('web', 'a', expect.stringContaining('a:'))
    expect(window.preview.summaryPdf).not.toHaveBeenCalled()
    expect(fake.store.prepare).not.toHaveBeenCalled()
    scope.stop()
  })
  it('keeps in-flight source immutable across selection changes and disposal', async () => {
    let resolveCapture!: (input: any) => void
    vi.mocked(window.db.documentSummary.parse).mockImplementation(() => new Promise(resolve => { resolveCapture = resolve }))
    const selected = ref<WebSnapshotPreview | null>(snapshot('a'))
    const scope = effectScope()
    const controller = scope.run(() => useWebSummary(selected))!
    const run = controller.generate()
    selected.value = snapshot('b')
    await nextTick()
    scope.stop()
    resolveCapture(parsed('a'))
    await run
    expect(fake.store.generate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'web', sourceId: 'a', title: 'a' }),
      expect.objectContaining({ model: 'deepseek-flash' }), false)
    expect(window.db.documentSummary.parse).toHaveBeenCalledWith('web', 'a')
    expect(window.preview.summaryPdf).not.toHaveBeenCalled()
  })
  it('does not start a paid model request after explicit stop during page capture', async () => {
    let resolveCapture!: (input: any) => void
    vi.mocked(window.db.documentSummary.parse).mockImplementation(() => new Promise(resolve => { resolveCapture = resolve }))
    const controller = useWebSummary(ref(snapshot('stop')))
    const run = controller.generate()
    controller.cancel()
    resolveCapture(parsed('stop'))
    await expect(run).rejects.toThrow('任务已取消')
    expect(fake.store.generate).not.toHaveBeenCalled()
    expect(fake.store.cancel).toHaveBeenCalledWith('web', 'stop')
  })
  it('deduplicates simultaneous capture/prepare for one snapshot', async () => {
    const controller = useWebSummary(ref(snapshot('c')))
    await Promise.all([controller.prepare(snapshot('c')), controller.prepare(snapshot('c'))])
    expect(window.db.documentSummary.parse).toHaveBeenCalledTimes(1)
  })
  it('can summarize a saved visual PDF even when oversized MHTML was unavailable', async () => {
    const controller = useWebSummary(ref({ ...snapshot('visual'), hasOriginalAppearance: false, hasSummaryVisual: true }))
    await controller.generate()
    expect(window.db.documentSummary.parse).toHaveBeenCalledWith('web', 'visual')
    expect(window.preview.summaryPdf).not.toHaveBeenCalled()
    expect(fake.store.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'visual' }), expect.anything(), false)
  })
  it('summarizes stored HTML even without a visual appearance snapshot', async () => {
    const controller = useWebSummary(ref({ ...snapshot('old'), hasOriginalAppearance: false }))
    await controller.generate()
    expect(fake.store.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'old', document: expect.anything() }), expect.anything(), false)
    expect(window.preview.summaryPdf).not.toHaveBeenCalled()
  })
})
