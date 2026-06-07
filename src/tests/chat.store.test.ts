import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
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
})
