import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import WebPreviewView from '../views/WebPreviewView.vue'
import type { PreviewApi, PreviewState } from '../types/webPreview'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import router from '../router'
import { ElMessageBox } from 'element-plus'
import { createMemoryHistory, createRouter } from 'vue-router'

const emptyState: PreviewState = {
  url: '', loading: false, canGoBack: false, canGoForward: false,
  error: '', notice: '', visible: false,
}

let wrapper: VueWrapper | undefined
let pushState: ((state: PreviewState) => void) | undefined
let unsubscribe: () => void
let preview: PreviewApi
const page = { id: 'page-1', canonicalUrl: 'https://example.org/article', title: '文章',
  createdAt: 1, lastOpenedAt: 1, latestSnapshotId: 'snap-1', snapshotCount: 1,
  sessionCount: 0, totalBytes: 80 }
const cached = { id: 'snap-1', pageId: 'page-1', finalUrl: page.canonicalUrl, title: '本地缓存文章',
  capturedAt: 1, byteLength: 80, contentHash: 'hash', preview: { truncated: false,
    blocks: [{ kind: 'paragraph' as const, text: '离线正文' }] } }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(window.db.webQa.archive).mockClear()
  vi.mocked(window.db.webQa.listPages).mockClear()
  vi.mocked(window.db.webQa.listPages).mockResolvedValue([])
  vi.mocked(window.db.webQa.archive).mockResolvedValue(page)
  vi.mocked(window.db.webQa.getPreview).mockResolvedValue(cached)
  vi.mocked(window.db.webQa.findAppearance).mockResolvedValue(null)
  vi.mocked(window.db.webQa.listSessions).mockResolvedValue([])
  unsubscribe = vi.fn()
  preview = {
    summaryPdf: vi.fn(async () => 'pdf'),
    open: vi.fn(async () => {}),
    openAndCapture: vi.fn(async () => ({
      finalUrl: 'https://example.org/', title: 'Example', html: '<html></html>',
      capturedAt: 1, contentHash: 'hash', byteLength: 13,
    })),
    setBounds: vi.fn(async () => {}),
    showCached: vi.fn(async () => false),
    back: vi.fn(async () => {}),
    forward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    openExternal: vi.fn(async () => {}),
    captureSnapshot: vi.fn(async () => ({
      finalUrl: 'https://example.org/', title: 'Example', html: '<html></html>',
      capturedAt: 1, contentHash: 'hash', byteLength: 13,
    })),
    onState: vi.fn((callback: (state: PreviewState) => void): (() => void) => {
      pushState = callback
      return unsubscribe
    }),
  }
  window.preview = preview
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 72, y: 64, width: 900, height: 700,
    top: 64, left: 72, right: 972, bottom: 764,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  pushState = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HTML preview page', () => {
  it('keeps local history failure and retry visible after a live native view was visible', async () => {
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    pushState?.({ ...emptyState, visible: true, url: 'https://example.org/live' })
    await routeRouter.push('/web-preview?page=page-1')
    await flushPromises()
    expect(wrapper.get('[data-action="retry-history"]').isVisible()).toBe(true)
    pushState?.({ ...emptyState, visible: true, url: 'https://example.org/live' })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('不存在')
    vi.mocked(window.db.webQa.listPages).mockRejectedValueOnce(new Error('local history unavailable'))
    await wrapper.get('[data-action="retry-history"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('local history unavailable')
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    await wrapper.get('[data-action="retry-history"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('离线正文')
    expect(wrapper.find('[data-action="retry-history"]').exists()).toBe(false)
  })

  it('enables new-session only after a deferred route history has restored its source', async () => {
    const session = { id: 'saved', pageId: page.id, snapshotId: cached.id, title: page.title, finalUrl: page.canonicalUrl, capturedAt: 1, byteLength: 80, createdAt: 1, updatedAt: 2, firstQuestion: 'Saved question' }
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    let finish!: (sessions: typeof session[]) => void
    vi.mocked(window.db.webQa.listSessions).mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue([session])
    vi.mocked(window.db.webQa.getSession).mockResolvedValue({ ...session, messages: [{ id: 'a', sessionId: session.id, role: 'assistant', content: 'Saved answer', status: 'completed', error: '', modelId: '', createdAt: 2 }] })
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    expect(wrapper.get('[data-action="new-session"]').attributes('disabled')).toBeDefined()
    finish([session])
    await flushPromises()
    expect(wrapper.text()).toContain('Saved answer')
    expect(wrapper.get('[data-action="new-session"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-action="new-session"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Saved answer')
    expect(wrapper.text()).toContain('离线正文')
    expect(wrapper.get('[aria-label="问题输入框"]').attributes('disabled')).toBeUndefined()
  })

  it('restores the latest source-owned conversation from a direct route and its original snapshot', async () => {
    const sessions = [
      { id: 'old', pageId: page.id, snapshotId: 'snap-old', title: page.title, finalUrl: page.canonicalUrl, capturedAt: 1, byteLength: 80, createdAt: 1, updatedAt: 2, firstQuestion: '旧问题' },
      { id: 'latest', pageId: page.id, snapshotId: 'snap-latest', title: page.title, finalUrl: page.canonicalUrl, capturedAt: 1, byteLength: 80, createdAt: 1, updatedAt: 20, firstQuestion: '最近问题' },
      { id: 'foreign', pageId: 'other', snapshotId: 'foreign-snap', title: 'Other', finalUrl: page.canonicalUrl, capturedAt: 1, byteLength: 80, createdAt: 99, updatedAt: 99, firstQuestion: 'Other' },
    ]
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(window.db.webQa.listSessions).mockResolvedValue(sessions)
    vi.mocked(window.db.webQa.getSession).mockImplementation(async id => ({ ...sessions.find(session => session.id === id)!, messages: [
      { id: 'answer', sessionId: id, role: 'assistant', content: id === 'latest' ? '最近回答' : '旧回答', status: 'completed', error: '', modelId: '', createdAt: 2 },
    ] }))
    vi.mocked(window.db.webQa.getPreview).mockImplementation(async id => ({ ...cached, id }))
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    expect(wrapper.text()).toContain('最近回答')
    expect(preview.showCached).toHaveBeenLastCalledWith('snap-latest', expect.any(Object))
    expect(preview.open).not.toHaveBeenCalled()
    await routeRouter.push('/web-preview?page=page-1&session=old')
    await flushPromises()
    expect(wrapper.text()).toContain('旧回答')
    expect(preview.showCached).toHaveBeenLastCalledWith('snap-old', expect.any(Object))
    await routeRouter.push('/web-preview?page=page-1&session=foreign')
    await flushPromises()
    expect(wrapper.text()).toContain('最近回答')
    expect(preview.showCached).not.toHaveBeenCalledWith('foreign-snap', expect.any(Object))
  })

  it('restores a source with no conversations and reports a missing route source', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    expect(wrapper.text()).toContain('离线正文')
    expect(preview.showCached).toHaveBeenCalledWith('snap-1', expect.any(Object))
    await routeRouter.push('/web-preview?page=deleted')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('不存在')
    expect(wrapper.text()).not.toContain('离线正文')
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([{ ...page, id: 'deleted' }])
    vi.mocked(window.db.webQa.getPreview).mockResolvedValue({ ...cached, pageId: 'deleted' })
    await wrapper.get('[data-action="retry-history"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('离线正文')
  })

  it('rejects a session whose loaded source differs from its history summary', async () => {
    const summary = { id: 'tampered', pageId: page.id, snapshotId: cached.id, title: page.title, finalUrl: page.canonicalUrl, capturedAt: 1, byteLength: 80, createdAt: 1, updatedAt: 2, firstQuestion: '?' }
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(window.db.webQa.listSessions).mockResolvedValue([summary])
    vi.mocked(window.db.webQa.getSession).mockResolvedValue({ ...summary, pageId: 'other', messages: [{ id: 'other-a', sessionId: summary.id, role: 'assistant', content: 'Wrong source answer', status: 'completed', error: '', modelId: '', createdAt: 2 }] })
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('不属于')
    expect(wrapper.text()).not.toContain('Wrong source answer')
    expect(preview.showCached).not.toHaveBeenCalled()
  })

  it('keeps a user-opened webpage when an initial route history lookup finishes later', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    let finish!: (sessions: []) => void
    vi.mocked(window.db.webQa.listSessions).mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue([])
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    await wrapper.get('[aria-label="网页地址"]').setValue('https://example.org/new')
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    finish([])
    await flushPromises()
    expect(wrapper.text()).toContain('在线网页预览')
    expect(wrapper.text()).not.toContain('本地缓存阅读')
  })

  it('ignores an old direct-route restoration after the route source changes', async () => {
    const secondPage = { ...page, id: 'page-2', latestSnapshotId: 'snap-2', title: 'Second' }
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page, secondPage])
    let finish!: (sessions: []) => void
    vi.mocked(window.db.webQa.listSessions).mockImplementation(async id => id === page.id ? new Promise(resolve => { finish = resolve }) : [])
    vi.mocked(window.db.webQa.getPreview).mockImplementation(async id => ({ ...cached, id, pageId: id === 'snap-2' ? 'page-2' : page.id, preview: { truncated: false, blocks: [{ kind: 'paragraph', text: id === 'snap-2' ? 'Second body' : 'Stale body' }] } }))
    const routeRouter = createRouter({ history: createMemoryHistory(), routes: [{ path: '/web-preview', component: WebPreviewView }] })
    await routeRouter.push('/web-preview?page=page-1')
    wrapper = mount(WebPreviewView, { global: { plugins: [routeRouter] } })
    await flushPromises()
    await routeRouter.push('/web-preview?page=page-2')
    await flushPromises()
    finish([])
    await flushPromises()
    expect(wrapper.text()).toContain('Second body')
    expect(wrapper.text()).not.toContain('Stale body')
  })

  it('switches right-side question and summary tabs while preserving the webpage and question draft', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(preview.showCached).mockResolvedValue(true)
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    const tabs = wrapper.get('.web-split-right').findAll('.right-tab')
    expect(tabs.map(tab => tab.text())).toEqual(['网页问答', '网页摘要'])
    expect(tabs[0].attributes('aria-pressed')).toBe('true')
    const question = wrapper.get('.web-qa-panel textarea')
    await question.setValue('保留的问题草稿')
    await tabs[1].trigger('click')
    await flushPromises()
    expect(wrapper.get('.web-split-right [aria-label="网页摘要"]').text()).toContain('生成摘要')
    expect(wrapper.get('.web-split-left .preview-stage').isVisible()).toBe(true)
    expect(wrapper.get('.web-qa-panel').isVisible()).toBe(false)
    expect(preview.setBounds).toHaveBeenLastCalledWith({ x: 72, y: 64, width: 900, height: 700 })
    await tabs[0].trigger('click')
    await flushPromises()
    expect((wrapper.get('.right-pane-content').element as HTMLElement).style.display).not.toBe('none')
    expect(tabs[0].attributes('aria-pressed')).toBe('true')
    expect((wrapper.get('.web-qa-panel textarea').element as HTMLTextAreaElement).value).toBe('保留的问题草稿')
    expect(preview.summaryPdf).not.toHaveBeenCalled()
  })

  it('is reachable from the sidebar as an independent compact reading page', async () => {
    expect(router.resolve('/web-preview').matched.at(-1)?.path).toBe('/web-preview')
    await router.push('/web-preview')
    wrapper = mount(App, { global: { plugins: [createPinia(), router] } })
    await flushPromises()
    expect(wrapper.get('a[href="#/web-preview"]').text()).toContain('网页问答')
    expect(wrapper.get('.app-shell').classes()).toContain('is-reading')
  })

  it('archives an actively opened HTTPS link after load and capture', async () => {
    wrapper = mount(WebPreviewView)
    await wrapper.get('[aria-label="网页地址"]').setValue(' example.org/article ')
    expect(window.db.webQa.archive).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    expect(preview.openAndCapture).toHaveBeenCalledWith('https://example.org/article', {
      x: 72, y: 64, width: 900, height: 700,
    })
    expect(window.db.webQa.archive).toHaveBeenCalledOnce()
  })

  it('archives a dropped HTTPS link but leaves site navigation unsaved', async () => {
    wrapper = mount(WebPreviewView)
    await wrapper.get('.preview-slot').trigger('drop', {
      dataTransfer: { getData: (type: string) => type === 'text/uri-list' ? 'https://example.org/article' : '' },
    })
    await flushPromises()
    expect(preview.openAndCapture).toHaveBeenCalledOnce()
    expect(window.db.webQa.archive).toHaveBeenCalledOnce()
    pushState?.({ ...emptyState, url: 'https://example.org/other', visible: true })
    await flushPromises()
    expect(window.db.webQa.archive).toHaveBeenCalledOnce()
  })

  it('accepts a plain-text link drop when no URI list is supplied', async () => {
    wrapper = mount(WebPreviewView)
    await wrapper.get('.preview-slot').trigger('drop', {
      dataTransfer: { getData: (type: string) => type === 'text/plain' ? 'https://example.org/article' : '' },
    })
    await flushPromises()
    expect(preview.openAndCapture).toHaveBeenCalledWith('https://example.org/article', expect.any(Object))
  })

  it('opens a saved page from text-only cache without loading the original URL', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue('page-1')
    await flushPromises()
    expect(wrapper.text()).toContain('本地缓存文章')
    expect(wrapper.text()).toContain('离线正文')
    expect(preview.open).not.toHaveBeenCalled()
    expect(preview.showCached).toHaveBeenCalledWith('snap-1', expect.objectContaining({ width: 900 }))
    expect(preview.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('shows a saved full-page archive in the native preview instead of text-only blocks', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(preview.showCached).mockResolvedValue(true)
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue('page-1')
    await flushPromises()
    expect(preview.showCached).toHaveBeenCalledWith('snap-1', {
      x: 72, y: 64, width: 900, height: 700,
    })
    expect(wrapper.text()).toContain('本地原貌缓存')
    expect(wrapper.find('.cached-page').exists()).toBe(false)
    expect(preview.setBounds).toHaveBeenCalledWith({ x: 72, y: 64, width: 900, height: 700 })
  })

  it('explains why original appearance fell back to readable text', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(window.db.webQa.getPreview).mockResolvedValue({ ...cached, hasOriginalAppearance: true })
    vi.mocked(preview.showCached).mockRejectedValueOnce(new Error('archive unavailable'))
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue('page-1')
    await flushPromises()
    expect(wrapper.text()).toContain('原貌缓存加载失败')
    expect(wrapper.text()).toContain('archive unavailable')
    expect(wrapper.text()).toContain('离线正文')
  })

  it('finds a matching appearance for an old conversation after the page changed again', async () => {
    const newerPage = { ...page, latestSnapshotId: 'snap-3', snapshotCount: 3, sessionCount: 1 }
    const oldSession = { id: 'old-session', pageId: page.id, snapshotId: 'snap-1',
      finalUrl: cached.finalUrl, title: cached.title, capturedAt: 1, byteLength: 80,
      createdAt: 1, updatedAt: 2, firstQuestion: '旧问题' }
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([newerPage])
    vi.mocked(window.db.webQa.listSessions).mockResolvedValue([oldSession])
    vi.mocked(window.db.webQa.getPreview).mockImplementation(async id => id === 'snap-3'
      ? { ...cached, id: 'snap-3', contentHash: 'changed' } : cached)
    vi.mocked(window.db.webQa.findAppearance).mockResolvedValue({ ...cached, id: 'snap-2', hasOriginalAppearance: true })
    vi.mocked(window.db.webQa.getSession).mockResolvedValue({ ...oldSession,
      messages: [{ id: 'old-q', sessionId: oldSession.id, role: 'user', content: '旧问题',
        status: 'completed', error: '', modelId: '', createdAt: 1 },
      { id: 'old-a', sessionId: oldSession.id, role: 'assistant', content: '旧回答',
        status: 'completed', error: '', modelId: 'model-a', createdAt: 2 }] })
    vi.mocked(preview.showCached).mockResolvedValue(true)
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    await wrapper.get('#web-qa-history').setValue(oldSession.id)
    await flushPromises()
    expect(preview.showCached).toHaveBeenLastCalledWith('snap-2', expect.any(Object))
    expect(window.db.webQa.findAppearance).toHaveBeenCalledWith(page.id, cached.contentHash)
    expect(wrapper.text()).toContain('外观来自同内容缓存')
    expect(wrapper.text()).toContain('旧问题')
  })

  it('does not let a stale cache load replace a newer live open', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    let completeCache!: (shown: boolean) => void
    vi.mocked(preview.showCached).mockReturnValueOnce(new Promise(resolve => { completeCache = resolve }))
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await wrapper.get('[aria-label="网页地址"]').setValue('https://example.org/new')
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    completeCache(true)
    await flushPromises()
    expect(wrapper.text()).toContain('在线网页预览')
    expect(wrapper.text()).not.toContain('本地原貌缓存')
  })

  it('keeps the live source open when an older session cache finishes later', async () => {
    const session = { id: 's1', pageId: page.id, snapshotId: cached.id,
      finalUrl: cached.finalUrl, title: cached.title, capturedAt: 1, byteLength: 80,
      createdAt: 1, updatedAt: 2, firstQuestion: '问题' }
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(window.db.webQa.listSessions).mockResolvedValue([session])
    vi.mocked(window.db.webQa.getSession).mockResolvedValue({ ...session, messages: [
      { id: 'q1', sessionId: session.id, role: 'user', content: '问题', status: 'completed', error: '', modelId: '', createdAt: 1 },
      { id: 'a1', sessionId: session.id, role: 'assistant', content: '回答', status: 'completed', error: '', modelId: '', createdAt: 2 },
    ] })
    vi.mocked(preview.showCached).mockResolvedValueOnce(true)
    let completeCache!: (shown: boolean) => void
    vi.mocked(preview.showCached).mockReturnValueOnce(new Promise(resolve => { completeCache = resolve }))
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    await wrapper.get('#web-qa-history').setValue(session.id)
    await flushPromises()
    await wrapper.get('.source-card button').trigger('click')
    await flushPromises()
    expect(preview.open).toHaveBeenCalledWith(cached.finalUrl, expect.any(Object))
    pushState?.({ ...emptyState, url: cached.finalUrl, visible: true })
    completeCache(true)
    await flushPromises()
    expect(wrapper.text()).toContain('在线网页预览')
    expect(wrapper.find('[data-action="save-current"]').exists()).toBe(true)
  })

  it('does not let an older archive refresh overwrite a newer opened address', async () => {
    const secondPage = { ...page, id: 'page-2', canonicalUrl: 'https://example.org/new',
      latestSnapshotId: 'snap-2' }
    wrapper = mount(WebPreviewView)
    await flushPromises()
    let finishFirstRefresh!: (pages: typeof page[]) => void
    vi.mocked(window.db.webQa.listPages)
      .mockReturnValueOnce(new Promise(resolve => { finishFirstRefresh = resolve }))
      .mockResolvedValueOnce([page, secondPage])
    vi.mocked(window.db.webQa.archive).mockResolvedValueOnce(page).mockResolvedValueOnce(secondPage)
    await wrapper.get('[aria-label="网页地址"]').setValue(page.canonicalUrl)
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    await wrapper.get('[aria-label="网页地址"]').setValue(secondPage.canonicalUrl)
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    finishFirstRefresh([page, secondPage])
    await flushPromises()
    expect((wrapper.get('[aria-label="网页地址"]').element as HTMLInputElement).value).toBe(secondPage.canonicalUrl)
    expect(wrapper.text()).not.toContain('网页选择已变化')
  })

  it('groups distinct sessions under a page and opens each saved answer from cache', async () => {
    const sessions = ['s1', 's2'].map((id, index) => ({ id, pageId: page.id,
      snapshotId: cached.id, finalUrl: cached.finalUrl, title: cached.title,
      capturedAt: 1, byteLength: 80, createdAt: index + 1, updatedAt: index + 1,
      firstQuestion: `问题 ${index + 1}` }))
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    vi.mocked(window.db.webQa.listSessions).mockResolvedValue(sessions)
    vi.mocked(window.db.webQa.getSession).mockImplementation(async id => ({ ...sessions.find(s => s.id === id)!,
      messages: [{ id: `m-${id}`, sessionId: id, role: 'user', content: `问题 ${id}`,
        status: 'completed', error: '', modelId: '', createdAt: 1 },
      { id: `a-${id}`, sessionId: id, role: 'assistant', content: `回答 ${id}`,
        status: 'completed', error: '', modelId: 'model-a', createdAt: 2 }] }))
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    expect(wrapper.get('#web-qa-history').findAll('option')).toHaveLength(3)
    await wrapper.get('#web-qa-history').setValue('s2')
    await flushPromises()
    expect(wrapper.text()).toContain('问题 s2')
    expect(preview.open).not.toHaveBeenCalled()
  })

  it('requires Save after unsaved site navigation before starting a new session', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    wrapper = mount(WebPreviewView)
    await wrapper.get('[aria-label="网页地址"]').setValue('example.org/article')
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    await flushPromises()
    pushState?.({ ...emptyState, url: 'https://example.org/other', visible: true })
    await wrapper.get('[data-action="new-session"]').trigger('click')
    expect(wrapper.get('[data-action="send-question"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-action="save-current"]').exists()).toBe(true)
    await wrapper.get('[data-action="save-current"]').trigger('click')
    await flushPromises()
    expect(preview.captureSnapshot).toHaveBeenCalledOnce()
    expect(window.db.webQa.archive).toHaveBeenCalledTimes(2)
  })

  it('deletes a page only after confirmation', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce(new Error('cancel'))
      .mockResolvedValueOnce('confirm' as never)
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    await wrapper.get('[data-action="remove-page"]').trigger('click')
    await flushPromises()
    expect(window.db.webQa.removePage).not.toHaveBeenCalled()
    await wrapper.get('[data-action="remove-page"]').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(window.db.webQa.removePage).toHaveBeenCalledWith(page.id)
    expect(preview.close).toHaveBeenCalledOnce()
  })

  it('allows a new QA after returning from the live source to cached reading', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    wrapper = mount(WebPreviewView)
    await flushPromises()
    await wrapper.get('[data-action="history-page"]').setValue(page.id)
    await flushPromises()
    await wrapper.get('[data-action="open-source"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="return-cache"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="new-session"]').trigger('click')
    expect(wrapper.get('[aria-label="问题输入框"]').attributes('disabled')).toBeUndefined()
  })

  it('explains HTTP input without asking Electron to load it', async () => {
    wrapper = mount(WebPreviewView)
    await wrapper.get('[aria-label="网页地址"]').setValue('http://example.org')
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    expect(wrapper.text()).toContain('仅支持 HTTPS 链接')
    expect(preview.open).not.toHaveBeenCalled()
  })

  it('shows invalid-address feedback while another page remains visible', async () => {
    wrapper = mount(WebPreviewView)
    pushState?.({ ...emptyState, url: 'https://example.org/start', visible: true })
    await wrapper.get('[aria-label="网页地址"]').setValue('http://example.org/next')
    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.enter')
    expect(wrapper.get('[role="alert"]').text()).toContain('仅支持 HTTPS 链接')
    expect(preview.open).not.toHaveBeenCalled()
  })

  it('tracks page navigation but preserves an unfinished address edit until Escape', async () => {
    wrapper = mount(WebPreviewView)
    pushState?.({ ...emptyState, url: 'https://example.org/start', visible: true, canGoBack: true })
    await wrapper.vm.$nextTick()
    expect((wrapper.get('[aria-label="网页地址"]').element as HTMLInputElement).value).toBe('https://example.org/start')
    expect(wrapper.get('[data-action="back"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[aria-label="网页地址"]').setValue('unfinished.example')
    pushState?.({ ...emptyState, url: 'https://example.org/next', visible: true })
    await wrapper.vm.$nextTick()
    expect((wrapper.get('[aria-label="网页地址"]').element as HTMLInputElement).value).toBe('unfinished.example')

    await wrapper.get('[aria-label="网页地址"]').trigger('keydown.esc')
    expect((wrapper.get('[aria-label="网页地址"]').element as HTMLInputElement).value).toBe('https://example.org/next')
    expect(wrapper.get('[data-action="back"]').attributes('disabled')).toBeDefined()
  })

  it('wires navigation actions and closes the native view on exit', async () => {
    wrapper = mount(WebPreviewView)
    pushState?.({ ...emptyState, url: 'https://example.org/start', visible: true, canGoBack: true, canGoForward: true })
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-action="back"]').trigger('click')
    await wrapper.get('[data-action="forward"]').trigger('click')
    await wrapper.get('[data-action="reload"]').trigger('click')
    await wrapper.get('[data-action="external"]').trigger('click')
    expect(preview.back).toHaveBeenCalledOnce()
    expect(preview.forward).toHaveBeenCalledOnce()
    expect(preview.reload).toHaveBeenCalledOnce()
    expect(preview.openExternal).toHaveBeenCalledWith('https://example.org/start')

    wrapper.unmount()
    wrapper = undefined
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(preview.close).toHaveBeenCalledOnce()
  })

  it('shows an actionable error when a page cannot load', async () => {
    wrapper = mount(WebPreviewView)
    expect(wrapper.text()).toContain('粘贴 HTTPS 链接，按 Enter 预览原网页')
    pushState?.({ ...emptyState, url: 'https://example.org/', error: '找不到网站，请检查地址或网络连接。' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('找不到网站')
    await wrapper.get('[data-action="retry"]').trigger('click')
    expect(preview.open).toHaveBeenCalledWith('https://example.org/', expect.any(Object))
  })

  it('starts with the PDF reader 58/42 split and keyboard-adjustable separator', async () => {
    wrapper = mount(WebPreviewView)
    const separator = wrapper.get('[role="separator"]')
    expect(separator.attributes('aria-valuenow')).toBe('58')
    await separator.trigger('keydown.right')
    expect(separator.attributes('aria-valuenow')).toBe('60')
    await separator.trigger('keydown.home')
    expect(separator.attributes('aria-valuenow')).toBe('30')
    await separator.trigger('dblclick')
    expect(separator.attributes('aria-valuenow')).toBe('58')
  })

  it('sets native webpage bounds to zero on the narrow QA pane', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    wrapper = mount(WebPreviewView)
    pushState?.({ ...emptyState, url: 'https://example.org/', visible: true })
    await wrapper.get('[aria-label="显示问答面板"]').trigger('click')
    await flushPromises()
    expect(preview.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
    await wrapper.get('.right-tabs .right-tab:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.find('[aria-label="网页摘要"]').exists()).toBe(true)
    expect(preview.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 0, height: 0 })
  })
})
