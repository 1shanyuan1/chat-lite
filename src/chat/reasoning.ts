import type { Protocol } from './protocol'

/**
 * 思考强度：借鉴 Chatbox 社区版的分层做法（src/shared/utils/reasoning-control.ts）。
 * 核心是两件事：
 * 1. default 表示「一个参数都不发」，遵循服务商默认；off 才是显式关闭
 * 2. 有些模型压根不能关（o 系列、Gemini 2.5 Pro、Gemini 3），此时 off 退化成 default，
 *    界面也不该给这个选项——发一个无效参数比不发更糟
 */
export type ReasoningControl =
  | { kind: 'levels'; levels: string[] }
  | { kind: 'toggle' }
  | { kind: 'none' }

export const LEVEL_LABELS: Record<string, string> = {
  none: '关',
  off: '关',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

export const labelOf = (value: string) => LEVEL_LABELS[value] ?? value

/** undefined=不干预，off=显式关闭，on=显式开启，其余为档位名 */
export type ReasoningValue = string | undefined

/* ---------------- 各家预算 ---------------- */

/** Anthropic 与国内网关 */
const BUDGET_STANDARD: Record<string, number> = {
  minimal: 1024,
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 8192,
}

/** Gemini 2.5：官方区间 low 1024 / medium 8192 / high 24576 */
const BUDGET_GEMINI25: Record<string, number> = {
  minimal: 1024,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 24576,
}

const TOGGLE_ON_BUDGET = 4096

/* ---------------- 模型能力 ---------------- */

/** 不能显式关闭思考的模型 */
const NO_DISABLE = [
  /(?:^|\/)o[1-9](?:[.-]|$)/i, // o 系列不接受 minimal/none
  /(?:^|\/)gemini-2\.5[\w.-]*-pro/i, // 2.5 Pro 有最低预算，0 会被拒
  /(?:^|\/)gemini-3(?:[.-]|$)/i, // 3.x 起不可关闭
]

export function canDisableExplicitly(modelId?: string): boolean {
  if (!modelId) return true
  return !NO_DISABLE.some((re) => re.test(modelId))
}

/* ---------------- 网关识别 ---------------- */

/**
 * 国内聚合网关普遍不认 reasoning_effort，而是认 enable_thinking。
 * 实测硅基流动：qwen3 / deepseek 用 enable_thinking:false 能真正关闭，reasoning_effort:none 被忽略。
 */
const ENABLE_THINKING_HOSTS = [
  'siliconflow.cn',
  'dashscope.aliyuncs.com',
  'bigmodel.cn',
  'moonshot.cn',
  'ark.cn-beijing.volces.com',
  'deepseek.com',
  'hunyuan.cloud.tencent.com',
  'stepfun.com',
  'baichuan-ai.com',
  'sensenova.cn',
  'ppinfra.com',
  'minimax.chat',
  'qianfan.baidubce.com',
  'spark-api-open.xf-yun.com',
  'tokenrhythm.studio',
]

export function usesEnableThinking(baseUrl?: string): boolean {
  if (!baseUrl) return false
  const url = baseUrl.toLowerCase()
  return ENABLE_THINKING_HOSTS.some((host) => url.includes(host))
}

/** Gemini 3 换成了档位（thinkingLevel），2.5 还是预算（thinkingBudget） */
const isGeminiLevelModel = (modelId?: string) => Boolean(modelId && /gemini-3/i.test(modelId))

/* ---------------- 控制形态 ---------------- */

export function reasoningControl(
  protocol: Protocol,
  model: { reasoning?: boolean; reasoningLevels?: string[] } | undefined
): ReasoningControl {
  if (!model) return { kind: 'none' }
  if (model.reasoningLevels && model.reasoningLevels.length > 0) {
    return { kind: 'levels', levels: model.reasoningLevels }
  }
  if (model.reasoning) return { kind: 'toggle' }
  return { kind: 'none' }
}

/* ---------------- 请求载荷 ---------------- */

export interface ReasoningPayload {
  /** OpenAI 兼容：reasoning_effort */
  effort?: string
  /** Anthropic：thinking.type = disabled */
  disabled?: boolean
  /** Anthropic：thinking.budget_tokens */
  budgetTokens?: number
  /** Gemini：thinkingConfig.thinkingBudget */
  thinkingBudget?: number
  /** Gemini 3：thinkingConfig.thinkingLevel */
  thinkingLevel?: string
  /** 国内网关：enable_thinking */
  enableThinking?: boolean
  /** 国内网关：thinking_budget（配合 enable_thinking） */
  gatewayBudget?: number
}

export function reasoningPayload(
  protocol: Protocol,
  value: ReasoningValue,
  options: { baseUrl?: string; modelId?: string } = {}
): ReasoningPayload {
  if (value === undefined) return {}
  const { baseUrl, modelId } = options
  const gateway = usesEnableThinking(baseUrl)

  if (value === 'off') {
    // 不能关的模型：退化成「不干预」，而不是发一个无效参数
    if (!canDisableExplicitly(modelId)) return {}
    if (protocol === 'anthropic') return { disabled: true }
    if (protocol === 'gemini') return { thinkingBudget: 0 }
    return gateway ? { enableThinking: false } : { effort: 'none' }
  }

  if (protocol === 'anthropic') {
    return {
      budgetTokens: value === 'on' ? TOGGLE_ON_BUDGET : (BUDGET_STANDARD[value] ?? TOGGLE_ON_BUDGET),
    }
  }

  if (protocol === 'gemini') {
    if (value === 'on') return { thinkingBudget: -1 }
    if (isGeminiLevelModel(modelId) && LEVEL_LABELS[value]) return { thinkingLevel: value }
    return { thinkingBudget: BUDGET_GEMINI25[value] ?? BUDGET_GEMINI25.medium }
  }

  // OpenAI 兼容：国内网关与官方是两套参数
  if (gateway) {
    if (value === 'on') return { enableThinking: true }
    return {
      enableThinking: true,
      gatewayBudget: BUDGET_STANDARD[value] ?? BUDGET_STANDARD.medium,
    }
  }

  if (value === 'on') return {}
  return { effort: value }
}
