import type { HttpRequest } from '@/platform'
import { reasoningPayload, supportsTemperature } from './reasoning'
import type { NativeSearchPayload } from './native-search'

export type Protocol = 'openai' | 'anthropic' | 'gemini'
export type ProtocolSetting = Protocol | 'auto'

export interface AuthConfig {
  baseUrl: string
  apiKey: string
}

/** 模型请求的一次工具调用 */
export interface WireToolCall {
  id: string
  name: string
  /** 原始 JSON 字符串，回传时要原样带上 */
  arguments: string
}

/** 暴露给模型的工具定义 */
export interface WireTool {
  name: string
  description: string
  /** JSON Schema */
  parameters: Record<string, unknown>
}

export interface WireMessage {
  /** system 用来承载「历史之后的追加指令」（角色卡的 post_history_instructions） */
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  /** 图片附件；有值时 content 会拼成多模态数组 */
  images?: Array<{ mime: string; data: string }>
  /** assistant 请求调用的工具 */
  toolCalls?: WireToolCall[]
  /** role=tool 时：对应哪次调用 */
  toolCallId?: string
  /** role=tool 时：工具名，Gemini 需要它来配对 */
  toolName?: string
}

/** 从 Base URL 猜协议，猜错可以在设置里手动指定 */
export function detectProtocol(baseUrl: string): Protocol {
  const url = baseUrl.toLowerCase()
  if (url.includes('anthropic')) return 'anthropic'
  if (url.includes('generativelanguage.googleapis') || url.includes('aiplatform')) return 'gemini'
  if (url.includes(':generatecontent') || url.includes(':streamgeneratecontent')) return 'gemini'
  return 'openai'
}

export function resolveProtocol(setting: ProtocolSetting, baseUrl: string): Protocol {
  // 老配置可能没有 protocol 字段，按地址猜
  return !setting || setting === 'auto' ? detectProtocol(baseUrl) : setting
}

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '')

const parseArgs = (raw: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/* ---------------- 各协议的 message 形状 ---------------- */

function toOpenAIMessage(m: WireMessage): Record<string, unknown> {
  if (m.role === 'system') return { role: 'system', content: m.content }
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
  }
  if (m.toolCalls?.length) {
    return {
      role: 'assistant',
      // 只调工具不说话的场合，content 必须是 null 而不是空串
      content: m.content || null,
      tool_calls: m.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }
  if (m.images?.length) {
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.images.map((img) => ({
          type: 'image_url',
          image_url: { url: `data:${img.mime};base64,${img.data}` },
        })),
      ],
    }
  }
  return { role: m.role, content: m.content }
}

function toAnthropicMessage(m: WireMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: m.toolCallId ?? '', content: m.content }],
    }
  }
  if (m.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.toolCalls.map((call) => ({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: parseArgs(call.arguments),
        })),
      ],
    }
  }
  if (m.images?.length) {
    return {
      role: m.role,
      content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...m.images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mime, data: img.data },
        })),
      ],
    }
  }
  return { role: m.role, content: m.content }
}

function toGeminiContent(m: WireMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return {
      role: 'user',
      parts: [{ functionResponse: { name: m.toolName ?? 'tool', response: { result: m.content } } }],
    }
  }
  if (m.toolCalls?.length) {
    return {
      role: 'model',
      parts: m.toolCalls.map((call) => ({
        functionCall: { name: call.name, args: parseArgs(call.arguments) },
      })),
    }
  }
  return {
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.content ? [{ text: m.content }] : []),
      ...(m.images ?? []).map((img) => ({ inline_data: { mime_type: img.mime, data: img.data } })),
    ],
  }
}

export function buildChatRequest(
  protocol: Protocol,
  auth: AuthConfig,
  options: {
    model: string
    messages: WireMessage[]
    system?: string
    stream: boolean
    includeUsage?: boolean
    topP?: number
    maxTokens?: number
    /** 采样温度；不传则用服务商默认 */
    temperature?: number
    /** 思考强度档位，off 或不传则不注入 */
    reasoningLevel?: string
    /** 暴露给模型的工具；空数组等于不启用工具 */
    tools?: WireTool[]
    /** 上游自带搜索的参数；开了就不走本地工具 */
    nativeSearch?: NativeSearchPayload
  }
): HttpRequest {
  const base = trimBase(auth.baseUrl)
  const { model, messages, system, stream, includeUsage, topP, maxTokens, temperature, reasoningLevel } = options
  const tools = options.tools?.length ? options.tools : undefined
  const native = options.nativeSearch
  // Anthropic / Gemini 的 system 只能走顶层字段，所以先把夹在消息里的 system 抽出来拼进去；
  // OpenAI 兼容协议则原样留在 messages 里（位置更靠后，权重更高）
  const inlineSystem = messages.filter((m) => m.role === 'system')
  const chatMessages = messages.filter((m) => m.role !== 'system')
  const systemAll = [system, ...inlineSystem.map((m) => m.content)].filter((t) => t && t.trim()).join('\n\n')
  const reason = reasoningPayload(protocol, reasoningLevel, { baseUrl: auth.baseUrl, modelId: model })

  // 推理模型不认 temperature；Anthropic 开了思考时 temperature 必须是 1，干脆不发
  const temp =
    temperature !== undefined && supportsTemperature(model) && !(protocol === 'anthropic' && reason.thinkingEnabled)
      ? temperature
      : undefined

  if (protocol === 'anthropic') {
    return {
      url: `${base}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': auth.apiKey,
        'anthropic-version': '2023-06-01',
        // 浏览器直连 Anthropic 必需的 CORS 开关
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        // 思考预算必须小于 max_tokens，适配器会把下限算好
        max_tokens: reason.minMaxTokens
          ? Math.max(maxTokens ?? 8192, reason.minMaxTokens)
          : (maxTokens ?? 8192),
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(temp !== undefined ? { temperature: temp } : {}),
        ...(reason.anthropic ?? {}),
        ...(systemAll ? { system: systemAll } : {}),
        ...(native?.anthropic ?? {}),
        ...(tools
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
        messages: chatMessages.map(toAnthropicMessage),
        stream,
      }),
    }
  }

  if (protocol === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(auth.apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: chatMessages.map(toGeminiContent),
        ...(systemAll ? { systemInstruction: { parts: [{ text: systemAll }] } } : {}),
        ...(tools ? { tools: [{ functionDeclarations: tools }] } : {}),
        ...(native?.gemini ?? {}),
        ...(topP !== undefined ||
        maxTokens !== undefined ||
        temp !== undefined ||
        reason.gemini !== undefined
          ? {
              generationConfig: {
                ...(topP !== undefined ? { topP } : {}),
                ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
                ...(temp !== undefined ? { temperature: temp } : {}),
                ...(reason.gemini ?? {}),
              },
            }
          : {}),
      }),
    }
  }

  return {
    url: `${base}/chat/completions`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.map(toOpenAIMessage)],
      stream,
      ...(tools
        ? { tools: tools.map((tool) => ({ type: 'function', function: tool })) }
        : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temp !== undefined ? { temperature: temp } : {}),
      ...(reason.openai ?? {}),
      ...(native?.openai ?? {}),
      // 只有 OpenAI 兼容协议支持这个字段，部分网关会因此报 400，上层有降级重试
      ...(stream && includeUsage ? { stream_options: { include_usage: true } } : {}),
    }),
  }
}

export function buildModelsRequest(protocol: Protocol, auth: AuthConfig): HttpRequest {
  const base = trimBase(auth.baseUrl)

  if (protocol === 'anthropic') {
    return {
      url: `${base}/models?limit=1000`,
      method: 'GET',
      headers: {
        'x-api-key': auth.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    }
  }

  if (protocol === 'gemini') {
    return {
      url: `${base}/models?pageSize=1000&key=${encodeURIComponent(auth.apiKey)}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }
  }

  return {
    url: `${base}/models`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.apiKey}`,
    },
  }
}
