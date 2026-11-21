import type { Protocol } from '../protocol'

export type AdapterId =
  | 'none'
  | 'openai-effort'
  | 'openrouter'
  | 'deepseek-thinking'
  | 'glm-thinking'
  | 'kimi-thinking'
  | 'doubao-thinking'
  | 'qwen-thinking'
  | 'anthropic-adaptive'
  | 'anthropic-budget'
  | 'gemini-level'
  | 'gemini-budget'

/** 模型元数据里与思考能力有关的部分 */
export interface ModelReasoningMeta {
  reasoning?: boolean
  reasoningLevels?: string[]
}

export interface ReasoningContext {
  protocol: Protocol
  baseUrl: string
  model: string
  meta?: ModelReasoningMeta
}

/**
 * 要合并进请求体的字段。
 * 适配器只决定「发什么」，具体落在哪一层由 protocol 负责序列化。
 */
export interface ReasoningPayload {
  /** OpenAI 兼容请求体顶层 */
  openai?: Record<string, unknown>
  /** Anthropic 请求体顶层 */
  anthropic?: Record<string, unknown>
  /** Gemini 的 generationConfig 内部 */
  gemini?: Record<string, unknown>
  /** Anthropic 的预算必须小于 max_tokens，需要把上限抬上去 */
  minMaxTokens?: number
  /** Anthropic 真的开了思考时，temperature 必须是 1 */
  thinkingEnabled?: boolean
}

export interface EffortOption {
  /** 不透明 id，菜单直接用；不必等于线上拼写 */
  id: string
  label: string
  payload: ReasoningPayload
}

export interface ReasoningAdapter {
  id: AdapterId
  /** 该模型可选的档位，按弱 → 强排序；空数组表示不支持思考 */
  efforts(ctx: ReasoningContext): EffortOption[]
  /** 把选中的档位翻成请求字段 */
  payload(effort: string, ctx: ReasoningContext): ReasoningPayload
}
