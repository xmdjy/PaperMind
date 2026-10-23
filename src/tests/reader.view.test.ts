import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReaderView from '../views/ReaderView.vue'
import ChatPanel from '../components/ChatPanel.vue'
import PdfViewer from '../components/PdfViewer.vue'
import { usePaperStore, type Paper } from '../stores/paper'
import { useChatStore, type Conversation } from '../stores/chat'

const papers: Paper[] = ['a', 'b'].map(id => ({
  id,
  title: 'Paper ' + id,
  authors: [],
  abstract: '',
  year: 2026,
  tags: [],
  status: 'reading',
  fileName: id + '.pdf',
  fileHash: '',
  addedAt: 0,
  knowledgeBaseId: 'default',
}))

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
})

describe('reader conversation lifecycle', () => {
  it('restores a requested conversation only for its paper, including query-only navigation', async () => {
    const pinia = createPinia()
    const paperStore = usePaperStore(pinia)
    const chatStore = useChatStore(pinia)
    paperStore.papers = papers.map(paper => ({ ...paper }))
    paperStore.loaded = true
    chatStore.loaded = true
    chatStore.conversations = [
      { id: 'old', title: 'Old', paperIds: ['a'], createdAt: 1, messages: [{ id: 'm1', role: 'user', content: 'Old', timestamp: 2 }] },
      { id: 'recent', title: 'Recent', paperIds: ['a'], createdAt: 0, messages: [{ id: 'm2', role: 'user', content: 'Recent', timestamp: 20 }] },
      { id: 'foreign', title: 'Foreign', paperIds: ['b'], createdAt: 99, messages: [] },
    ]
    vi.mocked(window.db.paper.contentUrl).mockResolvedValue('papermind-paper://paper/a')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library/:id', component: ReaderView }] })
    await router.push('/library/a?conversation=recent')
    wrapper = shallowMount(ReaderView, { global: { plugins: [pinia, router], stubs: { ElButton: true, ElIcon: true, ElSelect: true, ElOption: true, ElEmpty: true } } })
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.id).toBe('recent')
    await router.push('/library/a?conversation=old')
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.id).toBe('old')
    await router.push('/library/a?conversation=foreign')
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.id).toBe('recent')
    expect(wrapper.text()).toContain('会话')
    await router.push('/library/a')
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.id).toBe('old')
  })

  it('places the summary tab between questions and notes', async () => {
    const pinia = createPinia()
    const paperStore = usePaperStore(pinia)
    const chatStore = useChatStore(pinia)
    paperStore.papers = [{ ...papers[0] }]
    paperStore.loaded = true
    chatStore.loaded = true
    vi.mocked(window.db.paper.contentUrl).mockResolvedValue('papermind-paper://paper/a')
    vi.spyOn(chatStore, 'newConversation').mockResolvedValue({ id: 'conv', title: '对话', paperIds: ['a'], messages: [], createdAt: 0 })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library/:id', component: ReaderView }] })
    await router.push('/library/a')
    wrapper = shallowMount(ReaderView, {
      global: { plugins: [pinia, router], stubs: { ElButton: true, ElIcon: true, ElSelect: true, ElOption: true, ElEmpty: true } },
    })
    await flushPromises()
    expect(wrapper.findAll('.right-tab').map(tab => tab.text())).toEqual(['论文问答', '论文摘要', '阅读笔记'])
    await wrapper.findAll('.right-tab')[1].trigger('click')
    expect(wrapper.findComponent({ name: 'PaperAbstractPanel' }).exists()).toBe(true)
  })

  it('keeps the current paper conversation when an earlier creation resolves late', async () => {
    const pinia = createPinia()
    const paperStore = usePaperStore(pinia)
    const chatStore = useChatStore(pinia)
    paperStore.papers = papers.map(paper => ({ ...paper }))
    paperStore.loaded = true
    chatStore.loaded = true
    vi.mocked(window.db.paper.contentUrl).mockResolvedValue('papermind-paper://paper/a')

    const pending: Array<{ paperId: string; resolve: () => void }> = []
    vi.spyOn(chatStore, 'newConversation').mockImplementation((title, paperIds) => new Promise(resolve => {
      const conversation: Conversation = { id: 'conv-' + paperIds[0], title, paperIds, messages: [], createdAt: 0 }
      pending.push({
        paperId: paperIds[0],
        resolve: () => {
          chatStore.conversations.push(conversation)
          resolve(conversation)
        },
      })
    }))

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/library/:id', component: ReaderView }],
    })
    await router.push('/library/a')
    wrapper = shallowMount(ReaderView, {
      global: {
        plugins: [pinia, router],
        stubs: { ElButton: true, ElIcon: true, ElSelect: true, ElOption: true, ElEmpty: true },
      },
    })
    await flushPromises()
    await router.push('/library/b')
    await flushPromises()

    expect(pending.map(item => item.paperId)).toEqual(['a', 'b'])
    pending[1].resolve()
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.id).toBe('conv-b')

    pending[0].resolve()
    await flushPromises()
    expect(wrapper.findComponent(ChatPanel).props('conversation')?.paperIds).toEqual(['b'])
  })

  it('带 ?page= 打开阅读页时滚动到目标页（1-based query）', async () => {
    const pinia = createPinia()
    const paperStore = usePaperStore(pinia)
    const chatStore = useChatStore(pinia)
    paperStore.papers = papers.map(paper => ({ ...paper }))
    paperStore.loaded = true
    chatStore.loaded = true
    vi.mocked(window.db.paper.contentUrl).mockResolvedValue('papermind-paper://paper/a')

    const scrollToPage = vi.fn()
    const PdfViewerStub = defineComponent({
      name: 'PdfViewer',
      props: ['src', 'paperId'],
      setup: () => ({ scrollToPage }),
      template: '<div />',
    })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/library/:id', component: ReaderView }],
    })
    await router.push('/library/a?page=3')
    wrapper = shallowMount(ReaderView, {
      global: {
        plugins: [pinia, router],
        stubs: { ElButton: true, ElIcon: true, ElSelect: true, ElOption: true, ElEmpty: true, PdfViewer: PdfViewerStub },
      },
    })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(PdfViewer).props('src')).toBe('papermind-paper://paper/a')
    expect(window.db.paper.readFile).not.toHaveBeenCalled()
    expect(scrollToPage).toHaveBeenCalledWith(3)
  })

  it('带证据参数打开阅读页时定位到原句区域', async () => {
    const pinia = createPinia()
    const paperStore = usePaperStore(pinia)
    const chatStore = useChatStore(pinia)
    paperStore.papers = papers.map(paper => ({ ...paper }))
    paperStore.loaded = true
    chatStore.loaded = true
    vi.mocked(window.db.paper.contentUrl).mockResolvedValue('papermind-paper://paper/a')
    const scrollToEvidence = vi.fn()
    const PdfViewerStub = defineComponent({
      name: 'PdfViewer', props: ['src', 'paperId'],
      setup: () => ({ scrollToEvidence }), template: '<div />',
    })
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/library/:id', component: ReaderView }] })
    await router.push('/library/a?page=3&region=0.1,0.2,0.4,0.08&quote=Measured%20score')
    wrapper = shallowMount(ReaderView, {
      global: { plugins: [pinia, router], stubs: { ElButton: true, ElIcon: true, ElSelect: true, ElOption: true, ElEmpty: true, PdfViewer: PdfViewerStub } },
    })
    await flushPromises()
    expect(scrollToEvidence).toHaveBeenCalledWith({ label: 'p3', paperId: 'a', startPage: 2, endPage: 2,
      region: { x: 0.1, y: 0.2, width: 0.4, height: 0.08 }, quote: 'Measured score' })
  })
})
