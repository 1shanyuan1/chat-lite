import type { HttpRequest } from '@/platform'

export type Protocol = 'openai' | 'anthropic' | 'gemini'
export type ProtocolSetting = Protocol | 'auto'

export interface AuthConfig {
  baseUrl: string
  apiKey: string
}

export interface WireMessage {
  role: 'user' | 'assistant'
  content: string
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
  return setting === 'auto' ? detectProtocol(baseUrl) : setting
}

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '')

export function buildChatRequest(
  protocol: Protocol,
  auth: AuthConfig,
  options: {
    model: string
    messages: WireMessage[]
    system?: string
    stream: boolean
    includeUsage?: boolean
    temperature?: number
    topP?: number
    maxTokens?: number
  }
): HttpRequest {
  const base = trimBase(auth.baseUrl)
  const { model, messages, system, stream, includeUsage, temperature, topP, maxTokens } = options

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
        max_tokens: maxTokens ?? 8192,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
        ...(system ? { system } : {}),
        messages,
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
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(temperature !== undefined || topP !== undefined || maxTokens !== undefined
          ? {
              generationConfig: {
                ...(temperature !== undefined ? { temperature } : {}),
                ...(topP !== undefined ? { topP } : {}),
                ...(maxTokens !== undefined ? { maxOutputTokens: maxTokens } : {}),
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
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      stream,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { top_p: topP } : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
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
