import { activeVariant, type ChatTurn } from '@/db'

/**
 * 给酒馆生态脚本用的 ST DOM 锚点：消息 id 必须和 TH 扁平消息表一致。
 * 一轮里可能同时有用户和 AI 两条消息；.mes 代表 AI 那条，用户消息取自己的 id。
 */
export function thDomMessage(turns: ChatTurn[], turnId: string): { mesid: number; isUser: boolean } {
  let flat = 0
  for (const turn of turns) {
    const variant = activeVariant(turn)
    const hasUser = Boolean(variant.user.content.trim() || variant.user.attachments?.length)
    const userFlat = hasUser ? flat++ : undefined
    const assistantFlat = variant.assistant ? flat++ : undefined
    if (turn.id === turnId) {
      if (assistantFlat !== undefined) return { mesid: assistantFlat, isUser: false }
      return { mesid: userFlat ?? Math.max(0, flat - 1), isUser: true }
    }
  }
  return { mesid: 0, isUser: false }
}