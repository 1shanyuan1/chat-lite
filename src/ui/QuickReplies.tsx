import { useMemo } from 'react'
import { useApp } from '@/chat/store'
import { applyMacros, type CardQuickReply } from '@/chat/characters'
import type { SettingDoc } from '@/chat/settings'
import { executeStscript } from '@/chat/stscript'
import { stscriptApiFromStore } from '@/chat/th-runtime'

/**
 * 卡 QR 按钮条（P5）：卡内 extensions.quick_replies 渲染在输入框上方。
 * 点击后按宏展开，然后分流：
 * - 带 {{input}} 占位的模板 → 填进输入框，用户补完再发；
 * - / 开头的 STscript → 子集执行器（/send /setvar /gen /trigger）；
 * - 其余 → 直接作为用户消息发出。
 */
export default function QuickReplies() {
  const sessions = useApp((s) => s.sessions)
  const currentId = useApp((s) => s.currentId)
  const settings = useApp((s) => s.settings)

  const quickReplies = useMemo(() => {
    const session = sessions.find((s) => s.id === currentId)
    const ids = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
    const docs = ids
      .map((id) => settings.find((d) => d.id === id))
      .filter((d): d is SettingDoc => Boolean(d))
    return docs.flatMap((doc) => doc.quickReplies ?? []).filter((qr) => !qr.hidden)
  }, [sessions, currentId, settings])

  const run = (qr: CardQuickReply) => {
    const state = useApp.getState()
    const userName = state.config.userName ?? '你'
    const expanded = applyMacros(qr.message, '', userName).trim()
    if (!expanded) return
    if (expanded.includes('{{input}}')) {
      // 要用户补内容的模板：整体填进输入框，占位符留在原处等编辑
      state.setDraft(expanded)
      return
    }
    if (expanded.startsWith('/')) {
      void executeStscript(expanded, stscriptApiFromStore())
      return
    }
    void state.send(expanded)
  }

  if (quickReplies.length === 0) return null
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {quickReplies.map((qr, index) => (
        <button
          key={index}
          className="rounded-full bg-neutral-100 px-3 py-1.5 text-[13px] text-neutral-700 active:bg-neutral-200"
          onClick={() => run(qr)}
        >
          {qr.label}
        </button>
      ))}
    </div>
  )
}
