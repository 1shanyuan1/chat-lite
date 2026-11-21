import { estimateTokens } from '../tokens'
import { LAYER_ORDER, type BuiltPrompt, type PromptLayer, type PromptPart } from './types'

/**
 * 所有可能的提示词来源。
 *
 * 调用方只负责把原料算好填进来，不用关心顺序——顺序由下面的 SLOTS 决定。
 * 加一个新来源：这里加一个字段，SLOTS 里加一行，别的都不用动。
 */
export interface PromptInput {
  /** 记忆段（极简 + 长记忆） */
  memory?: string
  /** 设定发展说明（写作 + 发展模式） */
  evolution?: string
  /** 模式规范：极简为空，写作/酒馆各一段 */
  pack?: string
  /** 设定正文 */
  settings?: string
  /** 发展稿的条目索引 */
  entryIndex?: string
  /** 多角色同场时的提示 */
  cast?: string
  /** 我的设定 */
  persona?: string
  /** 命中的世界书条目 */
  world?: string
  /** 压缩续接写下的前情摘要 */
  recap?: string
  /** 用户挂在会话上的提示词 */
  prompt?: string
  /** 角色卡的历史后追加指令 */
  postHistory?: string
  /** 舞台指令（继续/重写/更短/更细） */
  steer?: string
  /** 强制审查提醒 */
  review?: string
}

interface Slot {
  key: keyof PromptInput
  layer: PromptLayer
  label: string
}

/**
 * 唯一的顺序定义。
 *
 * 前十条进 system，后三条进末尾的 system 消息——和改造前的拼接顺序逐字节一致，
 * 只是从「位置参数」变成了「带名字的槽位」。
 */
const SLOTS: Slot[] = [
  // 模式规范在最前：先定义「这是什么场景」，能力说明再补在后面。
  // 反过来会让「你可以调工具」压在「你在角色扮演」前面，场景反而模糊。
  { key: 'pack', layer: 'rule', label: '模式规范' },
  { key: 'memory', layer: 'rule', label: '记忆' },
  { key: 'evolution', layer: 'rule', label: '设定发展' },
  { key: 'settings', layer: 'data', label: '设定正文' },
  { key: 'entryIndex', layer: 'data', label: '条目索引' },
  { key: 'cast', layer: 'data', label: '群戏' },
  { key: 'persona', layer: 'data', label: '我的设定' },
  { key: 'world', layer: 'data', label: '世界书' },
  { key: 'recap', layer: 'pact', label: '前情摘要' },
  { key: 'prompt', layer: 'pact', label: '提示词' },
  { key: 'postHistory', layer: 'tail', label: '后置指令' },
  { key: 'steer', layer: 'tail', label: '舞台指令' },
  { key: 'review', layer: 'tail', label: '强制审查' },
]

/**
 * 一句话兜底。
 *
 * 只在「一个字都没注入」时出现——极简模式、没挂设定、没写提示词、没开记忆。
 * 以前这种请求直接不传 system，模型连身份都没有，容易乱猜格式。
 * 只要有用户写的任何内容，这段就不出现，所以不会干扰用户意见。
 */
export const BASE_PROMPT = '你是一个对话助手。用用户使用的语言回答，不确定的事不要编造。'

/** 空串和纯空白视为「没启用」，不占位置 */
const present = (text: string) => text.trim().length > 0

/**
 * 把各路原料拼成最终的 system 与 tail。
 *
 * 存的是原文本（不是 trim 过的），保证和改造前的拼接结果逐字节一致；
 * 只在判断「有没有内容」时用 trim。
 */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const parts: PromptPart[] = []

  for (const slot of SLOTS) {
    const raw = input[slot.key]
    if (typeof raw !== 'string' || !present(raw)) continue
    parts.push({
      id: slot.key,
      layer: slot.layer,
      label: slot.label,
      text: raw,
      tokens: estimateTokens(raw),
    })
  }

  const join = (layer: PromptLayer) =>
    parts
      .filter((p) => p.layer === layer)
      .map((p) => p.text)
      .join('\n\n')

  const composed = [join('rule'), join('data'), join('pact')].filter(present).join('\n\n')

  return { system: composed || BASE_PROMPT, tail: join('tail'), parts }
}

/** 按层分组，供界面展示 */
export function groupByLayer(parts: PromptPart[]): Array<{ layer: PromptLayer; parts: PromptPart[] }> {
  return LAYER_ORDER.map((layer) => ({
    layer,
    parts: parts.filter((p) => p.layer === layer),
  })).filter((group) => group.parts.length > 0)
}

/** 统计总量：给界面和自检用 */
export function promptStats(built: BuiltPrompt) {
  const systemTokens = built.parts.filter((p) => p.layer !== 'tail').reduce((n, p) => n + p.tokens, 0)
  const tailTokens = built.parts.filter((p) => p.layer === 'tail').reduce((n, p) => n + p.tokens, 0)
  return {
    parts: built.parts.length,
    systemTokens,
    tailTokens,
    totalTokens: systemTokens + tailTokens,
  }
}
