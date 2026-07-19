import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { SCHEMA } from './schema'

let db: Database.Database
let papersDir: string

export function initDb() {
  const userData = app.getPath('userData')
  const dbPath = join(userData, 'papermind.db')
  papersDir = join(userData, 'papers')
  mkdirSync(papersDir, { recursive: true })

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)

  // Seed default knowledge base
  const count = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get() as { n: number }).n
  if (count === 0) {
    db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('default', '默认知识库', '未分类论文', '#3db8a0', Date.now())
  }
}

// ---------- Knowledge Bases ----------
export const kbApi = {
  list: () => db.prepare('SELECT * FROM knowledge_bases ORDER BY created_at ASC').all(),
  create: (kb: { id: string; name: string; description: string; color: string; createdAt: number }) => {
    db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(kb.id, kb.name, kb.description, kb.color, kb.createdAt)
    return kb
  },
  remove: (id: string) => {
    // delete paper files on disk first
    const papers = db.prepare('SELECT file_path FROM papers WHERE knowledge_base_id = ?').all(id) as { file_path: string }[]
    for (const p of papers) if (existsSync(p.file_path)) unlinkSync(p.file_path)
    db.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id)
  },
}

// ---------- Papers ----------
export const paperApi = {
  list: () => {
    const rows = db.prepare('SELECT * FROM papers ORDER BY added_at DESC').all() as any[]
    return rows.map(deserializePaper)
  },
  get: (id: string) => {
    const row = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as any
    return row ? deserializePaper(row) : null
  },
  // create: fileData is base64; we write it to disk and store only the path
  create: (paper: any) => {
    const filePath = join(papersDir, `${paper.id}.pdf`)
    writeFileSync(filePath, Buffer.from(paper.fileData, 'base64'))
    db.prepare(`INSERT INTO papers
      (id, knowledge_base_id, title, authors, abstract, year, tags, status, file_name, file_path, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      paper.id, paper.knowledgeBaseId, paper.title, JSON.stringify(paper.authors ?? []),
      paper.abstract, paper.year, JSON.stringify(paper.tags ?? []), paper.status,
      paper.fileName, filePath, paper.addedAt,
    )
    return { ...paper, filePath }
  },
  update: (id: string, patch: any) => {
    const current = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as any
    if (!current) return
    const merged = {
      title: patch.title ?? current.title,
      authors: patch.authors !== undefined ? JSON.stringify(patch.authors) : current.authors,
      abstract: patch.abstract ?? current.abstract,
      year: patch.year ?? current.year,
      tags: patch.tags !== undefined ? JSON.stringify(patch.tags) : current.tags,
      status: patch.status ?? current.status,
      knowledge_base_id: patch.knowledgeBaseId ?? current.knowledge_base_id,
    }
    db.prepare(`UPDATE papers SET title=?, authors=?, abstract=?, year=?, tags=?, status=?, knowledge_base_id=? WHERE id=?`)
      .run(merged.title, merged.authors, merged.abstract, merged.year, merged.tags, merged.status, merged.knowledge_base_id, id)
  },
  remove: (id: string) => {
    const row = db.prepare('SELECT file_path FROM papers WHERE id = ?').get(id) as any
    if (row?.file_path && existsSync(row.file_path)) unlinkSync(row.file_path)
    db.prepare('DELETE FROM papers WHERE id = ?').run(id)
  },
  // read PDF binary as base64 for the renderer
  readFile: (id: string) => {
    const row = db.prepare('SELECT file_path FROM papers WHERE id = ?').get(id) as any
    if (!row?.file_path || !existsSync(row.file_path)) return null
    return readFileSync(row.file_path).toString('base64')
  },
}

function deserializePaper(row: any) {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    authors: JSON.parse(row.authors),
    abstract: row.abstract,
    year: row.year,
    tags: JSON.parse(row.tags),
    status: row.status,
    fileName: row.file_name,
    addedAt: row.added_at,
  }
}

// ---------- Conversations & Messages ----------
export const chatApi = {
  listConversations: () => {
    const convs = db.prepare('SELECT * FROM conversations ORDER BY created_at DESC').all() as any[]
    return convs.map(c => ({
      id: c.id,
      title: c.title,
      paperIds: JSON.parse(c.paper_ids),
      createdAt: c.created_at,
      messages: (db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC').all(c.id) as any[])
        .map(m => ({ id: m.id, role: m.role, content: m.content, sources: JSON.parse(m.sources), timestamp: m.timestamp })),
    }))
  },
  createConversation: (conv: { id: string; title: string; paperIds: string[]; createdAt: number }) => {
    db.prepare('INSERT INTO conversations (id, title, paper_ids, created_at) VALUES (?, ?, ?, ?)')
      .run(conv.id, conv.title, JSON.stringify(conv.paperIds), conv.createdAt)
    return { ...conv, messages: [] }
  },
  updateConversation: (id: string, patch: { title?: string; paperIds?: string[] }) => {
    const cur = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any
    if (!cur) return
    db.prepare('UPDATE conversations SET title=?, paper_ids=? WHERE id=?')
      .run(patch.title ?? cur.title, patch.paperIds ? JSON.stringify(patch.paperIds) : cur.paper_ids, id)
  },
  removeConversation: (id: string) => db.prepare('DELETE FROM conversations WHERE id = ?').run(id),
  addMessage: (msg: { id: string; conversationId: string; role: string; content: string; sources: string[]; timestamp: number }) => {
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, sources, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(msg.id, msg.conversationId, msg.role, msg.content, JSON.stringify(msg.sources), msg.timestamp)
  },
}

// ---------- Highlights ----------
export const highlightApi = {
  listByPaper: (paperId: string) =>
    db.prepare('SELECT * FROM highlights WHERE paper_id = ? ORDER BY created_at ASC').all(paperId),
  create: (h: { id: string; paperId: string; text: string; pageNum: number; color: string; note: string; createdAt: number }) => {
    db.prepare('INSERT INTO highlights (id, paper_id, text, page_num, color, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(h.id, h.paperId, h.text, h.pageNum, h.color, h.note, h.createdAt)
    return h
  },
  remove: (id: string) => db.prepare('DELETE FROM highlights WHERE id = ?').run(id),
}

// ---------- Settings (key-value, e.g. LLM config) ----------
export const settingsApi = {
  get: (key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row ? JSON.parse(row.value) : null
  },
  set: (key: string, value: unknown) => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  },
}

// ---------- Paper Indexes ----------
export const indexApi = {
  list: () => (db.prepare('SELECT paper_id FROM paper_indexes').all() as any[]).map(r => r.paper_id as string),
  get: (paperId: string) => {
    const row = db.prepare('SELECT index_json, pages_json FROM paper_indexes WHERE paper_id = ?').get(paperId) as any
    return row ? { indexJson: row.index_json, pagesJson: row.pages_json } : null
  },
  set: (paperId: string, indexJson: string, pagesJson: string) => {
    db.prepare('INSERT INTO paper_indexes (paper_id, index_json, pages_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(paper_id) DO UPDATE SET index_json=excluded.index_json, pages_json=excluded.pages_json, created_at=excluded.created_at')
      .run(paperId, indexJson, pagesJson, Date.now())
  },
}

export function exportAll() {
  return {
    knowledgeBases: kbApi.list(),
    papers: paperApi.list(),
    conversations: chatApi.listConversations(),
    settings: db.prepare('SELECT * FROM settings').all(),
  }
}

export function clearAll() {
  const papers = db.prepare('SELECT file_path FROM papers').all() as { file_path: string }[]
  for (const p of papers) if (existsSync(p.file_path)) unlinkSync(p.file_path)
  db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM highlights; DELETE FROM papers; DELETE FROM knowledge_bases; DELETE FROM settings;')
  db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('default', '默认知识库', '未分类论文', '#3db8a0', Date.now())
}
