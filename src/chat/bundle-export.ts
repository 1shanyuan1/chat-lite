import { strToU8, zipSync } from 'fflate'
import { cardToV2 } from './card-json'
import type { SettingDoc } from './settings'
import type { PresetItem } from './vault'

export interface BundleItem {
  kind: 'character' | 'world' | 'setting' | 'preset'
  name: string
  /** 文件名（不含目录），manifest 里引用 */
  file: string
  payload: unknown
}

/** 世界书导出成 { entries: { 0: {...} } }，与 ST 的 world info 结构一致 */
function worldToJson(doc: SettingDoc) {
  const entries: Record<string, unknown> = {}
  doc.entries.forEach((entry, index) => {
    entries[String(index)] = {
      uid: index,
      key: entry.keys,
      content: entry.content,
      enabled: entry.enabled,
      constant: Boolean(entry.constant),
      order: index,
    }
  })
  return { name: doc.name, entries }
}

/** 自由设定用自家标记，别人读不懂也无所谓，重在自家能无损往返 */
function settingToJson(doc: SettingDoc) {
  return {
    spec: 'chatlite_setting',
    version: 1,
    name: doc.name,
    body: doc.body,
    firstMessage: doc.firstMessage ?? '',
    entries: doc.entries.map((e) => ({ keys: e.keys, content: e.content, enabled: e.enabled, constant: e.constant })),
  }
}

function presetToJson(preset: PresetItem) {
  return {
    spec: 'chatlite_preset',
    version: 1,
    name: preset.name,
    ...(preset.topP !== undefined ? { top_p: preset.topP } : {}),
    ...(preset.maxTokens !== undefined ? { max_tokens: preset.maxTokens } : {}),
  }
}

const safeName = (name: string) => (name || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)

export function collectBundleItems(docs: SettingDoc[], presets: PresetItem[]): BundleItem[] {
  const items: BundleItem[] = []
  const used = new Set<string>()

  const unique = (base: string, ext: string) => {
    let file = `${base}${ext}`
    let i = 2
    while (used.has(file)) file = `${base}-${i++}${ext}`
    used.add(file)
    return file
  }

  for (const doc of docs) {
    const base = safeName(doc.name)
    if (doc.kind === 'character') {
      items.push({ kind: 'character', name: doc.name, file: unique(base, '.card.json'), payload: cardToV2(doc) })
    } else if (doc.kind === 'world') {
      items.push({ kind: 'world', name: doc.name, file: unique(base, '.world.json'), payload: worldToJson(doc) })
    } else {
      items.push({ kind: 'setting', name: doc.name, file: unique(base, '.setting.json'), payload: settingToJson(doc) })
    }
  }

  for (const preset of presets) {
    items.push({
      kind: 'preset',
      name: preset.name,
      file: unique(safeName(preset.name), '.preset.json'),
      payload: presetToJson(preset),
    })
  }

  return items
}

export interface BundleManifest {
  app: 'chat-lite'
  version: 1
  exportedAt: number
  items: Array<{ file: string; kind: BundleItem['kind']; name: string }>
}

/**
 * 打一个文件夹级别的组合包：
 * manifest.json 明确写出每个文件是什么类型，导回来就不必靠猜。
 */
export function buildBundle(folderName: string, items: BundleItem[]): Uint8Array {
  const manifest: BundleManifest = {
    app: 'chat-lite',
    version: 1,
    exportedAt: Date.now(),
    items: items.map(({ file, kind, name }) => ({ file, kind, name })),
  }

  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  }
  for (const item of items) {
    files[item.file] = strToU8(JSON.stringify(item.payload, null, 2))
  }

  return zipSync(files, { level: 6 })
}

export const bundleFileName = (folderName: string) => `${safeName(folderName)}.chatlite.zip`
