import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Paper {
  id: string
  title: string
  authors: string[]
  abstract: string
  year: number
  tags: string[]
  status: 'unread' | 'reading' | 'done'
  fileName: string
  addedAt: number
  knowledgeBaseId: string
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  color: string
  createdAt: number
}

export const usePaperStore = defineStore('paper', () => {
  const papers = ref<Paper[]>([])
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const loaded = ref(false)

  async function init() {
    if (loaded.value) return
    knowledgeBases.value = await window.db.kb.list()
    papers.value = await window.db.paper.list()
    loaded.value = true
  }

  async function addKnowledgeBase(name: string, description: string, color: string) {
    const kb: KnowledgeBase = { id: crypto.randomUUID(), name, description, color, createdAt: Date.now() }
    await window.db.kb.create(kb)
    knowledgeBases.value.push(kb)
    return kb
  }

  async function removeKnowledgeBase(id: string) {
    await window.db.kb.remove(id)
    knowledgeBases.value = knowledgeBases.value.filter(k => k.id !== id)
    papers.value = papers.value.filter(p => p.knowledgeBaseId !== id)
  }

  // paper includes fileData (base64); it is written to disk in the main process and not kept in memory
  async function addPaper(paper: Omit<Paper, 'id' | 'addedAt'> & { fileData: string }) {
    const id = crypto.randomUUID()
    const addedAt = Date.now()
    await window.db.paper.create({ ...paper, id, addedAt })
    const { fileData, ...meta } = paper
    papers.value.unshift({ ...meta, id, addedAt } as Paper)
    return id
  }

  async function removePaper(id: string) {
    await window.db.paper.remove(id)
    papers.value = papers.value.filter(p => p.id !== id)
  }

  async function updatePaper(id: string, patch: Partial<Paper>) {
    await window.db.paper.update(id, patch)
    const idx = papers.value.findIndex(p => p.id === id)
    if (idx !== -1) papers.value[idx] = { ...papers.value[idx], ...patch }
  }

  // read PDF binary (base64) on demand
  function readPaperFile(id: string): Promise<string | null> {
    return window.db.paper.readFile(id)
  }

  function getPapersByKb(kbId: string) {
    return computed(() => papers.value.filter(p => p.knowledgeBaseId === kbId))
  }

  function getPaper(id: string) {
    return papers.value.find(p => p.id === id)
  }

  return {
    papers, knowledgeBases, loaded, init,
    addKnowledgeBase, removeKnowledgeBase,
    addPaper, removePaper, updatePaper, readPaperFile,
    getPapersByKb, getPaper,
  }
})
