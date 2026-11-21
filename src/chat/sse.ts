import type { Protocol } from './protocol'
import { readAnthropicUsage, readGeminiUsage, readOpenAIUsage, type Usage } from './tokens'
import { anthropicSourcesFromBlocks, geminiSourcesFromCandidate } from './native-citations'
import type { WebSource } from './web-search-types'

export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  /** 参数是流式拼起来的片段，最后要整体 JSON.parse */
  arguments?: string
}

export interface Delta {
  content?: string
  reasoning?: string
  usage?: Partial<Usage>
  toolCall?: ToolCallDelta
  /** 上游自带搜索返回的来源 */
  sources?: WebSource[]
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

function readOpenAI(payload: unknown): Delta[] {
  const json = payload as {
    choices?: Array<{ delta?: Record<string, unknown> }>
    usage?: unknown
  }
  const out: Delta[] = []
  const usage = json?.usage ? (readOpenAIUsage(json.usage) ?? undefined) : undefined
  if (usage) out.push({ usage })

  const delta = json?.choices?.[0]?.delta
  if (!delta) return out

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
  if (text) out.push({ content: text })

  // 各家字段名不统一：reasoning_content / reasoning
  const reasoning =
    typeof delta.reasoning_content === 'string'
      ? delta.reasoning_content
      : typeof delta.reasoning === 'string'
        ? delta.reasoning
        : ''
  if (reasoning) out.push({ reasoning })

  // 工具调用：OpenAI 的 delta.tool_calls 是数组，按 index 累积
  if (Array.isArray(delta.tool_calls)) {
    for (const raw of delta.tool_calls) {
      if (!raw || typeof raw !== 'object') continue
      const call = raw as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } }
      const fn = call.function ?? {}
      out.push({
        toolCall: {
          index: typeof call.index === 'number' ? call.index : 0,
          id: typeof call.id === 'string' && call.id ? call.id : undefined,
          name: typeof fn.name === 'string' && fn.name ? fn.name : undefined,
          arguments: typeof fn.arguments === 'string' ? fn.arguments : undefined,
        },
      })
    }
  }

  return out
}

function readAnthropic(payload: unknown): Delta[] {
  const json = payload as {
    type?: string
    index?: number
    delta?: Record<string, unknown>
    content_block?: {
      type?: string
      id?: string
      name?: string
      content?: Array<{ type?: string; url?: string; title?: string; page_age?: string }>
    }
    message?: { usage?: unknown }
    usage?: unknown
  }

  // 输入 token 在 message_start，输出 token 在 message_delta
  if (json?.type === 'message_start' && json.message?.usage) {
    const usage = readAnthropicUsage(json.message.usage)
    return usage ? [{ usage }] : []
  }
  if (json?.type === 'message_delta' && json.usage) {
    const usage = readAnthropicUsage(json.usage)
    return usage ? [{ usage }] : []
  }

  // 工具调用的名字在 content_block_start，参数靠 input_json_delta 拼
  if (json?.type === 'content_block_start') {
    const block = json.content_block
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      return [{ toolCall: { index: json.index ?? 0, id: block.id, name: block.name } }]
    }
    // 服务端搜索的结果块：直接给出结构化的来源列表
    if (block?.type === 'web_search_tool_result') {
      const sources = anthropicSourcesFromBlocks([block])
      return sources.length > 0 ? [{ sources }] : []
    }
    return []
  }

  if (json?.type !== 'content_block_delta' || !json.delta) return []
  const delta = json.delta

  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return delta.text ? [{ content: delta.text }] : []
  }
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
    return delta.thinking ? [{ reasoning: delta.thinking }] : []
  }
  if (delta.type === 'input_json_delta') {
    const partial = typeof delta.partial_json === 'string' ? delta.partial_json : ''
    return partial ? [{ toolCall: { index: json.index ?? 0, arguments: partial } }] : []
  }
  return []
}

function readGemini(payload: unknown): Delta[] {
  const json = payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string
          thought?: boolean
          functionCall?: { name?: string; args?: unknown }
        }>
      }
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
      }
    }>
    usageMetadata?: unknown
  }
  const out: Delta[] = []
  const usage = json?.usageMetadata ? (readGeminiUsage(json.usageMetadata) ?? undefined) : undefined
  if (usage) out.push({ usage })

  const parts = json?.candidates?.[0]?.content?.parts
  // Google 搜索接地的来源；流式里会重复给，去重交给上层
  const grounded = geminiSourcesFromCandidate(json?.candidates?.[0])
  if (grounded.length > 0) out.push({ sources: grounded })
  if (!Array.isArray(parts)) return out

  let text = ''
  let thinking = ''
  parts.forEach((part, index) => {
    if (!part || typeof part !== 'object') return
    if (part.functionCall?.name) {
      // Gemini 的 functionCall 是一次性给全的，不像另外两家要拼片段
      out.push({
        toolCall: {
          index,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args ?? {}),
        },
      })
      return
    }
    if (typeof part.text !== 'string') return
    if (part.thought) thinking += part.text
    else text += part.text
  })

  if (text) out.push({ content: text })
  if (thinking) out.push({ reasoning: thinking })
  return out
}

/** 统一三家协议的流式解析，产出文本增量、思考增量、工具调用与用量 */
export async function* parseStream(protocol: Protocol, source: AsyncGenerator<string>): AsyncGenerator<Delta> {
  const read = protocol === 'anthropic' ? readAnthropic : protocol === 'gemini' ? readGemini : readOpenAI

  for await (const payload of dataPayloads(source)) {
    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      continue
    }
    for (const delta of read(json)) yield delta
  }
}
