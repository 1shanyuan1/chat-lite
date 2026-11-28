import { applyMacros, type CardRegexScript } from './characters'
import type { SettingDoc } from './settings'
import type { WireMessage } from './protocol'

/**
 * 卡正则脚本引擎：把卡里 regex_scripts 的变换应用到文本上。
 *
 * 两条使用路径，对应 ST 的同一套脚本语义：
 * - 提示词侧（forPrompt=true）：generate 组装请求时清理历史（[不发送] 类脚本）；
 * - 显示侧（forPrompt=false）：消息渲染前做替换（[隐藏] 类脚本）。
 * 存储永远是原文——变换只发生在组装/渲染时，和 ST 一样可随时改卡重算。
 */

/** 编译缓存：同一段 pattern 每次渲染/每轮组装都会用到，只构造一次 */
const compiled = new Map<string, RegExp | null>()

function compileRegex(script: CardRegexScript): RegExp | null {
  const key = `${script.find}\u0000${script.flags}`
  const cached = compiled.get(key)
  if (cached !== undefined) return cached
  let re: RegExp | null = null
  try {
    re = new RegExp(script.find, script.flags)
  } catch {
    // 卡作者写错了 pattern：跳过这条脚本，不能让一张坏卡炸掉整个请求
    re = null
  }
  compiled.set(key, re)
  return re
}

const depthOk = (script: CardRegexScript, depth: number): boolean => {
  if (typeof script.minDepth === 'number' && depth < script.minDepth) return false
  if (typeof script.maxDepth === 'number' && depth > script.maxDepth) return false
  return true
}

/** 替换串里的 HTML 由白名单渲染层（card-html.ts）负责清洗，这里不再拦 */
interface RegexContext {
  isUser: boolean
  /** 距末尾消息的距离（0=最后一条）；只约束提示词侧 */
  depth: number
  charName: string
  userName: string
  /** 酒馆助手卡：显示侧跳过空替换脚本——协议标记（占位符）要留给全局脚本渲染 */
  thMode?: boolean
}

/** 单条文本过一遍脚本列表；按卡里写的顺序应用 */
function applyCardRegex(text: string, scripts: CardRegexScript[], ctx: RegexContext, forPrompt: boolean): string {
  if (!text || scripts.length === 0) return text
  const placement = ctx.isUser ? 1 : 2
  let out = text
  for (const script of scripts) {
    if (!script.placement.includes(placement)) continue
    if (forPrompt) {
      // markdownOnly 的只影响显示；promptOnly 或两个标志都没写的进提示词
      if (script.markdownOnly === true && script.promptOnly !== true) continue
      if (!depthOk(script, ctx.depth)) continue
    } else {
      // promptOnly 的只进提示词；显示侧不看 depth（渲染单条消息时拿不到位置）
      if (script.promptOnly === true && script.markdownOnly !== true) continue
      // TH 卡的空替换脚本（删占位符类）跳过：占位符是全局脚本的渲染锚点
      if (ctx.thMode && script.replace === '') continue
    }
    const re = compileRegex(script)
    if (!re) continue
    out = out.replace(re, applyMacros(script.replace, ctx.charName, ctx.userName))
  }
  return out
}

/**
 * 发请求前对整段会话历史过一遍提示词侧脚本。
 * 逐条算 depth（距末尾距离，0=最后一条），user/assistant 各按自己的 placement 匹配；
 * system（注入的设定层）和 tool 消息不参与。docs 按会话挂载顺序逐卡应用。
 */
export function applyPromptRegex(history: WireMessage[], docs: SettingDoc[], userName: string): WireMessage[] {
  const scripted = docs.filter((doc) => (doc.regexScripts?.length ?? 0) > 0)
  if (scripted.length === 0 || history.length === 0) return history
  const last = history.length - 1
  return history.map((message, index) => {
    if (message.role !== 'assistant' && message.role !== 'user') return message
    const ctx: RegexContext = {
      isUser: message.role === 'user',
      depth: last - index,
      charName: '',
      userName,
    }
    let content = message.content
    for (const doc of scripted) {
      ctx.charName = doc.name
      content = applyCardRegex(content, doc.regexScripts ?? [], ctx, true)
    }
    return content === message.content ? message : { ...message, content }
  })
}

/**
 * 渲染前对单条 AI 消息过一遍显示侧脚本（[隐藏] 类）。
 * 替换出的 HTML 交给白名单渲染层（card-html.ts）清洗后渲染；
 * thMode=true 时（酒馆助手卡）跳过空替换脚本，占位符留给全局脚本。
 */
export function applyDisplayRegex(text: string, docs: SettingDoc[], userName: string, thMode = false): string {
  const scripted = docs.filter((doc) => (doc.regexScripts?.length ?? 0) > 0)
  if (!text || scripted.length === 0) return text
  let out = text
  for (const doc of scripted) {
    out = applyCardRegex(out, doc.regexScripts ?? [], { isUser: false, depth: 0, charName: doc.name, userName, thMode }, false)
  }
  return out
}
