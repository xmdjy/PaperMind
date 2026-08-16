<template>
  <div class="notes-panel">
    <div class="notes-header">
      <span class="notes-title">高亮与笔记</span>
      <span class="notes-count tabular-nums">{{ highlights.length }} 条</span>
    </div>
    <el-scrollbar class="notes-body">
      <div v-if="highlights.length === 0" class="notes-empty">
        暂无高亮。划词后在浮层点击「高亮」，即可在此写笔记。
      </div>
      <div v-for="h in highlights" :key="h.id" class="note-item">
        <button type="button" class="note-jump" @click="emit('jump', h.pageNum)">
          第 {{ h.pageNum }} 页
        </button>
        <div class="note-text">{{ h.text }}</div>
        <el-input
          v-model="h.note"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="写笔记…"
          @blur="save(h)"
        />
        <button type="button" class="note-del" @click="del(h.id)">删除</button>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { usePaperStore } from '../stores/paper'

const props = defineProps<{ paperId: string }>()
const emit = defineEmits<{ (e: 'jump', page: number): void }>()

const paperStore = usePaperStore()
const highlights = computed(() => paperStore.highlights)

onMounted(async () => {
  await paperStore.loadHighlights(props.paperId)
})
watch(() => props.paperId, (id) => {
  paperStore.loadHighlights(id)
})

function save(h: { id: string; note: string }) {
  paperStore.updateHighlight(h.id, { note: h.note })
}

async function del(id: string) {
  await ElMessageBox.confirm('删除这条高亮？', '删除', { type: 'warning' })
  await paperStore.removeHighlight(id)
}
</script>

<style scoped>
.notes-panel { display: flex; flex-direction: column; height: 100%; background: transparent; }
.notes-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
}
.notes-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.notes-count { font-size: 11px; color: var(--text-muted); background: var(--bg-hover); padding: 1px 7px; border-radius: 999px; }
.notes-body { flex: 1; padding: 12px; }
.notes-empty { font-size: 12px; color: var(--text-muted); text-align: center; padding: 24px 8px; line-height: 1.6; }
.note-item {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px; margin-bottom: 8px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-surface);
}
.note-jump {
  align-self: flex-start; border: none; background: var(--accent-dim); color: var(--accent);
  font-size: 11px; padding: 2px 8px; border-radius: 999px; cursor: pointer; font-family: inherit;
}
.note-jump:hover { background: color-mix(in srgb, var(--accent) 28%, transparent); }
.note-text {
  font-size: 12px; color: var(--text-secondary); line-height: 1.5;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.note-del {
  align-self: flex-end; border: none; background: transparent; color: var(--text-muted);
  font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 4px; font-family: inherit;
}
.note-del:hover { color: var(--danger); background: var(--bg-hover); }
</style>
