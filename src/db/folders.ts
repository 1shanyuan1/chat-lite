import type { VaultFolder } from '@/chat/folders'

const KEY = 'cl.vault.folders'

function read(): VaultFolder[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as VaultFolder[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function write(list: VaultFolder[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export const listFolders = () => read().sort((a, b) => a.createdAt - b.createdAt)

export function createFolder(area: VaultFolder['area'], name: string): VaultFolder[] {
  const folder: VaultFolder = { id: crypto.randomUUID(), area, name: name.trim() || '新文件夹', createdAt: Date.now() }
  write([...read(), folder])
  return listFolders()
}

export function renameFolder(id: string, name: string): VaultFolder[] {
  write(read().map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f)))
  return listFolders()
}

export function deleteFolder(id: string): VaultFolder[] {
  write(read().filter((f) => f.id !== id))
  return listFolders()
}
