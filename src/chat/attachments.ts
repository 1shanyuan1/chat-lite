/**
 * 附件：图片走多模态，其余文件抽成文本拼进消息正文。
 * 参考 Chatbox 社区版的做法——图片先压到能接受的大小再发，文本文件当上下文注入，
 * 而不是把整份文件塞进 system prompt（那样会把每一轮都撑爆）。
 * 文本抽取按内容魔数判型（图片 / PDF / zip 家族），逻辑在 extract.ts；
 * PDF 走 pdfjs（pdf.ts），docx / xlsx / pptx / zip 在 extract.ts 里用正则扫 XML。
 */

import {
  extractZipText,
  isTextFile,
  looksLikeImage,
  MAX_ZIP_BYTES,
  sniffDocKind,
} from '@/chat/extract'

export type AttachmentKind = 'image' | 'text'

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  mime: string
  /** 原始字节数，仅用于显示 */
  size: number
  /** 文本文件内容（超出上限时截断） */
  text?: string
  /** 图片的 data URL（可能已压缩） */
  dataUrl?: string
  /** 辅助识图模型给出的文字描述；有值就不再发原图 */
  description?: string
  /** 文本被截断过 */
  truncated?: boolean
}

/** 单条消息最多带几张图：再多既贵又容易触发网关限制 */
export const MAX_IMAGES = 9
/** 图片保留轮数默认值：含本轮在内，最近 2 轮的请求带原图 */
export const IMAGE_RESEND_TURNS = 2
/** 文本附件最多注入多少字符，超出截断（约 10 万汉字） */
export const MAX_TEXT_CHARS = 200_000
/** 图片长边上限，超过就等比缩小 */
export const MAX_IMAGE_DIM = 1280
/** 小于这个体积且不用缩放的图直接原样带走，避免二次压缩 */
const KEEP_ORIGINAL_BYTES = 400 * 1024

const textDecoder = new TextDecoder('utf-8')

export const isImageFile = (file: File) => file.type.startsWith('image/')

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

/**
 * 缩到长边 MAX_IMAGE_DIM 以内再转 JPEG。
 * 先铺白底：PNG 的透明区域转 JPEG 会变黑。
 */
async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= KEEP_ORIGINAL_BYTES) {
    bitmap.close?.()
    return readAsDataUrl(file)
  }

  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    return readAsDataUrl(file)
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.82)
}

/** 读一个文件成附件；不支持的类型直接抛错，由调用方提示 */
export async function readAttachment(file: File): Promise<Attachment> {
  const base = {
    id: crypto.randomUUID(),
    name: file.name || '未命名文件',
    size: file.size,
    mime: file.type || 'application/octet-stream',
  }
  const bytes = new Uint8Array(await file.arrayBuffer())

  if (looksLikeImage(bytes)) {
    const dataUrl = await compressImage(file)
    const mime = /^data:([^;]+);/.exec(dataUrl)?.[1] ?? 'image/jpeg'
    return { ...base, kind: 'image', mime, dataUrl }
  }

  const asText = (raw: string): Attachment => ({
    ...base,
    kind: 'text',
    text: raw.length > MAX_TEXT_CHARS ? raw.slice(0, MAX_TEXT_CHARS) : raw,
    truncated: raw.length > MAX_TEXT_CHARS,
  })

  // PDF / Office / 压缩包：按内容魔数判型后抽文本。pdfjs 很大，动态加载——
  // 不传 PDF 就不下载主模块与 worker
  const kind = sniffDocKind(file, bytes)
  if (kind === 'pdf') {
    const { text } = await (await import('@/chat/pdf')).extractPdfText(bytes)
    if (!text.trim()) {
      throw new Error(`${file.name} 没有可提取的文字——可能是扫描件（整页都是图），需要先转成带文字层的 PDF`)
    }
    return asText(text)
  }
  if (kind === 'zip') {
    if (bytes.length > MAX_ZIP_BYTES) throw new Error(`${file.name} 太大——压缩包上限 100 MB`)
    return asText(await extractZipText(bytes))
  }

  if (isTextFile(file.name, file.type)) {
    return asText(textDecoder.decode(bytes))
  }

  throw new Error(
    `${file.name} 暂不支持。能带的文件：图片、PDF、Word / Excel / PPT（.docx / .xlsx / .pptx）、压缩包（zip），以及 txt / md / json / csv 等文本类文件`,
  )
}

/** data URL 拆成 base64，协议里要的是裸数据 */
export const base64Of = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

/** 图片附件 → 协议用的裸数据；已经有文字描述的就不再发原图 */
export function wireImages(attachments?: Attachment[]): Array<{ mime: string; data: string }> | undefined {
  const images = (attachments ?? []).filter((a) => a.kind === 'image' && a.dataUrl && !a.description)
  if (images.length === 0) return undefined
  return images.map((a) => ({ mime: a.mime || 'image/jpeg', data: base64Of(a.dataUrl!) }))
}

/**
 * 超出图片保留窗口的历史轮次：原图撤下，换成一行占位说明。
 * 模型仍然知道「这一轮配了张图」，只是看不见原图——比静默丢掉好，
 * 也比每轮重发便宜一个数量级（长对话里图片重发是成本增长最快的一项）。
 * 有识图描述的图片本来就是文字，不受窗口影响。
 */
export function expireImages(attachments: Attachment[] | undefined, windowTurns: number): Attachment[] | undefined {
  const raw = attachments?.filter((a) => a.kind === 'image' && a.dataUrl && !a.description)
  if (!raw?.length) return attachments
  return attachments!.map((a) =>
    a.kind === 'image' && a.dataUrl && !a.description
      ? { ...a, kind: 'text' as const, text: `（原图已省略——请求只带最近 ${windowTurns} 轮的图片）`, dataUrl: undefined }
      : a
  )
}

/**
 * 用户正文 + 附件。
 * 图片若有识图描述就换成文字，文本文件直接拼内容。
 */
export function userText(content: string, attachments?: Attachment[]): string {
  const images = (attachments ?? [])
    .filter((a) => a.kind === 'image' && a.description?.trim())
    .map((a) => `【图片：${a.name}】\n${a.description!.trim()}`)
  const files = (attachments ?? [])
    .filter((a) => a.kind === 'text' && a.text?.trim())
    .map((a) => `【文件：${a.name}】\n${a.text!.trim()}`)
  return [content.trim(), ...images, ...files].filter(Boolean).join('\n\n')
}

export const hasContent = (content: string, attachments?: Attachment[]) =>
  Boolean(content.trim()) || Boolean(attachments?.length)

export const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
