import type { CharacterCard } from '@/chat/characters'

const KEY = 'cl.characters'
/** 头像存 base64，太大就丢，避免挤爆 localStorage */
const MAX_AVATAR_CHARS = 300_000

export function listCharacters(): CharacterCard[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as CharacterCard[]
    return Array.isArray(list) ? list.sort((a, b) => b.createdAt - a.createdAt) : []
  } catch {
    return []
  }
}

function persist(list: CharacterCard[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 存储写满时退化为不带头像再存一次
    localStorage.setItem(KEY, JSON.stringify(list.map((c) => ({ ...c, avatar: undefined }))))
  }
}

export function saveCharacter(card: CharacterCard): CharacterCard[] {
  const list = listCharacters()
  const cleaned: CharacterCard = {
    ...card,
    avatar: card.avatar && card.avatar.length <= MAX_AVATAR_CHARS ? card.avatar : undefined,
  }
  const next = [cleaned, ...list.filter((c) => c.id !== cleaned.id)]
  persist(next)
  return next
}

export function deleteCharacter(id: string): CharacterCard[] {
  const next = listCharacters().filter((c) => c.id !== id)
  persist(next)
  return next
}

export function getCharacter(id: string | undefined): CharacterCard | undefined {
  if (!id) return undefined
  return listCharacters().find((c) => c.id === id)
}
