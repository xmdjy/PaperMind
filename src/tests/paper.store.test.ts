import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePaperStore } from '../stores/paper'

describe('usePaperStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(globalThis as any).mockDb.paper.list.mockResolvedValue([])
    ;(globalThis as any).mockDb.kb.list.mockResolvedValue([
      { id: 'default', name: '默认知识库', description: '', color: '#409EFF', createdAt: 0 },
    ])
  })

  it('init loads knowledge bases and papers', async () => {
    const store = usePaperStore()
    await store.init()
    expect(store.knowledgeBases).toHaveLength(1)
    expect(store.knowledgeBases[0].id).toBe('default')
    expect(store.papers).toHaveLength(0)
    expect(store.loaded).toBe(true)
  })

  it('init is idempotent', async () => {
    const store = usePaperStore()
    await store.init()
    const callCount = (globalThis as any).mockDb.kb.list.mock.calls.length
    await store.init() // loaded === true, short-circuits
    expect((globalThis as any).mockDb.kb.list.mock.calls.length).toBe(callCount)
  })

  it('addPaper strips fileData from in-memory state', async () => {
    const store = usePaperStore()
    await store.init()
    const id = await store.addPaper({
      title: 'Test Paper', authors: ['Alice'], abstract: 'abc', year: 2024,
      tags: [], status: 'unread', fileName: 'test.pdf', knowledgeBaseId: 'default',
      fileData: 'base64data',
    })
    expect(id).toBeTruthy()
    const paper = store.getPaper(id)
    expect(paper).toBeDefined()
    expect((paper as any).fileData).toBeUndefined()
  })

  it('addKnowledgeBase appends to list', async () => {
    const store = usePaperStore()
    await store.init()
    await store.addKnowledgeBase('ML Papers', 'Machine learning', '#7c6af7')
    expect(store.knowledgeBases).toHaveLength(2)
    expect(store.knowledgeBases[1].name).toBe('ML Papers')
  })

  it('removePaper filters from papers array', async () => {
    ;(globalThis as any).mockDb.paper.list.mockResolvedValue([
      { id: 'p1', title: 'A', authors: [], abstract: '', year: 0, tags: [], status: 'unread', fileName: 'a.pdf', addedAt: 1, knowledgeBaseId: 'default' },
    ])
    const store = usePaperStore()
    await store.init()
    await store.removePaper('p1')
    expect(store.papers).toHaveLength(0)
  })

  it('updatePaper merges patch into local state', async () => {
    ;(globalThis as any).mockDb.paper.list.mockResolvedValue([
      { id: 'p1', title: 'Old', authors: [], abstract: '', year: 0, tags: [], status: 'unread', fileName: 'a.pdf', addedAt: 1, knowledgeBaseId: 'default' },
    ])
    const store = usePaperStore()
    await store.init()
    await store.updatePaper('p1', { status: 'done', title: 'New' })
    const p = store.getPaper('p1')!
    expect(p.status).toBe('done')
    expect(p.title).toBe('New')
  })

  it('getPapersByKb returns only matching papers', async () => {
    ;(globalThis as any).mockDb.paper.list.mockResolvedValue([
      { id: 'p1', title: 'A', authors: [], abstract: '', year: 0, tags: [], status: 'unread', fileName: 'a.pdf', addedAt: 1, knowledgeBaseId: 'kb1' },
      { id: 'p2', title: 'B', authors: [], abstract: '', year: 0, tags: [], status: 'unread', fileName: 'b.pdf', addedAt: 2, knowledgeBaseId: 'default' },
    ])
    const store = usePaperStore()
    await store.init()
    expect(store.getPapersByKb('kb1').value).toHaveLength(1)
    expect(store.getPapersByKb('default').value).toHaveLength(1)
  })
})
