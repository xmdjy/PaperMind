<template>
  <div class="settings-view">
    <div class="view-header">
      <h1 class="font-display">设置</h1>
    </div>

    <div class="settings-body">
      <div class="settings-card">
        <h3>模型配置</h3>
        <p class="card-desc">配置用于论文分析与对话的大语言模型。所有请求直接从本地发往对应服务，不经过任何中间服务器。</p>

        <div class="setting-row">
          <label>提供商</label>
          <el-select v-model="cfg.provider" @change="save" style="width:240px">
            <el-option label="OpenAI" value="openai" />
            <el-option label="Anthropic" value="anthropic" />
            <el-option label="Ollama (本地)" value="ollama" />
          </el-select>
        </div>

        <div class="setting-row">
          <label>模型名称</label>
          <el-input v-model="cfg.model" @change="save" style="width:240px" />
        </div>

        <div class="setting-row">
          <label>API 地址</label>
          <el-input v-model="cfg.baseUrl" @change="save" style="width:360px" />
        </div>

        <div class="setting-row" v-if="cfg.provider !== 'ollama'">
          <label>API Key</label>
          <el-input v-model="cfg.apiKey" @change="save" type="password" show-password style="width:360px" placeholder="sk-…" />
        </div>
      </div>

      <div class="settings-card">
        <h3>生成参数</h3>
        <div class="setting-row">
          <label>Temperature</label>
          <el-slider v-model="cfg.temperature" @change="save" :min="0" :max="2" :step="0.1" style="width:240px" />
          <span class="param-val">{{ cfg.temperature }}</span>
        </div>
        <div class="setting-row">
          <label>Max Tokens</label>
          <el-slider v-model="cfg.maxTokens" @change="save" :min="256" :max="8192" :step="256" style="width:240px" />
          <span class="param-val">{{ cfg.maxTokens }}</span>
        </div>
      </div>

      <div class="settings-card">
        <h3>数据管理</h3>
        <p class="card-desc">所有论文与对话数据存储在本地浏览器存储中。</p>
        <el-button @click="exportData">导出数据</el-button>
        <el-button type="danger" plain @click="clearData">清空所有数据</el-button>
      </div>

      <div class="settings-card about">
        <h3>关于</h3>
        <p class="card-desc">PaperMind · 本地论文阅读助手 · v0.1.0</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '../stores/chat'
import { storeToRefs } from 'pinia'

const chatStore = useChatStore()
const { config: cfg } = storeToRefs(chatStore)

function save() { chatStore.updateConfig(cfg.value) }

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
.settings-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.view-header { padding: 20px 28px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.view-header h1 { font-size: 22px; font-weight: 700; }

.settings-body { flex: 1; overflow-y: auto; padding: 24px 28px; max-width: 720px; }
.settings-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px 24px; margin-bottom: 16px; }
.settings-card h3 { font-size: 15px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.card-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; margin-bottom: 16px; }

.setting-row { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; }
.setting-row label { width: 100px; font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
.param-val { color: var(--accent); font-size: 13px; min-width: 40px; }

.about .card-desc { margin-bottom: 0; }
</style>
