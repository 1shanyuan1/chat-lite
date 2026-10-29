export interface WorldEntry {
  id: string
  /** 触发关键词，命中任意一个就注入 */
  keys: string[]
  content: string
  enabled: boolean
  /** 常驻注入，不看关键词 */
  constant?: boolean
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
    out.push({
      id: crypto.randomUUID(),
      keys,
      content,
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: entry.constant === true,
    })
  }
  return out
}

/** 兼容 chara_card_v2 / chara_card_v3 / 旧版扁平结构 */
export function normalizeCard(payload: unknown): CharacterCard {
  const root = (payload ?? {}) as Raw
  const data = (root.spec ? root.data : root) as Raw | undefined
  const d = (data ?? root) as Raw

  const card: CharacterCard = {
    id: crypto.randomUUID(),
    name: str(d.name) || '未命名角色',
    description: str(d.description),
    personality: str(d.personality),
    scenario: str(d.scenario),
    firstMessage: str(d.first_mes) || str(d.firstMessage) || str(d.greeting),
    exampleDialogue: str(d.mes_example) || str(d.example_dialogue),
    systemPrompt: str(d.system_prompt) || undefined,
    createdAt: Date.now(),
    worldInfo: parseWorldInfo(d.character_book),
  }
  return card
}

/* ---------------- PNG 内嵌卡（SillyTavern 主流格式） ---------------- */

/**
 * 从 PNG 的 tEXt/iTXt 块里取出 base64 的角色卡。
 * 格式：PNG 签名(8) + 若干块[len(4) type(4) data crc(4)]，chara 块的关键词是 'chara'。
 */
export function extractCardFromPng(buffer: ArrayBuffer): unknown | null {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47) return null

  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > bytes.length) return null

    if (type === 'tEXt' || type === 'iTXt') {
      const chunk = bytes.slice(dataStart, dataEnd)
      const text = new TextDecoder('latin1').decode(chunk)
      const zero = text.indexOf('\u0000')
      if (zero > 0) {
        const keyword = text.slice(0, zero).toLowerCase()
        if (keyword === 'chara' || keyword === 'ccv3') {
          try {
            // atob 返回的是「每字符一字节」的二进制串，必须按 UTF-8 重新解码，
            // 否则中文角色名会变成乱码
            const binary = atob(text.slice(zero + 1).trim())
            const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
            return JSON.parse(new TextDecoder('utf-8').decode(bytes))
          } catch {
            return null
          }
        }
      }
    }
    offset = dataEnd + 4 // 跳过 CRC
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
