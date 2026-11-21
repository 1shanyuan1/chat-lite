/**
 * 设定的长文本形态：一份设定可以写成一段纯文本，导入导出都走这里。
 *
 * 为什么要有它：
 * - 手机上没有舒服的方式逐条编辑「关键词 / 二级关键词 / 内容」四五个小控件；
 * - 设定发展模式会自己长出几十条条目，用户需要能一次看完、一次改完；
 * - 单份设定原本没有任何导出入口，条目只存在于 localStorage / SQLite 里。
 *
 * 格式（纯文本，不依赖 Markdown）：
 *
 *   【设定：雾港】
 *
 *   正文……
 *
 *   【条目：雾港, 港口】
 *   条目内容……
 *
 *   【条目：潮汐教团, 教团｜常驻｜锁定｜二级：海雾】
 *   条目内容……
 *
 * 规则：
 * - 【设定：名字】只在文件最前面识别，可省略（省略就沿用原名字 / 文件名）。
 * - 第一个【条目：】之前的所有内容都是正文；没有条目时整篇都是正文。
 * - 条目行里的关键词用逗号分隔；`｜` 后面是开关：常驻 / 锁定 / 停用 / 二级：…
 * - 正文或条目内容里真的出现「【条目：」这种行时，导出会加一个反斜杠转义，
 *   解析时去掉一个反斜杠还原。这是唯一需要转义的地方。
 *
 * 运行时语义完全不变：正文仍然每轮注入，条目仍然按关键词命中。
 * 文本只是编辑与交换的形态，不是新的存储格式。
 */
import type { SettingDoc, SettingEntry } from './settings'

const NAME_HEAD = /^【设定：(.*)】\s*$/
const ENTRY_HEAD = /^【条目：(.*)】\s*$/
/** 行首一个或多个反斜杠 + 标记，表示这是字面文本，不是条目/名字 */
const ESCAPED = /^\\+【(?:设定|条目)：/
const MARKER_START = /^\\*【(?:设定|条目)：/

export interface SettingTextStats {
  /** 解析出的条目总数 */
  entries: number
  /** 相比旧文档新增的条目 */
  added: number
  /** 关键词没变、复用了旧条目的数量 */
  kept: number
  /** 旧文档里有、新文本里没有的条目（保存后会消失） */
  removed: number
  /** 被删掉的条目里有多少条是锁定的——保存前要提醒用户 */
  lockedRemoved: number
  /** 正文长度，给界面显示 */
  bodyChars: number
}

export interface ParsedSettingText {
  /** 只有文本里写了【设定：…】才有；否则调用方沿用原名字 */
  name?: string
  body: string
  entries: SettingEntry[]
  stats: SettingTextStats
}

/** 关键词集合的身份：排序后拼接，顺序不同但内容相同视为同一条 */
const signature = (keys: string[]) =>
  keys
    .map((key) => key.trim())
    .filter(Boolean)
    .sort()
    .join('\u0000')

/** 导出时把真正的标记行转义，避免下次解析被当成分隔符 */
function escapeBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => (MARKER_START.test(line) ? `\\${line}` : line))
    .join('\n')
}

/** 关键词：逗号 / 中文逗号 / 顿号都认，顺序保持原样 */
function splitKeys(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[,，、]/)) {
    const key = part.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

/** 条目头：`关键词｜常驻｜锁定｜停用｜二级：a, b` */
function parseHeader(raw: string): {
  keys: string[]
  constant: boolean
  locked: boolean
  enabled: boolean
  secondaryKeys?: string[]
} {
  const parts = raw.split(/[｜|]/).map((part) => part.trim()).filter(Boolean)
  const keys = splitKeys(parts[0] ?? '')
  let constant = false
  let locked = false
  let enabled = true
  let secondaryKeys: string[] | undefined

  for (const flag of parts.slice(1)) {
    if (flag === '常驻') constant = true
    else if (flag === '锁定') locked = true
    else if (flag === '停用') enabled = false
    else if (/^二级[：:]/.test(flag)) {
      const list = splitKeys(flag.replace(/^二级[：:]/, ''))
      if (list.length > 0) secondaryKeys = list
    }
    // 不认识的开关忽略：宁可少一个标记，也不要把整条读坏
  }

  return { keys, constant, locked, enabled, secondaryKeys }
}

/** 一份设定 → 长文本。名字为空时不写【设定：】行，调用方用文件名兜底 */
export function renderSettingText(doc: Pick<SettingDoc, 'name' | 'body' | 'entries'>): string {
  const blocks: string[] = []
  const name = doc.name.trim()
  if (name) blocks.push(`【设定：${name}】`)
  if (doc.body.trim()) blocks.push(escapeBlock(doc.body.trim()))

  for (const entry of doc.entries) {
    // 没有关键词的条目永远不会命中，写出来只会多一行空标记
    if (entry.keys.length === 0) continue
    const flags: string[] = []
    if (entry.constant) flags.push('常驻')
    if (entry.locked) flags.push('锁定')
    if (entry.enabled === false) flags.push('停用')
    if (entry.secondaryKeys?.length) flags.push(`二级：${entry.secondaryKeys.join(', ')}`)
    const keys = entry.keys.join(', ')
    const head = `【条目：${keys}${flags.length > 0 ? `｜${flags.join('｜')}` : ''}】`
    const content = entry.content.trim()
    blocks.push(content ? `${head}\n${escapeBlock(content)}` : head)
  }

  return blocks.join('\n\n')
}

/**
 * 长文本 → 设定内容。
 *
 * prev 用来保留旧条目的 id 与文本里没有表达的字段（selective / order / 大小写等）。
 * 文本里写了的开关（常驻 / 锁定 / 停用 / 二级）以文本为准——用户改了就算改了。
 * 关键词集合必须完全一致才算「同一条」，避免改了一个关键词就把锁定状态丢了。
 */
export function parseSettingText(text: string, prev?: Pick<SettingDoc, 'entries'>): ParsedSettingText {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')

  let name: string | undefined
  let start = 0
  while (start < lines.length && !lines[start].trim()) start++
  const first = lines[start]
  if (first) {
    const matched = NAME_HEAD.exec(first)
    if (matched) {
      name = matched[1].trim() || undefined
      start += 1
    }
  }

  const bodyLines: string[] = []
  const entries: SettingEntry[] = []
  let current: ReturnType<typeof parseHeader> & { content: string[] } | null = null

  /** 收尾当前条目；没有关键词的条目永远不会命中，直接丢掉 */
  const pushCurrent = () => {
    if (!current) return
    const { keys, content, constant, locked, enabled, secondaryKeys } = current
    const body = content.join('\n').trim()
    current = null
    if (keys.length === 0) return
    entries.push({
      id: '',
      keys,
      content: body,
      enabled,
      ...(constant ? { constant: true } : {}),
      ...(locked ? { locked: true } : {}),
      ...(secondaryKeys ? { secondaryKeys } : {}),
    })
  }

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    // 转义过的标记行：去掉一个反斜杠，当普通文本
    if (ESCAPED.test(raw)) {
      const literal = raw.slice(1)
      if (current) current.content.push(literal)
      else bodyLines.push(literal)
      continue
    }
    const matched = ENTRY_HEAD.exec(raw)
    if (matched) {
      pushCurrent()
      current = { ...parseHeader(matched[1]), content: [] }
      continue
    }
    if (current) current.content.push(raw)
    else bodyLines.push(raw)
  }
  pushCurrent()

  // 去重：同一组关键词写了两遍，只留第一遍
  const seen = new Set<string>()
  const unique: SettingEntry[] = []
  for (const entry of entries) {
    const sig = signature(entry.keys)
    if (seen.has(sig)) continue
    seen.add(sig)
    unique.push(entry)
  }

  const prevBySig = new Map<string, SettingEntry>()
  for (const entry of prev?.entries ?? []) {
    const sig = signature(entry.keys)
    if (!prevBySig.has(sig)) prevBySig.set(sig, entry)
  }

  let added = 0
  let kept = 0
  const keptSigs = new Set<string>()
  const withIds = unique.map((entry) => {
    const sig = signature(entry.keys)
    const old = prevBySig.get(sig)
    if (!old) {
      added += 1
      return { ...entry, id: crypto.randomUUID() }
    }
    kept += 1
    keptSigs.add(sig)
    // 文本没写的兼容字段从旧条目带过来，避免一次文本编辑把 V2 的匹配选项洗掉
    return {
      ...entry,
      id: old.id,
      ...(old.selective !== undefined ? { selective: old.selective } : {}),
      ...(old.caseSensitive !== undefined ? { caseSensitive: old.caseSensitive } : {}),
      ...(old.matchWholeWords !== undefined ? { matchWholeWords: old.matchWholeWords } : {}),
      ...(old.order !== undefined ? { order: old.order } : {}),
    }
  })

  const removedEntries = (prev?.entries ?? []).filter((entry) => !keptSigs.has(signature(entry.keys)))
  const body = bodyLines.join('\n').trim()

  return {
    name,
    body,
    entries: withIds,
    stats: {
      entries: withIds.length,
      added,
      kept,
      removed: removedEntries.length,
      lockedRemoved: removedEntries.filter((entry) => entry.locked).length,
      bodyChars: body.length,
    },
  }
}

/** 把文本应用到一份已有设定上：名字、正文、条目一次性替换，其余字段不动 */
export function applySettingText(
  text: string,
  prev: SettingDoc
): { doc: SettingDoc; stats: SettingTextStats } {
  const parsed = parseSettingText(text, prev)
  return {
    doc: {
      ...prev,
      name: parsed.name ?? prev.name,
      body: parsed.body,
      entries: parsed.entries,
      updatedAt: Date.now(),
    },
    stats: parsed.stats,
  }
}

/** 导出文件名：手机分享面板里能直接看出是哪份设定 */
export function settingTextFileName(name: string): string {
  const safe = (name || '未命名设定').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  return `${safe}.txt`
}
