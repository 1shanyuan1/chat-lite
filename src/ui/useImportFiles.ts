import { useRef, useState } from 'react'
import { extractCardFromPng, normalizeCard } from '@/chat/characters'
import { settingFromCard, settingFromText, settingFromWorld } from '@/chat/settings'
import { detectKind, toPresetItem, toPromptItem, toWorldItem } from '@/chat/vault'
import { useApp } from '@/chat/store'

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

/**
 * 统一导入：按内容结构判断类型。
 * 角色卡和世界书都归为设定文件；预设与提示词进各自分类。
 */
export function useImportFiles() {
  const importSetting = useApp((s) => s.importSetting)
  const savePreset = useApp((s) => s.savePreset)
  const savePrompt = useApp((s) => s.savePrompt)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImported, setLastImported] = useState<string | null>(null)

  const importOne = async (file: File) => {
    const lower = file.name.toLowerCase()
    const baseName = file.name.replace(/\.[^.]+$/, '')

    if (lower.endsWith('.png')) {
      const raw = extractCardFromPng(await file.arrayBuffer())
      if (!raw) throw new Error('这张 PNG 里没有角色卡数据')
      const doc = settingFromCard(normalizeCard(raw))
      try {
        doc.avatar = await readAsDataUrl(file)
      } catch {
        /* 头像失败不影响导入 */
      }
      importSetting(doc)
      return doc.id
    }

    const text = await file.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      /* 纯文本当设定正文 */
    }

    const kind = detectKind(payload)
    if (kind === 'character') {
      const doc = settingFromCard(normalizeCard(payload))
      importSetting(doc)
      return doc.id
    }
    if (kind === 'world') {
      const doc = settingFromWorld(toWorldItem(payload, baseName))
      importSetting(doc)
      return doc.id
    }
    if (kind === 'preset') {
      savePreset(toPresetItem(payload, baseName))
      return null
    }
    if (kind === 'prompt') {
      const item = toPromptItem(payload, baseName)
      savePrompt(item)
      importSetting(settingFromText(item.name, item.text))
      return null
    }
    throw new Error(`${file.name} 认不出是什么类型`)
  }

  const importFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return []
    setBusy(true)
    setError(null)
    const ids: string[] = []
    try {
      for (const file of list) {
        const id = await importOne(file)
        if (id) ids.push(id)
      }
      setLastImported(ids[ids.length - 1] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
    return ids
  }

  return { importFiles, busy, error, setError, fileRef, lastImported }
}
