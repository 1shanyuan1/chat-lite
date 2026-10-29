import { applyMacros, type CharacterCard } from './characters'

export interface SettingEntry {
  id: string
  keys: string[]
  content: string
  enabled: boolean
  constant?: boolean
}

/**
 * 设定文件：角色卡与世界书合并后的统一形态。
 * body 是常驻注入的设定（人物、世界观、风格都写这里），entries 是关键词触发的条目。
 * 一个会话可以挂任意多个，也可以一个都不挂（就是普通聊天）。
 */
/** 生态格式与自由格式要分开：角色卡/世界书是从社区来的，设定是自家写法 */
export type DocKind = 'character' | 'world' | 'setting'

export interface SettingDoc {
  id: string
  kind: DocKind
  name: string
  body: string
  entries: SettingEntry[]
  /** 可选开场白；有则在开新会话时插入 */
  firstMessage?: string
  avatar?: string
  createdAt: number
  updatedAt: number
}

export const emptySetting = (kind: DocKind = 'setting'): SettingDoc => ({
  id: crypto.randomUUID(),
  kind,
  name: '',
  body: '',
  entries: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const join = (...parts: Array<string | undefined>) => parts.filter((p) => p && p.trim()).join('\n\n')

/** 从 SillyTavern 角色卡转成设定文件 */
export function settingFromCard(card: CharacterCard): SettingDoc {
  const body = join(
    card.description,
    card.personality ? `性格：${card.personality}` : undefined,
    card.scenario ? `情境：${card.scenario}` : undefined,
    card.exampleDialogue ? `对话示例（仅作语气参考）：\n${card.exampleDialogue}` : undefined,
    card.systemPrompt ? `要求：${card.systemPrompt}` : undefined
  )
  return {
    id: card.id,
    kind: 'character',
    name: card.name || '未命名设定',
    body,
    entries: card.worldInfo.map((e) => ({ ...e })),
    firstMessage: card.firstMessage || undefined,
    avatar: card.avatar,
    createdAt: card.createdAt,
    updatedAt: Date.now(),
  }
}

/** 从单独的世界书文件转成设定文件 */
export function settingFromWorld(
  item: { id?: string; name: string; entries: SettingEntry[]; createdAt?: number },
  body = ''
): SettingDoc {
  return {
    id: item.id ?? crypto.randomUUID(),
    kind: 'world',
    name: item.name || '未命名设定',
    body,
    entries: item.entries.map((e) => ({ ...e })),
    createdAt: item.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  }
}

/** 纯文本 / 提示词文件也当设定用：整段进 body */
export function settingFromText(name: string, body: string): SettingDoc {
  return {
    id: crypto.randomUUID(),
    kind: 'setting',
    name: name || '未命名设定',
    body,
    entries: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

/** 老数据没有 kind，按形状猜一个 */
export function guessKind(doc: Partial<SettingDoc>): DocKind {
  if (doc.kind) return doc.kind
  if (doc.firstMessage || doc.avatar) return 'character'
  if ((doc.entries?.length ?? 0) > 0 && !doc.body?.trim()) return 'world'
  return 'setting'
}

/** 把一份设定渲染成注入 system prompt 的文本块 */
export function renderSetting(doc: SettingDoc, userName: string): string {
  const name = doc.name || '设定'
  const body = applyMacros(doc.body, name, userName).trim()
  if (!body) return ''
  return `## ${name}\n${body}`
}

/** 合并多份设定的常驻正文 */
export function renderSettings(docs: SettingDoc[], userName: string): string {
  return docs
    .map((doc) => renderSetting(doc, userName))
    .filter(Boolean)
    .join('\n\n')
}

/** 合并多份设定的关键词条目，供世界书匹配使用 */
export function collectEntries(docs: SettingDoc[]): SettingEntry[] {
  return docs.flatMap((doc) => doc.entries)
}

/** 挂载多份设定时，用第一份带开场白的作为开场 */
export function pickGreeting(docs: SettingDoc[], userName: string): { name: string; text: string } | null {
  for (const doc of docs) {
    const text = doc.firstMessage?.trim()
    if (text) return { name: doc.name, text: applyMacros(text, doc.name, userName) }
  }
  return null
}
