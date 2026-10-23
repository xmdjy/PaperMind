import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReadingMapView from '../views/ReadingMapView.vue'

let wrapper: VueWrapper | undefined
const page = { id: 'web-1', title: 'Local article', canonicalUrl: 'https://example.org', createdAt: 1, lastOpenedAt: 2, latestSnapshotId: 's', snapshotCount: 1, sessionCount: 0, totalBytes: 10 }
beforeEach(() => {
  vi.mocked(window.db.paper.list).mockResolvedValue([])
  vi.mocked(window.db.webQa.listPages).mockResolvedValue([])
  vi.mocked(window.db.chat.listConversations).mockResolvedValue([])
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
async function open(path = '/reading-map') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/reading-map', component: ReadingMapView },
    { path: '/web-preview', component: { template: '<div>Reader</div>' } },
  ] })
  await router.push(path)
  wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  return router
}

describe('local reading map', () => {
  it('distinguishes an empty library from IPC failure and allows retry', async () => {
    vi.mocked(window.db.webQa.listPages).mockRejectedValueOnce(new Error('unavailable'))
    await open()
    expect(wrapper!.get('[role="alert"]').text()).toContain('unavailable')
    expect(wrapper!.find('[data-state="empty"]').exists()).toBe(false)
    await wrapper!.get('[data-action="refresh-map"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper!.get('[data-state="empty"]').text()).toContain('保存')
  })

  it('loads only metadata, navigates saved sources and keeps filters on back', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    const router = await open('/reading-map?source=web&q=article')
    expect(wrapper!.findAll('[data-reading-star]')).toHaveLength(1)
    expect(wrapper!.text()).toContain('1 份资料')
    const sessionsBefore = vi.mocked(window.db.webQa.listSessions).mock.calls.length
    await wrapper!.get('[data-reading-star]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/web-preview?page=web-1')
    expect(vi.mocked(window.db.webQa.listSessions).mock.calls.length).toBe(sessionsBefore)
    router.back()
    await new Promise(resolve => setTimeout(resolve, 0))
    await flushPromises()
    expect((wrapper!.get('[aria-label="搜索资料标题"]').element as HTMLInputElement).value).toBe('article')
    expect(wrapper!.get('[data-filter="web"]').attributes('aria-pressed')).toBe('true')
    await wrapper!.get('[aria-label="搜索资料标题"]').setValue('unmatched')
    await flushPromises()
    expect(wrapper!.findAll('[data-reading-star]')).toHaveLength(0)
    expect(wrapper!.find('[data-state="no-results"]').exists()).toBe(true)
  })

  it('reports a deleted source and recovers after refresh rather than navigating', async () => {
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([page])
    const router = await open()
    vi.mocked(window.db.webQa.listPages).mockResolvedValue([])
    await wrapper!.get('[data-reading-star]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/reading-map')
    expect(wrapper!.get('[role="alert"]').text()).toContain('不存在')
    await wrapper!.get('[data-action="refresh-map"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('[data-state="empty"]').exists()).toBe(true)
  })
})
