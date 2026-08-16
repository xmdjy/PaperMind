import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs'
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

  // Migration: highlight character offsets (added 2026-08-16)
  const highlightCols = (db.prepare('PRAGMA table_info(highlights)').all() as Array<{ name: string }>).map(c => c.name)
  if (!highlightCols.includes('start_offset')) db.exec('ALTER TABLE highlights ADD COLUMN start_offset INTEGER DEFAULT 0')
  if (!highlightCols.includes('end_offset')) db.exec('ALTER TABLE highlights ADD COLUMN end_offset INTEGER DEFAULT 0')

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
  listByPaper: (paperId: string) => {
    const rows = db.prepare('SELECT * FROM highlights WHERE paper_id = ? ORDER BY created_at ASC').all(paperId) as any[]
    return rows.map(r => ({
      id: r.id,
      paperId: r.paper_id,
      text: r.text,
      pageNum: r.page_num,
      color: r.color,
      note: r.note,
      startOffset: r.start_offset,
      endOffset: r.end_offset,
      createdAt: r.created_at,
    }))
  },
  create: (h: { id: string; paperId: string; text: string; pageNum: number; color: string; note: string; startOffset?: number; endOffset?: number; createdAt: number }) => {
    db.prepare('INSERT INTO highlights (id, paper_id, text, page_num, color, note, start_offset, end_offset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(h.id, h.paperId, h.text, h.pageNum, h.color, h.note, h.startOffset ?? 0, h.endOffset ?? 0, h.createdAt)
    return h
  },
  remove: (id: string) => db.prepare('DELETE FROM highlights WHERE id = ?').run(id),
  update: (id: string, patch: { note?: string }) => {
    const cur = db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as any
    if (!cur) return
    db.prepare('UPDATE highlights SET note = ? WHERE id = ?').run(patch.note ?? cur.note, id)
  },
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
  const paperRows = db.prepare('SELECT * FROM papers ORDER BY added_at DESC').all() as any[]
  const papers = paperRows.map(row => ({
    ...deserializePaper(row),
    fileData: existsSync(row.file_path) ? readFileSync(row.file_path).toString('base64') : null,
  }))
  return {
    version: 1,
    exportedAt: Date.now(),
    knowledgeBases: kbApi.list(),
    papers,
    conversations: chatApi.listConversations(),
    highlights: db.prepare('SELECT * FROM highlights').all(),
    paperIndexes: db.prepare('SELECT paper_id, index_json, pages_json FROM paper_indexes').all(),
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

export function importAll(data: any) {
  if (!data || data.version !== 1) throw new Error('不支持的备份文件格式（version 必须为 1）')

  const kbs = Array.isArray(data.knowledgeBases) ? data.knowledgeBases : []
  const papers = Array.isArray(data.papers) ? data.papers : []
  const conversations = Array.isArray(data.conversations) ? data.conversations : []
  const highlights = Array.isArray(data.highlights) ? data.highlights : []
  const indexes = Array.isArray(data.paperIndexes) ? data.paperIndexes : []
  const settings = Array.isArray(data.settings) ? data.settings : []

  // 1) 先写回备份中的 PDF（幂等覆盖，不影响旧库）
  for (const p of papers) {
    if (p && typeof p.id === 'string' && typeof p.fileData === 'string') {
      writeFileSync(join(papersDir, `${p.id}.pdf`), Buffer.from(p.fileData, 'base64'))
    }
  }

  // 2) DB 事务：清空旧行并按依赖顺序写入
  const insert = db.transaction(() => {
    db.exec('DELETE FROM messages; DELETE FROM conversations; DELETE FROM highlights; DELETE FROM paper_indexes; DELETE FROM papers; DELETE FROM knowledge_bases; DELETE FROM settings;')

    for (const kb of kbs) {
      db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(kb.id, kb.name, kb.description ?? '', kb.color ?? '#3db8a0', kb.createdAt ?? Date.now())
    }

    for (const p of papers) {
      db.prepare(`INSERT INTO papers
        (id, knowledge_base_id, title, authors, abstract, year, tags, status, file_name, file_path, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(p.id, p.knowledgeBaseId, p.title ?? '', JSON.stringify(p.authors ?? []),
          p.abstract ?? '', p.year ?? 0, JSON.stringify(p.tags ?? []), p.status ?? 'unread',
          p.fileName ?? '', join(papersDir, `${p.id}.pdf`), p.addedAt ?? Date.now())
    }

    for (const c of conversations) {
      db.prepare('INSERT INTO conversations (id, title, paper_ids, created_at) VALUES (?, ?, ?, ?)')
        .run(c.id, c.title, JSON.stringify(c.paperIds ?? []), c.createdAt ?? Date.now())
      for (const m of (c.messages ?? [])) {
        db.prepare('INSERT INTO messages (id, conversation_id, role, content, sources, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
          .run(m.id, c.id, m.role, m.content, JSON.stringify(m.sources ?? []), m.timestamp ?? Date.now())
      }
    }

    for (const h of highlights) {
      db.prepare('INSERT INTO highlights (id, paper_id, text, page_num, color, note, start_offset, end_offset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(h.id, h.paper_id ?? h.paperId, h.text, h.page_num ?? h.pageNum ?? 0, h.color ?? '#c9a84c',
          h.note ?? '', h.start_offset ?? h.startOffset ?? 0, h.end_offset ?? h.endOffset ?? 0,
          h.created_at ?? h.createdAt ?? Date.now())
    }

    for (const ix of indexes) {
      db.prepare('INSERT INTO paper_indexes (paper_id, index_json, pages_json, created_at) VALUES (?, ?, ?, ?)')
        .run(ix.paper_id ?? ix.paperId, ix.index_json ?? ix.indexJson, ix.pages_json ?? ix.pagesJson, Date.now())
    }

    for (const s of settings) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value)
    }
  })

  insert()

  // 3) 清理未被备份引用的孤儿 PDF
  const wanted = new Set(papers.filter((p: any) => typeof p.id === 'string').map((p: any) => `${p.id}.pdf`))
  for (const name of readdirSync(papersDir)) {
    if (name.endsWith('.pdf') && !wanted.has(name)) unlinkSync(join(papersDir, name))
  }

  // 4) 保证至少一个知识库
  const kbCount = (db.prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get() as { n: number }).n
  if (kbCount === 0) {
    db.prepare('INSERT INTO knowledge_bases (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('default', '默认知识库', '未分类论文', '#3db8a0', Date.now())
  }
}
