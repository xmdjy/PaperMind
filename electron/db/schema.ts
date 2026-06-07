export const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_bases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  color       TEXT DEFAULT '#7c6af7',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS papers (
  id                TEXT PRIMARY KEY,
  knowledge_base_id TEXT NOT NULL,
  title             TEXT DEFAULT '',
  authors           TEXT DEFAULT '[]',   -- JSON array
  abstract          TEXT DEFAULT '',
  year              INTEGER DEFAULT 0,
  tags              TEXT DEFAULT '[]',   -- JSON array
  status            TEXT DEFAULT 'unread',
  file_name         TEXT NOT NULL,
  file_path         TEXT NOT NULL,       -- absolute path on disk
  added_at          INTEGER NOT NULL,
  FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  paper_ids   TEXT DEFAULT '[]',         -- JSON array
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  sources         TEXT DEFAULT '[]',     -- JSON array
  timestamp       INTEGER NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS highlights (
  id          TEXT PRIMARY KEY,
  paper_id    TEXT NOT NULL,
  text        TEXT NOT NULL,
  page_num    INTEGER DEFAULT 0,
  color       TEXT DEFAULT '#c9a84c',
  note        TEXT DEFAULT '',
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_kb ON papers(knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_highlights_paper ON highlights(paper_id);
`
