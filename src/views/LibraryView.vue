<template>
  <div class="library-view">
    <header class="view-header">
      <div class="header-left">
        <h1 class="font-display">知识库</h1>
        <span class="paper-count tabular-nums">{{ allPapers.length }} 篇论文</span>
      </div>
      <div class="header-actions">
        <el-button @click="showNewKbDialog = true" plain size="small">
          <el-icon><FolderAdd /></el-icon> 新建知识库
        </el-button>
        <!-- 多配置时显示索引模型选择器 -->
        <div v-if="chatStore.profiles.length > 1" class="index-model-select">
          <span class="index-label">索引模型</span>
          <el-select
            :model-value="chatStore.indexProfileId"
            @update:model-value="chatStore.setIndexProfileId($event)"
            size="small"
            style="width:140px"
          >
            <el-option
              v-for="p in chatStore.profiles"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
        </div>
        <el-button type="primary" size="small" @click="triggerUpload">
          <el-icon><Upload /></el-icon> 导入 PDF
        </el-button>
        <input
          ref="fileInput"
          type="file"
          accept=".pdf"
          multiple
          class="file-input"
          aria-label="选择 PDF 文件"
          @change="onFilesSelected"
        />
      </div>
    </header>

    <div class="library-body">
      <div class="kb-tabs" aria-label="知识库">
        <div
          v-for="kb in store.knowledgeBases"
          :key="kb.id"
          class="kb-tab-wrap"
        >
          <button
            type="button"
            class="kb-tab"
            :class="{ active: activeKbId === kb.id }"
            :aria-current="activeKbId === kb.id ? 'true' : undefined"
            @click="activeKbId = kb.id"
          >
            <span class="kb-dot" :style="{ background: kb.color }" aria-hidden="true" />
            <span class="kb-name">{{ kb.name }}</span>
            <span class="kb-count tabular-nums">{{ store.getPapersByKb(kb.id).value.length }}</span>
          </button>
          <button
            v-if="kb.id !== 'default'"
            type="button"
            class="kb-remove"
            aria-label="删除知识库"
            @click="removeKb(kb.id)"
          >
            <el-icon aria-hidden="true"><Close /></el-icon>
          </button>
        </div>
      </div>

      <div class="paper-area">
        <div v-if="activePapers.length === 0" class="empty-state">
          <div class="empty-visual" aria-hidden="true">
            <el-icon :size="36"><Document /></el-icon>
          </div>
          <h2>还没有论文</h2>
          <p>导入 PDF，开始本地阅读与问答</p>
          <el-button type="primary" @click="triggerUpload">导入论文</el-button>
        </div>

        <div v-else class="paper-grid">
          <article
            v-for="paper in activePapers"
            :key="paper.id"
            class="paper-card"
          >
            <div class="card-top">
              <span class="status-pill" :data-status="paper.status">{{ statusLabel[paper.status] }}</span>
              <el-dropdown trigger="click" @click.stop>
                <button type="button" class="card-menu-btn" aria-label="论文操作" @click.stop>
                  <el-icon aria-hidden="true"><MoreFilled /></el-icon>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item @click.stop="movePaper(paper)">移动到知识库</el-dropdown-item>
                    <el-dropdown-item @click.stop="store.updatePaper(paper.id, { status: 'done' })">标记完成</el-dropdown-item>
                    <el-dropdown-item divided @click.stop="deletePaper(paper.id)">
                      <span class="danger-text">删除</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <router-link :to="`/library/${paper.id}`" class="card-link">
              <div class="card-icon" aria-hidden="true">
                <el-icon :size="22"><Document /></el-icon>
              </div>
              <h3 class="card-title">{{ paper.title || paper.fileName }}</h3>
              <p class="card-authors">{{ paper.authors?.join(', ') || '未知作者' }}</p>
              <p class="card-abstract">
                {{ paper.abstract?.slice(0, 120) }}{{ paper.abstract?.length > 120 ? '…' : '' }}
              </p>
              <div class="card-footer">
                <span class="card-year tabular-nums">{{ paper.year || '—' }}</span>
                <div class="card-tags">
                  <el-tag v-for="tag in paper.tags?.slice(0, 2)" :key="tag" size="small">{{ tag }}</el-tag>
                </div>
              </div>
            </router-link>
          </article>
        </div>
      </div>
    </div>

    <!-- ── 导入进度面板 ── -->
    <transition name="slide-up">
      <div v-if="showImportPanel" class="import-panel" role="status" aria-live="polite">
        <div class="import-panel-header">
          <span class="import-panel-title">
            导入进度
            <span class="import-counter tabular-nums">
              {{ doneCount }} / {{ importItems.length }}
            </span>
          </span>
          <button
            v-if="allDone"
            type="button"
            class="import-close-btn"
            aria-label="关闭"
            @click="showImportPanel = false"
          >✕</button>
        </div>

        <el-progress
          :percentage="importPercent"
          :status="importHasError ? 'exception' : allDone ? 'success' : undefined"
          :stroke-width="3"
          :show-text="false"
          class="import-progress-bar"
        />

        <ul class="import-list">
          <li
            v-for="item in importItems"
            :key="item.name"
            class="import-item"
            :data-status="item.status"
          >
            <span class="import-item-icon" aria-hidden="true">
              <span v-if="item.status === 'done'">✓</span>
              <span v-else-if="item.status === 'error'">✕</span>
              <span v-else class="spin">⟳</span>
            </span>
            <span class="import-item-name">{{ item.name }}</span>
            <span class="import-item-stage">{{ stageLabel[item.status] }}</span>
            <span v-if="item.error" class="import-item-error" :title="item.error">{{ item.error }}</span>
          </li>
        </ul>
      </div>
    </transition>

    <el-dialog v-model="showNewKbDialog" title="新建知识库" width="400px">
      <el-form :model="newKbForm" label-position="top" size="default">
        <el-form-item label="名称">
          <el-input v-model="newKbForm.name" name="kb-name" autocomplete="off" placeholder="如：深度学习、NLP…" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newKbForm.description" name="kb-desc" autocomplete="off" placeholder="简短描述（可选）" />
        </el-form-item>
        <el-form-item label="颜色">
          <div class="color-options" role="radiogroup" aria-label="知识库颜色">
            <button
              v-for="c in colorOptions"
              :key="c"
              type="button"
              role="radio"
              class="color-dot"
              :style="{ background: c }"
              :class="{ selected: newKbForm.color === c }"
              :aria-label="`选择颜色 ${c}`"
              :aria-checked="newKbForm.color === c"
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
import { FolderAdd, Upload, Close, MoreFilled, Document } from '@element-plus/icons-vue'
import { usePaperStore } from '../stores/paper'
import { useChatStore } from '../stores/chat'
import { parsePdfMeta } from '../utils/pdfUtils'

const store = usePaperStore()
const chatStore = useChatStore()
const fileInput = ref<HTMLInputElement>()
const activeKbId = ref(store.knowledgeBases[0]?.id ?? 'default')
const showNewKbDialog = ref(false)

const DEFAULT_KB_COLOR = '#3db8a0'
const newKbForm = ref({ name: '', description: '', color: DEFAULT_KB_COLOR })
const colorOptions = ['#3db8a0', '#5b8def', '#67C23A', '#E6A23C', '#F56C6C', '#d4a84b', '#909399']

const allPapers = computed(() => store.papers)
const activePapers = computed(() => store.getPapersByKb(activeKbId.value).value)

const statusLabel: Record<string, string> = { unread: '未读', reading: '阅读中', done: '已完成' }

// ── 导入进度状态 ──────────────────────────────────────────
type ImportStatus = 'pending' | 'parsing' | 'saving' | 'done' | 'error'

interface ImportItem {
  name: string
  status: ImportStatus
  error?: string
}

const stageLabel: Record<ImportStatus, string> = {
  pending: '等待中',
  parsing: '解析 PDF…',
  saving:  '写入中…',
  done:    '完成',
  error:   '失败',
}

const importItems = ref<ImportItem[]>([])
const showImportPanel = ref(false)

const doneCount = computed(() =>
  importItems.value.filter(i => i.status === 'done' || i.status === 'error').length,
)
const allDone = computed(() => doneCount.value === importItems.value.length && importItems.value.length > 0)
const importHasError = computed(() => importItems.value.some(i => i.status === 'error'))
const importPercent = computed(() =>
  importItems.value.length === 0 ? 0 : Math.round((doneCount.value / importItems.value.length) * 100),
)

function triggerUpload() { fileInput.value?.click() }

async function onFilesSelected(e: Event) {
  const files = (e.target as HTMLInputElement).files
  if (!files || files.length === 0) return

  // 初始化进度列表
  importItems.value = Array.from(files).map(f => ({ name: f.name, status: 'pending' as ImportStatus }))
  showImportPanel.value = true

  for (let i = 0; i < importItems.value.length; i++) {
    const file = files[i]
    const item = importItems.value[i]
    try {
      item.status = 'parsing'
      const meta = await parsePdfMeta(file)

      item.status = 'saving'
      const id = await store.addPaper({
        ...meta,
        fileName: file.name,
        knowledgeBaseId: activeKbId.value,
        status: 'unread',
        tags: [],
      })
      item.status = 'done'

      // 后台触发 pageIndex 预处理，不阻塞导入流程
      chatStore.indexPaper(id).catch(() => {})
    } catch (err) {
      item.status = 'error'
      item.error = err instanceof Error ? err.message : '未知错误'
    }
  }

  ;(e.target as HTMLInputElement).value = ''
}

function createKb() {
  store.addKnowledgeBase(newKbForm.value.name, newKbForm.value.description, newKbForm.value.color)
  showNewKbDialog.value = false
  newKbForm.value = { name: '', description: '', color: DEFAULT_KB_COLOR }
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
  const kbs = store.knowledgeBases
  const idx = kbs.findIndex(k => k.id === paper.knowledgeBaseId)
  const next = kbs[(idx + 1) % kbs.length]
  store.updatePaper(paper.id, { knowledgeBaseId: next.id })
  ElMessage.success(`已移至「${next.name}」`)
}
</script>

<style scoped>
.library-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-width: 0;
}

.view-header h1 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  text-wrap: balance;
}

.paper-count {
  font-size: 13px;
  color: var(--text-muted);
}

.header-actions { display: flex; align-items: center; gap: 8px; }

.index-model-select { display: flex; align-items: center; gap: 6px; }
.index-label { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.file-input { display: none; }

.library-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.kb-tabs {
  display: flex;
  gap: 4px;
  padding: 14px 28px 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  overflow-x: auto;
}

.kb-tab-wrap {
  display: flex;
  align-items: stretch;
  position: relative;
  bottom: -1px;
}

.kb-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 12px;
  border-radius: var(--radius-sm) 0 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  font-family: inherit;
  transition:
    background 0.15s var(--ease-out),
    color 0.15s var(--ease-out),
    border-color 0.15s var(--ease-out);
  white-space: nowrap;
}

.kb-tab-wrap:not(:has(.kb-remove)) .kb-tab {
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}

.kb-tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.kb-tab.active {
  background: color-mix(in srgb, var(--bg-base) 70%, var(--bg-surface));
  border-color: var(--border);
  color: var(--text-primary);
  font-weight: 500;
}

.kb-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 8%, transparent);
}

.kb-count {
  color: var(--text-muted);
  font-size: 11px;
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: 999px;
}

.kb-tab.active .kb-count {
  background: var(--accent-dim);
  color: var(--accent);
}

.kb-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-left: none;
  border-bottom: none;
  border-radius: 0 var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}

.kb-tab.active + .kb-remove {
  background: color-mix(in srgb, var(--bg-base) 70%, var(--bg-surface));
  border-color: var(--border);
}

.kb-remove:hover {
  color: var(--danger);
  background: var(--bg-hover);
}

.paper-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.empty-state {
  height: 100%;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
}

.empty-visual {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 8px;
  color: var(--accent);
  background:
    linear-gradient(145deg, var(--accent-dim), transparent),
    var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-card);
}

.empty-state h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-state p {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.paper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.paper-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  transition:
    border-color 0.2s var(--ease-out),
    background 0.2s var(--ease-out),
    transform 0.2s var(--ease-out),
    box-shadow 0.2s var(--ease-out);
  display: flex;
  flex-direction: column;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  position: relative;
  overflow: hidden;
}

.paper-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: transparent;
  transition: background 0.2s var(--ease-out);
}

.paper-card:hover,
.paper-card:focus-within {
  border-color: var(--border-light);
  background: var(--bg-elevated);
  transform: translateY(-2px);
  box-shadow: var(--shadow-card);
}

.paper-card:hover::before,
.paper-card:focus-within::before {
  background: var(--accent);
}

.card-link {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  min-width: 0;
  flex: 1;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-pill {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  letter-spacing: 0.2px;
}

.status-pill[data-status='unread'] {
  background: rgba(139, 149, 168, 0.14);
  color: var(--text-secondary);
}

.status-pill[data-status='reading'] {
  background: rgba(212, 168, 75, 0.14);
  color: var(--gold);
}

.status-pill[data-status='done'] {
  background: rgba(76, 175, 125, 0.14);
  color: var(--success);
}

.card-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s var(--ease-out), color 0.15s var(--ease-out);
}

.card-menu-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  background: var(--accent-dim);
  margin: 2px 0;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-wrap: pretty;
}

.card-authors {
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-abstract {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.card-year {
  font-size: 12px;
  color: var(--text-muted);
}

.card-tags { display: flex; gap: 4px; }

.danger-text { color: var(--danger); }

.color-options {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.color-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  padding: 0;
  transition: transform 0.15s var(--ease-out);
}

.color-dot:hover { transform: scale(1.15); }
.color-dot.selected {
  outline: 2px solid var(--text-primary);
  outline-offset: 2px;
}

/* ── 导入进度面板 ─────────────────────────────────────── */
.import-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 320px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  z-index: 1000;
}

.import-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
}
.import-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.import-counter {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-hover);
  padding: 1px 7px;
  border-radius: 999px;
}
.import-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s var(--ease-out), background 0.15s var(--ease-out);
}
.import-close-btn:hover { color: var(--text-primary); background: var(--bg-hover); }

.import-progress-bar { padding: 0 14px 6px; }

.import-list {
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  padding: 0 0 6px;
}
.import-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 14px;
  font-size: 12px;
  line-height: 1.5;
  transition: background 0.1s;
}
.import-item:hover { background: var(--bg-hover); }

.import-item-icon {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-size: 11px;
}
.import-item[data-status='done'] .import-item-icon  { color: var(--success); }
.import-item[data-status='error'] .import-item-icon { color: var(--danger); }
.import-item[data-status='parsing'] .import-item-icon,
.import-item[data-status='saving'] .import-item-icon  { color: var(--accent); }
.import-item[data-status='pending'] .import-item-icon { color: var(--text-muted); }

.import-item-name {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.import-item-stage {
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}
.import-item[data-status='done'] .import-item-stage   { color: var(--success); }
.import-item[data-status='error'] .import-item-stage  { color: var(--danger); }
.import-item[data-status='parsing'] .import-item-stage,
.import-item[data-status='saving']  .import-item-stage { color: var(--accent); }

.import-item-error {
  display: block;
  font-size: 11px;
  color: var(--danger);
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* 旋转动画 */
.spin {
  display: inline-block;
  animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* 滑入动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s var(--ease-out), opacity 0.25s var(--ease-out);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(16px);
  opacity: 0;
}</style>
