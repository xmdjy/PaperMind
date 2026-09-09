import type { Paper } from '../stores/paper'

export interface LibraryFilters {
  query?: string
  status?: Paper['status'] | 'all'
  sort?: 'recent' | 'title'
}

export function filterLibraryPapers(papers: Paper[], filters: LibraryFilters = {}): Paper[] {
  const query = filters.query?.trim().toLowerCase() ?? ''

  return papers
    .filter(paper => {
      if (filters.status && filters.status !== 'all' && paper.status !== filters.status) return false
      const searchable = [paper.title, paper.fileName, ...(paper.authors ?? []), ...(paper.tags ?? [])]
      return !query || searchable.some(value => value?.toLowerCase().includes(query))
    })
    .sort((a, b) => filters.sort === 'title'
      ? (a.title || a.fileName).localeCompare(b.title || b.fileName, 'zh-CN', { sensitivity: 'base', numeric: true })
      : b.addedAt - a.addedAt)
}
