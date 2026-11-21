/**
 * 提示词的分层模型。
 *
 * 以前所有来源都散在各个模块里，由 store 用 10 个位置参数拼起来，
 * 加一个功能就要改一次参数顺序，也看不出「谁压谁」。
 *
 * 这里把「层」显式化：层决定优先级，来源只是层里的条目。
 */

/** 四个容器。顺序即优先级，写在 build.ts 的 ORDER 里 */
export type PromptLayer = 'rule' | 'data' | 'pact' | 'tail'

export interface LayerMeta {
  label: string
  hint: string
  /** system 字段还是贴在历史之后的 system 消息 */
  where: 'system' | 'tail'
}

export const LAYER_META: Record<PromptLayer, LayerMeta> = {
  rule: { label: '规则', hint: '行为约束：该怎么做事', where: 'system' },
  data: { label: '资料', hint: '世界信息：供参考，不是指令', where: 'system' },
  pact: { label: '约定', hint: '这次对话的额外约定', where: 'system' },
  tail: { label: '追加', hint: '贴在历史之后，离当前发言最近', where: 'tail' },
}

/** 层在 UI 与文档里的固定顺序 */
export const LAYER_ORDER: PromptLayer[] = ['rule', 'data', 'pact', 'tail']

/** 拼进最终提示词的一段 */
export interface PromptPart {
  /** 稳定标识，等于 PromptInput 里的字段名 */
  id: string
  layer: PromptLayer
  label: string
  text: string
  tokens: number
}

export interface BuiltPrompt {
  /** 送进 system 字段的内容（rule + data + pact） */
  system: string
  /** 贴在对话历史末尾的 system 消息；空串表示不加 */
  tail: string
  /** 每一段的来源，供查看与调试 */
  parts: PromptPart[]
}
