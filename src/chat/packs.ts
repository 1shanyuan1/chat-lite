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
 * 写作：和酒馆同一套引擎，但不限于角色扮演。
 * 用户可能在续写、也可能在下指令（「这里太慢」「换个视角」），所以给一排动作。
 */
const WRITING: PromptPack = {
  id: 'writing',
  name: '写作',
  hint: '推进文本，可以下指令',
  systemPrompt:
    '你与用户共同推进一段文本。严格遵循设定文件中的世界观、人物与文风，只输出文本本身，不要解释你的思路，不要复述用户的指令，不要加「以下是」这类套话。当用户给出的是修改意见时，直接按要求重写，不要说「好的我来修改」。',
  actions: [
    { id: 'continue', label: '继续写', template: '接着上文往下写，保持人称、时态和语感一致，只输出新增的部分：\n\n{{input}}' },
    { id: 'pov', label: '换个角度', template: '换一个视角重写下面这段，保持信息与节奏不变：\n\n{{input}}' },
    { id: 'detail', label: '加细节', template: '给下面这段补上具体的动作与感官细节，不要增加新情节：\n\n{{input}}' },
    { id: 'tighten', label: '收紧', template: '把下面这段压到大约一半长度，删掉重复和铺垫，保留关键动作：\n\n{{input}}' },
    { id: 'close', label: '收束', template: '给当前这一段收尾，不要总结全文，留一个自然往下走的钩子：\n\n{{input}}' },
  ],
}

/** 酒馆：以角色身份对话，不给按钮 */
const TAVERN: PromptPack = {
  id: 'tavern',
  name: '酒馆',
  hint: '以角色身份说话',
  systemPrompt:
    '你正在与用户进行角色扮演。始终以设定文件中角色的口吻说话，不要跳出角色解释、总结或评价。场景与背景参考设定文件。',
  actions: [],
}

export const BUILTIN_PACKS: PromptPack[] = [MINIMAL, WRITING, TAVERN]

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
