import type { CharacterCard } from '@/chat/characters'
import { guessKind, settingFromCard, settingFromWorld, type SettingDoc } from '@/chat/settings'
import type { WorldItem } from '@/chat/vault'

const KEY = 'cl.vault.setting'
const LEGACY_CHARACTERS = 'cl.characters'
const LEGACY_WORLD = 'cl.vault.world'

function read(): SettingDoc[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as SettingDoc[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: SettingDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    localStorage.setItem(
      KEY,
      JSON.stringify(list.map((d) => ({ ...d, avatar: undefined })))
    )
  }
}

export function listSettings(): SettingDoc[] {
  // 老数据没有 kind，读的时候补上，保证旧会话不丢
  return read()
    .map((doc) => ({ ...doc, kind: guessKind(doc) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function saveSetting(doc: SettingDoc): SettingDoc[] {
  const next = [{ ...doc, updatedAt: Date.now() }, ...read().filter((d) => d.id !== doc.id)]
  write(next)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteSetting(id: string): SettingDoc[] {
  const next = read().filter((d) => d.id !== id)
  write(next)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 一次性迁移：把旧的「角色卡」和「世界书」都转成设定文件。
 * 迁移后删除旧键，避免下次重复转换。
 */
export function migrateLegacySettings(): SettingDoc[] {
  let list = read()
  let changed = false

  try {
    const raw = localStorage.getItem(LEGACY_CHARACTERS)
    if (raw) {
      const cards = JSON.parse(raw) as CharacterCard[]
      if (Array.isArray(cards) && cards.length > 0) {
        const ids = new Set(list.map((d) => d.id))
        for (const card of cards) {
          const doc = settingFromCard(card)
          if (!ids.has(doc.id)) list = [doc, ...list]
        }
        changed = true
      }
      localStorage.removeItem(LEGACY_CHARACTERS)
    }
  } catch {
    /* 旧数据坏了就跳过 */
  }

  try {
    const raw = localStorage.getItem(LEGACY_WORLD)
    if (raw) {
      const worlds = JSON.parse(raw) as WorldItem[]
      if (Array.isArray(worlds) && worlds.length > 0) {
        for (const world of worlds) list = [settingFromWorld(world), ...list]
        changed = true
      }
      localStorage.removeItem(LEGACY_WORLD)
    }
  } catch {
    /* 同上 */
  }

  if (changed) write(list)
  return list.sort((a, b) => b.updatedAt - a.updatedAt)
}
