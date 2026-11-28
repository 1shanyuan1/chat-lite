import {
  applyMacros,
  type CardDepthPrompt,
  type CardHelperScript,
  type CardQuickReply,
  type CardRegexScript,
  type CharacterCard,
  type WorldEntry,
} from './characters'
import type { EvolutionEntry } from './evolution'

/** 条目与角色卡的世界书条目是同一套结构，直接用同一个类型，避免字段各加一遍 */
export type SettingEntry = WorldEntry

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
  /** 所属文件夹，空表示未分类 */
  folderId?: string
  name: string
  body: string
  entries: SettingEntry[]
  /** 可选开场白；有则在开新会话时插入 */
  firstMessage?: string
  /** 备选开场（不含 firstMessage）；有的话聊天页可以换开场 */
  greetings?: string[]
  /** 历史之后的追加指令：每轮都插在对话历史末尾，权重比 system 更高 */
  postHistory?: string
  /** 卡内正则脚本（ST 的 regex_scripts）：提示词侧清理与显示侧替换共用 */
  regexScripts?: CardRegexScript[]
  /** 卡内快捷回复按钮（ST 的 quick_replies）：渲染在输入框上方 */
  quickReplies?: CardQuickReply[]
  /** 酒馆助手全局脚本：挂到会话后注入主窗口按卡原样运行 */
  helperScripts?: CardHelperScript[]
  /** 卡级深度注入（ext.depth_prompt） */
  depthPrompt?: CardDepthPrompt
  /** 设定发展模式：这份是某张卡的发展稿，指向原卡 */
  derivedFrom?: string
  /** 发展稿的变更历史，新的在前 */
  changelog?: EvolutionEntry[]
  avatar?: string
  /**
   * 卡片规范与作者信息，导入时保留、导出时写回。
   * 简介不单独存：寄存区直接用 body 现算（summaryOf），改完正文立刻能看到。
   */
  spec?: string
  creator?: string
  creatorNotes?: string
  tags?: string[]
  version?: string
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

/**
 * 一行简介：去掉 HTML 与 markdown 记号，空白压成一个空格，超长截断。
 * 角色描述普遍是 HTML 或带换行的长文，直接塞进列表会把行高撑乱。
 */
export function summaryOf(description?: string, fallback?: string): string {
  const raw = (description ?? '').trim() || (fallback ?? '').trim()
  if (!raw) return ''
  const text = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 110 ? `${text.slice(0, 110)}…` : text
}

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
    greetings: card.greetings.length > 0 ? card.greetings : undefined,
    postHistory: card.postHistory,
    regexScripts: card.regexScripts.length > 0 ? card.regexScripts : undefined,
    quickReplies: card.quickReplies.length > 0 ? card.quickReplies : undefined,
    helperScripts: card.helperScripts.length > 0 ? card.helperScripts : undefined,
    depthPrompt: card.depthPrompt,
    avatar: card.avatar,
    spec: card.spec,
    creator: card.creator,
    creatorNotes: card.creatorNotes,
    tags: card.tags,
    version: card.version,
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

/**
 * 我自己的设定：让角色知道 {{user}} 是谁。
 * 只在挂了设定文件时注入——没有角色的普通聊天里写「我是谁」没有意义。
 */
export function renderPersona(persona: string | undefined, userName: string, charName: string): string {
  const text = persona?.trim()
  if (!text) return ''
  return `## ${userName}\n${applyMacros(text, charName, userName)}`
}

/** 合并多份设定的常驻正文 */
export function renderSettings(docs: SettingDoc[], userName: string): string {
  return docs
    .map((doc) => renderSetting(doc, userName))
    .filter(Boolean)
    .join('\n\n')
}

/**
 * 合并多份设定的关键词条目，供世界书匹配使用。
 *
 * 条目里的 {{char}} / {{user}} 必须在这里替换掉——不同设定对应的角色名不同，
 * 只能按各自的名字替换。漏了这一步，模型会看到「{{char}}: "What is Eldoria?"」
 * 这种原文（SillyTavern 的默认卡就是这么写条目的）。
 */
export function collectEntries(docs: SettingDoc[], userName: string): SettingEntry[] {
  return docs.flatMap((doc) =>
    doc.entries.map((entry) => ({
      ...entry,
      content: applyMacros(entry.content, doc.name, userName),
      keys: entry.keys.map((key) => applyMacros(key, doc.name, userName)),
    }))
  )
}

/**
 * 一份设定的全部开场：默认开场在前，备选在后。
 * 空串丢掉、重复的也丢掉——有些卡会把 first_mes 原样塞进备选里。
 */
export function greetingsOf(doc: SettingDoc, userName: string): string[] {
  const raw = [doc.firstMessage, ...(doc.greetings ?? [])]
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of raw) {
    if (!text || !text.trim()) continue
    const applied = applyMacros(text, doc.name, userName)
    if (seen.has(applied)) continue
    seen.add(applied)
    out.push(applied)
  }
  return out
}

/** 挂载多份设定时，用第一份带开场白的作为开场；返回整份列表方便换 */
export function greetingList(docs: SettingDoc[], userName: string): string[] {
  for (const doc of docs) {
    const list = greetingsOf(doc, userName)
    if (list.length > 0) return list
  }
  return []
}

/**
 * 每份设定的第一段开场。
 * 单角色时只有一条；挂多张卡（群聊）时每张各出一条，开头会拼上角色名。
 */
export function collectGreetings(docs: SettingDoc[], userName: string): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = []
  for (const doc of docs) {
    const list = greetingsOf(doc, userName)
    if (list.length > 0) out.push({ name: doc.name, text: list[0] })
  }
  return out
}

/** 挂载多份设定时，用第一份带开场白的作为开场 */
export function pickGreeting(docs: SettingDoc[], userName: string): { name: string; text: string } | null {
  return collectGreetings(docs, userName)[0] ?? null
}

/**
 * 开场白落成第一轮时的整段文本。
 *
 * 单卡：用 pick 指定的那一段（越界就夹回范围）——这是「选开场白」的核心，
 * 第一轮说什么由用户挑，而不是永远默认第一段。
 * 群聊：每张卡各出第一段，前面标上名字，行为与以前一致。
 */
export function greetingScript(docs: SettingDoc[], userName: string, pick = 0): string {
  const cast = docs
    .map((doc) => ({ name: doc.name, list: greetingsOf(doc, userName) }))
    .filter((item) => item.list.length > 0)
  if (cast.length === 0) return ''
  if (cast.length === 1) {
    const list = cast[0].list
    return list[Math.min(Math.max(pick, 0), list.length - 1)]
  }
  return cast.map((item) => `**${item.name}**：${item.list[0]}`).join('\n\n')
}

/**
 * 群聊：场上不止一个角色时，明确告诉模型「一次只说一个人」。
 * 不加这段，多张卡的设定会被混成同一个人说话。
 */
export function renderCast(docs: SettingDoc[], mentionTarget?: string): string {
  // 只有「角色卡」才算同场角色。
  // 写作模式挂的多份是设定文件（世界观、人物小传、规则），按 docs.length 判断
  // 会把「雾港世界观 + 陆行舟」当成两个人对话，直接污染提示词。
  const cast = docs.filter((d) => d.kind === 'character')
  if (cast.length < 2) return ''
  const names = cast.map((d) => d.name).join('、')
  const targetLine =
    mentionTarget && cast.some((d) => d.name === mentionTarget)
      ? [`- 用户这次 @ 了「${mentionTarget}」，本次只以它的身份发言，回复以「**${mentionTarget}**：」开头。`]
      : []
  return [
    '## 场上角色',
    `这一段对话里同时有：${names}。`,
    '- 每次回复只让一个角色说话，用「**名字**：」开头。',
    '- 不要让多个角色在同一段里轮流念台词，也不要替用户发言。',
    '- 用户可能同时跟几个人说话，按语境判断该谁接；拿不准就让最相关的那位回应。',
    ...targetLine,
  ].join('\n')
}

/** 群聊 @点名：最后一条用户消息开头的 @角色名（前缀匹配挂载的角色卡） */
export function parseMentionTarget(
  history: Array<{ role: string; content: string }>,
  docs: SettingDoc[]
): string | undefined {
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  const m = /^\s*@([^\s@]+)/.exec(lastUser)
  if (!m) return undefined
  const query = m[1]
  return docs.find((d) => d.kind === 'character' && d.name.startsWith(query))?.name
}

/** 群聊发言人归属：@点名优先，否则从回复开头的「**名字**：」/「【名字】」提取（须是场上角色） */
export function extractSpeaker(answer: string, charNames: string[], target?: string): string | undefined {
  if (target && charNames.includes(target)) return target
  const m = /^\s*(?:\*\*([^*]+)\*\*|【([^】]+)】)/.exec(answer)
  const name = m ? (m[1] ?? m[2])?.trim() : undefined
  return name && charNames.includes(name) ? name : undefined
}
