import type { Conversation } from '../types/chat'
import type { Paper } from '../types/paper'
import type { WebPageSummary } from '../types/webQa'

export type ReadingSource = 'pdf' | 'web'
export type ReadingFilter = ReadingSource | 'all'
export interface ReadingStar {
  id: string
  sourceId: string
  source: ReadingSource
  title: string
  detail: string
  addedAt: number
  activityAt: number
  activityLabel: string
  conversationCount: number
  conversationId?: string
  position: { x: number; y: number }
}

function conversationActivity(conversation: Conversation): number {
  return Math.max(0, ...conversation.messages.map(message => message.timestamp))
}

export function latestPaperConversation(conversations: Conversation[], paperId: string, requested?: string): Conversation | undefined {
  const matching = conversations.filter(conversation => conversation.paperIds.includes(paperId))
  return matching.find(conversation => conversation.id === requested)
    ?? matching.sort((a, b) => conversationActivity(b) - conversationActivity(a) || b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0]
}

interface SessionActivity { id: string; pageId: string; updatedAt: number; createdAt: number }
export function latestWebSession<T extends SessionActivity>(sessions: T[], pageId: string, requested?: string): T | undefined {
  const matching = sessions.filter(session => session.pageId === pageId)
  return matching.find(session => session.id === requested)
    ?? matching.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0]
}

// Hash the qualified identity only: filtering and importing unrelated records never move a star.
export function starPosition(id: string): { x: number; y: number } {
  let hash = 2166136261
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  hash ^= hash >>> 16
  const x = (hash >>> 0) / 4294967296
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507)
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909)
  hash ^= hash >>> 16
  return { x: 5 + x * 90, y: 8 + ((hash >>> 0) / 4294967296) * 82 }
}

export function buildReadingMap(papers: Paper[], pages: WebPageSummary[], conversations: Conversation[]): ReadingStar[] {
  return [
    ...papers.map((paper): ReadingStar => {
      const recent = latestPaperConversation(conversations, paper.id)
      const activity = recent ? conversationActivity(recent) : 0
      return {
        id: `pdf:${paper.id}`, sourceId: paper.id, source: 'pdf',
        title: paper.title || paper.fileName, detail: paper.authors.join(' · ') || paper.fileName,
        addedAt: paper.addedAt, activityAt: activity || paper.addedAt,
        activityLabel: activity ? '最近对话' : '加入时间',
        conversationCount: conversations.filter(conversation => conversation.paperIds.includes(paper.id)).length,
        conversationId: recent?.id, position: starPosition(`pdf:${paper.id}`),
      }
    }),
    ...pages.map((page): ReadingStar => ({
      id: `web:${page.id}`, sourceId: page.id, source: 'web', title: page.title || page.canonicalUrl,
      detail: page.canonicalUrl, addedAt: page.createdAt, activityAt: page.lastOpenedAt,
      activityLabel: '网页打开', conversationCount: page.sessionCount, position: starPosition(`web:${page.id}`),
    })),
  ]
}

export function filterReadingMap(stars: ReadingStar[], source: ReadingFilter, query: string): ReadingStar[] {
  const search = query.trim().toLocaleLowerCase()
  return stars.filter(star => (source === 'all' || star.source === source) && star.title.toLocaleLowerCase().includes(search))
}

export function readingMapTarget(star: ReadingStar): { path: string; query: Record<string, string> } {
  return star.source === 'web'
    ? { path: '/web-preview', query: { page: star.sourceId } }
    : { path: `/library/${encodeURIComponent(star.sourceId)}`, query: star.conversationId ? { conversation: star.conversationId } : {} }
}
