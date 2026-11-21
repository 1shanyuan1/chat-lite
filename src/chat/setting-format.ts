/**
 * 让模型把用户自己写的一大篇设定，整理成「正文 + 关键词条目」。
 *
 * 输出直接采用 setting-text 的纯文本格式，解析、预览、保存全部复用同一条链路：
 * 模型只负责分段和取关键词，落库仍然走 parseSettingText，不引入第二套格式。
 *
 * 整理原则里最重要的一条是「不要改写」：用户写的是自己的世界观，
 * 模型可以搬动段落、合并重复，但不能替用户润色或补设定。
 */
import { completeText, type ChatConfig } from './client'
import type { SettingDoc } from './settings'
import { parseSettingText } from './setting-text'

/** 单次整理的字数上限：再长就先拆开，避免超上下文或输出被截断 */
export const FORMAT_MAX_CHARS = 60000

export const FORMAT_INSTRUCTION = [
  '你是一名设定编辑，负责把用户自己写的设定文稿整理成一份可以直接使用的设定文档。',
  '',
  '输出必须是纯文本，严格采用下面的格式（不要 Markdown 代码块，不要加粗，不要任何解释）：',
  '',
  '【设定：名字】',
  '',
  '（常驻正文，可以多段）',
  '',
  '【条目：关键词1, 关键词2】',
  '（这一条的内容）',
  '',
  '【条目：关键词3】',
  '（这一条的内容）',
  '',
  '整理规则：',
  '1. 原文的信息必须完整保留。可以调整顺序、合并重复、去掉 Markdown 标题符号，但不要改写文风，不要删掉事实，不要自行补充原文没有的设定。',
  '2. 正文只放「每一轮都必须知道」的内容：世界观基调、核心人物、主要地点、时代背景、叙事口吻、硬性规则。其余细节全部拆成条目。正文控制在全文的三分之一以内；如果原文本身很短，可以整篇留在正文。',
  '3. 每个条目只讲一件事：一个地点、一个人物、一个组织、一件物品、一条规则或一段历史。不要把多个主题塞进同一条，也不要把一段话拆成很多碎条。',
  '4. 条目必须能独立读懂。模型只会看到命中的那几条，看不到其它条目，所以不要用「他」「她」「那里」「上述」「这个组织」这类依赖上下文的指代；第一次出现就用名字。',
  '5. 每条给 2–5 个触发关键词，用中文逗号分隔。关键词要具体：人名、地名、组织名、物名、独特术语。不要用「故事」「设定」「世界」「他们」这类泛词。',
  '6. 条目数量按内容量决定：短文 3–8 条，长文 8–20 条；宁可少而完整，不要多而破碎。',
  '7. 只有「无论聊到什么都必须生效」的规则才在条目行加「｜常驻」，其余不要加。不要使用「锁定」「停用」。',
  '8. 对白、示例、原文中的特殊标记（如 {{char}}、{{user}}）原样保留。',
  '9. 第一行必须是【设定：名字】。用户给了名字就用它；没给就从原文标题或内容里取一个 2–10 字的短名字。',
  '10. 只输出整理后的文本。不要复述任务，不要写「以下是整理结果」，不要在结尾总结。',
].join('\n')

/**
 * 用户自己写的前置说明，放在系统提示词最前面。
 *
 * 为什么需要它：没有人能预知一份设定的广度和用途——它可能是小说世界观、跑团模组、
 * 成人向角色卡，也可能只是给某个模型看的资料。用户需要先交代「这是什么、给谁用、
 * 什么语气、什么边界」，再让下面的整理规则工作。这不等同于「调整拆分效果」。
 *
 * 前置说明优先级最高；但输出仍然必须是【设定：】/【条目：】结构，
 * 否则程序无法解析。这一条单独写在规则前面，避免模型把「最高优先级」理解成可以换格式。
 */
export function buildFormatInstruction(custom?: string): string {
  const extra = custom?.trim()
  if (!extra) return FORMAT_INSTRUCTION
  return [
    '【用户的前置说明】',
    '先读这一段。它说明这份设定是什么、给谁用、语气和边界是什么；理解之后再按后面的规则整理。',
    '如果它与后面的整理规则冲突，以这一段为准。',
    '',
    extra,
    '',
    '无论这段说明怎么写，最终输出仍然必须使用下面的【设定：】/【条目：】标记格式，否则程序无法解析。',
    '',
    FORMAT_INSTRUCTION,
  ].join('\n')
}

export function buildFormatPrompt(raw: string, name?: string): string {
  const title = name?.trim()
  return [
    title ? `【用户给的名字】${title}` : '【用户没有给名字】请从原文标题或内容里取一个短名字。',
    '',
    '【原文开始】',
    raw.trim(),
    '【原文结束】',
    '',
    '请按系统提示的格式整理这份设定，只输出整理后的文本。',
  ].join('\n')
}

/**
 * 清掉模型常见的包装：代码块围栏、前面的「好的，我来整理」。
 * 只在出现【设定：或【条目：时截断，避免把正文第一段误删。
 */
export function cleanModelOutput(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim()
  const start = text.search(/【(?:设定|条目)：/)
  if (start > 0) text = text.slice(start).trim()
  return text
}

/** 输出里必须至少有一个标记，否则说明模型没按格式来，不能当成正文悄悄存下去 */
export function looksFormatted(text: string): boolean {
  return /【(?:设定|条目)：/.test(text)
}

/**
 * 整理一篇设定。失败时抛人话错误，由界面显示。
 * 取消通过 signal 传入，和普通对话共用一套 Abort 语义。
 */
export async function formatSettingText(
  raw: string,
  config: ChatConfig,
  signal: AbortSignal,
  name?: string,
  instruction?: string
): Promise<string> {
  const text = raw.trim()
  if (!text) throw new Error('还没有内容可以整理')
  if (!config.apiKey.trim()) throw new Error('先在设置里填好 API Key，再来整理')
  if (text.length > FORMAT_MAX_CHARS) {
    throw new Error(`这篇有 ${text.length} 字，超过 ${FORMAT_MAX_CHARS} 字，先拆成两份再整理`)
  }

  const output = await completeText([{ role: 'user', content: buildFormatPrompt(text, name) }], {
    ...config,
    systemPrompt: buildFormatInstruction(instruction),
    // 整理是搬运，不是创作：温度压低，输出上限交给服务商默认（用户可能把 maxTokens 设得很小）
    temperature: 0.3,
    maxTokens: undefined,
    // 不需要思考，也不需要联网，开着只是白烧 token
    reasoningLevel: undefined,
    nativeSearch: undefined,
  }, signal)

  const cleaned = cleanModelOutput(output)
  if (!cleaned) throw new Error('模型返回了空内容，请重试')
  if (!looksFormatted(cleaned)) throw new Error('模型没有按格式输出，请重试或换一个模型')
  return cleaned
}

/** 整理结果 → 一份还没落库的设定草稿，交给详情面板预览 */
export function formattedDraft(text: string, base: SettingDoc, name?: string): SettingDoc {
  const parsed = parseSettingText(text)
  return {
    ...base,
    name: name?.trim() || parsed.name || base.name,
    body: parsed.body,
    entries: parsed.entries,
    updatedAt: Date.now(),
  }
}
