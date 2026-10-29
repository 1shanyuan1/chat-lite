import { useRef, useState } from 'react'
import {
  bytesToDataUrl,
  entryText,
  isJson,
  isPng,
  pickIconAsset,
  readBundle,
  resolveEmbededUri,
} from '@/chat/bundle'
import { extractCardFromPng, normalizeCard } from '@/chat/characters'
import { emptySetting, settingFromCard, settingFromText, settingFromWorld } from '@/chat/settings'
import { detectKind, toPresetItem, toPromptItem, toWorldItem } from '@/chat/vault'
import { useApp } from '@/chat/store'

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/**
 * 统一导入：单文件（png/json/txt）与组合包（charx/zip）。
 * 组合包优先认 CHARX 的 card.json，其次当普通压缩包逐个文件处理。
 */
export function useImportFiles() {
  const importSetting = useApp((s) => s.importSetting)
  const savePreset = useApp((s) => s.savePreset)
  const savePrompt = useApp((s) => s.savePrompt)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImported, setLastImported] = useState<string | null>(null)

  const importPayload = (name: string, payload: unknown): string | null => {
    const baseName = name.replace(/\.[^.]+$/, '').split('/').pop() ?? name
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
    throw new Error(`${name} 认不出是什么类型`)
  }

  /** manifest 里写明了类型，就不需要再猜 */
  const importExplicit = (kind: string, payload: unknown, name: string): string | null => {
    if (kind === 'character') {
      const doc = settingFromCard(normalizeCard(payload))
      importSetting(doc)
      return doc.id
    }
    if (kind === 'world') {
      const doc = settingFromWorld(toWorldItem(payload, name))
      importSetting(doc)
      return doc.id
    }
    if (kind === 'setting') {
      const raw = (payload ?? {}) as Record<string, unknown>
      const doc = emptySetting('setting')
      doc.name = typeof raw.name === 'string' && raw.name ? raw.name : name
      doc.body = typeof raw.body === 'string' ? raw.body : ''
      doc.firstMessage = typeof raw.firstMessage === 'string' ? raw.firstMessage : undefined
      const list = Array.isArray(raw.entries) ? raw.entries : []
      doc.entries = list
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          id: crypto.randomUUID(),
          keys: Array.isArray(e.keys) ? e.keys.map(String) : [],
          content: typeof e.content === 'string' ? e.content : '',
          enabled: e.enabled !== false,
          constant: e.constant === true,
        }))
      importSetting(doc)
      return doc.id
    }
    if (kind === 'preset') {
      const raw = (payload ?? {}) as Record<string, unknown>
      savePreset({
        id: crypto.randomUUID(),
        name: typeof raw.name === 'string' && raw.name ? raw.name : name,
        topP: typeof raw.top_p === 'number' ? raw.top_p : undefined,
        maxTokens: typeof raw.max_tokens === 'number' ? raw.max_tokens : undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return null
    }
    return null
  }

  const importPng = (name: string, buffer: ArrayBuffer): string => {
    const raw = extractCardFromPng(buffer)
    if (!raw) throw new Error(`${name} 里没有角色卡数据`)
    const doc = settingFromCard(normalizeCard(raw))
    importSetting(doc)
    return doc.id
  }

  /** 组合包：一个 charx 或 zip 里可能有一张卡、几本书，也可能是一整套 */
  const importBundle = async (file: File): Promise<string[]> => {
    const entries = readBundle(await file.arrayBuffer())
    const ids: string[] = []

    // 我们自己的组合包：manifest 写明类型，按它来
    const manifestEntry = entries.find((e) => e.path === 'manifest.json')
    if (manifestEntry) {
      const manifest = JSON.parse(entryText(manifestEntry)) as {
        app?: string
        items?: Array<{ file: string; kind: string; name: string }>
      }
      for (const item of manifest.items ?? []) {
        const entry = entries.find((e) => e.path === item.file)
        if (!entry) continue
        try {
          const id = importExplicit(item.kind, JSON.parse(entryText(entry)), item.name)
          if (id) ids.push(id)
        } catch {
          // 单个文件坏了不影响其他
        }
      }
      if (ids.length > 0) return ids
    }

    const cardEntry = entries.find((e) => e.path === 'card.json' || e.path.endsWith('/card.json'))
    if (cardEntry) {
      const json = JSON.parse(entryText(cardEntry))
      const doc = settingFromCard(normalizeCard(json))
      const icon = resolveEmbededUri(pickIconAsset(json), entries)
      if (icon) {
        doc.avatar = bytesToDataUrl(icon.bytes, /\.jpe?g$/i.test(icon.path) ? 'image/jpeg' : 'image/png')
      }
      importSetting(doc)
      ids.push(doc.id)
      return ids
    }

    // 不是 CHARX：当普通压缩包，逐个文件按内容识别
    for (const entry of entries) {
      try {
        if (isPng(entry.path)) {
          ids.push(importPng(entry.path, toArrayBuffer(entry.bytes)))
        } else if (isJson(entry.path)) {
          const id = importPayload(entry.path, JSON.parse(entryText(entry)))
          if (id) ids.push(id)
        }
      } catch {
        // 包里总有不认识的文件，跳过即可
      }
    }
    if (ids.length === 0) throw new Error('压缩包里没有可导入的角色卡或世界书')
    return ids
  }

  const importFile = async (file: File): Promise<string[]> => {
    const lower = file.name.toLowerCase()

    if (lower.endsWith('.charx') || lower.endsWith('.zip')) {
      return importBundle(file)
    }
    if (lower.endsWith('.png')) {
      const id = importPng(file.name, await file.arrayBuffer())
      try {
        const doc = useApp.getState().settings.find((d) => d.id === id)
        if (doc && !doc.avatar) importSetting({ ...doc, avatar: await readAsDataUrl(file) })
      } catch {
        /* 头像失败不影响导入 */
      }
      return [id]
    }

    const text = await file.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      /* 纯文本当设定正文 */
    }
    const id = importPayload(file.name, payload)
    return id ? [id] : []
  }

  const importFiles = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return []
    setBusy(true)
    setError(null)
    const ids: string[] = []
    try {
      for (const file of list) {
        ids.push(...(await importFile(file)))
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
