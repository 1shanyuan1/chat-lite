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

/** 写作：注入写作规范 + 一排改写动作 */
const WRITING: PromptPack = {
  id: 'writing',
  name: '写作',
  hint: '直接给成品文字，不解释过程',
  systemPrompt:
    '你是中文写作助手。直接给出成品文字，不要解释思路，不要加「以下是」「希望对你有帮助」这类套话。保留作者原意，只改表达。',
  actions: [
    { id: 'polish', label: '润色', template: '把下面这段文字润色得更通顺自然，保留原意和语气，直接给结果：\n\n{{input}}' },
    { id: 'expand', label: '扩写', template: '把下面这段扩写得更详细，补充具体细节和例子，保持原有风格：\n\n{{input}}' },
    { id: 'shorten', label: '缩写', template: '把下面这段压缩到大约一半长度，只保留关键信息：\n\n{{input}}' },
    { id: 'formal', label: '改正式', template: '把下面这段改写成更正式、克制的表达，去掉口语和情绪词：\n\n{{input}}' },
    { id: 'outline', label: '大纲', template: '围绕下面的主题列一个三级大纲，每级 3 到 5 条，条目要具体可写：\n\n{{input}}' },
    { id: 'continue', label: '续写', template: '接着下面这段继续往下写，保持人称、时态和语感一致，只输出新增的部分：\n\n{{input}}' },
  ],
}

/**
 * 角色：只保留姿态说明，不给按钮。
 * 酒馆里的下一步应该是「说话」，不是「点功能」，快捷动作会把扮演变成操作面板。
 */
const ROLEPLAY: PromptPack = {
  id: 'roleplay',
  name: '角色',
  hint: '保持角色口吻，只说话，不解释',
  systemPrompt:
    '你正在与用户进行角色扮演。始终以角色本人的口吻说话，不要跳出角色解释或总结。角色设定与背景请参考用户的补充说明。',
  actions: [],
}

export const BUILTIN_PACKS: PromptPack[] = [MINIMAL, WRITING, ROLEPLAY]

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
