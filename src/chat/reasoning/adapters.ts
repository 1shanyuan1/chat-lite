import type {
  AdapterId,
  EffortOption,
  ReasoningAdapter,
  ReasoningContext,
  ReasoningPayload,
} from './types'

const LABELS: Record<string, string> = {
  off: '关',
  none: '关',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最高',
}

export const labelOf = (id: string) => LABELS[id] ?? id

/** 标准档位，弱 → 强 */
const STANDARD = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Anthropic 与国内网关的预算换算 */
const BUDGET: Record<string, number> = {
  minimal: 1024,
  low: 1024,
  medium: 4096,
  high: 8192,
  xhigh: 8192,
  max: 16384,
}

/** Gemini 2.5 官方区间：low 1024 / medium 8192 / high 24576 */
const GEMINI_BUDGET: Record<string, number> = {
  minimal: 1024,
  low: 1024,
  medium: 8192,
  high: 24576,
  xhigh: 24576,
  max: 24576,
}

/** 不能显式关闭思考的模型 */
const NO_DISABLE = [
  /(?:^|\/)o[1-9](?:[.-]|$)/i,
  /(?:^|\/)gpt-[56]/i,
  /deepseek-reasoner/i,
  /gemini-2\.5[\w.-]*-pro/i,
  /gemini-[3-9](?:[.-]|$)/i,
  /glm-5\.[3-9]/i,
  /kimi-k3/i,
  /kimi-k2\.7-code/i,
]

export function canDisable(model?: string): boolean {
  if (!model) return true
  return !NO_DISABLE.some((re) => re.test(model))
}

/**
 * 不接受 temperature 的模型：o 系列、gpt-5/6、deepseek-reasoner。
 * 发了要么 400，要么被静默忽略。
 */
const NO_TEMPERATURE = [/(?:^|\/)o[1-9](?:[.-]|$)/i, /(?:^|\/)gpt-[56]/i, /deepseek-reasoner/i]

export function supportsTemperature(modelId?: string): boolean {
  if (!modelId) return true
  return !NO_TEMPERATURE.some((re) => re.test(modelId))
}

const supportsReasoning = (ctx: ReasoningContext) => ctx.meta?.reasoning === true

/** 服务商声明了档位就用它的，否则用默认；off/none 由开关单独表示 */
const levelsOf = (ctx: ReasoningContext, fallback: string[]) => {
  const declared = ctx.meta?.reasoningLevels
  const list = declared && declared.length > 0 ? declared : fallback
  return list.filter((id) => id !== 'off' && id !== 'none')
}

const options = (ids: string[], build: (id: string) => ReasoningPayload): EffortOption[] =>
  ids.map((id) => ({ id, label: labelOf(id), payload: build(id) }))

/** 追加「关」；不能关的模型不追加，避免给一个必然被拒的选项 */
const withOff = (list: EffortOption[], ctx: ReasoningContext, payload: ReasoningPayload) =>
  canDisable(ctx.model) ? [...list, { id: 'off', label: labelOf('off'), payload }] : list

const none: ReasoningAdapter = {
  id: 'none',
  efforts: () => [],
  payload: () => ({}),
}

/** OpenAI 官方风格：只有一个 reasoning_effort */
const openaiEffort: ReasoningAdapter = {
  id: 'openai-effort',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, ['minimal', 'low', 'medium', 'high']), (id) => ({
      openai: { reasoning_effort: id },
    }))
    return withOff(list, ctx, { openai: { reasoning_effort: 'none' } })
  },
  payload(effort) {
    return { openai: { reasoning_effort: effort === 'off' ? 'none' : effort } }
  },
}

/** OpenRouter 的统一 reasoning 对象 */
const openrouter: ReasoningAdapter = {
  id: 'openrouter',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, STANDARD), (id) => ({ openai: { reasoning: { effort: id } } }))
    return withOff(list, ctx, { openai: { reasoning: { enabled: false } } })
  },
  payload(effort) {
    return { openai: { reasoning: effort === 'off' ? { enabled: false } : { effort } } }
  },
}

/** DeepSeek / GLM / 豆包：thinking.type 开关 + reasoning_effort 档位 */
const thinkingPlusEffort = (adapterId: AdapterId, fallbackLevels: string[]): ReasoningAdapter => ({
  id: adapterId,
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, fallbackLevels), (id) => ({
      openai: { thinking: { type: 'enabled' }, reasoning_effort: id },
    }))
    return withOff(list, ctx, { openai: { thinking: { type: 'disabled' } } })
  },
  payload(effort) {
    if (effort === 'off') return { openai: { thinking: { type: 'disabled' } } }
    return { openai: { thinking: { type: 'enabled' }, reasoning_effort: effort } }
  },
})

/** Kimi：K3 恒开且只有档位，K2.x 只有开关 */
const kimi: ReasoningAdapter = {
  id: 'kimi-thinking',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    if (/kimi-k3/i.test(ctx.model)) {
      return options(levelsOf(ctx, ['low', 'high', 'max']), (id) => ({ openai: { reasoning_effort: id } }))
    }
    return canDisable(ctx.model)
      ? [{ id: 'off', label: labelOf('off'), payload: { openai: { thinking: { type: 'disabled' } } } }]
      : []
  },
  payload(effort, ctx) {
    if (/kimi-k3/i.test(ctx.model)) return { openai: { reasoning_effort: effort } }
    return effort === 'off'
      ? { openai: { thinking: { type: 'disabled' } } }
      : { openai: { thinking: { type: 'enabled' } } }
  },
}

/** 阿里百炼 / 硅基流动：enable_thinking + thinking_budget */
const qwen: ReasoningAdapter = {
  id: 'qwen-thinking',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, ['low', 'medium', 'high']), (id) => ({
      openai: { enable_thinking: true, thinking_budget: BUDGET[id] ?? BUDGET.medium },
    }))
    return withOff(list, ctx, { openai: { enable_thinking: false } })
  },
  payload(effort) {
    if (effort === 'off') return { openai: { enable_thinking: false } }
    return { openai: { enable_thinking: true, thinking_budget: BUDGET[effort] ?? BUDGET.medium } }
  },
}

/** Anthropic 4.6+：adaptive + output_config.effort */
const anthropicAdaptive: ReasoningAdapter = {
  id: 'anthropic-adaptive',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, ['low', 'medium', 'high']), (id) => ({
      anthropic: { thinking: { type: 'adaptive' }, output_config: { effort: id } },
      thinkingEnabled: true,
    }))
    return withOff(list, ctx, { anthropic: { thinking: { type: 'disabled' } } })
  },
  payload(effort) {
    if (effort === 'off') return { anthropic: { thinking: { type: 'disabled' } } }
    return {
      anthropic: { thinking: { type: 'adaptive' }, output_config: { effort } },
      thinkingEnabled: true,
    }
  },
}

/** Anthropic 4.5 及以前：budget_tokens */
const anthropicBudget: ReasoningAdapter = {
  id: 'anthropic-budget',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, ['low', 'medium', 'high']), (id) => {
      const budget = BUDGET[id] ?? BUDGET.medium
      return {
        anthropic: { thinking: { type: 'enabled', budget_tokens: budget } },
        minMaxTokens: budget + 2048,
        thinkingEnabled: true,
      }
    })
    return withOff(list, ctx, { anthropic: { thinking: { type: 'disabled' } } })
  },
  payload(effort) {
    if (effort === 'off') return { anthropic: { thinking: { type: 'disabled' } } }
    const budget = BUDGET[effort] ?? BUDGET.medium
    return {
      anthropic: { thinking: { type: 'enabled', budget_tokens: budget } },
      minMaxTokens: budget + 2048,
      thinkingEnabled: true,
    }
  },
}

/** Gemini 3+：thinkingLevel，且不能关闭 */
const geminiLevel: ReasoningAdapter = {
  id: 'gemini-level',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    return options(levelsOf(ctx, ['minimal', 'low', 'medium', 'high']), (id) => ({
      gemini: { thinkingConfig: { thinkingLevel: id } },
      thinkingEnabled: true,
    }))
  },
  payload(effort) {
    return { gemini: { thinkingConfig: { thinkingLevel: effort } }, thinkingEnabled: true }
  },
}

/** Gemini 2.5：thinkingBudget */
const geminiBudget: ReasoningAdapter = {
  id: 'gemini-budget',
  efforts(ctx) {
    if (!supportsReasoning(ctx)) return []
    const list = options(levelsOf(ctx, ['low', 'medium', 'high']), (id) => ({
      gemini: { thinkingConfig: { thinkingBudget: GEMINI_BUDGET[id] ?? GEMINI_BUDGET.medium } },
      thinkingEnabled: true,
    }))
    return withOff(list, ctx, { gemini: { thinkingConfig: { thinkingBudget: 0 } } })
  },
  payload(effort) {
    if (effort === 'off') return { gemini: { thinkingConfig: { thinkingBudget: 0 } } }
    return {
      gemini: { thinkingConfig: { thinkingBudget: GEMINI_BUDGET[effort] ?? GEMINI_BUDGET.medium } },
      thinkingEnabled: true,
    }
  },
}

export const ADAPTERS: Record<AdapterId, ReasoningAdapter> = {
  none,
  'openai-effort': openaiEffort,
  openrouter,
  'deepseek-thinking': thinkingPlusEffort('deepseek-thinking', ['low', 'high', 'max']),
  'glm-thinking': thinkingPlusEffort('glm-thinking', ['low', 'high', 'max']),
  'doubao-thinking': thinkingPlusEffort('doubao-thinking', STANDARD),
  'kimi-thinking': kimi,
  'qwen-thinking': qwen,
  'anthropic-adaptive': anthropicAdaptive,
  'anthropic-budget': anthropicBudget,
  'gemini-level': geminiLevel,
  'gemini-budget': geminiBudget,
}
