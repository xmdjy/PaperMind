import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  paperIds: string[]
  messages: Message[]
  createdAt: number
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama'
  model: string
  apiKey: string
  baseUrl: string
  temperature: number
  maxTokens: number
  systemPrompt: string
}

const defaultConfig: LLMConfig = {
  provider: 'openai', model: 'gpt-4o', apiKey: '', baseUrl: 'https://api.openai.com/v1',
  temperature: 0.7, maxTokens: 2048, systemPrompt: '你是一个专业的学术论文阅读助手，帮助用户理解和分析论文内容。'
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([])
  const config = ref<LLMConfig>({ ...defaultConfig })
  const loaded = ref(false)

  async function init() {
    if (loaded.value) return
    conversations.value = await window.db.chat.listConversations()
    const savedConfig = await window.db.settings.get('llm_config')
    if (savedConfig) config.value = { ...defaultConfig, ...savedConfig }
    loaded.value = true
  }

  async function newConversation(title: string, paperIds: string[]): Promise<Conversation> {
    const conv: Conversation = { id: crypto.randomUUID(), title, paperIds, messages: [], createdAt: Date.now() }
    await window.db.chat.createConversation({ id: conv.id, title, paperIds, createdAt: conv.createdAt })
    conversations.value.unshift(conv)
    return conv
  }

  async function addMessage(convId: string, role: 'user' | 'assistant', content: string, sources?: string[]) {
    const conv = conversations.value.find(c => c.id === convId)
    if (!conv) return
    const msg: Message = { id: crypto.randomUUID(), role, content, sources, timestamp: Date.now() }
    conv.messages.push(msg)
    await window.db.chat.addMessage({ id: msg.id, conversationId: convId, role, content, sources: sources ?? [], timestamp: msg.timestamp })
  }

  async function removeConversation(id: string) {
    await window.db.chat.removeConversation(id)
    conversations.value = conversations.value.filter(c => c.id !== id)
  }

  async function syncPaperIds(convId: string, paperIds: string[]) {
    const conv = conversations.value.find(c => c.id === convId)
    if (!conv) return
    conv.paperIds = [...paperIds]
    await window.db.chat.updateConversation(convId, { paperIds })
  }

  async function updateConfig(patch: Partial<LLMConfig>) {
    config.value = { ...config.value, ...patch }
    await window.db.settings.set('llm_config', config.value)
  }

  async function sendMessage(convId: string, userMessage: string, context?: string): Promise<string> {
    const conv = conversations.value.find(c => c.id === convId)
    if (!conv) throw new Error('Conversation not found')

    await addMessage(convId, 'user', userMessage)

    const cfg = config.value
    const messages = [
      { role: 'system', content: cfg.systemPrompt + (context ? `\n\n参考内容：\n${context}` : '') },
      ...conv.messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
    ]

    let reply = ''
    if (cfg.provider === 'ollama') {
      const res = await fetch(`${cfg.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cfg.model, messages, stream: false }),
      })
      const data = await res.json()
      reply = data.message?.content ?? ''
    } else {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cfg.provider === 'openai') headers['Authorization'] = `Bearer ${cfg.apiKey}`
      if (cfg.provider === 'anthropic') { headers['x-api-key'] = cfg.apiKey; headers['anthropic-version'] = '2023-06-01' }
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: cfg.model, messages, temperature: cfg.temperature, max_tokens: cfg.maxTokens }),
      })
      const data = await res.json()
      reply = data.choices?.[0]?.message?.content ?? ''
    }

    await addMessage(convId, 'assistant', reply)
    return reply
  }

  return {
    conversations, config, loaded, init,
    newConversation, addMessage, removeConversation, syncPaperIds, updateConfig, sendMessage,
  }
})
