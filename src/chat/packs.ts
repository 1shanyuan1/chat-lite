export interface PackAction {
  id: string
  label: string
  /** 支持 {{input}} 占位符，渲染时用输入框内容替换 */
  template: string
}

export interface PromptPack {
  id: string
  name: string
  /** 一句话说明，用于选择时提示 */
  hint: string
  systemPrompt: string
  actions: PackAction[]
}

/** 极简：不加任何东西，就是纯聊天 */
const MINIMAL: PromptPack = {
  id: 'minimal',
  name: '极简',
  hint: '纯聊天，不注入任何提示词',
  systemPrompt: '',
  actions: [],
}

/**
 * 设定：角色对话与写作共用。
 * 两者的区别不在模式，而在挂了什么设定文件、以及用户怎么说话。
 */
const SETTINGS: PromptPack = {
  id: 'settings',
  name: '设定',
  hint: '挂设定文件，对话或写作都行',
  systemPrompt:
    '你与用户共同推进一段对话或文本。严格遵循设定文件中的世界观、人物与口吻，只输出内容本身，不要解释你的思路，不要跳出设定做总结。当用户给出的是指令（例如要求继续、加快、换个角度），按指令直接写，不要复述指令。',
  actions: [],
}

export const BUILTIN_PACKS: PromptPack[] = [MINIMAL, SETTINGS]

export const DEFAULT_PACK_ID = MINIMAL.id

export function findPack(id?: string | null): PromptPack {
  return BUILTIN_PACKS.find((p) => p.id === id) ?? MINIMAL
}

/**
 * 三段提示词按优先级拼接：提示词包（写作/角色规范）→ 会话级（压缩摘要）→ 用户设置。
 * 抽出成纯函数，方便测试与复用。
 */
export function composeSystemPrompt(...parts: Array<string | null | undefined>): string {
  return parts.filter((part) => part && part.trim()).join('\n\n')
}

/**
 * 渲染动作模板：把输入框内容填进 {{input}}。
 * 模板没有占位符时，把输入接在指令后面；输入为空时只留指令本身。
 */
export function renderTemplate(template: string, input: string): string {
  const text = input.trim()
  if (template.includes('{{input}}')) return template.replace(/\{\{input\}\}/g, text)
  return text ? `${template}\n\n${text}` : template
}
