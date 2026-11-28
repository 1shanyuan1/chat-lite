import type { WorldEntry } from './characters'
import { estimateTokens } from './tokens'
import type { WireMessage } from './protocol'

/** 一次最多注入多少 token 的设定条目——比「最多几条」更贴近真实开销 */
const ENTRY_BUDGET = 900

/**
 * 世界书命中：常驻条目必进，其余按关键词在最近对话里找。
 *
 * 三条规则，都是踩过坑才加的：
 * 1. 常驻条目不受条数上限约束——以前是先进先出再截断，排在第 7 位的常驻条目会被丢掉。
 * 2. 命中多个关键词的条目排在前面，它比只命中一个的更相关。
 * 3. 除了条数上限还有 token 预算，长条目不至于把上下文挤爆。
 */
const isAscii = (text: string) => /^[\x20-\x7E]+$/.test(text)
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 单个关键词是否命中。
 * - 大小写敏感由条目自己决定（V2 的 case_sensitive）
 * - 整词匹配只对 ASCII 有意义：\b 在中文里不成立，中文关键词自动退化成包含判断
 */
function keyHits(key: string, raw: string, lower: string, entry: WorldEntry): boolean {
  if (!key) return false
  const haystack = entry.caseSensitive ? raw : lower
  const needle = entry.caseSensitive ? key : key.toLowerCase()
  if (entry.matchWholeWords && isAscii(key)) {
    return new RegExp(`\\b${escapeRe(needle)}\\b`).test(haystack)
  }
  return haystack.includes(needle)
}

/**
 * 世界书命中：常驻条目必进，其余按关键词在最近对话里找。
 *
 * 规则（对齐 V2 的 character_book 语义）：
 * 1. 常驻条目不受条数上限约束——以前先 push 再截断，排第 7 位的常驻条目会被丢掉。
 * 2. 有 secondary_keys 且 selective 不为 false 时，主键和二级键都要命中。
 * 3. 命中多个关键词的排前面；同分按 insertion_order，再按原始顺序。
 * 4. 除了条数上限还有 token 预算，长条目不至于把上下文挤爆。
 */
export function matchWorldEntries(entries: WorldEntry[], contextText: string, limit = 6): WorldEntry[] {
  if (entries.length === 0) return []
  const raw = contextText
  const lower = contextText.toLowerCase()

  const scored: Array<{ entry: WorldEntry; score: number; index: number }> = []
  entries.forEach((entry, index) => {
    if (!entry.enabled) return
    if (entry.constant) {
      scored.push({ entry, score: Number.MAX_SAFE_INTEGER, index })
      return
    }

    const primaryHits = entry.keys.filter((key) => keyHits(key, raw, lower, entry)).length
    if (primaryHits === 0) return

    // selective 为 false 时二级键不参与（SillyTavern 的行为：写了但关掉就等于没有）
    if (entry.secondaryKeys?.length && entry.selective !== false) {
      const secondaryHit = entry.secondaryKeys.some((key) => keyHits(key, raw, lower, entry))
      if (!secondaryHit) return
    }

    scored.push({ entry, score: primaryHits, index })
  })

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ao = a.entry.order ?? 0
    const bo = b.entry.order ?? 0
    if (ao !== bo) return ao - bo
    return a.index - b.index
  })

  const picked: WorldEntry[] = []
  const seen = new Set<string>()
  let used = 0
  for (const { entry } of scored) {
    if (picked.length >= limit) break
    const text = entry.content.trim()
    if (!text || seen.has(text)) continue
    const cost = estimateTokens(text)
    // 预算再紧也至少给一条，否则等于设定全丢
    if (used + cost > ENTRY_BUDGET && picked.length > 0) continue
    seen.add(text)
    picked.push(entry)
    used += cost
  }
  return picked
}

export function renderWorldEntries(entries: WorldEntry[]): string {
  if (entries.length === 0) return ''
  return `已知设定：\n${entries.map((e) => `- ${e.content}`).join('\n')}`
}

/* ---------------- @D 深度注入（ST 的 at_depth 语义） ---------------- */

export interface DepthInjection {
  content: string
  /** 距末尾消息的距离：0=贴着最后一条 */
  depth: number
  role: 'system' | 'user' | 'assistant'
}

/** 命中条目分流：普通条目进 world 槽位，at_depth 条目走深度注入 */
export function splitWorldEntries(entries: WorldEntry[]): { inPrompt: WorldEntry[]; atDepth: WorldEntry[] } {
  const atDepth: WorldEntry[] = []
  const inPrompt: WorldEntry[] = []
  for (const e of entries) {
    if (e.position === 'at_depth') atDepth.push(e)
    else inPrompt.push(e)
  }
  return { inPrompt, atDepth }
}

/** 命中的 @D 条目 → 深度注入描述（content 已在 collectEntries 完成宏替换） */
export function buildDepthInjections(entries: WorldEntry[]): DepthInjection[] {
  return entries
    .filter((e) => e.content.trim())
    .map((e) => ({ content: e.content, depth: e.depth ?? 4, role: 'system' as const }))
}

/** 把深度注入插进历史：depth d → 距末尾 d 条之前；同深度按传入顺序堆叠，深的大在后插 */
export function injectDepthMessages(history: WireMessage[], injections: DepthInjection[]): WireMessage[] {
  if (injections.length === 0) return history
  const result = [...history]
  const byDepth = new Map<number, WireMessage[]>()
  for (const inj of [...injections].sort((a, b) => a.depth - b.depth)) {
    const msg: WireMessage = { role: inj.role, content: inj.content }
    const list = byDepth.get(inj.depth) ?? []
    list.push(msg)
    byDepth.set(inj.depth, list)
  }
  // 从最深处开始插，浅层的索引才不会被挤动
  for (const [depth, msgs] of [...byDepth.entries()].sort((a, b) => b[0] - a[0])) {
    const index = Math.max(0, Math.min(result.length - depth, result.length))
    result.splice(index, 0, ...msgs)
  }
  return result
}

/** 取最近若干条消息作为世界书的扫描窗口 */
export function contextWindow(texts: string[], windowSize = 6): string {
  return texts.slice(-windowSize).join('\n')
}
