import { useRef, useState } from 'react'
import { extractCardFromPng, normalizeCard, type CharacterCard } from '@/chat/characters'
import { useApp } from '@/chat/store'

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

async function parseFile(file: File): Promise<CharacterCard> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.png')) {
    const raw = extractCardFromPng(await file.arrayBuffer())
    if (!raw) throw new Error('这张 PNG 里没有角色卡数据')
    const card = normalizeCard(raw)
    try {
      card.avatar = await readAsDataUrl(file)
    } catch {
      /* 头像失败不影响导入 */
    }
    return card
  }
  if (lower.endsWith('.json')) {
    return normalizeCard(JSON.parse(await file.text()))
  }
  throw new Error('只支持 .png 或 .json 角色卡')
}

/**
 * 角色卡导入：解析文件 → 存库 → 刷新列表。
 * 抽屉里的角色页和新建对话页共用这一份逻辑。
 */
export function useImportCharacter() {
  const importCharacter = useApp((s) => s.importCharacter)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const importFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return []
    setBusy(true)
    setError(null)
    const added: CharacterCard[] = []
    try {
      for (const file of list) {
        const card = await parseFile(file)
        importCharacter(card)
        added.push(card)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
    return added
  }

  return { importFiles, busy, error, setError, fileRef }
}
