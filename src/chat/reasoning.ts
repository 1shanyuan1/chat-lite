import type { Protocol } from './protocol'

/**
 * 思考强度的三种控制形态：
 * - levels：服务商在模型元数据里声明了档位，就原样给出
 * - toggle：只声明“支持思考”，给一个开关
 * - none：不支持思考，界面不显示
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

/** 开关/档位都用同一个字段承载：undefined=不干预，off=明确关闭，on=明确开启，其余为档位名 */
export type ReasoningValue = string | undefined

/** Anthropic 无档位时开启思考用的默认预算 */
const TOGGLE_ON_BUDGET = 4096

/** Anthropic / Gemini 用 token 预算表达强度（参考官方区间：anthropic ≥1024，gemini 2.5 128–32768） */
const LEVEL_BUDGET: Record<string, number> = {
  minimal: 1024,
  low: 2048,
  medium: 4096,
  high: 8192,
  xhigh: 16384,
}

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

export interface ReasoningPayload {
  /** OpenAI 兼容：reasoning_effort */
  effort?: string
  /** Anthropic：thinking.type = disabled */
  disabled?: boolean
  /** Anthropic：thinking.budget_tokens */
  budgetTokens?: number
  /** Gemini：thinkingConfig.thinkingBudget（0 关闭，-1 动态） */
  thinkingBudget?: number
  /** 国内网关：enable_thinking */
  enableThinking?: boolean
}

/**
 * 把界面上的值翻译成各家请求字段。
 * undefined 表示「不干预」——不发任何参数，遵循服务商自己的默认。
 */
export function reasoningPayload(
  protocol: Protocol,
  value: ReasoningValue,
  baseUrl?: string
): ReasoningPayload {
  if (value === undefined) return {}
  const gateway = usesEnableThinking(baseUrl)

  if (value === 'off') {
    if (protocol === 'anthropic') return { disabled: true }
    if (protocol === 'gemini') return { thinkingBudget: 0 }
    return gateway ? { enableThinking: false } : { effort: 'none' }
  }

  if (value === 'on') {
    if (protocol === 'anthropic') return { budgetTokens: TOGGLE_ON_BUDGET }
    if (protocol === 'gemini') return { thinkingBudget: -1 }
    // 开启态：网关用 enable_thinking，官方 API 不干预即默认开启
    return gateway ? { enableThinking: true } : {}
  }

  const budget = LEVEL_BUDGET[value] ?? LEVEL_BUDGET.medium
  if (protocol === 'anthropic') return { budgetTokens: budget }
  if (protocol === 'gemini') return { thinkingBudget: budget }
  return gateway ? { enableThinking: true, effort: value } : { effort: value }
}
