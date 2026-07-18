import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// pageIndex.ts (imported by chat.ts) pulls in pdfjs-dist which needs DOMMatrix — mock it in Node
vi.mock('pdfjs-dist', () => ({
  default: {},
  GlobalWorkerOptions: { workerSrc: '' },
}))

import { useChatStore } from '../stores/chat'

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;(globalThis as any).mockDb.chat.listConversations.mockResolvedValue([])
    ;(globalThis as any).mockDb.settings.get.mockResolvedValue(null)
  })

  it('init loads conversations and default config', async () => {
    const store = useChatStore()
    await store.init()
    expect(store.conversations).toHaveLength(0)
    expect(store.config.provider).toBe('openai')
    expect(store.loaded).toBe(true)
  })

  it('init restores saved config', async () => {
    ;(globalThis as any).mockDb.settings.get.mockResolvedValue({ provider: 'ollama', model: 'llama3' })
    const store = useChatStore()
    await store.init()
    expect(store.config.provider).toBe('ollama')
    expect(store.config.model).toBe('llama3')
  })

  it('newConversation creates and prepends to list', async () => {
    const store = useChatStore()
    await store.init()
    const conv = await store.newConversation('Test', ['p1'])
    expect(store.conversations).toHaveLength(1)
    expect(conv.title).toBe('Test')
    expect(conv.paperIds).toEqual(['p1'])
    expect(conv.messages).toHaveLength(0)
  })

  it('addMessage appends to conversation', async () => {
    const store = useChatStore()
    await store.init()
    const conv = await store.newConversation('Chat', [])
    await store.addMessage(conv.id, 'user', 'Hello')
    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0].role).toBe('user')
    expect(conv.messages[0].content).toBe('Hello')
  })

  it('removeConversation deletes from list', async () => {
    const store = useChatStore()
    await store.init()
    const conv = await store.newConversation('Del', [])
    await store.removeConversation(conv.id)
    expect(store.conversations).toHaveLength(0)
  })

  it('updateConfig persists to settings', async () => {
    const store = useChatStore()
    await store.init()
    await store.updateConfig({ temperature: 1.5, model: 'gpt-4' })
    expect(store.config.temperature).toBe(1.5)
    expect(store.config.model).toBe('gpt-4')
    expect((globalThis as any).mockDb.settings.set).toHaveBeenCalledWith('llm_config', expect.objectContaining({ temperature: 1.5 }))
  })

  it('sendMessage throws for unknown conversation', async () => {
    const store = useChatStore()
    await store.init()
    await expect(store.sendMessage('nonexistent', 'hi')).rejects.toThrow('Conversation not found')
  })

  it('sendMessage calls LLM and appends both messages', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ choices: [{ message: { content: 'Answer' } }] }),
    }) as any
    const store = useChatStore()
    await store.init()
    await store.updateConfig({ apiKey: 'sk-test' })
    const conv = await store.newConversation('Chat', [])
    const reply = await store.sendMessage(conv.id, 'Question')
    expect(reply).toBe('Answer')
    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[1].role).toBe('assistant')
  })

  it('sendMessage skips query rewriting on first message (2 LLM calls total)', async () => {
    // 首条消息，无对话历史，应跳过查询改写：共2次 fetch（scoreAndSelect + 回答）
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        json: () => Promise.resolve({ choices: [{ message: { content: 'Answer' } }] }),
      })
    }) as any

    ;(globalThis as any).mockDb.index.get.mockResolvedValue({
      indexJson: JSON.stringify({
        title: 'Paper', nodeId: 'root', startPage: 0, endPage: 0,
        summary: 'test paper', nodes: [],
      }),
      pagesJson: JSON.stringify(['page one text']),
    })

    const store = useChatStore()
    await store.init()
    await store.updateConfig({ apiKey: 'sk-test' })
    const conv = await store.newConversation('test', ['paper-1'])

    await store.sendMessage(conv.id, 'What is this paper about?')

    // 单节点（root 无子节点）scoreAndSelect 不调用 LLM，加上回答 = 1次
    // 若有多节点才是2次。此处 root 无子节点，共1次回答调用
    expect(callCount).toBe(1)
  })

  it('sendMessage calls query rewriting when conversation has prior history (3 LLM calls total)', async () => {
    // 多节点 index，有历史时应触发改写：改写(1) + 评分(1) + 回答(1) = 3次
    let callCount = 0
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve({
        json: () => Promise.resolve({
          choices: [{ message: { content: '[{"id":0,"score":9},{"id":1,"score":2}]' } }],
        }),
      })
    }) as any

    ;(globalThis as any).mockDb.index.get.mockResolvedValue({
      indexJson: JSON.stringify({
        title: 'Paper', nodeId: 'root', startPage: 0, endPage: 3,
        summary: 'multi-section paper',
        nodes: [
          { title: 'Intro',    nodeId: '0', startPage: 0, endPage: 1, summary: 'intro', nodes: [] },
          { title: 'Methods',  nodeId: '1', startPage: 2, endPage: 3, summary: 'methods', nodes: [] },
        ],
      }),
      pagesJson: JSON.stringify(['p0', 'p1', 'p2', 'p3']),
    })

    const store = useChatStore()
    await store.init()
    await store.updateConfig({ apiKey: 'sk-test' })
    const conv = await store.newConversation('test', ['paper-1'])

    // 第一条消息（建立历史，不触发改写）
    callCount = 0
    await store.sendMessage(conv.id, 'What is this paper about?')
    const firstRoundCalls = callCount   // scoreAndSelect(1) + answer(1) = 2

    // 第二条消息（有历史，触发改写）
    callCount = 0
    await store.sendMessage(conv.id, 'What about the results?')

    // rewrite(1) + scoreAndSelect(1) + answer(1) = 3
    expect(callCount).toBe(3)
    expect(firstRoundCalls).toBe(2)
  })
})
