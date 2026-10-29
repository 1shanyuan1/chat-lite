/**
 * 极简 PNG 编码器：只支持 8 位 RGB，用于生成头像与测试用图。
 * 自己算 CRC32，输出符合 PNG 规范，严格解析器能正常读。
 * 只在 Node 端使用（生成示例文件），所以放在 scripts 下而不是 src 里。
 */
import { deflateSync } from 'node:zlib'

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

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const out = new Uint8Array(4 + 4 + data.length + 4)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** textChunk：PNG 的 tEXt 块（keyword + \\0 + value） */
export function pngTextChunk(keyword: string, value: string): Uint8Array {
  return pngChunk('tEXt', new TextEncoder().encode(`${keyword}\u0000${value}`))
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 用逐像素回调生成 PNG */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => Rgb): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 3))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const { r, g, b } = pixel(x, y)
      raw[offset++] = r & 0xff
      raw[offset++] = g & 0xff
      raw[offset++] = b & 0xff
    }
  }

  const deflate = deflateSync(raw)
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const chunks = [new Uint8Array(SIGNATURE), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflate), pngChunk('IEND', new Uint8Array(0))]

  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const chunk of chunks) {
    out.set(chunk, pos)
    pos += chunk.length
  }
  return out
}
