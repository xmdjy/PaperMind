<template>
  <div ref="mapRoot" class="star-map" tabindex="-1" @keydown.esc.stop.prevent="dismissDetail()" @focusout="onFocusOut">
    <div class="sky-toolbar"><span>LOCAL CONSTELLATION <small>本地阅读轨迹</small></span><button type="button" :aria-pressed="listMode" @click="listMode = !listMode">{{ listMode ? '星空视图' : '资料列表' }}</button></div>
    <div v-if="!listMode" class="sky-scroll" aria-label="可滚动星空">
      <div class="sky-field" :style="fieldStyle">
        <div class="nebula" aria-hidden="true" />
        <i v-for="(dust, index) in dusts" :key="index" class="dust" :style="dust" aria-hidden="true" />
        <span class="sky-coordinate coordinate-one" aria-hidden="true">ORBIT / 01</span><span class="sky-coordinate coordinate-two" aria-hidden="true">THE QUIET BETWEEN IDEAS</span>
        <button v-for="star in stars" :key="star.id" type="button" class="document-star" :class="[star.source, { selected: focused?.id === star.id }]"
          :style="{ left: star.position.x + '%', top: star.position.y + '%' }" data-reading-star :disabled="disabled"
          :aria-label="`${star.source === 'pdf' ? 'PDF' : '网页'}：${star.title}，打开阅读历史`"
          @mouseenter="showDetail(star.id, $event, false)" @mouseleave="leaveStar" @focus="showDetail(star.id, $event, true)" @click="$emit('open', star)">
          <span class="star-halo" aria-hidden="true"><span class="star-core" /></span>
        </button>
      </div>
    </div>
    <div v-else class="star-list" aria-label="全部匹配资料">
      <button v-for="star in stars" :key="star.id" type="button" data-reading-star :disabled="disabled" @click="$emit('open', star)">
        <span class="list-source">{{ star.source === 'pdf' ? '▤ PDF' : '◎ 网页' }}</span><span class="list-title">{{ star.title }}</span><small>{{ star.conversationCount }} 个会话 ↗</small>
      </button>
    </div>
    <ElPopover :visible="!listMode && !!focused" :virtual-ref="anchorElement" virtual-triggering placement="bottom" :offset="5"
      :teleported="false" :persistent="false" :show-arrow="false" :width="previewWidth" :popper-options="popperOptions"
      :popper-style="{ padding: '0', border: '0', background: 'transparent', boxShadow: 'none' }" transition="">
    <div v-if="!listMode && focused" class="star-detail" aria-live="polite" @mouseenter="enterPreview" @mouseleave="leavePreview" @focusin="focusWithin = true">
      <button type="button" class="dismiss-detail" aria-label="关闭资料详情" @click="dismissDetail(true)">×</button>
      <span class="detail-source">{{ focused.source === 'pdf' ? 'PDF DOCUMENT' : 'SAVED WEBPAGE' }}</span>
      <strong>{{ focused.title }}</strong><p class="detail-origin">{{ focused.detail }}</p>
      <div><span>{{ focused.activityLabel }} · {{ formatDate(focused.activityAt) }}</span><span>{{ focused.conversationCount }} 个会话</span></div>
      <button type="button" :disabled="disabled" @click="$emit('open', focused)">回到阅读 <span aria-hidden="true">↗</span></button>
    </div>
    </ElPopover>
    <div v-if="!listMode && !focused" class="sky-instruction">寻找一颗亮星<span>悬停或 Tab 查看资料 · 点击继续阅读</span></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ElPopover } from 'element-plus'
import { starPosition, type ReadingStar } from '../utils/readingMap'
const props = defineProps<{ stars: ReadingStar[]; total: number; disabled?: boolean }>()
defineEmits<{ open: [star: ReadingStar] }>()
const focusedId = ref<string | null>(null)
const focused = computed(() => props.stars.find(star => star.id === focusedId.value) ?? null)
const mapRoot = ref<HTMLElement>()
const anchorElement = shallowRef<HTMLElement>()
const previewWidth = ref(260)
const popperOptions = computed(() => ({ modifiers: [
  { name: 'preventOverflow', options: { boundary: mapRoot.value, padding: 10 } },
  { name: 'flip', options: { boundary: mapRoot.value, padding: 10, fallbackPlacements: ['top', 'bottom-start', 'bottom-end'] } },
] }))
let hideTimer: ReturnType<typeof setTimeout> | undefined
let hoveringStar = false
let hoveringPreview = false
const focusWithin = ref(false)
const listMode = ref(false)
const fieldStyle = computed(() => props.total <= 120 ? {} : ({ minWidth: `${Math.sqrt(props.total) * 90}px`, minHeight: `${Math.sqrt(props.total) * 70}px` }))
const dusts = Array.from({ length: 360 }, (_, index) => {
  const position = starPosition(`decorative-dust-${index}`)
  return { left: position.x + '%', top: position.y + '%', opacity: .12 + (index % 7) * .065, width: index % 19 === 0 ? '2px' : '1px', height: index % 19 === 0 ? '2px' : '1px' }
})
function formatDate(timestamp: number) { return new Date(timestamp).toLocaleDateString('zh-CN') }
function cancelHide() { clearTimeout(hideTimer) }
function showDetail(id: string, event: Event, keyboard: boolean) {
  cancelHide()
  const target = event.currentTarget as HTMLElement
  if (focusedId.value !== id) {
    hoveringStar = false
    hoveringPreview = false
    focusWithin.value = false
  }
  focusedId.value = id
  anchorElement.value = target
  previewWidth.value = Math.min(260, (mapRoot.value?.clientWidth || 280) - 20)
  if (keyboard) focusWithin.value = true
  else hoveringStar = true
}
function scheduleHide() {
  cancelHide()
  // Keep the short gap between the star and its preview traversable by pointer.
  hideTimer = setTimeout(() => {
    if (!hoveringStar && !hoveringPreview && !focusWithin.value) focusedId.value = null
  }, 120)
}
function leaveStar() { hoveringStar = false; scheduleHide() }
function enterPreview() { hoveringPreview = true; cancelHide() }
function leavePreview() { hoveringPreview = false; scheduleHide() }
function onFocusOut(event: FocusEvent) {
  const target = event.relatedTarget
  if (target instanceof Element && (target.closest('.star-detail') || target === anchorElement.value)) return
  focusWithin.value = false
  scheduleHide()
}
function dismissDetail(moveFocus = false) {
  cancelHide()
  hoveringStar = false
  hoveringPreview = false
  focusWithin.value = false
  focusedId.value = null
  if (moveFocus) void nextTick(() => mapRoot.value?.focus())
}
watch(listMode, () => dismissDetail())
onBeforeUnmount(cancelHide)
</script>

<style scoped>
.star-map { height: 100%; position: relative; color: #c4d2e8; background: radial-gradient(ellipse at 54% 42%, #142444 0, #0b162b 41%, #080f22 80%); }
.sky-toolbar { position: absolute; z-index: 2; top: 0; left: 0; right: 0; padding: 23px 25px; display: flex; justify-content: space-between; gap: 10px; align-items: center; pointer-events: none; background: linear-gradient(#080f22e8, transparent); }
.sky-toolbar > span { font-size: 9px; letter-spacing: 2px; color: #7d91b2; }
.sky-toolbar small { margin-left: 10px; font-size: 9px; letter-spacing: 1px; color: #65768f; }
.sky-toolbar button { pointer-events: auto; border: 1px solid #35435f; border-radius: 5px; padding: 6px 9px; background: #15223b; color: #aebed4; font-size: 10px; cursor: pointer; }
.sky-scroll { position: absolute; inset: 65px 0 44px; overflow: auto; scrollbar-color: #304262 #0a1428; scrollbar-width: thin; }
.sky-field { position: relative; height: 100%; width: 100%; isolation: isolate; }
.nebula { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 60% 35%, #3271a911, transparent 40%), radial-gradient(ellipse at 28% 70%, #796c9b12, transparent 40%); }
.dust { position: absolute; background: #b9d7ff; border-radius: 50%; pointer-events: none; box-shadow: 0 0 3px #7ba7dd40; }
.sky-coordinate { position: absolute; color: #536681; font-size: 8px; letter-spacing: 2px; pointer-events: none; opacity: .55; }
.coordinate-one { left: 9%; top: 12%; }.coordinate-two { right: 8%; bottom: 13%; writing-mode: vertical-rl; }
.document-star { position: absolute; transform: translate(-50%, -50%); width: 42px; height: 42px; display: grid; place-items: center; border: 0; border-radius: 50%; background: transparent; color: #b7d5f6; cursor: pointer; z-index: 1; }
.star-halo { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle, #a7d4ff40, #7ab9ff08 47%, transparent 70%); }
.star-core { width: 5px; height: 5px; background: #e4f4ff; border-radius: 50%; box-shadow: 0 0 5px #e1f3ff, 0 0 13px #7cb9ff, 0 0 27px #4f96e5b0; }
.pdf .star-core { background: #ffe4bc; box-shadow: 0 0 6px #ffe7be, 0 0 15px #d2b28d, 0 0 24px #e2b66b60; }
.document-star:hover, .document-star:focus-visible, .document-star.selected { z-index: 3; }
.document-star:hover .star-halo, .document-star:focus-visible .star-halo { background: #a7d4ff21; outline: 1px solid #9abce35e; }
.document-star:focus-visible { outline: 1px solid #d4e7ff; outline-offset: 4px; }
.star-detail { position: relative; width: 100%; background: #111e34f5; border: 1px solid #7ca6cd35; border-radius: 8px; padding: 13px 14px 11px; box-shadow: 0 8px 24px #02071077; backdrop-filter: blur(10px); }
.detail-source { color: #779bbf; font-size: 8px; letter-spacing: 1.5px; }
.star-detail strong { display: block; font-size: 12px; line-height: 1.6; font-weight: 500; margin-top: 7px; color: #d9e8f9; overflow-wrap: anywhere; max-height: 60px; overflow: auto; }
.detail-origin { font-size: 10px; color: #8294af; margin: 7px 0 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.star-detail > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 9px; color: #91a2b9; }
.star-detail button { width: 100%; margin-top: 14px; padding: 9px 1px 0; display: flex; justify-content: space-between; color: #adcdf0; background: transparent; border: 0; border-top: 1px solid #314360; text-align: left; font-size: 11px; cursor: pointer; }
.star-detail .dismiss-detail { position: absolute; top: 7px; right: 8px; width: 28px; height: 28px; margin: 0; padding: 0; border: 0; justify-content: center; align-items: center; border-radius: 4px; color: #9bb3ce; font-size: 18px; }
.dismiss-detail:hover { background: #a7d4ff15; }
.sky-instruction { position: absolute; bottom: 76px; left: 24px; color: #b3c5dd; font-size: 13px; letter-spacing: 2px; pointer-events: none; }
.sky-instruction span { display: block; margin-top: 9px; font-size: 9px; color: #7086a4; letter-spacing: 1px; }
.star-list { position: absolute; inset: 70px 0 47px; overflow: auto; padding: 0 24px; }
.star-list > button { display: flex; align-items: center; width: 100%; gap: 14px; text-align: left; padding: 16px 10px; border: 0; border-bottom: 1px solid #2a3e5c; background: transparent; color: #bed0e8; cursor: pointer; }
.list-source { font-size: 10px; color: #91a5bf; flex-shrink: 0; }.list-title { flex: 1; overflow-wrap: anywhere; font-size: 12px; }.star-list small { font-size: 9px; flex-shrink: 0; }
button:focus-visible { outline: 2px solid #b7d6fc; outline-offset: 3px; }button:disabled { cursor: wait; }
@media(max-width: 900px) { .sky-toolbar small { display: none; } .sky-toolbar { padding: 20px 16px; }.star-list { padding-left: 12px; padding-right: 12px; }.star-list > button { flex-wrap: wrap; gap: 8px; } }
</style>
