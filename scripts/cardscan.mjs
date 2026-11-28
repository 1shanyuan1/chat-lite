/**
 * 角色卡静态扫描器：只出统计，不出正文。
 *
 * 背景：面板卡的正文（正则 replaceString、世界书、状态栏 HTML）动辄几百 KB，
 * 整卡读进对话上下文会撑爆窗口触发供应商围栏。这个工具解析卡之后只输出
 * 统计摘要——扩展键名、正则脚本元数据、HTML 标签频次、CSS 属性频次、宏频次、
 * 危险信号——所有文本一律截断，用来给 sanitizer 白名单和兼容优先级定数据。
 *
 * 用法：
 *   npm run cardscan -- 路径/卡.json
 *   npm run cardscan -- 路径/卡.png      # PNG 内嵌卡（tEXt / zTXt / iTXt）
 *   npm run cardscan -- 路径/卡.charx    # zip 容器，取 card.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { inflateSync, inflateRawSync, gunzipSync } from 'node:zlib'

/* ---------------- 载入：三种容器，层层剥开 ---------------- */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CARD_KEYWORDS = ['ccv3', 'chara', 'ccv2', 'character']

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true })
/** 规范写 Latin-1，实际 UTF-8 更常见；先严格解 UTF-8，失败退 Latin-1 */
const decodeText = (buf) => {
  try {
    return fatalUtf8.decode(buf)
  } catch {
    return buf.toString('latin1')
  }
}

/** zlib/gzip 解包，失败返回 null */
function tryInflate(buf) {
  if (buf.length < 2) return null
  try {
    if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8')
    return inflateSync(buf).toString('utf8')
  } catch {
    return null
  }
}

/** zip 条目用的是 deflate 原始流（无 zlib 头），失败返回 null */
function tryInflateRaw(buf) {
  try {
    return inflateRawSync(buf).toString('utf8')
  } catch {
    return null
  }
}

const tryJson = (text) => {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '').trim())
  } catch {
    return null
  }
}

/**
 * 字符串层剥壳：JSON 套 JSON、base64 套 JSON、data URL、gzip 的 base64。
 * 和 characters.ts 的 unwrapCard 同一套语义。
 */
function unwrap(value) {
  let current = value
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth++) {
    const asJson = tryJson(current)
    if (asJson !== null) {
      current = asJson
      continue
    }
    const dataUrl = /^data:[^,]*;base64,/i.exec(current)
    const compact = (dataUrl ? current.slice(dataUrl[0].length) : current).replace(/[\s\u0000]+/g, '')
    if (compact.length >= 4 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
      const raw = Buffer.from(compact.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
      // 解出来多半还是文本（JSON），不是压缩流就按原文继续剥
      const text = tryInflate(raw) ?? raw.toString('utf8')
      if (text) {
        current = text
        continue
      }
    }
    break
  }
  return current
}

/** 得像个卡：空的 ccv3 占位块不能挡住后面的 chara */
function isCardShape(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const root = value
  const data = root.data && typeof root.data === 'object' ? root.data : root
  return ['name', 'first_mes', 'firstMessage', 'description'].some(
    (key) => typeof data[key] === 'string'
  )
}

function extractFromPng(buf) {
  if (buf.length < 8 || !PNG_SIG.every((b, i) => buf[i] === b)) return null
  const chunks = []
  let offset = 8
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    const start = offset + 8
    const end = start + length
    if (end + 4 > buf.length) break
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = buf.subarray(start, end)
      const zero = data.indexOf(0)
      if (zero > 0) {
        const keyword = data.toString('latin1', 0, zero).trim()
        let text = null
        if (type === 'tEXt') {
          text = decodeText(data.subarray(zero + 1))
        } else if (type === 'zTXt') {
          // keyword\0 压缩方法(1) 压缩数据
          if (data[zero + 1] === 0) text = tryInflate(data.subarray(zero + 2))
        } else {
          // iTXt：keyword\0 标志(1) 方法(1) lang\0 translated\0 body
          const compressed = data[zero + 1]
          const langEnd = data.indexOf(0, zero + 3)
          if (langEnd >= 0) {
            const translatedEnd = data.indexOf(0, langEnd + 1)
            if (translatedEnd >= 0) {
              const body = data.subarray(translatedEnd + 1)
              text = compressed === 0 ? decodeText(body) : tryInflate(body)
            }
          }
        }
        if (text) chunks.push({ keyword, text })
      }
    }
    offset = end + 4 // 跳过 CRC
    if (type === 'IEND') break
  }
  const rank = (keyword) => {
    const index = CARD_KEYWORDS.indexOf(keyword.toLowerCase())
    return index < 0 ? CARD_KEYWORDS.length : index
  }
  chunks.sort((a, b) => rank(a.keyword) - rank(b.keyword))
  for (const chunk of chunks) {
    if (rank(chunk.keyword) === CARD_KEYWORDS.length) continue
    const card = unwrap(chunk.text)
    if (isCardShape(card)) return card
  }
  return null
}

/** 最小 zip 读取：中央目录里找 card.json，找不到退回第一个能解的 .json */
function extractFromZip(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const count = buf.readUInt16LE(eocd + 10)
  let ptr = buf.readUInt32LE(eocd + 16)
  let fallback = null
  for (let n = 0; n < count && ptr + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen)
    ptr += 46 + nameLen + extraLen + commentLen
    if (!name.endsWith('.json')) continue
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) continue
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = buf.subarray(dataStart, dataStart + compSize)
    const text = method === 0 ? decodeText(data) : method === 8 ? tryInflateRaw(data) : null
    if (text === null) continue
    const parsed = tryJson(text)
    if (parsed === null) continue
    if (name === 'card.json' || name.endsWith('/card.json')) return parsed
    fallback ??= parsed
  }
  return fallback
}

/* ---------------- 统计：频次、截断、危险信号 ---------------- */

const countBy = (list) => {
  const map = new Map()
  for (const item of list) map.set(item, (map.get(item) ?? 0) + 1)
  return map
}
const topList = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, value]) => `${key}:${value}`)
const topPairs = (map, n) =>
  [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)

/** HTML 标签频次：`<tag` 与 `</tag` 一起算 */
const tagRe = /<\/?\s*([A-Za-z][\w-]*)/g
function tagCensus(text) {
  if (!text) return new Map()
  return countBy((text.match(tagRe) ?? []).map((t) => t.replace(/^<\/?/, '').toLowerCase()))
}

/** CSS 属性频次：style="..." 属性值 + <style> 块里的声明 */
const styleAttrRe = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
function cssCensus(text) {
  if (!text) return new Map()
  const parts = []
  for (const m of text.matchAll(styleAttrRe)) parts.push(m[1] ?? m[2] ?? '')
  for (const m of text.matchAll(styleBlockRe)) parts.push(m[1] ?? '')
  const props = []
  for (const part of parts) {
    for (const m of part.matchAll(/([a-zA-Z-]+)\s*:/g)) {
      const name = m[1].toLowerCase()
      if (name === 'http' || name === 'https') continue // url(https://…) 的假阳性
      props.push(name)
    }
  }
  return countBy(props)
}

const DANGER = {
  scriptTag: /<script/i,
  jsUrl: /javascript:/i,
  eventAttr: /\son\w+\s*=/i,
  iframe: /<iframe/i,
  cssUrl: /url\s*\(/i,
  cssImport: /@import/i,
  positionFixed: /position\s*:\s*fixed/i,
  htmlDataUrl: /data\s*:\s*text\/html/i,
}
const RUNNER = {
  TavernHelper: /TavernHelper/i,
  'js-slash-runner': /js-slash-runner|酒馆助手/i,
  triggerSlash: /triggerSlash/i,
  getvar: /getvar|get_message_variable/i,
  setvar: /setvar|set_message_variable|UpdateVariable/i,
  stscript: /(^|\n)\s*\/(gen|send|setvar|trigger)\b/,
}

/** 危险信号 + 脚本引擎特征，逐层计数 */
function signalCensus(text) {
  if (!text) return {}
  const out = {}
  for (const [key, re] of Object.entries(DANGER)) {
    const count = (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length
    if (count > 0) out[key] = count
  }
  return out
}
function runnerCensus(text) {
  if (!text) return {}
  const out = {}
  for (const [key, re] of Object.entries(RUNNER)) {
    const count = (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length
    if (count > 0) out[key] = count
  }
  return out
}

const MACRO_RE = /\{\{\s*([^{}\n]{1,60}?)\s*\}\}/g
function macroCensus(text) {
  if (!text) return new Map()
  const names = []
  for (const m of text.matchAll(MACRO_RE)) {
    const head = m[1].split(/[:\s]/)[0].toLowerCase()
    names.push(head === 'char' || head === 'user' ? head : `{{${head}…}}`)
  }
  return countBy(names)
}

const trunc = (text, n) => (text.length > n ? `${text.slice(0, n)}…` : text)

/* ---------------- 主流程 ---------------- */

const file = process.argv[2]
if (!file) {
  console.error('用法：npm run cardscan -- <卡片路径>')
  process.exit(1)
}
const buf = fs.readFileSync(path.resolve(file))

let kind = '?'
let raw = null
const isPng = buf.length >= 8 && PNG_SIG.every((b, i) => buf[i] === b)
if (isPng) {
  kind = 'png'
  raw = extractFromPng(buf)
} else if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
  kind = 'charx'
  raw = extractFromZip(buf)
} else {
  kind = 'json'
  raw = unwrap(buf.toString('utf8'))
}
if (!isCardShape(raw)) {
  console.error('这个文件里没有认得出角色卡的数据')
  process.exit(1)
}

const root = raw
const data = root.data && typeof root.data === 'object' ? root.data : root
const ext = data.extensions && typeof data.extensions === 'object' ? data.extensions : {}

// 正则脚本：主字段是 extensions.regex_scripts；个别实现会换键名，凡是数组项带 findRegex 的都收
const regexItems = []
const collectRegex = (value) => {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (item && typeof item === 'object' && typeof item.findRegex === 'string') regexItems.push(item)
  }
}
collectRegex(ext.regex_scripts)
for (const [key, value] of Object.entries(ext)) {
  if (key !== 'regex_scripts' && /regex/i.test(key)) collectRegex(value)
}

const qrItems = Array.isArray(ext.quick_replies) ? ext.quick_replies.filter((q) => q && typeof q === 'object') : []

// 分层做统计：模型短标记 → 正则 replaceString → 面板 HTML/CSS 的链路就藏在这几层里
const bookEntries = (() => {
  const book = data.character_book
  const entries = book?.entries ?? book
  if (!entries) return []
  return Array.isArray(entries) ? entries : Object.values(entries)
})()

const layers = {
  regexFind: regexItems.map((r) => r.findRegex ?? '').join('\n'),
  regexReplace: regexItems.map((r) => r.replaceString ?? '').join('\n'),
  worldbook: bookEntries.map((e) => e?.content ?? '').join('\n'),
  greeting: [data.first_mes, ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [])].join('\n'),
  prompt: [data.description, data.personality, data.scenario, data.mes_example, data.system_prompt, data.post_history_instructions]
    .filter((t) => typeof t === 'string')
    .join('\n'),
}

const knownTags = new Set(
  ['a', 'abbr', 'b', 'blockquote', 'body', 'br', 'button', 'caption', 'code', 'col', 'dd', 'del', 'details', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'li', 'ol', 'p', 'pre', 'q', 's', 'small', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'].map((t) => t)
)

const layerStats = {}
for (const [name, text] of Object.entries(layers)) {
  layerStats[name] = {
    chars: text.length,
    tags: topList(tagCensus(text), name === 'regexReplace' || name === 'greeting' ? 20 : 12),
    css: topList(cssCensus(text), 20),
    danger: signalCensus(text),
    runner: runnerCensus(text),
  }
}

// 自定义标签（不在常见 HTML 集合里的）：全层合并排名 + 出现在哪一层
const customTagLayerCounts = new Map()
for (const [name, text] of Object.entries(layers)) {
  for (const [tag, count] of tagCensus(text)) {
    if (knownTags.has(tag)) continue
    const entry = customTagLayerCounts.get(tag) ?? {}
    entry[name] = (entry[name] ?? 0) + count
    entry.total = (entry.total ?? 0) + count
    customTagLayerCounts.set(tag, entry)
  }
}
const customTags = [...customTagLayerCounts.entries()]
  .sort((a, b) => b[1].total - a[1].total)
  .slice(0, 20)
  .map(([tag, counts]) => ({ tag, ...counts }))

const macroMap = new Map()
for (const text of Object.values(layers)) {
  for (const [name, count] of macroCensus(text)) macroMap.set(name, (macroMap.get(name) ?? 0) + count)
}

const positionDist = countBy(bookEntries.map((e) => String(e?.position ?? e?.sticky ?? '-')))
const depthCount = bookEntries.filter((e) => typeof e?.depth === 'number' || typeof e?.position === 'number').length
const qrFields = new Set()
for (const item of qrItems) for (const key of Object.keys(item)) qrFields.add(key)

const report = {
  file: path.basename(file),
  bytes: buf.length,
  kind,
  spec: root.spec ?? '(无 spec，旧版扁平卡)',
  dataKeys: Object.keys(data).sort(),
  extKeys: Object.entries(ext)
    .map(([key, value]) => ({ key, bytes: JSON.stringify(value ?? null)?.length ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes),
  sizes: {
    description: (data.description ?? '').length,
    personality: (data.personality ?? '').length,
    scenario: (data.scenario ?? '').length,
    first_mes: (data.first_mes ?? '').length,
    mes_example: (data.mes_example ?? '').length,
    system_prompt: (data.system_prompt ?? '').length,
    post_history: (data.post_history_instructions ?? '').length,
    greetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.length : 0,
  },
  regexScripts: {
    count: regexItems.length,
    findChars: layers.regexFind.length,
    replaceChars: layers.regexReplace.length,
    items: regexItems.slice(0, 30).map((r) => ({
      name: trunc(String(r.scriptName ?? '(未命名)'), 40),
      find: trunc(r.findRegex ?? '', 90),
      replaceLen: (r.replaceString ?? '').length,
      placement: r.placement ?? null,
      markdownOnly: r.markdownOnly === true,
      promptOnly: r.promptOnly === true,
      disabled: r.disabled === true,
    })),
  },
  quickReplies: {
    count: qrItems.length,
    fields: [...qrFields].sort(),
    items: qrItems.slice(0, 25).map((q) => ({
      label: trunc(String(q.label ?? q.title ?? '(无标签)'), 30),
      msgLen: typeof q.message === 'string' ? q.message.length : Array.isArray(q.message) ? q.message.join('\n').length : 0,
      isSlash: (typeof q.message === 'string' ? q.message : '').trimStart().startsWith('/'),
    })),
  },
  worldbook: {
    entries: bookEntries.length,
    constant: bookEntries.filter((e) => e?.constant === true || e?.sticky === true).length,
    totalChars: layers.worldbook.length,
    position: Object.fromEntries(topPairs(positionDist, 10)),
    withDepthOrNumericPos: depthCount,
    withSecondary: bookEntries.filter((e) => Array.isArray(e?.secondary_keys) && e.secondary_keys.length > 0).length,
    selectiveFalse: bookEntries.filter((e) => e?.selective === false).length,
  },
  depthPrompt: ext.depth_prompt
    ? { depth: ext.depth_prompt.depth ?? null, chars: (ext.depth_prompt.prompt ?? '').length, role: ext.depth_prompt.role ?? null }
    : null,
  layers: layerStats,
  customTags,
  macros: topList(macroMap, 20),
}

console.log(JSON.stringify(report, null, 1))
