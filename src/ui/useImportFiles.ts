import { useRef, useState } from 'react'
import {
  bytesToDataUrl,
  entryText,
  findZipOffset,
  isJson,
  pickIconAsset,
  readBundle,
  resolveEmbededUri,
  type BundleEntry,
} from '@/chat/bundle'
import { docxText, officeKindOf, pptxText, sniffDocKind, xlsxText } from '@/chat/extract'
import { extractCardFromPng, isPngBuffer, normalizeCard } from '@/chat/characters'
import { emptySetting, settingFromCard, settingFromWorld } from '@/chat/settings'
import { parseSettingText } from '@/chat/setting-text'
import { detectKind, toPromptItem, toWorldItem } from '@/chat/vault'
import { useApp } from '@/chat/store'

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

export interface ImportOptions {
  /**
   * 纯文本（.txt / .md / 粘贴）当什么导入。
   * 写作区的设定本来就是「一段正文 + 若干条目」，纯文本应该落成设定；
   * 通用区/酒馆保持旧行为，当成提示词，避免把带卡的文件洗成设定。
   */
  textAs?: 'setting' | 'prompt'
}


/**
 * 统一导入：单文件（png/json/txt）与组合包（charx/zip）。
 * 类型按文件内容判断，扩展名只当参考——PNG 卡存成 .json、组合包存成 .png 都见过。
 * 组合包优先认 CHARX 的 card.json，其次当普通压缩包逐个文件处理。
 * folderId 是「在哪个文件夹里点的导入」——导入的内容直接归到那里。
 */
export function useImportFiles(options: ImportOptions = {}) {
  const textAs = options.textAs ?? 'prompt'
  const importSetting = useApp((s) => s.importSetting)
  const savePrompt = useApp((s) => s.savePrompt)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastImported, setLastImported] = useState<string | null>(null)

  /** 纯文本落成设定：整篇进正文，带【条目：】标记的那几段变成条目 */
  const importText = (name: string, text: string, folderId?: string): string => {
    const parsed = parseSettingText(text)
    const doc = emptySetting('setting')
    doc.folderId = folderId
    doc.name = parsed.name || name || '未命名设定'
    doc.body = parsed.body
    doc.entries = parsed.entries
    importSetting(doc)
    return doc.id
  }

  const importPayload = (name: string, payload: unknown, folderId?: string): string | null => {
    const baseName = name.replace(/\.[^.]+$/, '').split('/').pop() ?? name
    // 写作区里的 .txt / .md：先看有没有条目标记，没有就整篇当正文
    if (typeof payload === 'string' && textAs === 'setting') {
      return importText(baseName, payload, folderId)
    }
    const kind = detectKind(payload)
    if (kind === 'character') {
      const doc = { ...settingFromCard(normalizeCard(payload)), folderId }
      importSetting(doc)
      return doc.id
    }
    if (kind === 'world') {
      const doc = { ...settingFromWorld(toWorldItem(payload, baseName)), folderId }
      importSetting(doc)
      return doc.id
    }
    if (kind === 'prompt') {
      // 提示词现在是一等公民，自己就能归档，不再额外生成一份同文设定
      savePrompt({ ...toPromptItem(payload, baseName), folderId })
      return null
    }
    throw new Error(`${name} 认不出是什么类型`)
  }

  /** manifest 里写明了类型，就不需要再猜 */
  const importExplicit = (kind: string, payload: unknown, name: string, folderId?: string): string | null => {
    if (kind === 'character') {
      const doc = { ...settingFromCard(normalizeCard(payload)), folderId }
      importSetting(doc)
      return doc.id
    }
    if (kind === 'world') {
      const doc = { ...settingFromWorld(toWorldItem(payload, name)), folderId }
      importSetting(doc)
      return doc.id
    }
    if (kind === 'setting') {
      const raw = (payload ?? {}) as Record<string, unknown>
      const doc = emptySetting('setting')
      doc.folderId = folderId
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
    if (kind === 'prompt') {
      savePrompt({ ...toPromptItem(payload, name), folderId })
      return null
    }
    return null
  }

  const importPng = (name: string, buffer: ArrayBuffer, folderId?: string): string => {
    const raw = extractCardFromPng(buffer)
    if (!raw) {
      throw new Error(`${name} 里没有角色卡数据——SillyTavern 的 PNG 卡需要 chara / ccv3 文本块`)
    }
    const doc = { ...settingFromCard(normalizeCard(raw)), folderId }
    // PNG 卡自带图，直接当头像——这是它相对 JSON 卡的最大好处。
    // 在包里导入时也走这里，头像才不会因为「不是直接选的文件」而丢掉。
    doc.avatar = doc.avatar ?? bytesToDataUrl(new Uint8Array(buffer), 'image/png')
    importSetting(doc)
    return doc.id
  }

  /** 组合包：一个 charx 或 zip 里可能有一张卡、几本书，也可能是一整套 */
  const importBundle = async (entries: BundleEntry[], folderId?: string): Promise<string[]> => {
    const ids: string[] = []

    // 我们自己的组合包：manifest 写明类型，按它来
    const manifestEntry = entries.find((e) => e.path === 'manifest.json')
    if (manifestEntry) {
      const manifest = JSON.parse(entryText(manifestEntry)) as {
        app?: string
        items?: Array<{ file: string; kind: string; name: string }>
      }
      let restored = 0
      for (const item of manifest.items ?? []) {
        const entry = entries.find((e) => e.path === item.file)
        if (!entry) continue
        try {
          const id = importExplicit(item.kind, JSON.parse(entryText(entry)), item.name, folderId)
          if (id) ids.push(id)
          restored += 1
        } catch {
          // 单个文件坏了不影响其他
        }
      }
      // 提示词只返回 null，但也是导入成功的，不能因为没 id 就退回逐文件猜
      if (restored > 0) return ids
    }

    const cardEntry = entries.find((e) => e.path === 'card.json' || e.path.endsWith('/card.json'))
    if (cardEntry) {
      const json = JSON.parse(entryText(cardEntry))
      const doc = { ...settingFromCard(normalizeCard(json)), folderId }
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
        const entryBuffer = toArrayBuffer(entry.bytes)
        if (isPngBuffer(entryBuffer)) {
          ids.push(importPng(entry.path, entryBuffer, folderId))
        } else if (isJson(entry.path)) {
          const id = importPayload(entry.path, JSON.parse(entryText(entry)), folderId)
          if (id) ids.push(id)
        }
      } catch {
        // 包里总有不认识的文件，跳过即可
      }
    }
    if (ids.length === 0) throw new Error('压缩包里没有可导入的角色卡或世界书')
    return ids
  }

  const importFile = async (file: File, folderId?: string): Promise<string[]> => {
    // 按内容判断类型，不看扩展名：社区里 PNG 卡改成 .json、组合包改成 .png 都很常见
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    if (isPngBuffer(buffer)) {
      return [importPng(file.name, buffer, folderId)]
    }

    const lower = file.name.toLowerCase()
    const head = (magic: number[]) => bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)

    // Risu 的「JPEG 预览 + ZIP」：开头是图片魔数，要先于图片/文档判定拦下来
    if ((lower.endsWith('.charx') || head([0xff, 0xd8, 0xff])) && findZipOffset(bytes) >= 0) {
      return importBundle(readBundle(buffer), folderId)
    }

    const kind = sniffDocKind(file, bytes)

    // PDF：抽文本后走普通 payload（写作区当设定稿，通用区当提示词）
    if (kind === 'pdf') {
      const { text } = await (await import('@/chat/pdf')).extractPdfText(bytes)
      if (!text.trim()) throw new Error(`${file.name} 里没有可提取的文字——可能是扫描件（整页都是图）`)
      const id = importPayload(file.name, text, folderId)
      return id ? [id] : []
    }

    // zip 家族：先看是不是 Office 三件套（也是 zip，但里面不是角色卡），再走组合包逻辑
    if (kind === 'zip') {
      // 扩展名说是 zip 但内容不是的（改错名的 json 等），掉回普通文本路径，保持旧行为
      const entries = findZipOffset(bytes) >= 0 ? readBundle(buffer) : []
      if (entries.length > 0) {
        const office = officeKindOf(entries)
        if (office) {
          const text = office === 'docx' ? docxText(entries) : office === 'xlsx' ? xlsxText(entries) : pptxText(entries)
          if (!text.trim()) throw new Error(`${file.name} 里没有可提取的文字`)
          const id = importPayload(file.name, text, folderId)
          return id ? [id] : []
        }
        return importBundle(entries, folderId)
      }
    }

    const text = new TextDecoder('utf-8').decode(buffer)
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      /* 纯文本当提示词正文 */
    }
    const id = importPayload(file.name, payload, folderId)
    return id ? [id] : []
  }

  const importFiles = async (files: FileList | File[] | null, folderId?: string) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return []
    setBusy(true)
    setError(null)
    const ids: string[] = []
    try {
      for (const file of list) {
        ids.push(...(await importFile(file, folderId)))
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

  return { importFiles, importText, busy, error, setError, fileRef, lastImported }
}
