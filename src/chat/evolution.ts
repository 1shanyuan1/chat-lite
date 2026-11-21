/**
 * 设定发展模式：AI 在推进正文的同时，维护一份可以改写的设定副本。
 *
 * 为什么是副本而不是直接改原卡：设定是生成的依据，改错了会一路错下去。
 * 副本坏了大不了丢掉重来，原卡永远干净。
 *
 * 三条护栏：
 * 1. 模型只能提交「追加 / 替换 / 删除」三种明确操作，不能整份重写。
 * 2. 用户锁住的条目（locked）AI 碰不到。
 * 3. 每次改动都记一条 changelog，用户能查、能判断是不是它改歪了。
 */
import type { SettingDoc } from './settings'
import type { WireTool } from './protocol'

export interface EvolutionEntry {
  at: number
  /** 第几轮触发的（从 0 数） */
  turn: number
  note: string
  changes: string[]
}

export const UPDATE_SETTING_TOOL: WireTool = {
  name: 'update_setting',
  description:
    '更新这份设定副本。当你在正文里引入了新的地点、人物、规则，或者改变了已有设定时调用。' +
    '纯描写、情绪、对话不要调用。每次只记真正会影响后续写作的内容。',
  parameters: {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: '一句话说明这次改了什么、为什么，会记进变更历史给作者看。',
      },
      append: {
        type: 'array',
        description: '追加到设定正文末尾的段落，每条一段。不要重复已有的内容。',
        items: { type: 'string' },
      },
      entries: {
        type: 'array',
        description: '新增或修改的关键词条目。要改已有条目就填 replace（用它的关键词匹配）。',
        items: {
          type: 'object',
          properties: {
            keys: { type: 'array', items: { type: 'string' }, description: '触发关键词' },
            content: { type: 'string', description: '条目内容' },
            replace: {
              type: 'string',
              description: '要替换的旧条目关键词（逗号分隔，需与已有条目的关键词完全一致）；不填表示新增',
            },
          },
          required: ['keys', 'content'],
        },
      },
      drop: {
        type: 'array',
        description: '要作废的条目关键词（逗号分隔）。只有在设定确实被推翻时才用。',
        items: { type: 'string' },
      },
    },
    required: ['note'],
  },
}

const keyOf = (keys: string[]) => keys.map((k) => k.trim()).filter(Boolean).join(',')

/** 把副本的条目清单压成一行行，注入 system 让模型知道有哪些条目可改 */
export function renderEntryIndex(doc: SettingDoc): string {
  if (doc.entries.length === 0) return ''
  const lines = doc.entries.map((entry, i) => {
    const head = entry.content.replace(/\s+/g, ' ').slice(0, 30)
    const lock = entry.locked ? '（已锁定，不可改）' : ''
    return `${i + 1}. [${keyOf(entry.keys)}] ${head}${lock}`
  })
  return `【当前设定条目】\n${lines.join('\n')}`
}

interface RawUpdate {
  note?: unknown
  append?: unknown
  entries?: unknown
  drop?: unknown
}

/**
 * 把模型给的操作应用到副本上。返回新文档和人类可读的变更描述。
 * 任何一项非法都不影响其它项——宁可只落一半，也不要整批丢弃。
 */
export function applySettingUpdate(
  doc: SettingDoc,
  argsJson: string,
  turn: number
): { doc: SettingDoc; changes: string[] } {
  const raw = JSON.parse(argsJson) as RawUpdate
  const changes: string[] = []
  let body = doc.body
  let entries = doc.entries.map((e) => ({ ...e }))

  const append = Array.isArray(raw.append) ? raw.append.map((t) => String(t).trim()).filter(Boolean) : []
  for (const text of append) {
    // 已经有一模一样的段落就不再追加，避免反复同步导致正文越来越长
    if (body.includes(text)) continue
    body = body ? `${body}\n\n${text}` : text
    changes.push(`正文 +${text.slice(0, 24)}${text.length > 24 ? '…' : ''}`)
  }

  const upserts = Array.isArray(raw.entries) ? raw.entries : []
  for (const item of upserts) {
    const row = (item ?? {}) as Record<string, unknown>
    const keys = Array.isArray(row.keys) ? row.keys.map((k) => String(k).trim()).filter(Boolean) : []
    const content = typeof row.content === 'string' ? row.content.trim() : ''
    if (keys.length === 0 || !content) continue

    const replaceKey = typeof row.replace === 'string' ? row.replace.trim() : ''
    if (replaceKey) {
      const at = entries.findIndex((e) => keyOf(e.keys) === replaceKey)
      if (at >= 0) {
        if (entries[at].locked) {
          changes.push(`跳过「${replaceKey}」（已锁定）`)
          continue
        }
        entries[at] = { ...entries[at], keys, content }
        changes.push(`条目 ~${replaceKey} → ${content.slice(0, 24)}…`)
        continue
      }
    }
    entries = [...entries, { id: crypto.randomUUID(), keys, content, enabled: true }]
    changes.push(`条目 +${keyOf(keys)}`)
  }

  const drop = Array.isArray(raw.drop) ? raw.drop.map((k) => String(k).trim()).filter(Boolean) : []
  for (const key of drop) {
    const at = entries.findIndex((e) => keyOf(e.keys) === key)
    if (at < 0) continue
    if (entries[at].locked) {
      changes.push(`跳过删除「${key}」（已锁定）`)
      continue
    }
    entries = entries.filter((_, i) => i !== at)
    changes.push(`条目 -${key}`)
  }

  if (changes.length === 0) return { doc, changes }

  const note = typeof raw.note === 'string' ? raw.note.trim() : ''
  const history = doc.changelog ?? []
  return {
    doc: {
      ...doc,
      body,
      entries,
      changelog: [{ at: Date.now(), turn, note, changes }, ...history].slice(0, 50),
      updatedAt: Date.now(),
    },
    changes,
  }
}

/** 设定发展是否真的在这份会话上生效：全局开关 + 写作模式 + 挂的是发展稿 */
export function evolutionActive(
  enabled: boolean | undefined,
  packId: string,
  docs: Array<Pick<SettingDoc, 'derivedFrom'>>
): boolean {
  return Boolean(enabled) && packId === 'writing' && docs.some((doc) => Boolean(doc.derivedFrom))
}

/** 给模型看的、这次改动的回执 */
export function describeUpdate(changes: string[]): string {
  if (changes.length === 0) return '没有需要记录的改动。'
  return `已更新设定副本：\n${changes.map((c) => `- ${c}`).join('\n')}`
}

/**
 * 注入 system 的设定发展说明。
 * 没有这段，模型只记得「只输出文本」，不会想到去动设定——
 * 工具挂着但没人告诉它该用，等于没挂。
 */
export function evolutionSystemBlock(): string {
  return [
    '【设定发展】',
    '你手上有一份可以改写的设定副本，它和正文一起成长。原卡不会变，改坏了也能丢掉重来。',
    '',
    '本段只允许你在写正文之前先维护设定，不改变用户的任何要求。',
    '用户明确说了怎么写，就按用户说的来。',
    '关于「只输出文本、不要解释」这类格式约束，本段是例外：调用 update_setting 不算解释思路。',
    '',
    '每写完一段正文，先回头看一眼这一段：有没有出现新的地点、人物、组织、物件、规则？有没有推翻或修改已有设定？',
    '',
    '- 有新东西 → 调用 update_setting 记下来（追加正文或新增条目），再输出正文。',
    '- 改动了已有设定 → 用 replace 改那一条，不要新开一条并存的。',
    '- 明确作废的 → 用 drop 删掉。',
    '- 只是描写、情绪、对话推进、一次性的场景细节 → 不要调用。',
    '',
    '宁可漏记，也不要为了调用而编造设定。',
    '记的时候写结论：是什么、在哪、和已有设定什么关系，不要抄正文原句。',
    '这件事对读者不可见：正文里不要提「我更新了设定」，也不要解释你在维护副本。',
  ].join('\n')
}

/** 强制审查：每隔若干轮提醒模型回头看一眼设定 */
export function reviewNudge(): string {
  return [
    '【设定审查】',
    '回头看一遍上面这段正文：有没有出现新的地点、人物、规则，或者和现有设定不一致的地方？',
    '有就调用 update_setting 记下来；没有就不要调用，不要为了调用而编造。',
  ].join('\n')
}
