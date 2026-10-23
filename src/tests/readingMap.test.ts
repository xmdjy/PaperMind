import { describe, expect, it } from 'vitest'
import { buildReadingMap, filterReadingMap, latestPaperConversation, latestWebSession, readingMapTarget } from '../utils/readingMap'
import type { Paper } from '../types/paper'
import type { Conversation } from '../types/chat'
import type { WebPageSummary } from '../types/webQa'

const paper: Paper = { id: 'same', title: 'Attention', authors: [], abstract: '', year: 2026, tags: [], status: 'reading', fileName: 'a.pdf', fileHash: '', addedAt: 10, knowledgeBaseId: 'default' }
const page: WebPageSummary = { id: 'same', title: 'Transformer notes', canonicalUrl: 'https://example.org', createdAt: 20, lastOpenedAt: 30, latestSnapshotId: 'snapshot', snapshotCount: 2, sessionCount: 3, totalBytes: 100 }
const conversations: Conversation[] = [
  { id: 'empty-new', paperIds: ['same'], title: 'Empty', createdAt: 100, messages: [] },
  { id: 'older', paperIds: ['same'], title: 'Older', createdAt: 70, messages: [{ id: 'm1', role: 'user', content: '?', timestamp: 80 }] },
  { id: 'latest', paperIds: ['same'], title: 'Latest', createdAt: 1, messages: [{ id: 'm2', role: 'assistant', content: 'Answer', timestamp: 90 }] },
  { id: 'foreign', paperIds: ['other'], title: 'Other', createdAt: 200, messages: [{ id: 'm3', role: 'user', content: '?', timestamp: 200 }] },
]

describe('reading map metadata', () => {
  it('keeps source IDs independent and selects activity from actual messages', () => {
    const nodes = buildReadingMap([paper], [page], conversations)
    expect(nodes.map(n => n.id)).toEqual(['pdf:same', 'web:same'])
    expect(nodes[0]).toMatchObject({ conversationId: 'latest', activityAt: 90, activityLabel: '最近对话', conversationCount: 3 })
    expect(nodes[1]).toMatchObject({ activityAt: 30, activityLabel: '网页打开', conversationCount: 3 })
    expect(readingMapTarget(nodes[0])).toEqual({ path: '/library/same', query: { conversation: 'latest' } })
    expect(readingMapTarget(nodes[1])).toEqual({ path: '/web-preview', query: { page: 'same' } })
  })

  it('keeps positions stable on reorder, additions, source filtering and title search', () => {
    const original = buildReadingMap([paper], [page], [])
    const added = buildReadingMap([{ ...paper, id: 'other', title: 'Other paper' }, paper], [page], [])
    const match = filterReadingMap(added, 'pdf', ' ATTENTION ')
    expect(match.map(n => n.id)).toEqual(['pdf:same'])
    expect(match[0].position).toEqual(original[0].position)
    expect(original[0].position).not.toEqual(original[1].position)
    expect(buildReadingMap([], [], [])).toEqual([])
  })

  it('validates conversation membership and falls back to latest actual activity', () => {
    expect(latestPaperConversation(conversations, 'same', 'older')?.id).toBe('older')
    expect(latestPaperConversation(conversations, 'same', 'foreign')?.id).toBe('latest')
    expect(latestPaperConversation(conversations, 'missing')).toBeUndefined()
    expect(latestPaperConversation([conversations[0]], 'same')?.id).toBe('empty-new')
  })

  it('spreads sequential source IDs across the sky rather than along one edge', () => {
    const nodes = buildReadingMap(Array.from({ length: 72 }, (_, index) => ({ ...paper, id: `demo-paper-${index}` })), [], [])
    const quadrants = [0, 0, 0, 0]
    for (const node of nodes) quadrants[(node.position.x >= 50 ? 1 : 0) + (node.position.y >= 50 ? 2 : 0)]++
    expect(quadrants.every(count => count >= 8)).toBe(true)
    const steps = nodes.slice(1).map((node, index) => Math.abs(node.position.x - nodes[index].position.x))
    expect(steps.reduce((sum, value) => sum + value, 0) / steps.length).toBeGreaterThan(15)
  })

  it('selects web history by activity and rejects a foreign page session', () => {
    const sessions = [
      { id: 'old', pageId: 'p', updatedAt: 3, createdAt: 2 },
      { id: 'new', pageId: 'p', updatedAt: 9, createdAt: 1 },
      { id: 'foreign', pageId: 'q', updatedAt: 99, createdAt: 1 },
    ]
    expect(latestWebSession(sessions, 'p')?.id).toBe('new')
    expect(latestWebSession(sessions, 'p', 'old')?.id).toBe('old')
    expect(latestWebSession(sessions, 'p', 'foreign')?.id).toBe('new')
    expect(latestWebSession(sessions, 'deleted')).toBeUndefined()
  })
})
