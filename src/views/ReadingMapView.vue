<template>
  <div class="reading-map-view">
    <header class="map-heading">
      <div><p class="eyebrow">YOUR READING UNIVERSE</p><h1>阅读星图<span>本地资料的微光</span></h1></div>
      <button type="button" data-action="refresh-map" :disabled="loading || opening" @click="refresh">{{ loading ? '读取中…' : '刷新资料' }}</button>
    </header>
    <div class="map-workspace">
      <aside class="map-filters" aria-label="星图筛选">
        <p class="filter-heading">资料星群</p>
        <button v-for="filter in filters" :key="filter.value" type="button" :data-filter="filter.value" :aria-pressed="source === filter.value" @click="setFilter(filter.value)">
          <span>{{ filter.icon }} &nbsp;{{ filter.label }}</span><small>{{ count(filter.value) }}</small>
        </button>
        <label class="map-search">搜索星光<input aria-label="搜索资料标题" type="search" :value="query" placeholder="搜索资料标题…" @input="setQuery(($event.target as HTMLInputElement).value)" /></label>
        <div class="filter-note"><span class="local-dot" /> 本地资料<p>每颗亮星，都是你保存过的一份资料。<br />点击星光，回到阅读与对话。</p></div>
        <p class="filter-hint">PDF 续接最近对话；网页恢复最近会话的原快照。PDF 暂不保留上次页码。</p>
      </aside>
      <section class="map-stage" aria-label="本地阅读星空" :aria-busy="loading || opening">
        <ReadingStarMap :stars="visible" :total="stars.length" :disabled="opening" @open="openStar" />
        <div v-if="loading" class="map-message" role="status">正在读取本地资料…</div>
        <div v-else-if="error" class="map-message error" role="alert"><strong>资料暂时无法打开</strong><p>{{ error }}</p><p>点击“刷新资料”重新读取本地记录。</p></div>
        <div v-else-if="!stars.length" class="map-message" data-state="empty"><strong>星空正等着第一束光</strong><p>在文献库导入 PDF，或在网页问答保存网页后，它们会出现在这里。</p><router-link to="/library">打开文献库</router-link></div>
        <div v-else-if="!visible.length" class="map-message" data-state="no-results"><strong>没有匹配的资料</strong><p>试试其他标题或资料类型。</p><button type="button" @click="clearFilters">清除筛选</button></div>
        <footer class="map-status" aria-live="polite"><span>{{ visible.length }} / {{ stars.length }} 份资料<span v-if="opening"> · 正在打开…</span></span><span>亮星为真实资料 · 星尘仅作装饰</span></footer>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ReadingStarMap from '../components/ReadingStarMap.vue'
import { buildReadingMap, filterReadingMap, readingMapTarget, type ReadingFilter, type ReadingStar } from '../utils/readingMap'

const route = useRoute()
const router = useRouter()
const stars = ref<ReadingStar[]>([])
const loading = ref(true)
const opening = ref(false)
const error = ref('')
let generation = 0
const filters: Array<{ value: ReadingFilter; label: string; icon: string }> = [
  { value: 'all', label: '全部星光', icon: '✦' }, { value: 'web', label: '网页', icon: '◎' }, { value: 'pdf', label: '文档 PDF', icon: '▤' },
]
const source = computed<ReadingFilter>(() => route.query.source === 'web' || route.query.source === 'pdf' ? route.query.source : 'all')
const query = computed(() => typeof route.query.q === 'string' ? route.query.q : '')
const visible = computed(() => filterReadingMap(stars.value, source.value, query.value))
const count = (filter: ReadingFilter) => filter === 'all' ? stars.value.length : stars.value.filter(star => star.source === filter).length
function setFilter(value: ReadingFilter) { void router.replace({ query: { ...route.query, source: value === 'all' ? undefined : value } }) }
function setQuery(value: string) { void router.replace({ query: { ...route.query, q: value || undefined } }) }
function clearFilters() { void router.replace({ query: {} }) }

async function refresh() {
  const version = ++generation
  loading.value = true
  error.value = ''
  try {
    const [papers, pages, conversations] = await Promise.all([window.db.paper.list(), window.db.webQa.listPages(), window.db.chat.listConversations()])
    if (version === generation) stars.value = buildReadingMap(papers, pages, conversations)
  } catch (cause) {
    if (version === generation) error.value = cause instanceof Error ? cause.message : '本地资料读取失败'
  } finally { if (version === generation) loading.value = false }
}

async function openStar(star: ReadingStar) {
  if (opening.value || loading.value) return
  const version = generation
  opening.value = true
  error.value = ''
  try {
    const exists = star.source === 'pdf' ? await window.db.paper.get(star.sourceId)
      : (await window.db.webQa.listPages()).find(page => page.id === star.sourceId)
    if (version !== generation) return
    if (!exists) throw new Error('这份资料已不存在，刷新星图后重试。')
    await router.push(readingMapTarget(star))
  } catch (cause) { if (version === generation) error.value = cause instanceof Error ? cause.message : '资料未能打开，请重试。' }
  finally { if (version === generation) opening.value = false }
}
onMounted(refresh)
onBeforeUnmount(() => { generation++ })
</script>

<style scoped>
.reading-map-view { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--bg-base); }
.map-heading { min-height: 104px; padding: 23px 32px; display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.eyebrow { font-size: 9px; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 8px; }
h1 { font-size: 24px; font-weight: 600; margin: 0; letter-spacing: 2px; }
h1 span { font-size: 11px; letter-spacing: 1px; color: var(--text-muted); margin-left: 18px; font-weight: 400; }
button { cursor: pointer; font: inherit; }
.map-heading > button { border: 1px solid var(--border); background: var(--bg-surface); border-radius: 7px; padding: 9px 14px; color: var(--text-secondary); font-size: 12px; }
.map-workspace { display: flex; flex: 1; min-height: 0; padding: 0 24px 24px 0; }
.map-filters { width: 184px; padding: 20px 18px 20px 24px; flex-shrink: 0; overflow-y: auto; }
.filter-heading { font-size: 10px; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 19px; }
.map-filters > button { display: flex; width: 100%; justify-content: space-between; align-items: center; border: 0; border-radius: 6px; padding: 11px 10px; margin: 4px 0; color: var(--text-secondary); background: transparent; font-size: 12px; }
.map-filters > button[aria-pressed=true] { background: var(--bg-surface); color: var(--accent); box-shadow: var(--shadow-sm); }
.map-filters small { font-size: 10px; color: var(--text-muted); }
.map-search { display: block; margin-top: 28px; color: var(--text-muted); font-size: 10px; }
.map-search input { display: block; width: 100%; margin-top: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-surface); color: var(--text-primary); font-size: 11px; }
.filter-note { border-top: 1px solid var(--border); margin-top: 32px; padding-top: 20px; font-size: 10px; color: var(--text-secondary); }
.filter-note p, .filter-hint { font-size: 10px; line-height: 1.9; color: var(--text-muted); margin-top: 12px; }
.local-dot { display: inline-block; background: #6c9779; width: 5px; height: 5px; border-radius: 50%; margin-right: 5px; }
.map-stage { position: relative; flex: 1; min-width: 0; min-height: 0; background: #080f22; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 28px #10162c20; }
.map-message { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 38px; text-align: center; color: #b6c8df; background: #080f22c9; pointer-events: none; }
.map-message p { max-width: 410px; font-size: 12px; line-height: 1.8; }
.map-message strong { color: #e4eefa; font-size: 17px; font-weight: 500; letter-spacing: 1px; }
.map-message button, .map-message a { pointer-events: auto; color: #bcd8ff; background: #1a2b49; border: 1px solid #3b506c; border-radius: 6px; padding: 9px 16px; font-size: 12px; }
.map-message.error strong { color: #f0c9a8; }
.map-status { pointer-events: none; position: absolute; bottom: 0; left: 0; right: 0; padding: 16px 22px; display: flex; justify-content: space-between; gap: 12px; font-size: 10px; letter-spacing: .5px; color: #7e91af; background: linear-gradient(transparent, #080f22); }
button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
button:disabled { cursor: wait; opacity: .6; }
@media(max-width: 900px) { .map-heading { padding: 20px; } .map-workspace { padding: 0 14px 14px 0; } .map-filters { width: 160px; padding: 18px 14px; } h1 span { display: none; } }
@media(max-width: 600px) { .map-workspace { flex-direction: column; padding: 0 10px 10px; } .map-filters { width: 100%; padding: 0 0 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; overflow: visible; } .filter-heading, .filter-note, .filter-hint { display: none; } .map-filters > button { width: auto; flex: 1; gap: 8px; margin: 0; } .map-search { margin: 0; width: 100%; font-size: 0; } .map-search input { margin: 0; } .map-stage { min-height: 300px; } .map-status { font-size: 9px; padding: 12px; } .map-status > span:last-child { max-width: 125px; } }
</style>
