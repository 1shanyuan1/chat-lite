import type { SearchHit, Session } from '@/db'

export interface SessionMatch {
  session: Session
  snippet?: string
  hits: number
}

export interface MatchResult {
  byTitle: Session[]
  byContent: SessionMatch[]
  hitCount: Map<string, number>
  hitSnippet: Map<string, string>
}

export const EMPTY_MATCH: MatchResult = {
  byTitle: [],
  byContent: [],
  hitCount: new Map(),
  hitSnippet: new Map(),
}

/** 取命中位置前后各 span 个字符，压平换行 */
export function snippetOf(text: string, query: string, span = 34): string {
  if (!text) return ''
  const flat = text.replace(/\s+/g, ' ')
  const i = flat.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return flat.slice(0, span * 2)
  const start = Math.max(0, i - span)
  const end = Math.min(flat.length, i + query.length + span)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * 会话列表的搜索：标题命中（本地过滤）+ 消息内容命中（repo.search 的结果）合并。
 * 两边都中的会话只出现在标题区，但片段照样带出来。
 */
export function matchSessions(sessions: Session[], contentHits: SearchHit[], rawQuery: string): MatchResult {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return EMPTY_MATCH

  const hitCount = new Map<string, number>()
  const firstText = new Map<string, string>()
  for (const hit of contentHits) {
    // 防御式过滤：即使调用方传来的是未筛选的结果也不会误命中
    if (!hit.text.toLowerCase().includes(q)) continue
    hitCount.set(hit.sessionId, (hitCount.get(hit.sessionId) ?? 0) + 1)
    if (!firstText.has(hit.sessionId)) firstText.set(hit.sessionId, hit.text)
  }

  const hitSnippet = new Map<string, string>()
  for (const [id, text] of firstText) hitSnippet.set(id, snippetOf(text, q))

  const byTitle = sessions.filter((s) => s.title.toLowerCase().includes(q))
  const titleIds = new Set(byTitle.map((s) => s.id))
  const byContent: SessionMatch[] = sessions
    .filter((s) => !titleIds.has(s.id) && hitCount.has(s.id))
    .map((s) => ({ session: s, snippet: hitSnippet.get(s.id), hits: hitCount.get(s.id) ?? 0 }))

  return { byTitle, byContent, hitCount, hitSnippet }
}
