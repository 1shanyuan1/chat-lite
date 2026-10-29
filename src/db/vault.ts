import type { PresetItem, PromptItem, VaultKind, WorldItem } from '@/chat/vault'

const key = (kind: VaultKind) => `cl.vault.${kind}`

function read<T>(kind: VaultKind): T[] {
  try {
    const raw = localStorage.getItem(key(kind))
    const list = raw ? (JSON.parse(raw) as T[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write<T>(kind: VaultKind, list: T[]) {
  localStorage.setItem(key(kind), JSON.stringify(list))
}

export const listWorlds = () => read<WorldItem>('world').sort((a, b) => b.updatedAt - a.updatedAt)
export const listPresets = () => read<PresetItem>('preset').sort((a, b) => b.updatedAt - a.updatedAt)
export const listPrompts = () => read<PromptItem>('prompt').sort((a, b) => b.updatedAt - a.updatedAt)

function upsert<T extends { id: string; updatedAt: number }>(kind: VaultKind, item: T): T[] {
  const next = [{ ...item, updatedAt: Date.now() }, ...read<T>(kind).filter((i) => i.id !== item.id)]
  write(kind, next)
  return next.sort((a, b) => b.updatedAt - a.updatedAt)
}

export const saveWorld = (item: WorldItem) => upsert('world', item)
export const savePreset = (item: PresetItem) => upsert('preset', item)
export const savePrompt = (item: PromptItem) => upsert('prompt', item)

function remove<T extends { id: string }>(kind: VaultKind, id: string): T[] {
  const next = read<T>(kind).filter((i) => i.id !== id)
  write(kind, next)
  return next
}

export const deleteWorld = (id: string) => remove<WorldItem>('world', id)
export const deletePreset = (id: string) => remove<PresetItem>('preset', id)
export const deletePrompt = (id: string) => remove<PromptItem>('prompt', id)
