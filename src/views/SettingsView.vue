<template>
  <div class="settings-view">
    <header class="view-header">
      <h1 class="font-display">设置</h1>
      <p class="header-desc">LLM 配置管理与本地数据</p>
    </header>

    <div class="settings-body">

      <!-- ── LLM 配置列表 ── -->
      <section class="settings-card">
        <div class="card-title-row">
          <div>
            <h3>LLM 配置</h3>
            <p class="card-desc">可创建多个命名配置，分别用于对话和论文索引。所有请求直接从本地发往服务，不经过中间服务器。</p>
          </div>
          <el-button type="primary" size="small" @click="openNew">
            <el-icon><Plus /></el-icon> 新增配置
          </el-button>
        </div>

        <div class="profile-list">
          <div
            v-for="p in profiles"
            :key="p.id"
            class="profile-row"
            :class="{ 'is-chat': chatProfileId === p.id, 'is-index': indexProfileId === p.id }"
          >
            <div class="profile-info">
              <span class="profile-name">{{ p.name }}</span>
              <span class="profile-sub">{{ p.provider }} · {{ p.model }}</span>
              <div class="profile-badges">
                <span v-if="chatProfileId === p.id" class="badge badge-chat">对话</span>
                <span v-if="indexProfileId === p.id" class="badge badge-index">索引</span>
              </div>
            </div>
            <div class="profile-actions">
              <el-button size="small" plain @click="openEdit(p)">编辑</el-button>
              <el-button
                size="small"
                plain
                :disabled="profiles.length <= 1"
                @click="doRemove(p.id)"
              >删除</el-button>
            </div>
          </div>
        </div>
      </section>

      <!-- ── 默认选择 ── -->
      <section class="settings-card">
        <h3>默认使用配置</h3>
        <p class="card-desc">对话和论文索引可以分别使用不同的 LLM 配置。</p>

        <div class="setting-row">
          <label>对话</label>
          <el-select v-model="chatProfileIdLocal" @change="chatStore.setChatProfileId(chatProfileIdLocal)" style="width:240px">
            <el-option v-for="p in profiles" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </div>

        <div class="setting-row">
          <label>论文索引</label>
          <el-select v-model="indexProfileIdLocal" @change="chatStore.setIndexProfileId(indexProfileIdLocal)" style="width:240px">
            <el-option v-for="p in profiles" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </div>
      </section>

      <!-- ── 数据管理 ── -->
      <section class="settings-card">
        <h3>数据管理</h3>
        <p class="card-desc">所有论文与对话数据存储在本地，可随时导出备份。</p>
        <div class="action-row">
          <el-button @click="exportData">导出数据</el-button>
          <el-button type="danger" plain @click="clearData">清空所有数据</el-button>
        </div>
      </section>

      <!-- ── 关于 ── -->
      <section class="settings-card about">
        <div class="about-mark" aria-hidden="true">P</div>
        <div>
          <h3>关于</h3>
          <p class="card-desc">PaperMind · 本地论文阅读助手 · v0.1.0</p>
        </div>
      </section>
    </div>

    <!-- ── Profile 编辑 Dialog ── -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑配置' : '新增配置'"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form :model="form" label-position="top" size="default" class="profile-form">
        <el-form-item label="配置名称">
          <el-input v-model="form.name" placeholder="如：GPT-4o 精读、Ollama 本地…" />
        </el-form-item>

        <el-form-item label="模型提供商">
          <el-select v-model="form.provider" style="width:100%">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="Ollama (本地)" value="ollama" />
          </el-select>
        </el-form-item>

        <el-form-item label="模型名称">
          <el-input v-model="form.model" autocomplete="off" spellcheck="false" placeholder="gpt-4o / claude-3-5-sonnet / llama3…" />
        </el-form-item>

        <el-form-item label="API 地址">
          <el-input v-model="form.baseUrl" type="url" autocomplete="off" spellcheck="false" />
        </el-form-item>

        <el-form-item v-if="form.provider !== 'ollama'" label="API Key">
          <el-input v-model="form.apiKey" type="password" show-password autocomplete="off" spellcheck="false" placeholder="sk-…" />
        </el-form-item>

        <div class="form-row-two">
          <el-form-item label="Temperature">
            <div class="slider-row">
              <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" style="flex:1" />
              <span class="slider-val tabular-nums">{{ form.temperature }}</span>
            </div>
          </el-form-item>

          <el-form-item label="Max Tokens">
            <div class="slider-row">
              <el-slider v-model="form.maxTokens" :min="256" :max="8192" :step="256" style="flex:1" />
              <span class="slider-val tabular-nums">{{ form.maxTokens }}</span>
            </div>
          </el-form-item>
        </div>

        <el-form-item label="Top-K（0 = 不限制）">
          <div class="slider-row">
            <el-slider v-model="form.topK" :min="0" :max="100" :step="1" style="flex:1" />
            <span class="slider-val tabular-nums">{{ form.topK === 0 ? '—' : form.topK }}</span>
          </div>
        </el-form-item>

        <el-form-item label="系统提示词">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="5" resize="none" />
        </el-form-item>

        <el-form-item label="提示词模板（点击填入）">
          <div class="template-chips">
            <button
              v-for="t in PROMPT_TEMPLATES"
              :key="t.name"
              type="button"
              class="template-chip"
              @click="form.systemPrompt = t.prompt"
            >{{ t.name }}</button>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!form.name || !form.model" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useChatStore, PROMPT_TEMPLATES, type LLMProfile } from '../stores/chat'
import { storeToRefs } from 'pinia'

const chatStore = useChatStore()
const { profiles, chatProfileId, indexProfileId } = storeToRefs(chatStore)

// 本地绑定，避免直接修改 store ref（select @change 时再写入）
const chatProfileIdLocal = ref(chatProfileId.value)
const indexProfileIdLocal = ref(indexProfileId.value)

// ── Dialog state ──
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)

const EMPTY_FORM = (): Omit<LLMProfile, 'id'> => ({
  name: '',
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  temperature: 0.7,
  maxTokens: 2048,
  topK: 0,
  systemPrompt: '你是一个专业的学术论文阅读助手，帮助用户理解和分析论文内容。',
})

const form = reactive<Omit<LLMProfile, 'id'>>(EMPTY_FORM())

function openNew() {
  editingId.value = null
  Object.assign(form, EMPTY_FORM())
  dialogVisible.value = true
}

function openEdit(p: LLMProfile) {
  editingId.value = p.id
  Object.assign(form, { ...p })
  dialogVisible.value = true
}

async function saveProfile() {
  if (editingId.value) {
    await chatStore.updateProfile(editingId.value, { ...form })
    ElMessage.success('配置已更新')
  } else {
    await chatStore.addProfile({ ...form })
    ElMessage.success('配置已添加')
  }
  dialogVisible.value = false
}

async function doRemove(id: string) {
  await ElMessageBox.confirm('确认删除该配置？', '删除配置', { type: 'warning' })
  await chatStore.removeProfile(id)
  // 同步本地选择器
  chatProfileIdLocal.value = chatProfileId.value
  indexProfileIdLocal.value = indexProfileId.value
  ElMessage.success('已删除')
}

// ── Data management ──
async function exportData() {
  const data = await window.db.data.export()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `papermind-backup-${Date.now()}.json`
  a.click()
  ElMessage.success('已导出')
}

async function clearData() {
  await ElMessageBox.confirm('将删除所有论文、对话和配置，此操作不可恢复。确认继续？', '清空数据', { type: 'warning' })
  await window.db.data.clear()
  ElMessage.success('已清空，刷新后生效')
  setTimeout(() => location.reload(), 800)
}
</script>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.view-header {
  padding: 22px 28px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.view-header h1 { font-size: 24px; font-weight: 700; text-wrap: balance; }
.header-desc { margin-top: 4px; font-size: 13px; color: var(--text-muted); }

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  max-width: 760px;
}

.settings-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 22px 24px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s var(--ease-out);
}
.settings-card:hover { border-color: var(--border-light); }
.settings-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}
.card-desc {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-bottom: 16px;
}
.card-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.card-title-row > div { flex: 1; }
.card-title-row .card-desc { margin-bottom: 0; }

/* Profile list */
.profile-list { display: flex; flex-direction: column; gap: 8px; }
.profile-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  transition: border-color 0.15s var(--ease-out);
}
.profile-row:hover { border-color: var(--border-light); }
.profile-row.is-chat, .profile-row.is-index { border-color: var(--accent); background: var(--accent-dim); }
.profile-info { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.profile-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.profile-sub { font-size: 12px; color: var(--text-muted); }
.profile-badges { display: flex; gap: 4px; margin-left: 4px; }
.badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  letter-spacing: 0.3px;
}
.badge-chat { background: var(--accent-dim); color: var(--accent); }
.badge-index { background: rgba(212,168,75,0.14); color: var(--gold); }
.profile-actions { display: flex; gap: 6px; flex-shrink: 0; }

/* Settings rows */
.setting-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}
.setting-row label { width: 80px; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }

.action-row { display: flex; gap: 8px; flex-wrap: wrap; }

/* About */
.about { display: flex; align-items: center; gap: 14px; }
.about .card-desc { margin-bottom: 0; }
.about-mark {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: 18px;
  color: #0c0e11;
  background: linear-gradient(145deg, var(--accent-hover), var(--accent));
  box-shadow: 0 6px 16px rgba(61, 184, 160, 0.18);
  flex-shrink: 0;
}

/* Dialog form */
.profile-form .form-row-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.slider-row { display: flex; align-items: center; gap: 10px; width: 100%; }
.slider-val { font-size: 12px; color: var(--accent); min-width: 32px; text-align: right; }

.template-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.template-chip {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s var(--ease-out), color 0.15s var(--ease-out), background 0.15s var(--ease-out);
  font-family: inherit;
}
.template-chip:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
</style>
