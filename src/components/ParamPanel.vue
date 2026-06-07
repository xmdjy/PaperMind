<template>
  <div class="param-panel">
    <div class="param-header">
      <h3>请求参数</h3>
      <el-icon class="collapse-btn" @click="$emit('close')"><DArrowRight /></el-icon>
    </div>

    <el-scrollbar class="param-body">
      <div class="param-section">
        <label>模型提供商</label>
        <el-select v-model="cfg.provider" @change="save" size="default" style="width:100%">
          <el-option label="OpenAI" value="openai" />
          <el-option label="Anthropic" value="anthropic" />
          <el-option label="Ollama (本地)" value="ollama" />
        </el-select>
      </div>

      <div class="param-section">
        <label>模型名称</label>
        <el-input v-model="cfg.model" @change="save" placeholder="gpt-4o / llama3…" />
      </div>

      <div class="param-section">
        <label>API 地址</label>
        <el-input v-model="cfg.baseUrl" @change="save" />
      </div>

      <div class="param-section" v-if="cfg.provider !== 'ollama'">
        <label>API Key</label>
        <el-input v-model="cfg.apiKey" @change="save" type="password" show-password placeholder="sk-…" />
      </div>

      <el-divider />

      <div class="param-section">
        <label>Temperature <span class="val">{{ cfg.temperature }}</span></label>
        <el-slider v-model="cfg.temperature" @change="save" :min="0" :max="2" :step="0.1" />
      </div>

      <div class="param-section">
        <label>Max Tokens <span class="val">{{ cfg.maxTokens }}</span></label>
        <el-slider v-model="cfg.maxTokens" @change="save" :min="256" :max="8192" :step="256" />
      </div>

      <el-divider />

      <div class="param-section">
        <label>系统提示词</label>
        <el-input v-model="cfg.systemPrompt" @change="save" type="textarea" :rows="6" resize="none" />
      </div>

      <div class="param-section">
        <label>提示词模板</label>
        <div class="prompt-templates">
          <div v-for="t in templates" :key="t.name" class="template-item" @click="applyTemplate(t.prompt)">
            <span class="template-name">{{ t.name }}</span>
            <el-icon><Right /></el-icon>
          </div>
        </div>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { DArrowRight, Right } from '@element-plus/icons-vue'
import { useChatStore } from '../stores/chat'
import { storeToRefs } from 'pinia'

defineEmits<{ (e: 'close'): void }>()
const chatStore = useChatStore()
const { config: cfg } = storeToRefs(chatStore)

function save() { chatStore.updateConfig(cfg.value) }

const templates = [
  { name: '逐段精读', prompt: '请逐段解析以下内容，解释关键概念、方法和结论。' },
  { name: '通俗解释', prompt: '请用通俗易懂的语言解释这段内容，假设我是该领域的初学者。' },
  { name: '提取要点', prompt: '请提取这段内容的核心要点，以列表形式呈现。' },
  { name: '批判性分析', prompt: '请批判性地分析这段内容的论证逻辑、潜在缺陷和未解决的问题。' },
  { name: '翻译为中文', prompt: '请将这段内容准确翻译为中文，保留专业术语。' },
]

function applyTemplate(prompt: string) {
  cfg.value.systemPrompt = prompt
  save()
}
</script>

<style scoped>
.param-panel { display: flex; flex-direction: column; height: 100%; background: var(--bg-surface); border-left: 1px solid var(--border); }
.param-header { display: flex; align-items: center; justify-content: space-between; padding: 16px; border-bottom: 1px solid var(--border); }
.param-header h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.collapse-btn { cursor: pointer; color: var(--text-muted); }
.collapse-btn:hover { color: var(--text-primary); }

.param-body { flex: 1; padding: 16px; }
.param-section { margin-bottom: 18px; }
.param-section label { display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; font-weight: 500; }
.param-section .val { color: var(--accent); float: right; }

.prompt-templates { display: flex; flex-direction: column; gap: 4px; }
.template-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; background: var(--bg-base); border: 1px solid var(--border);
  border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.15s; color: var(--text-secondary);
}
.template-item:hover { border-color: var(--accent); color: var(--accent); }
</style>
