import { useEffect, useState } from 'react'
import { useApp } from '@/chat/store'
import { DEFAULT_GROUP, normalizeGroup, type GroupGeneration, type GroupStrategy } from '@/chat/group'
import type { SettingDoc } from '@/chat/settings'

const STRATEGIES: Array<{ id: GroupStrategy; label: string; hint: string }> = [
  { id: 'natural', label: '自然', hint: '点名优先，其次按话痨度随机' },
  { id: 'list', label: '列表', hint: '所有未静音成员按列表顺序依次回复' },
  { id: 'pooled', label: '轮流', hint: '随机挑一个本轮还没说过话的成员' },
  { id: 'manual', label: '手动', hint: '用户发送不自动接话，点「让TA说」触发' },
]

const GENERATIONS: Array<{ id: GroupGeneration; label: string; hint: string }> = [
  { id: 'swap', label: '交换角色卡', hint: '只把当前发言者的卡放进上下文，省 token、少串味' },
  { id: 'join', label: '合并角色卡', hint: '所有成员的卡都放进上下文，互相知道设定，但容易人格混淆' },
]

/** 官方式群聊设置：回复顺序、角色卡注入、静音、话痨度、强制发言、自动接话、场景覆盖 */
export default function GroupPanel() {
  const open = useApp((s) => s.groupPanelOpen)
  const setOpen = useApp((s) => s.setGroupPanel)
  const sessions = useApp((s) => s.sessions)
  const currentId = useApp((s) => s.currentId)
  const settings = useApp((s) => s.settings)
  const streaming = useApp((s) => s.streamingTurnId)

  const session = sessions.find((s) => s.id === currentId)
  const ids = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
  const chars = ids
    .map((id) => settings.find((d) => d.id === id))
    .filter((d): d is SettingDoc => Boolean(d && d.kind === 'character'))
  const group = normalizeGroup(session?.group ?? DEFAULT_GROUP)
  const groupEnabled = Boolean(session?.group) || chars.length >= 2

  const [scenario, setScenario] = useState('')
  useEffect(() => {
    if (open) setScenario(group.scenarioOverride ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id])

  if (!open || !session || !groupEnabled) return null

  const update = (patch: Parameters<ReturnType<typeof useApp.getState>['updateSessionGroup']>[0]) => {
    void useApp.getState().updateSessionGroup(patch)
  }

  const forceTalk = (id: string) => {
    setOpen(false)
    void useApp.getState().groupTrigger(id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={() => setOpen(false)}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white px-4 pb-6 pt-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-medium text-neutral-900">群聊设置</span>
          <button className="px-2 py-1 text-[12px] text-neutral-400" onClick={() => setOpen(false)}>
            关闭
          </button>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[11px] text-neutral-400">发言顺序</div>
          <div className="grid grid-cols-4 gap-1">
            {STRATEGIES.map((item) => (
              <button
                key={item.id}
                className={`rounded-lg border px-1 py-1.5 text-[11px] ${
                  group.strategy === item.id
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-200 text-neutral-600'
                }`}
                onClick={() => update({ strategy: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-neutral-400">
            {STRATEGIES.find((item) => item.id === group.strategy)?.hint}
          </p>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[11px] text-neutral-400">角色卡注入</div>
          <div className="grid grid-cols-2 gap-1">
            {GENERATIONS.map((item) => (
              <button
                key={item.id}
                className={`rounded-lg border px-2 py-1.5 text-left text-[11px] ${
                  group.generation === item.id
                    ? 'border-neutral-900 bg-neutral-50 text-neutral-900'
                    : 'border-neutral-200 text-neutral-600'
                }`}
                onClick={() => update({ generation: item.id })}
              >
                <span className="block">{item.label}</span>
                <span className="mt-0.5 block text-[9px] leading-tight text-neutral-400">{item.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-neutral-700">自动接话</span>
            <div className="flex items-center gap-2">
              {group.autoMode && (
                <label className="flex items-center gap-1 text-[10px] text-neutral-400">
                  间隔
                  <input
                    type="number"
                    min={2}
                    max={60}
                    className="w-10 rounded border border-neutral-200 px-1 py-0.5 text-center text-[11px]"
                    value={group.autoModeDelay ?? 5}
                    onChange={(event) => update({ autoModeDelay: Number(event.target.value) })}
                  />
                  秒
                </label>
              )}
              <button
                className={`rounded-full px-3 py-1 text-[11px] ${
                  group.autoMode ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => update({ autoMode: !group.autoMode })}
              >
                {group.autoMode ? '已开启' : '已关闭'}
              </button>
            </div>
          </div>
          {group.strategy === 'natural' && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-700">允许连续接话</span>
              <button
                className={`rounded-full px-3 py-1 text-[11px] ${
                  group.allowSelfResponses ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => update({ allowSelfResponses: !group.allowSelfResponses })}
              >
                {group.allowSelfResponses ? '已开启' : '已关闭'}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-neutral-700">按当前策略接一轮</span>
            <button
              className="rounded-full bg-neutral-900 px-3 py-1 text-[11px] text-white disabled:bg-neutral-300"
              disabled={Boolean(streaming)}
              onClick={() => {
                setOpen(false)
                void useApp.getState().groupTrigger()
              }}
            >
              触发
            </button>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1.5 text-[11px] text-neutral-400">成员（顺序即列表顺序）</div>
          <div className="space-y-2">
            {chars.map((doc, index) => {
              const muted = group.muted.includes(doc.id)
              const value = Math.round((group.talkativeness[doc.id] ?? 0.5) * 100)
              return (
                <div key={doc.id} className="rounded-xl border border-neutral-200 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    {doc.avatar ? (
                      <img src={doc.avatar} alt="" className="h-7 w-7 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 text-[10px] text-neutral-400">
                        {doc.name.slice(0, 1)}
                      </div>
                    )}
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${muted ? 'text-neutral-400' : 'text-neutral-800'}`}>
                      {index + 1}. {doc.name}
                    </span>
                    <button
                      className={`rounded px-1.5 py-0.5 text-[10px] ${muted ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'}`}
                      onClick={() =>
                        update({
                          muted: muted ? group.muted.filter((id) => id !== doc.id) : [...group.muted, doc.id],
                        })
                      }
                    >
                      {muted ? '已静音' : '静音'}
                    </button>
                    <button
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => void useApp.getState().moveGroupMember(doc.id, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 disabled:opacity-30"
                      disabled={index === chars.length - 1}
                      onClick={() => void useApp.getState().moveGroupMember(doc.id, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-[10px] text-neutral-400">话痨度</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={value}
                      className="min-w-0 flex-1 accent-neutral-900"
                      onChange={(event) =>
                        update({
                          talkativeness: { ...group.talkativeness, [doc.id]: Number(event.target.value) / 100 },
                        })
                      }
                    />
                    <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-neutral-500">{value}%</span>
                    <button
                      className="shrink-0 rounded-full bg-neutral-900 px-2.5 py-1 text-[10px] text-white disabled:bg-neutral-300"
                      disabled={Boolean(streaming)}
                      onClick={() => forceTalk(doc.id)}
                    >
                      让TA说
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-[11px] text-neutral-400">群聊场景（覆盖所有角色卡里的情境）</div>
          <textarea
            rows={3}
            className="w-full resize-none rounded-xl border border-neutral-200 px-3 py-2 text-[12px] outline-none"
            placeholder="留空则使用各角色卡自己的情境"
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          />
          <div className="mt-1 flex justify-end">
            <button
              className="rounded-full bg-neutral-900 px-3 py-1 text-[11px] text-white"
              onClick={() => update({ scenarioOverride: scenario.trim() || undefined })}
            >
              保存场景
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}