<template>
  <div class="reader-view" v-if="paper">
    <div class="reader-topbar">
      <el-button text size="small" @click="$router.push('/library')">
        <el-icon><ArrowLeft /></el-icon> 返回
      </el-button>
      <h2 class="reader-title">{{ paper.title || paper.fileName }}</h2>
      <div class="topbar-right">
        <el-select v-model="paper.status" size="small" style="width:110px" @change="updateStatus">
          <el-option label="未读" value="unread" />
          <el-option label="阅读中" value="reading" />
          <el-option label="已完成" value="done" />
        </el-select>
      </div>
    </div>

    <div class="reader-split">
      <!-- Left: PDF -->
      <div class="split-left" :style="{ width: `${splitRatio}%` }">
        <PdfViewer v-if="pdfUrl" :src="pdfUrl" @select-text="onSelectText" />
      </div>

      <!-- Resizer -->
      <div class="resizer" @mousedown="startResize" />

      <!-- Right: Chat -->
      <div class="split-right" :style="{ width: `${100 - splitRatio}%` }">
        <div class="chat-header">
          <el-select
            v-model="activeConvId" size="small" placeholder="选择对话" style="flex:1"
          >
            <el-option v-for="c in paperConversations" :key="c.id" :label="c.title" :value="c.id" />
          </el-select>
          <el-button size="small" @click="createConv"><el-icon><Plus /></el-icon></el-button>
        </div>
        <ChatPanel ref="chatPanelRef" :conversation="activeConv" />
      </div>
    </div>
  </div>
  <el-empty v-else description="论文不存在" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Plus } from '@element-plus/icons-vue'
import PdfViewer from '../components/PdfViewer.vue'
import ChatPanel from '../components/ChatPanel.vue'
import { usePaperStore } from '../stores/paper'
import { useChatStore } from '../stores/chat'
import { base64ToUrl } from '../utils/pdfUtils'
const route = useRoute()
const paperStore = usePaperStore()
const chatStore = useChatStore()

const paper = computed(() => paperStore.getPaper(route.params.id as string))
const pdfUrl = ref('')
const splitRatio = ref(58)
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()
const activeConvId = ref('')

const paperConversations = computed(() =>
  chatStore.conversations.filter(c => c.paperIds.includes(paper.value?.id ?? ''))
)
const activeConv = computed(() => chatStore.conversations.find(c => c.id === activeConvId.value) ?? null)

function updateStatus() {
  if (paper.value) paperStore.updatePaper(paper.value.id, { status: paper.value.status })
}

async function createConv() {
  if (!paper.value) return
  const conv = await chatStore.newConversation(`对话 ${paperConversations.value.length + 1}`, [paper.value.id])
  activeConvId.value = conv.id
}

async function onSelectText(text: string) {
  if (!activeConv.value) await createConv()
  chatPanelRef.value?.addContext(text)
}

// Resizer logic
let resizing = false
function startResize() { resizing = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none' }
function onMove(e: MouseEvent) {
  if (!resizing) return
  const total = window.innerWidth - 220 // minus sidebar
  const ratio = ((e.clientX - 220) / total) * 100
  splitRatio.value = Math.min(Math.max(ratio, 25), 75)
}
function stopResize() { resizing = false; document.body.style.cursor = ''; document.body.style.userSelect = '' }

onMounted(async () => {
  if (paper.value) {
    const base64 = await paperStore.readPaperFile(paper.value.id)
    if (base64) pdfUrl.value = base64ToUrl(base64)
    if (paper.value.status === 'unread') paperStore.updatePaper(paper.value.id, { status: 'reading' })
    if (paperConversations.value.length) activeConvId.value = paperConversations.value[0].id
    else createConv()
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', stopResize)
})

onBeforeUnmount(() => {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value)
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', stopResize)
})
</script>

<style scoped>
.reader-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.reader-topbar {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.reader-title { flex: 1; font-size: 15px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.reader-split { flex: 1; display: flex; overflow: hidden; }
.split-left { overflow: hidden; height: 100%; }
.split-right { overflow: hidden; height: 100%; display: flex; flex-direction: column; }

.resizer { width: 4px; background: var(--border); cursor: col-resize; flex-shrink: 0; transition: background 0.15s; }
.resizer:hover { background: var(--accent); }

.chat-header { display: flex; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); background: var(--bg-surface); }
</style>
