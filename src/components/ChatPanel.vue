<template>
  <div class="chat-panel">
    <div class="chat-messages" ref="messagesRef">
      <div v-if="!conversation || conversation.messages.length === 0" class="chat-empty">
        <div class="empty-icon">💬</div>
        <p>开始对话</p>
        <span>选中论文内容或直接提问</span>
      </div>

      <div
        v-for="msg in conversation?.messages" :key="msg.id"
        class="message" :class="msg.role"
      >
        <div class="msg-avatar">{{ msg.role === 'user' ? '我' : 'AI' }}</div>
        <div class="msg-body">
          <div class="msg-content" v-html="renderContent(msg.content)" />
          <div v-if="msg.sources?.length" class="msg-sources">
            <el-icon><Link /></el-icon>
            <span v-for="(s, i) in msg.sources" :key="i" class="source-chip">{{ s }}</span>
          </div>
        </div>
      </div>

      <div v-if="loading" class="message assistant">
        <div class="msg-avatar">AI</div>
        <div class="msg-body"><div class="typing"><span /><span /><span /></div></div>
      </div>
    </div>

    <!-- Pending context chips -->
    <div v-if="pendingContext.length" class="context-chips">
      <div v-for="(ctx, i) in pendingContext" :key="i" class="context-chip">
        <el-icon><Document /></el-icon>
        <span class="chip-text">{{ ctx.slice(0, 40) }}{{ ctx.length > 40 ? '…' : '' }}</span>
        <el-icon class="chip-close" @click="pendingContext.splice(i, 1)"><Close /></el-icon>
      </div>
    </div>

    <div class="chat-input-area">
      <el-input
        v-model="input"
        type="textarea"
        :rows="2"
        resize="none"
        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
        @keydown.enter.exact.prevent="send"
      />
      <el-button type="primary" :loading="loading" :disabled="!input.trim()" @click="send" class="send-btn">
        <el-icon><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Link, Document, Close, Promotion } from '@element-plus/icons-vue'
import { useChatStore, type Conversation } from '../stores/chat'

const props = defineProps<{ conversation: Conversation | null }>()
const chatStore = useChatStore()

const input = ref('')
const loading = ref(false)
const messagesRef = ref<HTMLElement>()
const pendingContext = ref<string[]>([])

function addContext(text: string) {
  pendingContext.value.push(text)
}
defineExpose({ addContext })

function renderContent(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

async function scrollToBottom() {
  await nextTick()
  if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight
}

watch(() => props.conversation?.messages.length, scrollToBottom)

async function send() {
  if (!input.value.trim() || !props.conversation) {
    if (!props.conversation) ElMessage.warning('请先选择或创建对话')
    return
  }
  const context = pendingContext.value.join('\n---\n')
  const message = input.value.trim()
  input.value = ''
  pendingContext.value = []
  loading.value = true
  await scrollToBottom()

  try {
    await chatStore.sendMessage(props.conversation.id, message, context || undefined)
  } catch (e: any) {
    ElMessage.error(`请求失败：${e.message}。请检查设置中的 API 配置。`)
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}
</script>

<style scoped>
.chat-panel { display: flex; flex-direction: column; height: 100%; background: var(--bg-base); overflow: hidden; }

.chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }

.chat-empty {
  margin: auto; text-align: center; color: var(--text-muted);
  display: flex; flex-direction: column; gap: 4px; align-items: center;
}
.empty-icon { font-size: 36px; opacity: 0.5; }
.chat-empty p { font-size: 15px; color: var(--text-secondary); }
.chat-empty span { font-size: 13px; }

.message { display: flex; gap: 10px; }
.message.user { flex-direction: row-reverse; }
.msg-avatar {
  width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
}
.message.user .msg-avatar { background: var(--accent); color: #fff; }
.message.assistant .msg-avatar { background: var(--gold-dim); color: var(--gold); }

.msg-body { max-width: 78%; }
.msg-content {
  padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6;
  background: var(--bg-surface); color: var(--text-primary);
}
.message.user .msg-content { background: var(--accent-dim); }
.msg-content :deep(code) { background: var(--bg-elevated); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
.msg-sources { font-size: 11px; color: var(--text-muted); margin-top: 4px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.source-chip { background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px; color: var(--text-secondary); }

.typing { padding: 12px 14px; display: flex; gap: 4px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); animation: bounce 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }

.context-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 16px; border-top: 1px solid var(--border); }
.context-chip {
  display: flex; align-items: center; gap: 6px; padding: 4px 8px;
  background: var(--gold-dim); border-radius: 6px; font-size: 12px; color: var(--gold);
}
.chip-close { cursor: pointer; }
.chip-close:hover { color: var(--danger); }

.chat-input-area { display: flex; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--border); align-items: flex-end; }
.send-btn { height: 56px; }
</style>
