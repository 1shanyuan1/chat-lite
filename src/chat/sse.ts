import type { Protocol } from './protocol'
import { readAnthropicUsage, readGeminiUsage, readOpenAIUsage, type Usage } from './tokens'

export interface Delta {
  content?: string
  reasoning?: string
  usage?: Partial<Usage>
}

/**
 * 把任意 SSE 流切成 data: 里的 JSON 字符串，遇到 [DONE] 结束。
 * 必须按 \n 缓冲：网络分片随时可能把一行 data: 切成两半。
 */
async function* dataPayloads(source: AsyncGenerator<string>): AsyncGenerator<string> {
  let buffer = ''

  const take = (line: string): string | 'done' | null => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null
    const payload = trimmed.slice(5).trim()
    if (!payload) return null
    if (payload === '[DONE]') return 'done'
    return payload
  }

  for await (const chunk of source) {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index !== -1) {
      const result = take(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (result === 'done') return
      if (result) yield result
    }
  }
  const tail = take(buffer)
  if (tail && tail !== 'done') yield tail
}

function readOpenAI(payload: unknown): Delta | null {
  const json = payload as { choices?: Array<{ delta?: Record<string, unknown> }>; usage?: unknown }
  const delta = json?.choices?.[0]?.delta
  const usage = json?.usage ? readOpenAIUsage(json.usage) ?? undefined : undefined

  if (!delta) return usage ? { usage } : null

  const raw = delta.content
  let text = ''
  if (typeof raw === 'string') {
    text = raw
  } else if (Array.isArray(raw)) {
    // 多模态增量：content 可能是 [{ type: 'text', text: '...' }]
    text = raw
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('')
  }

  // 各家字段名不统一：reasoning_content / reasoning
  const reasoning =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : ''

  if (!text && !reasoning) return usage ? { usage } : null
  return { content: text || undefined, reasoning: reasoning || undefined, usage }
}

function readAnthropic(payload: unknown): Delta | null {
  const json = payload as {
    type?: string
    delta?: Record<string, unknown>
    message?: { usage?: unknown }
    usage?: unknown
  }

  // 输入 token 在 message_start，输出 token 在 message_delta
  if (json?.type === 'message_start' && json.message?.usage) {
    const usage = readAnthropicUsage(json.message.usage)
    return usage ? { usage: usage ?? undefined } : null
  }
  if (json?.type === 'message_delta' && json.usage) {
    const usage = readAnthropicUsage(json.usage)
    return usage ? { usage: usage ?? undefined } : null
  }
  if (json?.type !== 'content_block_delta' || !json.delta) return null

  const delta = json.delta
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return delta.text ? { content: delta.text } : null
  }
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    return delta.thinking ? { reasoning: delta.thinking } : null
  }
  return null
}

function readGemini(payload: unknown): Delta | null {
  const json = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
    usageMetadata?: unknown
  }
  const usage = json?.usageMetadata ? readGeminiUsage(json.usageMetadata) ?? undefined : undefined
  const parts = json?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return usage ? { usage } : null

  let text = ''
  let thinking = ''
  for (const part of parts) {
    if (!part || typeof part.text !== 'string') continue
    if (part.thought) thinking += part.text
    else text += part.text
  }
  if (!text && !thinking) return usage ? { usage } : null
  return { content: text || undefined, reasoning: thinking || undefined, usage }
}

/** 统一三家协议的流式解析，产出文本增量与用量 */
export async function* parseStream(protocol: Protocol, source: AsyncGenerator<string>): AsyncGenerator<Delta> {
  const read = protocol === 'anthropic' ? readAnthropic : protocol === 'gemini' ? readGemini : readOpenAI

  for await (const payload of dataPayloads(source)) {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      continue
    }
    const delta = read(json)
    if (delta) yield delta
  }
}
