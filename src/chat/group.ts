/**
 * 酒馆式群聊的规则层（纯函数，可供自检直接测试）。
 *
 * 对齐 SillyTavern 的群聊机制：
 * - 发言顺序：自然（点名 + 话痨度）/ 列表 / 轮流随机 / 手动
 * - 生成方式：交换角色卡（只给当前发言者）/ 合并角色卡（全员给）
 * - 静音、强制发言、自动接话、场景覆盖
 *
 * 一轮里被激活的角色会各自生成一条独立消息；本模块只负责“谁在什么时候说”。
 */

export type GroupStrategy = 'natural' | 'list' | 'pooled' | 'manual'
export type GroupGeneration = 'swap' | 'join'

export interface GroupConfig {
  /** 回复顺序策略 */
  strategy: GroupStrategy
  /** 角色卡注入方式 */
  generation: GroupGeneration
  /** 静音的成员（settingId） */
  muted: string[]
  /** 话痨度 0–1，缺省 0.5；key 是 settingId */
  talkativeness: Record<string, number>
  /** 自然顺序下允许同一个人连续接话 */
  allowSelfResponses?: boolean
  /** 自动接话（ST 的 Auto-mode） */
  autoMode?: boolean
  /** 自动接话间隔秒数，默认 5 */
  autoModeDelay?: number
  /** 群聊场景覆盖（所有成员统一使用） */
  scenarioOverride?: string
}

export const DEFAULT_GROUP: GroupConfig = {
  strategy: 'natural',
  generation: 'swap',
  muted: [],
  talkativeness: {},
  allowSelfResponses: false,
  autoMode: false,
  autoModeDelay: 5,
}

export function normalizeGroup(input?: Partial<GroupConfig> | null): GroupConfig {
  const raw = input ?? {}
  const strategies: GroupStrategy[] = ['natural', 'list', 'pooled', 'manual']
  const generations: GroupGeneration[] = ['swap', 'join']
  const talkativeness: Record<string, number> = {}
  for (const [id, value] of Object.entries(raw.talkativeness ?? {})) {
    const n = Number(value)
    if (Number.isFinite(n)) talkativeness[id] = Math.min(1, Math.max(0, n))
  }
  const delay = Number(raw.autoModeDelay ?? DEFAULT_GROUP.autoModeDelay)
  return {
    strategy: strategies.includes(raw.strategy as GroupStrategy) ? (raw.strategy as GroupStrategy) : DEFAULT_GROUP.strategy,
    generation: generations.includes(raw.generation as GroupGeneration)
      ? (raw.generation as GroupGeneration)
      : DEFAULT_GROUP.generation,
    muted: Array.isArray(raw.muted) ? raw.muted.map(String) : [],
    talkativeness,
    allowSelfResponses: Boolean(raw.allowSelfResponses),
    autoMode: Boolean(raw.autoMode),
    autoModeDelay: Number.isFinite(delay) ? Math.min(60, Math.max(2, delay)) : 5,
    scenarioOverride: typeof raw.scenarioOverride === 'string' ? raw.scenarioOverride : undefined,
  }
}

export interface GroupMember {
  id: string
  name: string
  /** 0–1 */
  talkativeness: number
  muted: boolean
}

/** 把角色卡文档 + 群配置变成激活引擎要的成员表（保留入参顺序） */
export function buildGroupMembers(
  docs: Array<{ id: string; name: string; kind: string }>,
  group: GroupConfig
): GroupMember[] {
  return docs
    .filter((doc) => doc.kind === 'character')
    .map((doc) => ({
      id: doc.id,
      name: doc.name,
      talkativeness: group.talkativeness[doc.id] ?? 0.5,
      muted: group.muted.includes(doc.id),
    }))
}

function nameTokens(name: string): string[] {
  const full = name.trim()
  if (!full) return []
  const parts = full
    .split(/[\s,，。.!?！？、;；:：·•\-_/\\()（）[\]【】]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const tokens = new Set<string>([full, ...parts])
  return [...tokens].filter((token) => [...token].length >= 2)
}

/** 自然顺序：从文本里抽出被点名的成员，按在文本里出现的先后排序 */
export function extractMentioned(
  members: GroupMember[],
  text: string
): string[] {
  const haystack = text.toLowerCase()
  const hits: Array<{ id: string; at: number }> = []
  for (const member of members) {
    let at = -1
    for (const token of nameTokens(member.name)) {
      const pos = haystack.indexOf(token.toLowerCase())
      if (pos >= 0 && (at < 0 || pos < at)) at = pos
    }
    if (at >= 0) hits.push({ id: member.id, at })
  }
  return hits.sort((a, b) => a.at - b.at).map((hit) => hit.id)
}

export interface ActivateInput {
  strategy: GroupStrategy
  members: GroupMember[]
  /** 参与激活的文本：用户输入，或非用户触发时的最后一条消息 */
  text?: string
  isUserInput: boolean
  /** 非用户触发时，上一句话是谁说的（自然顺序默认不让同一人连说） */
  lastSpeakerId?: string
  /** 上一条用户消息之后已经说过话的成员（轮流随机用） */
  spokenSinceUser?: string[]
  allowSelfResponses?: boolean
  /** 强制发言：绕过策略和静音 */
  forceId?: string
  rng?: () => number
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

function pickRandom<T>(list: T[], rng: () => number): T | undefined {
  if (list.length === 0) return undefined
  return list[Math.floor(rng() * list.length)]
}

function shuffled<T>(list: T[], rng: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 决定这一轮由谁发言（返回成员 id，按发言先后排序）。
 * - natural：点名优先，其次按话痨度掷骰；都没激活就随机挑一个
 * - list：所有未静音成员按列表顺序依次发言
 * - pooled：随机挑一个自上次用户发言后还没说过话的人
 * - manual：用户发送时不自动接话；手动触发时随机挑一个未静音成员
 */
export function activateGroup(input: ActivateInput): string[] {
  const rng = input.rng ?? Math.random
  const members = input.members
  if (members.length === 0) return []

  if (input.forceId) {
    return members.some((member) => member.id === input.forceId) ? [input.forceId] : []
  }

  const enabled = members.filter((member) => !member.muted)
  if (enabled.length === 0) return []

  if (input.strategy === 'manual') {
    if (input.isUserInput) return []
    return pickRandom(enabled, rng) ? [pickRandom(enabled, rng)!.id] : []
  }

  if (input.strategy === 'list') {
    return enabled.map((member) => member.id)
  }

  if (input.strategy === 'pooled') {
    const spoken = new Set(input.spokenSinceUser ?? [])
    const fresh = enabled.filter((member) => !spoken.has(member.id))
    const pool =
      fresh.length > 0
        ? fresh
        : members.length > 1 && input.lastSpeakerId
          ? enabled.filter((member) => member.id !== input.lastSpeakerId)
          : enabled
    const picked = pickRandom(pool.length > 0 ? pool : enabled, rng)
    return picked ? [picked.id] : []
  }

  // natural
  const banned =
    !input.isUserInput && input.lastSpeakerId && !input.allowSelfResponses ? input.lastSpeakerId : undefined
  const eligible = enabled.filter((member) => member.id !== banned)
  const activated: string[] = []

  if (input.text) {
    for (const id of extractMentioned(eligible, input.text)) {
      if (!activated.includes(id)) activated.push(id)
    }
  }

  for (const member of shuffled(eligible, rng)) {
    if (activated.includes(member.id)) continue
    if (rng() <= member.talkativeness) activated.push(member.id)
  }

  if (activated.length === 0) {
    const chatty = eligible.filter((member) => member.talkativeness > 0)
    const picked = pickRandom(chatty.length > 0 ? chatty : eligible, rng)
    if (picked) activated.push(picked.id)
  }

  return dedupe(activated)
}

/** 新建群聊时每个成员随机挑一段开场白（ST 会在 first_mes + alternate_greetings 里随机） */
export function pickGroupGreeting(list: string[], rng: () => number = Math.random): string | undefined {
  if (list.length === 0) return undefined
  return list[Math.floor(rng() * list.length)]
}

/** 群聊提示词：锚定当前发言者，并提示不要替别人说话 */
export function renderGroupDirective(names: string[], speaker: string, generation: GroupGeneration): string {
  const others = names.filter((name) => name !== speaker)
  return [
    '## 群聊（多角色同场）',
    `场上角色：${names.join('、')}。`,
    `当前发言者：${speaker}。只写「${speaker}」这一条回复。`,
    others.length > 0 ? `不要替 ${others.join('、')} 或用户说话。` : '',
    generation === 'join'
      ? '所有角色的设定已合并提供；请保持各自的口吻、立场和称呼习惯。'
      : '本轮只提供当前发言者的角色设定，其他人的信息以对话历史为准。',
    '不要在回复开头写角色名，直接写正文。',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 模型偶尔会模仿历史格式自带「名字：」前缀；入库前只剥掉当前发言者的前缀 */
export function stripSpeakerPrefix(text: string, speaker: string): string {
  if (!text) return text
  const escaped = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`^\\s*\\*\\*${escaped}\\*\\*\\s*[:：]\\s*`),
    new RegExp(`^\\s*【${escaped}】\\s*[:：]?\\s*`),
    new RegExp(`^\\s*${escaped}\\s*[:：]\\s*`),
  ]
  for (const pattern of patterns) {
    const next = text.replace(pattern, '')
    if (next !== text) return next
  }
  return text
}

/** 给群聊历史里的 assistant 消息加上角色名前缀，让模型分清谁说过什么 */
export function labelSpeaker(text: string, speaker?: string): string {
  if (!speaker) return text
  return `${speaker}：${text}`
}