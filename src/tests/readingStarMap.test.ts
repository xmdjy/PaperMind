import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import ReadingStarMap from '../components/ReadingStarMap.vue'
import type { ReadingStar } from '../utils/readingMap'

const star: ReadingStar = {
  id: 'pdf:document', sourceId: 'document', source: 'pdf', title: 'Saved document', detail: 'A document',
  addedAt: 1, activityAt: 2, activityLabel: '最近对话', conversationCount: 1,
  conversationId: 'old-conversation', position: { x: 40, y: 40 },
}
afterEach(() => { vi.useRealTimers() })

describe('reading star details', () => {
  it('shows titles only in the active preview and closes after leaving star and preview', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ReadingStarMap, { props: { stars: [star], total: 1 } })
    expect(wrapper.text()).not.toContain('Saved document')
    const target = wrapper.get('[data-reading-star]')
    await target.trigger('mouseenter')
    expect(wrapper.get('.star-detail').text()).toContain('Saved document')
    await target.trigger('mouseleave')
    await wrapper.get('.star-detail').trigger('mouseenter')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.find('.star-detail').exists()).toBe(true)
    await wrapper.get('.star-detail').trigger('mouseleave')
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.find('.star-detail').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes the keyboard preview when focus leaves the star and preview', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ReadingStarMap, { props: { stars: [star], total: 1 } })
    const target = wrapper.get('[data-reading-star]')
    await target.trigger('focus')
    expect(wrapper.find('.star-detail').exists()).toBe(true)
    await target.trigger('focusout', { relatedTarget: wrapper.get('.sky-toolbar button').element })
    vi.advanceTimersByTime(200)
    await nextTick()
    expect(wrapper.find('.star-detail').exists()).toBe(false)
    wrapper.unmount()
  })
  it('opens the refreshed conversation when a focused source is refreshed', async () => {
    const wrapper = mount(ReadingStarMap, { props: { stars: [star], total: 1 } })
    await wrapper.get('[data-reading-star]').trigger('focus')
    await wrapper.setProps({ stars: [{ ...star, title: 'Updated document', conversationId: 'new-conversation', conversationCount: 2 }] })
    expect(wrapper.get('.star-detail').text()).toContain('Updated document')
    await wrapper.get('.star-detail').findAll('button').find(button => button.text().includes('回到阅读'))!.trigger('click')
    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ conversationId: 'new-conversation', conversationCount: 2 })
    wrapper.unmount()
  })

  for (const initiallyFocused of [false, true]) {
    it(`keeps list rows free of sky overlays when initially ${initiallyFocused ? 'focused' : 'unfocused'}`, async () => {
      const wrapper = mount(ReadingStarMap, { props: { stars: [star], total: 1 } })
      if (initiallyFocused) await wrapper.get('[data-reading-star]').trigger('focus')
      await wrapper.get('.sky-toolbar button').trigger('click')
      expect(wrapper.find('.star-detail').exists()).toBe(false)
      expect(wrapper.find('.sky-instruction').exists()).toBe(false)
      const row = wrapper.get('.star-list [data-reading-star]')
      await row.trigger('focus')
      expect(wrapper.find('.star-detail').exists()).toBe(false)
      await row.trigger('click')
      expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ id: 'pdf:document' })
      wrapper.unmount()
    })
  }

  it('dismisses details with an accessible button and Escape without navigating', async () => {
    const wrapper = mount(ReadingStarMap, { props: { stars: [star], total: 1 } })
    await wrapper.get('[data-reading-star]').trigger('focus')
    await wrapper.get('[aria-label="关闭资料详情"]').trigger('click')
    expect(wrapper.find('.star-detail').exists()).toBe(false)
    await wrapper.get('[data-reading-star]').trigger('focus')
    await wrapper.get('[data-reading-star]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.star-detail').exists()).toBe(false)
    expect(wrapper.emitted('open')).toBeUndefined()
    wrapper.unmount()
  })
})
