import { activeVariant, type ChatTurn } from '@/db'

export interface TurnHit {
  turnId: string
  /** 命中的是这一轮里的提问还是回答 */
  field: 'user' | 'assistant'
}

/**
 * 找出会话内所有可定位的命中点。
 * 按「消息」计而不是按出现次数计——同一条消息里出现三次，翻页三次都停在原地没有意义。
 */
export function findTurnHits(turns: ChatTurn[], rawQuery: string): TurnHit[] {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return []

  const hits: TurnHit[] = []
  for (const turn of turns) {
    const variant = activeVariant(turn)
    if (variant.user.content.toLowerCase().includes(q)) hits.push({ turnId: turn.id, field: 'user' })
    if (variant.assistant?.content.toLowerCase().includes(q)) hits.push({ turnId: turn.id, field: 'assistant' })
  }
  return hits
}

export const hitElementId = (hit: TurnHit) => `hit-${hit.turnId}-${hit.field}`
