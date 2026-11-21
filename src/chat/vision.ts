import { platform } from '@/platform'
import { base64Of, type Attachment } from './attachments'
import type { ChatConfig } from './client'
import { keyForProvider } from './credentials'
import { buildChatRequest, resolveProtocol, type Protocol } from './protocol'

/**
 * 辅助识图：把图片先发给一个视觉模型，拿回文字描述，再让主模型读文字。
 * 这样主模型不需要支持视觉，也能处理图片。
 */

export interface VisionTarget {
  protocol: Protocol
  baseUrl: string
  apiKey: string
  model: string
}

/** 让描述尽量覆盖主模型可能问到的细节，顺带把图里的文字抄下来 */
const VISION_PROMPT = [
  '请客观、详细地描述这张图片，供另一个无法看到图片的模型使用。',
  '要求：',
  '1. 先一句话说清整体是什么；',
  '2. 再分点描述主体、布局、颜色、数量、状态等可观察细节；',
  '3. 图中有文字就逐条抄下来（保留原文语言与层级）；',
  '4. 有图表就说明坐标轴、趋势和关键数值；',
  '5. 不要推测图片之外的信息，不要评价好坏。',
].join('\n')

export function resolveVisionTarget(config: ChatConfig): VisionTarget | null {
  const aux = config.visionModel
  // 没配默认关；配了也可以随时关掉
  if (!aux?.enabled) return null

  // 服务商和模型都给全了才算「独立的识图模型」。
  // 只换了服务商没选模型时退回当前对话——拿 A 的模型名去请求 B 一定失败。
  const dedicated = aux.baseUrl?.trim() && aux.model?.trim() ? aux : undefined
  const baseUrl = dedicated?.baseUrl?.trim() || config.baseUrl
  const model = dedicated?.model?.trim() || config.model
  const apiKey = keyForProvider(config, baseUrl)
  if (!baseUrl || !model || !apiKey) return null
  return {
    // 独立的识图模型按地址猜协议，避免被主对话的协议设置带偏
    protocol: resolveProtocol(dedicated ? 'auto' : config.protocol, baseUrl),
    baseUrl,
    apiKey,
    model,
  }
}

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** 三家响应里把正文抠出来 */
function readText(protocol: Protocol, payload: unknown): string | undefined {
  if (protocol === 'anthropic') {
    const content = (payload as { content?: unknown }).content
    if (!Array.isArray(content)) return undefined
    const text = content
      .map((block) =>
        block && typeof block === 'object' && (block as { type?: string }).type === 'text'
          ? asString((block as { text?: unknown }).text)
          : undefined
      )
      .filter(Boolean)
      .join('\n')
    return text || undefined
  }

  if (protocol === 'gemini') {
    const parts = (payload as { candidates?: Array<{ content?: { parts?: unknown[] } }> }).candidates?.[0]?.content
      ?.parts
    if (!Array.isArray(parts)) return undefined
    const text = parts
      .map((part) =>
        part && typeof part === 'object' && !(part as { thought?: boolean }).thought
          ? asString((part as { text?: unknown }).text)
          : undefined
      )
      .filter(Boolean)
      .join('\n')
    return text || undefined
  }

  const message = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
  const raw = message?.content
  if (typeof raw === 'string') return asString(raw)
  if (Array.isArray(raw)) {
    const text = raw
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('')
    return asString(text)
  }
  return undefined
}

/** 描述一张图；失败就抛错，由调用方决定怎么降级 */
export async function describeImage(image: Attachment, target: VisionTarget): Promise<string> {
  if (!image.dataUrl) throw new Error('图片数据缺失')

  const request = buildChatRequest(
    target.protocol,
    { baseUrl: target.baseUrl, apiKey: target.apiKey },
    {
      model: target.model,
      messages: [
        {
          role: 'user',
          content: VISION_PROMPT,
          images: [{ mime: image.mime || 'image/jpeg', data: base64Of(image.dataUrl) }],
        },
      ],
      stream: false,
      // 思考型视觉模型会先花掉一大截预算，给少了就只剩思考没有正文
      maxTokens: 4096,
    }
  )

  const res = await platform().request({
    url: request.url,
    method: 'POST',
    headers: request.headers,
    body: request.body,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`识图失败（HTTP ${res.status}）${res.text.slice(0, 120).replace(/\s+/g, ' ')}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(res.text)
  } catch {
    throw new Error('识图返回的不是 JSON')
  }

  const text = readText(target.protocol, payload)
  if (!text) throw new Error('识图模型没有返回描述（可能输出上限被思考占满了）')
  return text
}

/**
 * 把图片附件转成文字描述。
 * 没配识图模型时原样返回，走原来的多模态路径。
 */
export async function describeAttachments(
  files: Attachment[],
  config: ChatConfig,
  onProgress?: (message: string) => void
): Promise<Attachment[]> {
  const target = resolveVisionTarget(config)
  const images = files.filter((file) => file.kind === 'image' && file.dataUrl && !file.description)
  if (!target || images.length === 0) return files

  const out: Attachment[] = []
  let index = 0
  for (const file of files) {
    if (file.kind !== 'image' || !file.dataUrl || file.description) {
      out.push(file)
      continue
    }
    index += 1
    onProgress?.(images.length > 1 ? `正在识图 ${index}/${images.length}…` : '正在识图…')
    try {
      out.push({ ...file, description: await describeImage(file, target) })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 失败也写进描述，避免这张图又被塞给不支持视觉的主模型
      out.push({ ...file, description: `（这张图没能识别：${message}）` })
    }
  }
  return out
}
