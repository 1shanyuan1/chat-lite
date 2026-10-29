import type { Protocol } from './protocol'

/** 统一的思考强度档位 */
export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export const LEVEL_LABELS: Record<string, string> = {
  off: '关',
  none: '关',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

/** 各家 API 只认自己的名字，做一次收敛 */
const API_LEVEL: Record<string, string> = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'high',
}

/** Anthropic / Gemini 用 token 预算表达强度 */
const LEVEL_BUDGET: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
}

export const labelOf = (level: string) => LEVEL_LABELS[level] ?? level
export const isOff = (level?: string) => !level || level === 'off' || level === 'none'
export const budgetOf = (level: string) => LEVEL_BUDGET[level] ?? LEVEL_BUDGET.medium

/** 服务商没给档位时的兜底：按协议给一组够用的 */
export function defaultLevels(protocol: Protocol): string[] {
  if (protocol === 'gemini') return ['off', 'low', 'high']
  return ['off', 'low', 'medium', 'high']
}

/**
 * 决定某个模型应该显示哪几个档位：
 * 1. 模型元数据里声明了档位 → 原样使用（服务商说了算）
 * 2. 只声明支持思考 → 用协议默认档位
 * 3. 不支持思考 → 空数组，界面不显示
 */
export function levelsForModel(
  protocol: Protocol,
  model: { reasoning?: boolean; reasoningLevels?: string[] } | undefined
): string[] {
  if (!model) return []
  if (model.reasoningLevels && model.reasoningLevels.length > 0) return model.reasoningLevels
  if (model.reasoning) return defaultLevels(protocol)
  return []
}

export interface ReasoningParams {
  /** OpenAI 兼容：reasoning_effort */
  reasoningEffort?: string
  /** Anthropic：thinking.budget_tokens */
  budgetTokens?: number
  /** Gemini：thinkingConfig.thinkingBudget */
  thinkingBudget?: number
}

export function reasoningParams(protocol: Protocol, level?: string): ReasoningParams {
  if (isOff(level)) return {}
  const key = level as string
  if (protocol === 'anthropic') return { budgetTokens: budgetOf(key) }
  if (protocol === 'gemini') return { thinkingBudget: budgetOf(key) }
  return { reasoningEffort: API_LEVEL[key] ?? key }
}
