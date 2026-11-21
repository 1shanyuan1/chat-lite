import type { Protocol } from '../protocol'
import { findProvider } from '../providers'
import { ADAPTERS } from './adapters'
import type {
  EffortOption,
  ModelReasoningMeta,
  ReasoningAdapter,
  ReasoningContext,
  ReasoningPayload,
} from './types'

/**
 * Anthropic 的方言按模型世代切换：
 * 4.6 起 budget_tokens 弃用，4.7+ 发 type:enabled 直接 400，只能 adaptive + effort。
 */
export function anthropicAdapterFor(model: string): ReasoningAdapter {
  const match = /claude-[a-z]+-(\d+)(?:[.-](\d+))?/i.exec(model)
  // 认不出世代时按新方言走：老模型正在退场，新模型更可能被用到
  if (!match) return ADAPTERS['anthropic-adaptive']
  const major = Number(match[1])
  const minor = match[2] ? Number(match[2]) : 0
  if (major >= 5) return ADAPTERS['anthropic-adaptive']
  if (major === 4 && minor >= 6) return ADAPTERS['anthropic-adaptive']
  return ADAPTERS['anthropic-budget']
}

/** Gemini 3 起改用 thinkingLevel，且不能与 thinkingBudget 同时出现 */
export function geminiAdapterFor(model: string): ReasoningAdapter {
  const match = /gemini-(\d+)/i.exec(model)
  const major = match ? Number(match[1]) : 0
  return major >= 3 ? ADAPTERS['gemini-level'] : ADAPTERS['gemini-budget']
}

/**
 * 选方言：协议决定大方向，服务商预设决定 OpenAI 兼容网关的具体方言。
 * 认不出的走 openai-effort——它只在模型声明支持思考时才会发参数。
 */
export function pickAdapter(
  protocol: Protocol,
  baseUrl: string | undefined,
  model: string | undefined
): ReasoningAdapter {
  const modelId = model ?? ''
  if (protocol === 'anthropic') return anthropicAdapterFor(modelId)
  if (protocol === 'gemini') return geminiAdapterFor(modelId)
  const provider = baseUrl ? findProvider(baseUrl) : undefined
  return ADAPTERS[provider?.reasoning ?? 'openai-effort'] ?? ADAPTERS['openai-effort']
}

export function reasoningEfforts(
  protocol: Protocol,
  baseUrl: string | undefined,
  model: string | undefined,
  meta?: ModelReasoningMeta
): EffortOption[] {
  const ctx: ReasoningContext = { protocol, baseUrl: baseUrl ?? '', model: model ?? '', meta }
  return pickAdapter(protocol, baseUrl, model).efforts(ctx)
}

export function reasoningPayload(
  protocol: Protocol,
  value: string | undefined,
  options: { baseUrl?: string; modelId?: string } = {}
): ReasoningPayload {
  if (!value) return {}
  const ctx: ReasoningContext = { protocol, baseUrl: options.baseUrl ?? '', model: options.modelId ?? '' }
  return pickAdapter(protocol, options.baseUrl, options.modelId).payload(value, ctx)
}
