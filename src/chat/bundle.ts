import { unzipSync } from 'fflate'

export interface BundleEntry {
  /** ZIP 内的路径，例如 card.json 或 assets/icon/images/avatar.png */
  path: string
  bytes: Uint8Array
}

/** 跳过 macOS 垃圾文件与 Risu 的二进制模块 */
const IGNORED = [/^__MACOSX\//, /^\./, /^x_meta\//, /\.risum$/i, /\/$/]

const textDecoder = new TextDecoder('utf-8')

/**
 * CHARX / Risu 的「mullet」格式：JPEG 预览在前、ZIP 数据在后，
 * 所以不能假设从第 0 字节开始，得先找 ZIP 的本地文件头。
 */
export function findZipOffset(bytes: Uint8Array): number {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) return i
  }
  return -1
}

/** 解出组合包里的文件（只保留可能有用的） */
export function readBundle(buffer: ArrayBuffer): BundleEntry[] {
  const bytes = new Uint8Array(buffer)
  const offset = findZipOffset(bytes)
  if (offset < 0) throw new Error('这个文件不是 zip 组合包')

  const files = unzipSync(bytes.subarray(offset))
  const entries: BundleEntry[] = []
  for (const [path, data] of Object.entries(files)) {
    if (IGNORED.some((re) => re.test(path))) continue
    if (data.length === 0) continue
    entries.push({ path, bytes: data })
  }
  return entries
}

export const entryText = (entry: BundleEntry): string => textDecoder.decode(entry.bytes)

export const isJson = (path: string) => /\.json$/i.test(path)
export const isPng = (path: string) => /\.png$/i.test(path)
export const isImage = (path: string) => /\.(png|jpe?g|webp)$/i.test(path)

/** Uint8Array → data URL，用于把包内头像直接当角色卡头像 */
export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** card.json 里的 assets 用 embeded:// 前缀（规范就是一个 d） */
export function resolveEmbededUri(uri: unknown, entries: BundleEntry[]): BundleEntry | undefined {
  if (typeof uri !== 'string') return undefined
  const path = uri.replace(/^embeded:\/\//i, '').replace(/^\.?\//, '')
  return entries.find((e) => e.path === path) ?? entries.find((e) => e.path.endsWith(path))
}

/** 从 card.json 里找主头像的 uri（V3 的 assets[type=icon]） */
export function pickIconAsset(cardJson: unknown): unknown {
  const root = (cardJson ?? {}) as Record<string, unknown>
  const data = ((root.spec ? root.data : root) ?? {}) as Record<string, unknown>
  const assets = data.assets
  if (!Array.isArray(assets)) return undefined
  const icon = assets.find((a) => a && typeof a === 'object' && (a as { type?: string }).type === 'icon')
  return (icon as { uri?: unknown } | undefined)?.uri
}
