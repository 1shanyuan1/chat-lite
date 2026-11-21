import type { CharacterCard } from './characters'

export type VaultKind = 'world' | 'prompt'

export const VAULT_KINDS: Array<{ id: 'character' | VaultKind; label: string; hint: string }> = [
  { id: 'character', label: '角色卡', hint: 'PNG / JSON，SillyTavern V1–V3' },
  { id: 'world', label: '世界书', hint: '关键词触发的设定集' },
  { id: 'prompt', label: '提示词', hint: '可复用的系统提示词片段' },
]

export interface WorldItem {
  id: string
  name: string
  entries: Array<{ id: string; keys: string[]; content: string; enabled: boolean; constant?: boolean }>
  createdAt: number
  updatedAt: number
}

/** 可复用的系统提示词片段 */
export interface PromptItem {
  id: string
  /** 所属文件夹，空表示未分类（落在「通用」区） */
  folderId?: string
  name: string
  text: string
  createdAt: number
  updatedAt: number
}

export type VaultEntry = WorldItem | PromptItem

/**
 * 按结构猜类型，不靠扩展名——社区文件经常乱命名。
 * 顺序很重要：角色卡和世界书都可能带 entries。
 */
const looksLikeEntries = (value: unknown): boolean =>
  Array.isArray(value) && value.some((e) => e && typeof e === 'object' && 'keys' in (e as object))

export function detectKind(payload: unknown): 'character' | VaultKind | null {
  if (typeof payload === 'string') return payload.trim() ? 'prompt' : null
  if (!payload || typeof payload !== 'object') return null

  // 数组必须先处理：Array.prototype.entries 是个函数，会被误当成条目表
  if (Array.isArray(payload)) return looksLikeEntries(payload) ? 'world' : null

  const root = payload as Record<string, unknown>
  const data = (root.spec ? root.data : root) as Record<string, unknown> | undefined
  const d = (data ?? root) as Record<string, unknown>

  // 角色卡
  if (typeof d.name === 'string' && (d.first_mes || d.firstMessage || d.greeting || d.description)) {
    return 'character'
  }
  if (root.spec === 'chara_card_v2' || root.spec === 'chara_card_v3') return 'character'

  // SillyTavern 的对话预设：本质是一组提示词。必须在世界书之前认出来，
  // 否则 prompts 数组会命中下面的「值里有 keys」规则（Array.prototype.keys 也是 keys）
  if (Array.isArray(d.prompts)) return 'prompt'

  // 世界书
  const book = d.entries && typeof d.entries === 'object' && !Array.isArray(d.entries) ? d.entries : d
  if (book && typeof book === 'object' && !Array.isArray(book) && Object.keys(book as object).length > 0) {
    const values = Object.values(book as Record<string, unknown>)
    // 数组也有继承来的 keys，必须排除，否则 { prompts: [...] } 会被当成世界书
    if (values.some((v) => v && typeof v === 'object' && !Array.isArray(v) && 'keys' in (v as object))) return 'world'
  }
  if (looksLikeEntries(book)) return 'world'

  // 提示词
  if (typeof d.prompt === 'string' || typeof d.content === 'string' || typeof d.system_prompt === 'string') {
    return 'prompt'
  }
  return null
}

export function toWorldItem(payload: unknown, fallbackName: string): WorldItem {
  const root = (payload ?? {}) as Record<string, unknown>
  // 同样是 Array.prototype.entries 的坑：数组本身就是条目列表
  const rawEntries = Array.isArray(payload) ? payload : root.entries
  const list = Array.isArray(rawEntries)
    ? rawEntries
    : Object.values(
        (rawEntries && typeof rawEntries === 'object' ? rawEntries : {}) as Record<string, unknown>
      )

  const entries = list
    .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
    .map((e) => {
      const keysRaw = e.keys ?? e.key ?? []
      const keys = (Array.isArray(keysRaw) ? keysRaw : String(keysRaw).split(','))
        .map((k) => String(k).trim())
        .filter(Boolean)
      return {
        id: crypto.randomUUID(),
        keys,
        content: typeof e.content === 'string' ? e.content : '',
        enabled: e.enabled !== false && e.disable !== true,
        constant: e.constant === true,
      }
    })
    .filter((e) => e.content || e.keys.length > 0)

  return {
    id: crypto.randomUUID(),
    name: typeof root.name === 'string' && root.name ? root.name : fallbackName,
    entries,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/**
 * SillyTavern 预设里的提示词条目，按顺序拼成一段文本。
 * 跳过空内容和被禁用的条目，避免把一堆占位符灌进系统提示词。
 */
function presetPromptText(d: Record<string, unknown>): string {
  const list = d.prompts
  if (!Array.isArray(list)) return ''
  const disabled = new Set<string>()
  const order = d.prompt_order
  if (Array.isArray(order)) {
    for (const group of order) {
      const items = (group as Record<string, unknown> | null)?.order
      if (!Array.isArray(items)) continue
      for (const item of items) {
        const row = item as Record<string, unknown> | null
        if (row && row.enabled === false && typeof row.identifier === 'string') disabled.add(row.identifier)
      }
    }
  }

  return list
    .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === 'object'))
    .filter((p) => !(typeof p.identifier === 'string' && disabled.has(p.identifier)))
    .map((p) => (typeof p.content === 'string' ? p.content.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

export function toPromptItem(payload: unknown, fallbackName: string): PromptItem {
  const d = (payload ?? {}) as Record<string, unknown>
  const text =
    typeof payload === 'string'
      ? payload
      : typeof d.prompt === 'string'
        ? d.prompt
        : typeof d.content === 'string'
          ? d.content
          : typeof d.system_prompt === 'string'
            ? d.system_prompt
            : typeof d.text === 'string'
              ? d.text
              : presetPromptText(d)
  return {
    id: crypto.randomUUID(),
    name: typeof d.name === 'string' && d.name ? d.name : fallbackName,
    text,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export type { CharacterCard }
