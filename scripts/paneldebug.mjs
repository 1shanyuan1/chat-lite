/**
 * 面板管线诊断：取真实会话里最后一条 AI 回复，跑真实显示侧管线
 * （applyDisplayRegex → cleanCardHtml），只输出结构化事实，不打印正文。
 *
 *   npm run paneldebug -- <db文件> <卡png>
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.argv[2]
const cardPath = process.argv[3]

const { normalizeCard, extractCardFromPng, isPngBuffer } = await import('@/chat/characters')
const { settingFromCard } = await import('@/chat/settings')
const { applyDisplayRegex, applyPromptRegex } = await import('@/chat/card-regex')
const { cleanCardHtml } = await import('@/chat/card-html')

// 卡
const buffer = fs.readFileSync(cardPath)
const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteLength)
const raw = isPngBuffer(ab) ? extractCardFromPng(ab) : JSON.parse(buffer.toString('utf8'))
const card = normalizeCard(raw)
const doc = settingFromCard(card)
console.log('卡脚本数:', doc.regexScripts?.length ?? 0)
const archiveScript = doc.regexScripts?.find((s) => s.name.includes('档案') || s.find.includes('调查员档案'))
if (archiveScript) {
  console.log('档案脚本: flags=%s replaceLen=%d markdownOnly=%s placement=%j', archiveScript.flags, archiveScript.replace.length, archiveScript.markdownOnly, archiveScript.placement)
}

// 最后一条 AI 回复
const db = new DatabaseSync(dbPath)
const rows = db.prepare('SELECT idx, variants, created_at FROM turns ORDER BY created_at DESC LIMIT 3').all()
console.log('最近轮数:', rows.length)
for (const row of rows.reverse()) {
  const variants = JSON.parse(String(row.variants))
  const content = variants[0]?.assistant?.content ?? ''
  const openCount = (content.match(/\[调查员档案开启\]/g) ?? []).length
  const closeCount = (content.match(/\[调查员档案关闭\]/g) ?? []).length
  const衍生 = (content.match(/\[衍生数据\]/g) ?? []).length
  console.log(`--- turn idx=${row.idx} len=${content.length} 开启=${openCount} 关闭=${closeCount} 衍生块=${衍生}`)

  // 真实显示管线
  const display = applyDisplayRegex(content, [doc], '你')
  const displayOpen = (display.match(/\[调查员档案开启\]/g) ?? []).length
  const cleaned = cleanCardHtml(display)
  const panelLooksHtml = /<div|<table|<details/i.test(cleaned.body)
  console.log(`    显示侧后: 长度=${display.length} 残留开启=${displayOpen} script=${cleaned.hasScript} html结构=${panelLooksHtml} 替换后长度变化=${display.length - content.length}`)

  // 替换发生的位置：显示文本里第一个「衍生数据」前后 60 字（判断它是否在面板内）
  const idx = display.indexOf('[衍生数据]')
  if (idx >= 0) {
    console.log(`    [衍生数据] 在显示文本中的位置: ${idx}（替换后总长 ${display.length}）`)
    const before = display.slice(Math.max(0, idx - 60), idx).replace(/\s+/g, ' ')
    console.log(`    前文片段: …${before}`)
  }
}
