/**
 * 把一张角色卡按真实导入路径跑一遍，打印寄存区会显示成什么样。
 *
 * 用途：改完解析或寄存区展示之后，拿真卡验收——不用装 App、不用真机截图。
 * 走的是 normalizeCard → settingFromCard，和「导入」按钮完全同一条路径。
 *
 *   npm run cardcase -- 路径/xxx.json
 *   npm run cardcase -- 路径/xxx.png    # PNG 内嵌卡（tEXt / zTXt / iTXt 都认）
 */
import fs from 'node:fs'
import path from 'node:path'
import { normalizeCard, applyMacros, extractCardFromPng, isPngBuffer } from '@/chat/characters'
import { settingFromCard, summaryOf } from '@/chat/settings'

const file = process.argv[2]
if (!file) {
  console.error('用法：npm run cardcase -- <卡片路径>')
  process.exit(1)
}

const buffer = fs.readFileSync(path.resolve(file))
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
const raw = isPngBuffer(arrayBuffer)
  ? extractCardFromPng(arrayBuffer)
  : JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''))
if (!raw) {
  console.error('这个文件里没有角色卡数据')
  process.exit(1)
}
const card = normalizeCard(raw)
const doc = settingFromCard(card)

const openings = doc.firstMessage || (doc.greetings?.length ?? 0) > 0 ? 1 + (doc.greetings?.length ?? 0) : 0
const constant = doc.entries.filter((entry) => entry.constant).length
// 和寄存区列表同一套：{{char}} 换成角色名，否则列表里会露出一串模板变量
const summary = applyMacros(summaryOf(doc.body), doc.name, '你')

const line = (label, value) =>
  console.log(`${label.padEnd(12, ' ')} ${typeof value === 'string' ? value : JSON.stringify(value)}`)

console.log('='.repeat(60))
console.log('寄存区列表里这一行')
console.log('='.repeat(60))
line('名字', doc.name)
line('标签', (doc.tags ?? []).slice(0, 2).join(' / ') || '（无）')
line('简介', summary || '（无）')
line(
  '统计',
  [
    doc.entries.length > 0 ? `${doc.entries.length} 条条目` : '',
    openings > 0 ? `${openings} 段开场` : '',
    doc.body ? `${doc.body.length} 字正文` : '',
  ]
    .filter(Boolean)
    .join(' · ') || '空'
)

console.log('\n' + '='.repeat(60))
console.log('详情面板顶部')
console.log('='.repeat(60))
line('规范', doc.spec ?? '（旧版扁平卡）')
line('作者', doc.creator ?? '（未提供）')
line('版本', doc.version ?? '（未提供）')
line('标签', (doc.tags ?? []).join(' · ') || '（无）')
line('条目', `${doc.entries.length} 条${constant > 0 ? `（${constant} 条常驻）` : ''}`)
line('开场', `${openings} 段`)
line('正文字数', `${doc.body.length} 字`)
line('后置指令', doc.postHistory ? `${doc.postHistory.slice(0, 40)}…` : '（无）')
line('作者备注', doc.creatorNotes ? `${doc.creatorNotes.slice(0, 60)}${doc.creatorNotes.length > 60 ? '…' : ''}` : '（无）')

console.log('\n' + '='.repeat(60))
console.log('进提示词的内容')
console.log('='.repeat(60))
line('body 段落', doc.body.split('\n\n').length)
line('开场白', (doc.firstMessage ?? '').slice(0, 40) + '…')
line('备选开场', (doc.greetings ?? []).map((text, i) => `第${i + 2}段 ${text.length}字`).join(' / ') || '（无）')

console.log('\n' + '='.repeat(60))
console.log('世界书条目')
console.log('='.repeat(60))
if (doc.entries.length === 0) console.log('（这张卡没有世界书条目）')
for (const [i, entry] of doc.entries.entries()) {
  const flags = [entry.constant ? '常驻' : '', entry.enabled ? '' : '停用', entry.locked ? '锁定' : '']
    .filter(Boolean)
    .join(',')
  console.log(`${String(i + 1).padStart(2)}. [${entry.keys.join(', ') || '无关键词'}]${flags ? ` (${flags})` : ''}`)
  console.log(`    ${entry.content.slice(0, 70).replace(/\s+/g, ' ')}${entry.content.length > 70 ? '…' : ''}`)
}

// 给案例页用的原始结构，方便直接粘到 HTML 里
if (process.argv.includes('--json')) {
  console.log('\n' + JSON.stringify({ doc, summary, openings, constant }, null, 2))
}
