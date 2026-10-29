import { cardToV2, cardToV3 } from './card-json'
import { dataUrlToBytes } from './charx-export'
import type { SettingDoc } from './settings'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** UTF-8 字节 → base64（atob/btoa 只认 latin1，必须先转） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64OfJson(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))
}

/** 组装一个 tEXt 块：长度 + 类型 + keyword\0value + CRC */
function textChunk(keyword: string, value: string): Uint8Array {
  const payload = new TextEncoder().encode(`${keyword}\u0000${value}`)
  const type = new TextEncoder().encode('tEXt')
  const out = new Uint8Array(4 + 4 + payload.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, payload.length)
  out.set(type, 4)
  out.set(payload, 8)
  view.setUint32(8 + payload.length, crc32(out.subarray(4, 8 + payload.length)))
  return out
}

const isPng = (bytes: Uint8Array) => SIGNATURE.every((b, i) => bytes[i] === b)

/**
 * 把角色卡写回 PNG 的 tEXt 块——这是 SillyTavern 圈子里最通用的分享方式。
 * 同时写 chara（V2）与 ccv3（V3）两个块：新版优先读 ccv3，老工具读 chara。
 * 头像不是 PNG 时无法内嵌，返回 null 由调用方降级。
 */
export function buildPngCard(doc: SettingDoc): Uint8Array | null {
  const avatar = dataUrlToBytes(doc.avatar)
  if (!avatar || avatar.ext !== 'png' || !isPng(avatar.bytes)) return null

  const image = avatar.bytes
  const chunks = [
    textChunk('chara', base64OfJson(cardToV2(doc))),
    textChunk('ccv3', base64OfJson(cardToV3(doc))),
  ]

  // 插在 IHDR 之后；没有 IHDR 就紧跟在签名后面
  let insertAt = 8
  if (image.length > 33) {
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength)
    const firstLength = view.getUint32(8)
    const firstType = String.fromCharCode(image[12], image[13], image[14], image[15])
    if (firstType === 'IHDR') insertAt = 8 + 4 + 4 + firstLength + 4
  }

  const extra = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(image.length + extra)
  out.set(image.subarray(0, insertAt), 0)
  let offset = insertAt
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  out.set(image.subarray(insertAt), offset)
  return out
}

export const pngCardFileName = (name: string) =>
  `${(name || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.png`
