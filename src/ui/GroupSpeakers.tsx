import { useMemo } from 'react'
import { useApp } from '@/chat/store'
import type { SettingDoc } from '@/chat/settings'

/**
 * 群聊工具条：同场 ≥2 个角色时出现。
 * 点角色名 = 在输入框开头插入 @点名（自然顺序的激活依据）；
 * 右侧「群设置」打开官方式群聊面板（顺序策略/静音/话痨度/强制发言）。
 */
export default function GroupSpeakers() {
  const sessions = useApp((s) => s.sessions)
  const currentId = useApp((s) => s.currentId)
  const settings = useApp((s) => s.settings)

  const { chars, group } = useMemo(() => {
    const session = sessions.find((s) => s.id === currentId)
    const ids = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
    const picked = ids
      .map((id) => settings.find((d) => d.id === id))
      .filter((d): d is SettingDoc => Boolean(d && d.kind === 'character'))
    return { chars: picked, group: session?.group }
  }, [sessions, currentId, settings])

  if (chars.length < 2 && !group) return null
  return (
    <div className="mb-1.5 flex items-start gap-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {chars.map((doc) => {
          const muted = group?.muted?.includes(doc.id)
          return (
            <button
              key={doc.id}
              className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] ${
                muted ? 'bg-neutral-100 text-neutral-400 line-through' : 'bg-neutral-900 text-white active:bg-neutral-700'
              }`}
              onClick={() => {
                const st = useApp.getState()
                st.setDraft(`@${doc.name} ${st.draft}`)
              }}
              title={muted ? '已静音：点名字可点名（自动接话不会选它）' : '插入 @点名'}
            >
              {doc.avatar ? (
                <img src={doc.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
              ) : null}
              @{doc.name}
            </button>
          )
        })}
      </div>
      <button
        className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] text-neutral-600 active:bg-neutral-200"
        onClick={() => useApp.getState().setGroupPanel(true)}
        aria-label="群聊设置"
      >
        群设置{group?.autoMode ? ' · 自动' : ''}
      </button>
    </div>
  )
}