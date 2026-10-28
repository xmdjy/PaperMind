import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { LLMProfile } from './chat'
import { isParsedDocument } from '../utils/doclingDocument'
import { parsedSummaryFingerprint, PARSED_SUMMARY_PROMPT_VERSION, requestParsedSummary, type ParsedSummaryInput } from '../utils/parsedSummary'
import { replaceSummaryAssets, type VisualReport, type VisualSummaryResult } from '../utils/visualSummary'

export interface VisualSummaryState { preparing: boolean; generating: boolean; progress: string; error: string; content: string; report: VisualReport | null; truncated: boolean }
interface ParsedReport extends VisualReport { fingerprint: string; parserKey: string }

// Keep the existing application-owned lifecycle so jobs survive route changes.
export const useVisualSummaryStore = defineStore('visualSummary', () => {
  const states = ref<Record<string, VisualSummaryState>>({})
  const generations = new Map<string, Promise<VisualSummaryResult>>()
  const preparations = new Map<string, Promise<ParsedSummaryInput>>()
  const generationQueues = new Map<string, Promise<VisualSummaryResult>>()
  const controllers = new Map<string, AbortController>()
  const revisions = new Map<string, number>()
  const sourceVersions = new Map<string, string>()
  const keyOf = (kind: string, id: string) => `${kind}:${id}`
  const stateFor = (key: string) => states.value[key] ??= { preparing: false, generating: false, progress: '', error: '', content: '', report: null, truncated: false }
  function check(key: string, revision: number) {
    if ((revisions.get(key) ?? 0) !== revision) throw new Error('任务已取消或来源版本已变更')
  }
  function cancel(kind: 'paper' | 'web', sourceId: string) {
    const key = keyOf(kind, sourceId)
    revisions.set(key, (revisions.get(key) ?? 0) + 1)
    controllers.get(key)?.abort()
    preparations.delete(key)
    const state = stateFor(key)
    state.preparing = false; state.generating = false; state.progress = '已取消'; state.error = ''
  }
  function bindVersion(input: ParsedSummaryInput) {
    const key = keyOf(input.kind, input.sourceId), version = `${input.sourceHash}:${input.parserKey}`
    const old = sourceVersions.get(key)
    if (old && old !== version) {
      cancel(input.kind, input.sourceId)
      const state = stateFor(key)
      state.report = null; state.content = ''; state.truncated = false
    }
    sourceVersions.set(key, version)
  }
  async function load(kind: 'paper' | 'web', sourceId: string, sourceHash?: string) {
    const key = keyOf(kind, sourceId), state = stateFor(key), revision = revisions.get(key) ?? 0
    if (sourceHash && state.report && state.report.sourceHash !== sourceHash) { state.report = null; state.content = ''; state.truncated = false }
    if (state.generating || state.preparing) return state
    const row = await window.db.documentSummary.get(kind, sourceId, 'report')
    if ((revisions.get(key) ?? 0) !== revision || state.generating || state.preparing) return state
    if (row && (!sourceHash || row.sourceHash === sourceHash)) {
      try {
        const report = JSON.parse(row.payload) as VisualReport
        if (typeof report.content === 'string') { state.report = report; state.content = report.content; state.truncated = report.truncated }
      } catch { state.error = '已保存摘要无法读取，请重新生成' }
    }
    const task = await window.db.documentSummary.get(kind, sourceId, 'task')
    if ((revisions.get(key) ?? 0) !== revision || state.generating || state.preparing) return state
    if (task) {
      try {
        const saved = JSON.parse(task.payload)
        if (!['completed', 'failed', 'cancelled'].includes(saved.phase)) state.progress = '上次任务未完成，请重试'
        if (saved.phase === 'failed') state.error = saved.error || '上次摘要任务失败，请重试'
      } catch { /* An invalid marker must not hide a readable historical report. */ }
    }
    return state
  }
  async function prepare(input: ParsedSummaryInput, _profile?: LLMProfile): Promise<ParsedSummaryInput> {
    if (!isParsedDocument(input.document) || !input.document.items.length) throw new Error('原文未解析出可用于摘要的材料')
    bindVersion(input)
    return input
  }
  async function parseSource(kind: 'paper' | 'web', sourceId: string) {
    const key = keyOf(kind, sourceId), existing = preparations.get(key)
    if (existing) return existing
    const revision = revisions.get(key) ?? 0, state = stateFor(key)
    state.preparing = true; state.error = ''; state.progress = kind === 'paper' ? '正在解析论文正文、图表与公式…' : '正在解析已保存网页的正文与素材…'
    const task = Promise.resolve().then(async () => {
      try {
        const input = await window.db.documentSummary.parse(kind, sourceId)
        check(key, revision)
        if (input.kind !== kind || input.sourceId !== sourceId) throw new Error('解析结果与当前原文不匹配')
        return input
      } catch (cause) {
        if ((revisions.get(key) ?? 0) === revision) state.error = cause instanceof Error ? cause.message : '原文解析失败'
        throw cause
      } finally {
        if ((revisions.get(key) ?? 0) === revision) state.preparing = false
        if (preparations.get(key) === task) preparations.delete(key)
      }
    })
    preparations.set(key, task)
    return task
  }
  async function generate(input: ParsedSummaryInput, requestedProfile: LLMProfile, force = false, previous = ''): Promise<VisualSummaryResult> {
    const prepared = prepare(input)
    const profile = { ...requestedProfile }, key = keyOf(input.kind, input.sourceId), state = stateFor(key)
    const revision = revisions.get(key) ?? 0
    await prepared
    check(key, revision)
    const fingerprint = await parsedSummaryFingerprint(input, profile)
    check(key, revision)
    const versionKey = `${key}:${revision}:${fingerprint}:${force}:${previous}`
    const ongoing = generations.get(versionKey)
    if (ongoing) return ongoing
    // Distinct model requests for one source are serialized; cache identities remain independent.
    const prior = generationQueues.get(key)
    const task = (async () => {
      if (prior) await prior.catch(() => {})
      check(key, revision)
      state.generating = true; state.error = ''
      const persistTask = (phase: string, error?: string) => window.db.documentSummary.save({ kind: input.kind, sourceId: input.sourceId, slot: 'task', sourceHash: input.sourceHash, payload: JSON.stringify({ phase, error, model: profile.model }) })
      let controller: AbortController | undefined
      try {
        const row = await window.db.documentSummary.get(input.kind, input.sourceId, 'report')
        check(key, revision)
        let report = state.report as ParsedReport | null
        if (!report && row?.sourceHash === input.sourceHash) {
          try { report = JSON.parse(row.payload) } catch { /* Regenerate a damaged report. */ }
        }
        if (previous && row && row.sourceHash !== input.sourceHash) throw new Error('原文版本已变化，请重新生成摘要，不能继续旧版本摘要')
        const reusable = report?.sourceHash === input.sourceHash && report.fingerprint === fingerprint && report.promptVersion === PARSED_SUMMARY_PROMPT_VERSION
        if (reusable && report && !force && !report.truncated && !previous) {
          state.report = report; state.content = report.content; state.truncated = report.truncated
          return report
        }
        const sameSource = report?.sourceHash === input.sourceHash
        if (previous && sameSource && report?.parserKey && report.parserKey !== input.parserKey) throw new Error('解析版本已变化，请重新生成摘要，不能继续旧版本摘要')
        const continuation = sameSource && report && report.truncated && (!report.parserKey || report.parserKey === input.parserKey)
          && (!previous || report.content.endsWith(previous)) && !force ? report.content : previous
        controller = new AbortController()
        controllers.set(key, controller)
        state.progress = '正在根据全文、图表与公式生成摘要…'
        await persistTask('summarizing')
        check(key, revision)
        const result = await requestParsedSummary(input, profile, continuation, controller.signal)
        check(key, revision)
        const allowed = new Set(input.document.items.flatMap(item => item.images.flatMap(image => image.assetId ? [image.assetId] : [])))
        const content = replaceSummaryAssets((continuation ? continuation + '\n\n' : '') + result.content, allowed)
        const next: ParsedReport = { ...result, content, fingerprint, parserKey: input.parserKey, sourceHash: input.sourceHash, model: profile.model, promptVersion: PARSED_SUMMARY_PROMPT_VERSION, createdAt: Date.now() }
        await window.db.documentSummary.save({ kind: input.kind, sourceId: input.sourceId, slot: 'report', sourceHash: input.sourceHash, payload: JSON.stringify(next) })
        check(key, revision)
        await persistTask('completed')
        check(key, revision)
        state.report = next; state.content = content; state.truncated = next.truncated
        state.progress = next.truncated ? '摘要被截断，可继续生成' : '摘要已完成'
        return { ...next, delta: continuation ? content.slice(continuation.length).trimStart() : content }
      } catch (cause) {
        if ((revisions.get(key) ?? 0) === revision) {
          state.error = cause instanceof Error ? cause.message : '摘要生成失败'
          await persistTask('failed', state.error).catch(() => {})
        }
        throw cause
      } finally {
        if ((revisions.get(key) ?? 0) === revision) state.generating = false
        if (controller && controllers.get(key) === controller) controllers.delete(key)
      }
    })()
    generations.set(versionKey, task)
    generationQueues.set(key, task)
    try { return await task } finally {
      if (generations.get(versionKey) === task) generations.delete(versionKey)
      if (generationQueues.get(key) === task) generationQueues.delete(key)
    }
  }
  async function preparePaper(paperId: string, _profile?: LLMProfile) {
    return parseSource('paper', paperId)
  }
  async function generatePaper(paperId: string, profile: LLMProfile, force = false, previous = '') {
    const key = keyOf('paper', paperId), revision = revisions.get(key) ?? 0, state = stateFor(key)
    state.generating = true
    try {
      const input = await parseSource('paper', paperId)
      check(key, revision)
      return await generate(input, profile, force, previous)
    } catch (cause) {
      if ((revisions.get(key) ?? 0) === revision) { state.error = cause instanceof Error ? cause.message : 'PDF 摘要失败'; state.generating = false }
      throw cause
    }
  }
  return { states, prepare, generate, preparePaper, generatePaper, load, cancel }
})
