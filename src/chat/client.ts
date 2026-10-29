import { platform } from '@/platform'
import type { Role } from '@/db'
import { buildChatRequest, resolveProtocol, type ProtocolSetting } from './protocol'
import { parseStream, type Delta } from './sse'

export interface ChatConfig {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  /** 'auto' 时按 Base URL 猜协议 */
  protocol: ProtocolSetting
  /** 模型上下文长度，来自 /models，用于超限提醒 */
  contextLimit?: number
  /** 全局提示词包（会话可覆盖） */
  packId?: string
  /** 用户在该角色眼中的称呼，用于替换 {{user}} */
  userName?: string
}

export interface WireTurn {
  role: Role
  content: string
}

export async function* streamChat(
  history: WireTurn[],
  config: ChatConfig,
  signal: AbortSignal
): AsyncGenerator<Delta> {
  const protocol = resolveProtocol(config.protocol, config.baseUrl)

  const run = (includeUsage: boolean) =>
    parseStream(
      protocol,
      platform().stream(
        buildChatRequest(protocol, config, {
          model: config.model,
          messages: history,
          system: config.systemPrompt || undefined,
          stream: true,
          // Gemini 与 Anthropic 原生协议自带 usage，不需要这个开关
          includeUsage: includeUsage && protocol === 'openai',
        }),
        signal
      )
    )

  let started = false
  try {
    for await (const delta of run(true)) {
      started = true
      yield delta
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 少数网关不认 stream_options，去掉再试一次
    if (!started && /stream_options|include_usage/i.test(message)) {
      for await (const delta of run(false)) {
        started = true
        yield delta
      }
      return
    }
    throw error
  }
}

/** 一次性拿完整文本，用于摘要压缩 */
export async function completeText(
  history: WireTurn[],
  config: ChatConfig,
  signal: AbortSignal
): Promise<string> {
  let text = ''
  for await (const delta of streamChat(history, config, signal)) {
    if (delta.content) text += delta.content
  }
  return text
}
