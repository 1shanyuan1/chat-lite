import type { WorldEntry } from './characters'

/**
 * 世界书命中：常驻条目总是注入；其余按关键词在最近对话里找。
 * 命中太多会挤占上下文，所以有上限。
 */
export function matchWorldEntries(entries: WorldEntry[], contextText: string, limit = 6): WorldEntry[] {
  if (entries.length === 0) return []
  const haystack = contextText.toLowerCase()

  const picked: WorldEntry[] = []
  for (const entry of entries) {
    if (!entry.enabled) continue
    if (entry.constant) {
      picked.push(entry)
      continue
    }
    if (entry.keys.some((key) => key && haystack.includes(key.toLowerCase()))) {
      picked.push(entry)
    }
  }
  return picked.slice(0, limit)
}

export function renderWorldEntries(entries: WorldEntry[]): string {
  if (entries.length === 0) return ''
  return `已知设定：\n${entries.map((e) => `- ${e.content}`).join('\n')}`
}

/** 取最近若干条消息作为世界书的扫描窗口 */
export function contextWindow(texts: string[], windowSize = 6): string {
  return texts.slice(-windowSize).join('\n')
}
