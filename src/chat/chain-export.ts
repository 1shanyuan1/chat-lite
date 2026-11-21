/**
 * 把一条「单回复链」导出成可读的 Markdown。
 *
 * 只导出这条链上的轮次：用户说了什么、助手回了什么，可选思考过程。
 * 不带用量、模型名、系统提示词——这个功能是给用户自己读或分享用的，
 * 不是给另一个模型续写的迁移包。
 */
import type { Session } from '@/db'
import { exportFilename } from './export'
import type { Chain } from './branches'

export interface ChainExportOptions {
  includeReasoning?: boolean
  /** 说话人标签：默认「你」/「助手」，界面可以传角色名 */
  userLabel?: string
  assistantLabel?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function stamp(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function chainToMarkdown(
  session: Pick<Session, 'title'>,
  chain: Chain,
  options: ChainExportOptions = {}
): string {
  const lines: string[] = []
  const target = chain.steps[chain.steps.length - 1]
  const lastIdx = target ? target.turn.idx : 0
  const targetCount = target ? target.turn.variants.length : 1
  const targetVersion = target ? target.variant + 1 : 1
  const userLabel = options.userLabel?.trim() || '你'
  const assistantLabel = options.assistantLabel?.trim() || '助手'

  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(
    `> 导出于 ${stamp()}　·　第 1–${lastIdx + 1} 轮${
      targetCount > 1 ? `　·　第 ${lastIdx + 1} 轮第 ${targetVersion}/${targetCount} 版` : ''
    }`
  )
  lines.push(
    `> 链路：${
      chain.exact
        ? '真实历史链（前序轮次没有分叉，或已记录来源）'
        : '部分早期版本没有来源记录，前序轮次按当前选择拼接'
    }`
  )

  for (const step of chain.steps) {
    const variant = step.turn.variants[step.variant]
    if (!variant) continue
    lines.push('')
    lines.push('---')
    lines.push('')
    const version =
      step.turn.variants.length > 1 ? `（第 ${step.variant + 1}/${step.turn.variants.length} 版）` : ''
    lines.push(`## 第 ${step.turn.idx + 1} 轮${version}`)

    if (variant.user.content.trim()) {
      lines.push('')
      lines.push(`**${userLabel}**`)
      lines.push('')
      lines.push(variant.user.content.trim())
      if (variant.user.attachments?.length) {
        lines.push('')
        lines.push(`（附件：${variant.user.attachments.map((file) => file.name).join('、')}）`)
      }
    }

    lines.push('')
    lines.push(`**${assistantLabel}**`)
    lines.push('')
    lines.push(variant.assistant?.content?.trim() || '（空）')

    if (options.includeReasoning && variant.assistant?.reasoning?.trim()) {
      lines.push('')
      lines.push('<details><summary>思考过程</summary>')
      lines.push('')
      lines.push(variant.assistant.reasoning.trim())
      lines.push('')
      lines.push('</details>')
    }
  }

  return `${lines.join('\n').trim()}\n`
}

/** 文件名里带上「到第几轮」，同一会话导多个分支时不会互相覆盖 */
export function chainExportFilename(session: Pick<Session, 'title'>, chain: Chain): string {
  const target = chain.steps[chain.steps.length - 1]
  const round = target ? target.turn.idx + 1 : 1
  return exportFilename(`${session.title}-到第${round}轮`)
}
