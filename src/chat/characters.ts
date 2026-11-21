import { gunzipSync, unzlibSync } from 'fflate'

export interface WorldEntry {
  id: string
  /** 触发关键词，命中任意一个就注入 */
  keys: string[]
  content: string
  enabled: boolean
  /** 常驻注入，不看关键词 */
  constant?: boolean
  /**
   * 二级关键词：非空时要求「主键命中 + 二级键也命中」才注入。
   * 对应 V2 的 secondary_keys，用于把范围收窄（比如「森林」这条只在提到「夜晚」时才生效）。
   */
  secondaryKeys?: string[]
  /** 主键与二级键是 AND 还是 OR；V2 里叫 selective，默认 true（AND） */
  selective?: boolean
  /** 区分大小写；默认 false */
  caseSensitive?: boolean
  /** 整词匹配，避免「cat」命中「category」；对中文无效，自动忽略 */
  matchWholeWords?: boolean
  /** 插入顺序，越小越靠前；同分时用它兜底 */
  order?: number
  /** 用户锁住这条，设定发展模式里的 AI 不会改动它 */
  locked?: boolean
}

export interface CharacterCard {
  id: string
  name: string
  description: string
  personality: string
  scenario: string
  firstMessage: string
  exampleDialogue: string
  /** 角色自带的系统提示词（V2 的 system_prompt） */
  systemPrompt?: string
  /** 备选开场（V2 的 alternate_greetings），不含 firstMessage 本身 */
  greetings: string[]
  /** 历史之后的追加指令（V2 的 post_history_instructions） */
  postHistory?: string
  /**
   * 卡片自带的元信息。导进来的卡能不能看出「这是谁做的、什么版本、什么标签」
   * 全靠这几个字段——不解析的话寄存区只剩一个名字和正文。
   */
  spec?: string
  creator?: string
  creatorNotes?: string
  tags?: string[]
  version?: string
  avatar?: string
  worldInfo: WorldEntry[]
  createdAt: number
}

export const emptyCard = (): CharacterCard => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMessage: '',
  exampleDialogue: '',
  greetings: [],
  worldInfo: [],
  createdAt: Date.now(),
})

/* ---------------- V2 / V1 卡解析 ---------------- */

type Raw = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function parseWorldInfo(raw: unknown): WorldEntry[] {
  const book = raw as Raw | undefined
  const entries = (book?.entries ?? book) as unknown
  const list = Array.isArray(entries) ? entries : Object.values((entries ?? {}) as Raw)

  const out: WorldEntry[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Raw
    const keysRaw = entry.keys ?? entry.key ?? []
    const keys = (Array.isArray(keysRaw) ? keysRaw : String(keysRaw).split(','))
      .map((k) => String(k).trim())
      .filter(Boolean)
    const content = str(entry.content)
    if (!keys.length && !content) continue
    const secondaryRaw = entry.secondary_keys ?? entry.secondaryKeys ?? []
    const secondaryKeys = (Array.isArray(secondaryRaw) ? secondaryRaw : String(secondaryRaw).split(','))
      .map((k) => String(k).trim())
      .filter(Boolean)

    out.push({
      id: crypto.randomUUID(),
      keys,
      content,
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: entry.constant === true,
      ...(secondaryKeys.length > 0 ? { secondaryKeys } : {}),
      // V2 的 selective 默认 true：写了二级键就意味着要同时命中
      ...(secondaryKeys.length > 0 ? { selective: entry.selective !== false } : {}),
      ...(entry.case_sensitive === true ? { caseSensitive: true } : {}),
      ...(entry.match_whole_words === true ? { matchWholeWords: true } : {}),
      ...(typeof entry.insertion_order === 'number' ? { order: entry.insertion_order } : {}),
    })
  }
  return out
}

/**
 * 备选开场：过滤空串，并去掉和默认开场重复的那条。
 * 有些卡会把 first_mes 原样复制到 alternate_greetings[0]，不去重就会出现两条一样的。
 */
function parseAlternates(raw: unknown, first: string): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const text = str(item).trim()
    if (!text || text === first.trim()) continue
    if (out.includes(text)) continue
    out.push(text)
  }
  return out
}

/**
 * 作者备注：V2 是字符串，V3 有 creator_notes_multilingual 这个多语言对象。
 * 中文优先，没有再取第一个非空的值。
 */
function pickNotes(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (!raw || typeof raw !== 'object') return ''
  const map = raw as Record<string, unknown>
  for (const key of ['zh', 'zh-cn', 'zh_CN', 'zh-Hans', 'en']) {
    const value = map[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  for (const value of Object.values(map)) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/** 兼容 chara_card_v2 / chara_card_v3 / 旧版扁平结构 */
export function normalizeCard(payload: unknown): CharacterCard {
  const root = (payload ?? {}) as Raw
  const data = (root.spec ? root.data : root) as Raw | undefined
  const d = (data ?? root) as Raw
  const tags = Array.isArray(d.tags) ? d.tags.map((tag) => str(tag).trim()).filter(Boolean) : []

  const card: CharacterCard = {
    id: crypto.randomUUID(),
    name: str(d.name) || '未命名角色',
    description: str(d.description),
    personality: str(d.personality),
    scenario: str(d.scenario),
    firstMessage: str(d.first_mes) || str(d.firstMessage) || str(d.greeting),
    exampleDialogue: str(d.mes_example) || str(d.example_dialogue),
    systemPrompt: str(d.system_prompt) || undefined,
    greetings: parseAlternates(d.alternate_greetings, str(d.first_mes) || str(d.firstMessage) || str(d.greeting)),
    postHistory: str(d.post_history_instructions) || undefined,
    spec: str(root.spec) || undefined,
    creator: str(d.creator) || undefined,
    creatorNotes: pickNotes(d.creator_notes_multilingual) || pickNotes(d.creator_notes) || undefined,
    tags: tags.length > 0 ? tags : undefined,
    version: str(d.character_version) || undefined,
    createdAt: Date.now(),
    worldInfo: parseWorldInfo(d.character_book),
  }
  return card
}

/* ---------------- PNG 内嵌卡（SillyTavern 主流格式） ---------------- */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 按内容判断是不是 PNG：社区文件的扩展名经常不可信 */
export function isPngBuffer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)
}

/**
 * PNG 里能装角色卡的关键词，按优先级排列。
 * 同一张卡常同时写 chara（V2）和 ccv3（V3）；SillyTavern 优先读 ccv3，
 * 我们也得跟着走，否则 V3 才有的字段（多语言备注、群聊开场）会丢。
 */
const CARD_KEYWORDS = ['ccv3', 'chara', 'ccv2', 'character']

interface TextChunk {
  keyword: string
  text: string
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: false })

const latin1 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return out
}

/**
 * tEXt 规范写的是 Latin-1，但实际文件里 UTF-8 更常见（关键词是 ASCII，正文可能直接是中文 JSON）。
 * 先按 UTF-8 严格解，失败再退回 Latin-1。
 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return latin1(bytes)
  }
}

/** zlib 或 gzip 压缩的数据；解不开返回 null（调用方按未压缩处理） */
function inflateBytes(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 2) return null
  try {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzipSync(bytes)
    return unzlibSync(bytes)
  } catch {
    return null
  }
}

/** tEXt / zTXt / iTXt 三种文本块 → { 关键词, 文本 } */
function parseTextChunk(type: string, data: Uint8Array): TextChunk | null {
  const zero = data.indexOf(0)
  if (zero <= 0) return null
  const keyword = latin1(data.subarray(0, zero)).trim()
  if (!keyword) return null

  if (type === 'tEXt') return { keyword, text: decodeText(data.subarray(zero + 1)) }

  if (type === 'zTXt') {
    // keyword\0 压缩方法(1) 压缩数据；方法 0 是 deflate
    if (data[zero + 1] !== 0) return null
    const raw = inflateBytes(data.subarray(zero + 2))
    return raw ? { keyword, text: utf8Decoder.decode(raw) } : null
  }

  // iTXt：keyword\0 压缩标志(1) 压缩方法(1) 语言标签\0 翻译关键词\0 文本
  const compressed = data[zero + 1]
  const method = data[zero + 2]
  const langEnd = data.indexOf(0, zero + 3)
  if (langEnd < 0) return null
  const translatedEnd = data.indexOf(0, langEnd + 1)
  if (translatedEnd < 0) return null
  const body = data.subarray(translatedEnd + 1)
  if (compressed === 0) return { keyword, text: utf8Decoder.decode(body) }
  if (compressed !== 1 || method !== 0) return null
  const raw = inflateBytes(body)
  return raw ? { keyword, text: utf8Decoder.decode(raw) } : null
}

/** base64 → 字节；容忍换行、URL-safe 字符和缺失的补位 */
function base64Bytes(text: string): Uint8Array | null {
  // 换行、空格、补位的 NUL 都可能出现，atob 只认纯字母表
  const compact = text.replace(/[\s\u0000]+/g, '')
  if (compact.length < 4) return null
  const normalized = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    // atob 返回「每字符一字节」的二进制串，后面必须按 UTF-8 重新解码，
    // 否则中文角色名会变成乱码
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

const jsonValue = (text: string): unknown | null => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** 卡数据可能被再包一层字符串（JSON 套 JSON、base64 套 JSON），循环剥开 */
function unwrapCard(value: unknown): unknown | null {
  let current = value
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth++) {
    const asJson = jsonValue(current.trim())
    if (asJson !== null) {
      current = asJson
      continue
    }
    // 解出来还是一串 base64（有人把 JSON 序列化后又编码了一次）
    const asCard = decodeCardBytes(current)
    if (asCard === null) break
    current = asCard
  }
  return current && typeof current === 'object' ? current : null
}

function decodeCardBytes(text: string): unknown | null {
  const dataUrl = /^data:[^,]*;base64,/i.exec(text)
  const bytes = base64Bytes(dataUrl ? text.slice(dataUrl[0].length) : text)
  if (!bytes) return null
  const raw = inflateBytes(bytes) ?? bytes
  return jsonValue(utf8Decoder.decode(raw).replace(/^\uFEFF/, '').trim())
}

/**
 * 文本块里的卡数据：明文 JSON、base64 的 JSON、data URL，甚至 gzip 过的 base64。
 * 返回 null 表示这段文本不是角色卡。
 */
export function parseCardPayload(payload: string): unknown | null {
  const trimmed = payload.replace(/^\uFEFF/, '').replace(/\u0000+$/, '').trim()
  if (!trimmed) return null
  const direct = jsonValue(trimmed)
  return unwrapCard(direct ?? decodeCardBytes(trimmed))
}

/** 解出来的东西得像一张卡：有些文件会放一个空的 ccv3 占位块，不能让它挡住后面的 chara */
function isCardShape(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const root = value as Record<string, unknown>
  const data = (root.data && typeof root.data === 'object' ? root.data : root) as Record<string, unknown>
  return ['name', 'first_mes', 'firstMessage', 'description'].some((key) => typeof data[key] === 'string')
}

/**
 * 从 PNG 里取出角色卡。
 * 格式：PNG 签名(8) + 若干块[len(4) type(4) data crc(4)]。
 * 卡数据可能藏在 tEXt（最常见）、zTXt 或 iTXt 里，三种都要认——
 * 只认 tEXt 的话，社区里相当一部分卡会导入失败。
 */
export function extractCardFromPng(buffer: ArrayBuffer): unknown | null {
  const bytes = new Uint8Array(buffer)
  if (!isPngBuffer(buffer)) return null
  const view = new DataView(buffer)

  const candidates: TextChunk[] = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const start = offset + 8
    const end = start + length
    // 尾部损坏的文件：能读到哪算哪，不因为最后一块不完整就整张放弃
    if (end + 4 > bytes.length) break
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const chunk = parseTextChunk(type, bytes.subarray(start, end))
      if (chunk) candidates.push(chunk)
    }
    offset = end + 4 // 跳过 CRC
    if (type === 'IEND') break
  }

  const rank = (keyword: string) => {
    const index = CARD_KEYWORDS.indexOf(keyword.toLowerCase())
    return index < 0 ? CARD_KEYWORDS.length : index
  }
  candidates.sort((a, b) => rank(a.keyword) - rank(b.keyword))

  for (const chunk of candidates) {
    if (rank(chunk.keyword) === CARD_KEYWORDS.length) continue
    const card = parseCardPayload(chunk.text)
    if (isCardShape(card)) return card
  }
  return null
}

/* ---------------- 宏替换与提示词渲染 ---------------- */

export function applyMacros(text: string, charName: string, userName: string): string {
  if (!text) return ''
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<BOT>/gi, charName)
    .replace(/<USER>/gi, userName)
}

/** 把角色卡渲染成注入 system prompt 的文本块 */
export function renderCard(card: CharacterCard, userName: string): string {
  const name = card.name || '角色'
  const blocks: string[] = []
  if (card.systemPrompt) blocks.push(applyMacros(card.systemPrompt, name, userName))
  blocks.push(`你正在扮演「${name}」，与「${userName}」对话。始终保持角色的口吻、性格与认知边界，不要跳出角色解释或总结。`)
  if (card.description) blocks.push(`角色设定：\n${applyMacros(card.description, name, userName)}`)
  if (card.personality) blocks.push(`性格：\n${applyMacros(card.personality, name, userName)}`)
  if (card.scenario) blocks.push(`当前情境：\n${applyMacros(card.scenario, name, userName)}`)
  if (card.exampleDialogue) blocks.push(`对话示例（仅作语气参考，不要照抄）：\n${applyMacros(card.exampleDialogue, name, userName)}`)
  return blocks.join('\n\n')
}
