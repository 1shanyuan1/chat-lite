import { activeVariant, type ChatTurn, type Session } from '@/db'
import { formatPercent, formatTokens, hitRate, isCacheEstimated, missTokens, sumUsage } from './tokens'

const pad = (n: number) => String(n).padStart(2, '0')

export function exportFilename(title: string): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const safe = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'chat'
  return `${safe}-${stamp}.md`
}

export function sessionToMarkdown(session: Session, turns: ChatTurn[]): string {
  const usages = turns.map((t) => activeVariant(t).assistant?.usage)
  const total = sumUsage(usages)
  const models = Array.from(new Set(turns.map((t) => activeVariant(t).assistant?.model).filter(Boolean)))
  const now = new Date()
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`

  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(
    `> 导出时间：${stamp}　·　模型：${models.join(', ') || '未记录'}　·　${turns.length} 轮对话${
      total.estimated ? '（含估算用量）' : ''
    }`
  )
  const approx = isCacheEstimated(total) ? '≈' : ''
  lines.push(
    `> Token：输入 ${formatTokens(total.input)}（命中 ${approx}${formatTokens(total.cacheRead)} / 未命中 ${approx}${formatTokens(
      missTokens(total)
    )}，命中率 ${approx}${formatPercent(hitRate(total))}）　·　输出 ${formatTokens(total.output)}${
      isCacheEstimated(total) ? '　·　命中数据为本地估算' : ''
    }`
  )
  if (session.systemPrompt) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('**系统提示词**')
    lines.push('')
    lines.push('```text')
    lines.push(session.systemPrompt)
    lines.push('```')
  }

  for (const [i, turn] of turns.entries()) {
    const variant = activeVariant(turn)
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push(`## ${i + 1}. 用户${turn.variants.length > 1 ? `（版本 ${turn.active + 1}/${turn.variants.length}）` : ''}`)
    lines.push('')
    lines.push(variant.user.content || '（仅附件）')
    if (variant.user.attachments?.length) {
      lines.push('')
      lines.push(variant.user.attachments.map((a) => `- 附件：${a.name}`).join('\n'))
    }

    if (variant.assistant) {
      lines.push('')
      lines.push('## 助手')
      if (variant.assistant.usage) {
        const u = variant.assistant.usage
        lines.push('')
        lines.push(
          `<sub>${variant.assistant.model ?? ''} · 输入 ${formatTokens(u.input)} / 输出 ${formatTokens(
            u.output
          )}${u.cacheRead ? ` · 命中 ${isCacheEstimated(u) ? '≈' : ''}${formatTokens(u.cacheRead)}` : ''}${
            u.estimated ? ' · 估算' : isCacheEstimated(u) ? ' · 命中为估算' : ''
          }</sub>`
        )
      }
      if (variant.assistant.reasoning) {
        lines.push('')
        lines.push('<details><summary>思考过程</summary>')
        lines.push('')
        lines.push(variant.assistant.reasoning)
        lines.push('')
        lines.push('</details>')
      }
      lines.push('')
      lines.push(variant.assistant.content || '（空）')
    }
  }

  lines.push('')
  return lines.join('\n')
}
