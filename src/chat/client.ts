import { platform } from '@/platform'
import { buildChatRequest, resolveProtocol, type ProtocolSetting, type WireMessage, type WireTool } from './protocol'
import type { NativeSearchPayload } from './native-search'
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
  /**
   * 压缩预警：上下文占用到这个百分比就提示「压缩并开新对话」，默认 80。
   * 各家模型的「安全水位」不一样——128k 窗口留 20% 余量和 8k 窗口留 20% 完全是两回事。
   */
  compressAt?: number
  /**
   * 图片保留轮数：请求里只给最近 N 轮（含本轮）带原图，更早的换成占位说明，默认 2。
   * 多模态没有服务端会话状态，历史图片每一轮都会重新计费——DeepSeek 官方 chat-demo
   * 用 Files API 的 file_id 引用解决，但并非每家服务商都有对应能力，这里用通用解。
   * 调大保留更多图像记忆，调小更省；有识图描述的图片不受影响（它本来就是文字）。
   */
  imageResendTurns?: number
  /** 全局提示词包（会话可覆盖） */
  packId?: string
  /** 用户在该角色眼中的称呼，用于替换 {{user}} */
  userName?: string
  /** 我自己的设定：角色扮演时注入，让 {{char}} 知道 {{user}} 是谁 */
  persona?: string
  /** 外观：浅色 / 深色 */
  theme?: 'light' | 'dark'
  /** 圆角风格：圆角 / 直角 */
  corners?: 'round' | 'sharp'
  /**
   * 色组（实验版 ui-next 使用，正式版忽略）：浅 / 深两套锚点各自独立
   * （每套 = 底/中/墨 必填 + 正文/次级/辅助 可选覆盖，显式颜色原样生效）。
   * 不填 = 石墨默认。可选字段，旧数据不受影响；更旧的 { h, s } / 扁平格式读取时兼容。
   */
  palette?: {
    light?: { bg: string; mid: string; ink: string; text?: string; sub?: string; aux?: string }
    dark?: { bg: string; mid: string; ink: string; text?: string; sub?: string; aux?: string }
    bold?: boolean
  }
  /** 消息气泡模式（实验版）：true = 助手回复也用气泡（默认平铺） */
  bubbles?: boolean
  /**
   * 设定发展模式（写作专属）：开新会话时把挂载的设定复制成一份发展稿，
   * AI 可以在写作过程中更新它，原卡保持不变。
   */
  settingEvolution?: boolean
  /** 采样参数，全局可调（在输入框的模型面板里） */
  topP?: number
  maxTokens?: number
  /** 采样温度；不设则用服务商默认 */
  temperature?: number
  /** 思考强度档位 */
  reasoningLevel?: string
  /** 联网搜索开关：关 / 上游自带 / 本地源 / Bing 兜底 */
  searchMode?: 'off' | 'native' | 'local' | 'bing'
  /** @deprecated 旧字段，仅在读取时兼容 */
  webSearch?: boolean
  /** 专门用于搜索的 DeepSeek key；留空则复用模型 key（仅当服务商是 DeepSeek） */
  searchApiKey?: string
  /** 本地搜索用哪个源；auto = 有 key 用 DeepSeek，没有就用内置 Bing */
  searchSource?: 'auto' | 'deepseek' | 'bing' | 'custom' | 'native'
  /** 自定义搜索接口：地址里可用 {{query}}，请求体里可用 {{query}}/{{count}} */
  searchCustom?: {
    url: string
    method?: 'GET' | 'POST'
    key?: string
    /** 额外请求头，JSON 文本；值里可用 {{key}} */
    headers?: string
    /** 请求体模板；留空则用 {"query":"{{query}}","count":{{count}}} */
    body?: string
  }
  /**
   * 辅助模型：从「已添加的服务商」里挑，留空则用当前对话的服务商。
   * enabled 是独立开关——没配默认关，配了也可以随时关掉。
   */
  visionModel?: AuxiliaryModel
  /** 辅助搜索模型：同上 */
  searchModel?: AuxiliaryModel
  /** 用过的服务商 Key（baseUrl → key），供辅助模型挑选 */
  credentials?: Record<string, string>
  /**
   * 长记忆：只在极简模式下生效。
   * 打开后模型能读写本机记忆文件，界面上只显示成品回答。
   */
  longMemory?: boolean
  /**
   * 画像的 token 预算（默认 PROFILE_BUDGET = 6000）：AI 在预算内自由经营记忆
   * （追加、合并、淘汰、重组），超出从最旧的条目开始丢。预算越大记得越多，
   * 但画像每轮都注入 system，token 成本也跟着涨。
   */
  memoryBudget?: number
  /** 运行时字段：上游自带搜索的参数，不落库 */
  nativeSearch?: NativeSearchPayload
}

export interface AuxiliaryModel {
  enabled?: boolean
  /** 服务商地址；留空表示用当前对话的服务商 */
  baseUrl?: string
  /** 模型名；留空表示用当前对话的模型 */
  model?: string
}

/** 请求历史里的一条消息，与协议层共用同一套形状 */
export type WireTurn = WireMessage

export async function* streamChat(
  history: WireTurn[],
  config: ChatConfig,
  signal: AbortSignal,
  tools?: WireTool[]
): AsyncGenerator<Delta> {
  const protocol = resolveProtocol(config.protocol, config.baseUrl)
  // OpenRouter 的 :online 是拼在模型名上的
  const model = config.model + (config.nativeSearch?.modelSuffix ?? '')

  const run = (includeUsage: boolean) =>
    parseStream(
      protocol,
      platform().stream(
        buildChatRequest(protocol, config, {
          model,
          messages: history,
          system: config.systemPrompt || undefined,
          topP: config.topP,
          maxTokens: config.maxTokens,
          temperature: config.temperature,
          reasoningLevel: config.reasoningLevel,
          tools,
          nativeSearch: config.nativeSearch,
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
