<template>
  <div class="chat-view">
    <!-- Left: Paper list -->
    <div class="chat-left">
      <div class="left-header">
        <el-select v-model="activeKbId" size="small" style="width:100%">
          <el-option v-for="kb in paperStore.knowledgeBases" :key="kb.id" :label="kb.name" :value="kb.id" />
        </el-select>
      </div>
      <div class="left-subheader">
        <span>选择论文作为上下文</span>
        <span class="selected-count">{{ selectedPaperIds.length }} 已选</span>
      </div>
      <el-scrollbar class="paper-list">
        <div
          v-for="p in kbPapers" :key="p.id"
          class="paper-list-item" :class="{ selected: selectedPaperIds.includes(p.id) }"
          @click="toggleSelect(p.id)"
        >
          <el-checkbox :model-value="selectedPaperIds.includes(p.id)" @click.stop="toggleSelect(p.id)" />
          <div class="pli-info">
            <span class="pli-title">{{ p.title || p.fileName }}</span>
            <span class="pli-meta">{{ p.authors?.[0] || '未知' }} · {{ p.year || '—' }}</span>
          </div>
        </div>
        <el-empty v-if="kbPapers.length === 0" description="该知识库暂无论文" :image-size="60" />
      </el-scrollbar>

      <div class="left-footer">
        <div class="conv-list-label">历史对话</div>
        <el-scrollbar max-height="200px">
          <div
            v-for="c in allConversations" :key="c.id"
            class="conv-item" :class="{ active: activeConvId === c.id }"
            @click="selectConv(c)"
          >
            <el-icon><ChatLineRound /></el-icon>
            <span class="conv-title">{{ c.title }}</span>
            <el-icon class="conv-del" @click.stop="delConv(c.id)"><Close /></el-icon>
          </div>
        </el-scrollbar>
      </div>
    </div>

    <!-- Center: Chat -->
    <div class="chat-center">
      <div class="center-header">
        <div class="ch-left">
          <h3>{{ activeConv?.title || '新对话' }}</h3>
          <span v-if="selectedPaperIds.length" class="ctx-badge">
            <el-icon><Files /></el-icon> {{ selectedPaperIds.length }} 篇论文上下文
          </span>
        </div>
        <el-button size="small" @click="startNewConv"><el-icon><Plus /></el-icon> 新对话</el-button>
      </div>
      <ChatPanel ref="chatPanelRef" :conversation="activeConv" />
    </div>

    <!-- Right: Params -->
    <transition name="slide">
      <div class="chat-right" v-if="showParams">
        <ParamPanel @close="showParams = false" />
      </div>
    </transition>
    <div v-if="!showParams" class="param-reopen" @click="showParams = true">
      <el-icon><Setting /></el-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox } from 'element-plus'
import { ChatLineRound, Close, Files, Plus, Setting } from '@element-plus/icons-vue'
import ChatPanel from '../components/ChatPanel.vue'
import ParamPanel from '../components/ParamPanel.vue'
import { usePaperStore } from '../stores/paper'
import { useChatStore, type Conversation } from '../stores/chat'

const paperStore = usePaperStore()
const chatStore = useChatStore()

const activeKbId = ref(paperStore.knowledgeBases[0]?.id ?? 'default')
const selectedPaperIds = ref<string[]>([])
const activeConvId = ref('')
const showParams = ref(true)
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()

const kbPapers = computed(() => paperStore.getPapersByKb(activeKbId.value).value)
const allConversations = computed(() => chatStore.conversations)
const activeConv = computed(() => chatStore.conversations.find(c => c.id === activeConvId.value) ?? null)

function toggleSelect(id: string) {
  const idx = selectedPaperIds.value.indexOf(id)
  if (idx === -1) selectedPaperIds.value.push(id)
  else selectedPaperIds.value.splice(idx, 1)
  // sync context into active conversation
  if (activeConv.value) chatStore.syncPaperIds(activeConv.value.id, selectedPaperIds.value)
}

async function startNewConv() {
  const title = `对话 ${chatStore.conversations.length + 1}`
  const conv = await chatStore.newConversation(title, [...selectedPaperIds.value])
  activeConvId.value = conv.id
}

function selectConv(c: Conversation) {
  activeConvId.value = c.id
  selectedPaperIds.value = [...c.paperIds]
}

async function delConv(id: string) {
  await ElMessageBox.confirm('确认删除该对话？', '删除', { type: 'warning' })
  await chatStore.removeConversation(id)
  if (activeConvId.value === id) activeConvId.value = ''
}
</script>

<style scoped>
.chat-view { display: flex; height: 100%; overflow: hidden; position: relative; }

/* Left */
.chat-left { width: 280px; min-width: 280px; background: var(--bg-surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; }
.left-header { padding: 14px; border-bottom: 1px solid var(--border); }
.left-subheader { display: flex; justify-content: space-between; padding: 10px 14px; font-size: 12px; color: var(--text-muted); }
.selected-count { color: var(--accent); }
.paper-list { flex: 1; padding: 0 8px; }
.paper-list-item {
  display: flex; align-items: center; gap: 8px; padding: 10px;
  border-radius: 8px; cursor: pointer; margin-bottom: 2px; transition: background 0.15s;
}
.paper-list-item:hover { background: var(--bg-hover); }
.paper-list-item.selected { background: var(--accent-dim); }
.pli-info { display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.pli-title { font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pli-meta { font-size: 11px; color: var(--text-muted); }

.left-footer { border-top: 1px solid var(--border); padding: 12px 8px; }
.conv-list-label { font-size: 11px; color: var(--text-muted); padding: 0 8px 8px; text-transform: uppercase; letter-spacing: 0.5px; }
.conv-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--text-secondary);
}
.conv-item:hover { background: var(--bg-hover); }
.conv-item.active { background: var(--accent-dim); color: var(--accent); }
.conv-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-del { opacity: 0; }
.conv-item:hover .conv-del { opacity: 1; }
.conv-del:hover { color: var(--danger); }

/* Center */
.chat-center { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.center-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border); }
.ch-left { display: flex; align-items: center; gap: 12px; }
.center-header h3 { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.ctx-badge { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--gold); background: var(--gold-dim); padding: 3px 8px; border-radius: 6px; }

/* Right */
.chat-right { width: 300px; min-width: 300px; }
.param-reopen {
  position: absolute; right: 16px; top: 16px; z-index: 10;
  width: 36px; height: 36px; border-radius: 8px;
  background: var(--bg-elevated); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; color: var(--text-secondary);
}
.param-reopen:hover { color: var(--accent); border-color: var(--accent); }

.slide-enter-active, .slide-leave-active { transition: all 0.2s ease; }
.slide-enter-from, .slide-leave-to { transform: translateX(100%); opacity: 0; }
</style>
