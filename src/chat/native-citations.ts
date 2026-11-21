import type { WebSource } from './web-search-types'

/**
 * 从各家响应里抽出「搜索来源」。
 * 流式（SSE）和非流式的辅助调用共用同一套解析，避免两处逻辑漂移。
 */

const asString = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** Anthropic：content 里的 web_search_tool_result 块 */
export function anthropicSourcesFromBlocks(blocks: unknown): WebSource[] {
  if (!Array.isArray(blocks)) return []
  const out: WebSource[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'web_search_tool_result' || !Array.isArray(item.content)) continue
    for (const entry of item.content as unknown[]) {
      if (!entry || typeof entry !== 'object') continue
      const result = entry as Record<string, unknown>
      if (result.type !== 'web_search_result') continue
      const url = asString(result.url)
      if (!url) continue
      out.push({ url, title: asString(result.title), publishedAt: asString(result.page_age) })
    }
  }
  return out
}

/** Gemini：groundingMetadata.groundingChunks[].web */
export function geminiSourcesFromCandidate(candidate: unknown): WebSource[] {
  if (!candidate || typeof candidate !== 'object') return []
  const meta = (candidate as Record<string, unknown>).groundingMetadata as Record<string, unknown> | undefined
  const chunks = meta?.groundingChunks
  if (!Array.isArray(chunks)) return []
  const out: WebSource[] = []
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') continue
    const web = (chunk as Record<string, unknown>).web as Record<string, unknown> | undefined
    const url = asString(web?.uri)
    if (!url) continue
    out.push({ url, title: asString(web?.title) })
  }
  return out
}
