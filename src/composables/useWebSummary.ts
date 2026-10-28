import { computed, reactive, ref, watch, type Ref } from 'vue'
import { useVisualSummaryStore } from '../stores/visualSummary'
import { useChatStore, type LLMProfile } from '../stores/chat'
import type { ParsedSummaryInput } from '../utils/parsedSummary'
import type { WebSnapshotPreview } from '../types/webQa'

// These tasks outlive their view. Closing the preview must not close the separate
// HTML parser or cancel the model request.
const pending = new WeakMap<object, Map<string, Promise<ParsedSummaryInput>>>()
const captures = new WeakMap<object, Record<string, { busy: boolean; error: string; pageId: string }>>()
const revisions = new WeakMap<object, Map<string, number>>()
export function webSummaryHash(snapshot: WebSnapshotPreview) {
  return `${snapshot.id}:${snapshot.contentHash}:${snapshot.capturedAt}`
}

export function useWebSummary(selected: Ref<WebSnapshotPreview | null>) {
  const store = useVisualSummaryStore()
  const chat = useChatStore()
  if (!pending.has(store)) pending.set(store, new Map())
  if (!captures.has(store)) captures.set(store, reactive({}))
  if (!revisions.has(store)) revisions.set(store, new Map())
  const sourceRevisions = revisions.get(store)!
  const tasks = pending.get(store)!
  const captureStates = captures.get(store)!
  const cacheLoading = ref(false)
  const cacheError = ref('')
  const state = computed(() => selected.value ? store.states[`web:${selected.value.id}`] : undefined)
  const capture = computed(() => selected.value ? captureStates[selected.value.id] : undefined)
  const busy = computed(() => !!(capture.value?.busy || state.value?.preparing || state.value?.generating))
  const error = computed(() => capture.value?.error || state.value?.error || cacheError.value)
  const progress = computed(() => capture.value?.busy ? '正在解析已保存网页的正文与素材…' : state.value?.progress || '正在处理原文…')
  let version = 0
  watch(selected, async snapshot => {
    const current = ++version
    cacheError.value = ''
    cacheLoading.value = !!snapshot
    if (!snapshot) return
    try { await store.load('web', snapshot.id, webSummaryHash(snapshot)) }
    catch (cause) { if (version === current) cacheError.value = cause instanceof Error ? cause.message : '摘要读取失败' }
    finally { if (version === current) cacheLoading.value = false }
  }, { immediate: true })

  async function inputFor(snapshot: WebSnapshotPreview): Promise<ParsedSummaryInput> {
    const key = webSummaryHash(snapshot)
    const existing = tasks.get(key)
    if (existing) return existing
    const revision = sourceRevisions.get(snapshot.id) ?? 0
    const check = () => { if ((sourceRevisions.get(snapshot.id) ?? 0) !== revision) throw new Error('任务已取消') }
    const run = (async () => {
      captureStates[snapshot.id] = { busy: true, error: '', pageId: snapshot.pageId }
      try {
        const input = await window.db.documentSummary.parse('web', snapshot.id)
        check()
        if (input.kind !== 'web' || input.sourceId !== snapshot.id || input.sourceHash !== key) throw new Error('网页快照版本已变化，请重新选择后生成')
        return input
      } catch (cause) {
        if ((sourceRevisions.get(snapshot.id) ?? 0) === revision) captureStates[snapshot.id].error = cause instanceof Error ? cause.message : '网页解析失败'
        throw cause
      } finally { if ((sourceRevisions.get(snapshot.id) ?? 0) === revision) captureStates[snapshot.id].busy = false }
    })()
    tasks.set(key, run)
    try { return await run } finally { if (tasks.get(key) === run) tasks.delete(key) }
  }

  async function prepare(snapshot: WebSnapshotPreview) {
    const source = { ...snapshot }
    const profile = JSON.parse(JSON.stringify(chat.chatProfile)) as LLMProfile
    return store.prepare(await inputFor(source), profile)
  }
  async function generate(force = false) {
    if (!selected.value) throw new Error('请先保存或选择网页快照')
    const source = { ...selected.value }
    const profile = JSON.parse(JSON.stringify(chat.chatProfile)) as LLMProfile
    return store.generate(await inputFor(source), profile, force)
  }
  function cancel(sourceId = selected.value?.id) {
    if (!sourceId) return
    sourceRevisions.set(sourceId, (sourceRevisions.get(sourceId) ?? 0) + 1)
    if (captureStates[sourceId]) { captureStates[sourceId].busy = false; captureStates[sourceId].error = '' }
    for (const key of tasks.keys()) if (key.startsWith(`${sourceId}:`)) tasks.delete(key)
    store.cancel('web', sourceId)
  }
  function cancelPage(pageId: string) {
    for (const [sourceId, capture] of Object.entries(captureStates)) if (capture.pageId === pageId) cancel(sourceId)
    if (selected.value?.pageId === pageId) cancel(selected.value.id)
  }
  return { state, busy, error, progress, cacheLoading, prepare, generate, cancel, cancelPage }
}
