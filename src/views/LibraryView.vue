<template>
  <div class="library-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-left">
        <h1 class="font-display">知识库</h1>
        <span class="paper-count">{{ allPapers.length }} 篇论文</span>
      </div>
      <div class="header-actions">
        <el-button @click="showNewKbDialog = true" plain size="small">
          <el-icon><FolderAdd /></el-icon> 新建知识库
        </el-button>
        <el-button type="primary" size="small" @click="triggerUpload">
          <el-icon><Upload /></el-icon> 导入 PDF
        </el-button>
        <input ref="fileInput" type="file" accept=".pdf" multiple style="display:none" @change="onFilesSelected" />
      </div>
    </div>

    <div class="library-body">
      <!-- KB Tabs -->
      <div class="kb-tabs">
        <div
          v-for="kb in store.knowledgeBases" :key="kb.id"
          class="kb-tab" :class="{ active: activeKbId === kb.id }"
          @click="activeKbId = kb.id"
        >
          <span class="kb-dot" :style="{ background: kb.color }" />
          <span class="kb-name">{{ kb.name }}</span>
          <span class="kb-count">{{ store.getPapersByKb(kb.id).value.length }}</span>
          <el-icon v-if="kb.id !== 'default'" class="kb-remove" @click.stop="removeKb(kb.id)"><Close /></el-icon>
        </div>
      </div>

      <!-- Paper Grid -->
      <div class="paper-area">
        <el-empty v-if="activePapers.length === 0" description="拖入 PDF 文件或点击「导入 PDF」" :image-size="80">
          <el-button type="primary" @click="triggerUpload">导入论文</el-button>
        </el-empty>

        <div v-else class="paper-grid">
          <div
            v-for="paper in activePapers" :key="paper.id"
            class="paper-card"
            @click="$router.push(`/library/${paper.id}`)"
          >
            <div class="card-top">
              <el-tag size="small" :type="statusType[paper.status]">{{ statusLabel[paper.status] }}</el-tag>
              <el-dropdown trigger="click" @click.stop>
                <el-icon class="card-menu"><MoreFilled /></el-icon>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click.stop="movePaper(paper)">移动到知识库</el-dropdown-item>
                    <el-dropdown-item @click.stop="store.updatePaper(paper.id, { status: 'done' })">标记完成</el-dropdown-item>
                    <el-dropdown-item divided @click.stop="deletePaper(paper.id)">
                      <span style="color:var(--danger)">删除</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <div class="card-icon">📄</div>
            <h3 class="card-title">{{ paper.title || paper.fileName }}</h3>
            <p class="card-authors">{{ paper.authors?.join(', ') || '未知作者' }}</p>
            <p class="card-abstract">{{ paper.abstract?.slice(0, 120) }}{{ paper.abstract?.length > 120 ? '…' : '' }}</p>

            <div class="card-footer">
              <span class="card-year">{{ paper.year || '—' }}</span>
              <div class="card-tags">
                <el-tag v-for="tag in paper.tags?.slice(0, 2)" :key="tag" size="small">{{ tag }}</el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- New KB Dialog -->
    <el-dialog v-model="showNewKbDialog" title="新建知识库" width="400px">
      <el-form :model="newKbForm" label-position="top" size="default">
        <el-form-item label="名称">
          <el-input v-model="newKbForm.name" placeholder="如：深度学习、NLP…" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newKbForm.description" placeholder="简短描述（可选）" />
        </el-form-item>
        <el-form-item label="颜色">
          <div class="color-options">
            <div
              v-for="c in colorOptions" :key="c"
              class="color-dot" :style="{ background: c }"
              :class="{ selected: newKbForm.color === c }"
              @click="newKbForm.color = c"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewKbDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!newKbForm.name" @click="createKb">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { FolderAdd, Upload, Close, MoreFilled } from '@element-plus/icons-vue'
import { usePaperStore } from '../stores/paper'
import { parsePdfMeta } from '../utils/pdfUtils'

const store = usePaperStore()
const fileInput = ref<HTMLInputElement>()
const activeKbId = ref(store.knowledgeBases[0]?.id ?? 'default')
const showNewKbDialog = ref(false)

const newKbForm = ref({ name: '', description: '', color: '#7c6af7' })
const colorOptions = ['#7c6af7', '#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#c9a84c', '#909399']

const allPapers = computed(() => store.papers)
const activePapers = computed(() => store.getPapersByKb(activeKbId.value).value)

const statusType: Record<string, any> = { unread: 'info', reading: 'warning', done: 'success' }
const statusLabel: Record<string, string> = { unread: '未读', reading: '阅读中', done: '已完成' }

function triggerUpload() { fileInput.value?.click() }

async function onFilesSelected(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files) return
  for (const file of Array.from(files)) {
    const meta = await parsePdfMeta(file)
    store.addPaper({ ...meta, fileName: file.name, knowledgeBaseId: activeKbId.value, status: 'unread', tags: [] })
  }
  ElMessage.success(`已导入 ${files.length} 篇论文`)
  ;(e.target as HTMLInputElement).value = ''
}

function createKb() {
  store.addKnowledgeBase(newKbForm.value.name, newKbForm.value.description, newKbForm.value.color)
  showNewKbDialog.value = false
  newKbForm.value = { name: '', description: '', color: '#7c6af7' }
}

async function removeKb(id: string) {
  await ElMessageBox.confirm('删除知识库会同时删除其中所有论文，确认继续？', '删除知识库', { type: 'warning' })
  await store.removeKnowledgeBase(id)
  if (activeKbId.value === id) activeKbId.value = 'default'
}

async function deletePaper(id: string) {
  await ElMessageBox.confirm('确认删除该论文？', '删除', { type: 'warning' })
  await store.removePaper(id)
}

function movePaper(paper: any) {
  // simple: cycle through KBs
  const kbs = store.knowledgeBases
  const idx = kbs.findIndex(k => k.id === paper.knowledgeBaseId)
  const next = kbs[(idx + 1) % kbs.length]
  store.updatePaper(paper.id, { knowledgeBaseId: next.id })
  ElMessage.success(`已移至「${next.name}」`)
}
</script>

<style scoped>
.library-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

.view-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.header-left { display: flex; align-items: baseline; gap: 12px; }
.view-header h1 { font-size: 22px; font-weight: 700; color: var(--text-primary); }
.paper-count { font-size: 13px; color: var(--text-muted); }
.header-actions { display: flex; gap: 8px; }

.library-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; }

.kb-tabs {
  display: flex; gap: 4px; padding: 12px 28px 0;
  border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.kb-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 6px 6px 0 0;
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer; border: 1px solid transparent;
  border-bottom: none; transition: all 0.15s;
  position: relative; bottom: -1px;
}
.kb-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
.kb-tab.active { background: var(--bg-base); border-color: var(--border); color: var(--text-primary); font-weight: 500; }
.kb-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.kb-count { color: var(--text-muted); font-size: 11px; }
.kb-remove { font-size: 12px; color: var(--text-muted); margin-left: 2px; }
.kb-remove:hover { color: var(--danger); }

.paper-area { flex: 1; overflow-y: auto; padding: 24px 28px; }

.paper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.paper-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex; flex-direction: column; gap: 8px;
}
.paper-card:hover { border-color: var(--border-light); background: var(--bg-elevated); transform: translateY(-1px); }

.card-top { display: flex; justify-content: space-between; align-items: center; }
.card-menu { color: var(--text-muted); cursor: pointer; }
.card-menu:hover { color: var(--text-primary); }
.card-icon { font-size: 28px; line-height: 1; margin: 4px 0; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-authors { font-size: 12px; color: var(--accent); font-weight: 500; }
.card-abstract { font-size: 12px; color: var(--text-secondary); line-height: 1.5; flex: 1; }
.card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.card-year { font-size: 12px; color: var(--text-muted); }
.card-tags { display: flex; gap: 4px; }

.color-options { display: flex; gap: 10px; flex-wrap: wrap; }
.color-dot { width: 24px; height: 24px; border-radius: 50%; cursor: pointer; transition: transform 0.15s; }
.color-dot:hover { transform: scale(1.2); }
.color-dot.selected { outline: 2px solid white; outline-offset: 2px; }
</style>
