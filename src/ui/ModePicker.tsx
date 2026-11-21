import { useState } from 'react'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { greetingsOf, type SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import { PlusIcon } from './icons'
import { useImportFiles } from './useImportFiles'

/** 起始页默认只铺 4 段开场，卡片多的角色卡动辄十几段，全展开会把列表顶飞 */
const GREETING_PREVIEW = 4

/**
 * 新建对话：先选极简/写作/酒馆，再勾设定；酒馆再选一段开场白。
 *
 * 勾选只写进 store 的 pending 槽，不建会话——点了就建会留下一个没有消息的空会话。
 * 有开场白的卡会多出一段可选清单：选中哪段就存进 pendingGreetingIndex，
 * 开场白**不单独成一轮**，它跟着用户敲的第一句话一起发出去（与 SillyTavern 一致）。
 */
export default function ModePicker() {
  const {
    config,
    setPack,
    settings,
    prompts,
    pendingPromptId,
    setPendingPrompt,
    pendingSettingIds,
    togglePendingSetting,
    removeSetting,
    pendingGreetingIndex,
    setPendingGreeting,
  } = useApp()
  const pack = findPack(config.packId)
  // 写作模式导进来的纯文本是设定；酒馆里的 .txt 仍然当提示词
  const { importFiles, busy, error, fileRef } = useImportFiles({
    textAs: pack.id === 'writing' ? 'setting' : 'prompt',
  })
  const [showAllGreetings, setShowAllGreetings] = useState(false)

  const isMinimal = pack.id === 'minimal'
  const isTavern = pack.id === 'tavern'
  const userName = config.userName ?? '你'

  // 两种模式各看自己那一区的文件：酒馆只认角色卡/世界书，写作只认自由设定
  const available = isTavern
    ? settings.filter((d) => d.kind === 'character' || d.kind === 'world')
    : settings.filter((d) => d.kind === 'setting')

  const pickedDocs = pendingSettingIds
    .map((id) => settings.find((d) => d.id === id))
    .filter((d): d is SettingDoc => Boolean(d))
  // 有开场白的卡：单卡时列出它的全部开场备选，多卡（群聊）时各用第一段
  const greetingDocs = isTavern ? pickedDocs.filter((d) => greetingsOf(d, userName).length > 0) : []
  const greetingChoices = greetingDocs.length === 1 ? greetingsOf(greetingDocs[0], userName) : []
  const pick = Math.min(pendingGreetingIndex, Math.max(greetingChoices.length - 1, 0))

  /**
   * 刚导入的角色卡直接勾上：选完 PNG 下一步就能开口，不用再回列表里找。
   * 只有一张时才自动勾——多张等于群聊，让用户自己决定场上都有谁。
   */
  const onImport = async (files: FileList | null) => {
    const ids = await importFiles(files)
    if (!isTavern || ids.length === 0) return
    const state = useApp.getState()
    const imported = state.settings.filter((d) => d.kind === 'character' && ids.includes(d.id))
    if (imported.length === 1 && !state.pendingSettingIds.includes(imported[0].id)) {
      state.togglePendingSetting(imported[0].id)
    }
  }

  return (
    <div className="px-1 pt-3">
      <div className="flex gap-2">
        {BUILTIN_PACKS.map((p) => {
          const active = p.id === pack.id
          return (
            <button
              key={p.id}
              className={`flex-1 rounded-xl border px-1.5 py-2.5 text-center ${
                active ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700'
              }`}
              onClick={() => {
                if (p.id !== pack.id) void setPack(p.id)
              }}
            >
              <div className="text-[13px] font-medium">{p.name}</div>
              <div className={`mt-0.5 text-[10px] leading-tight ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                {p.hint}
              </div>
            </button>
          )
        })}
      </div>

      {prompts.length > 0 && (
        <div className="mt-5">
          <div className="mb-1 text-[10px] text-neutral-400">提示词（可选，不选就什么都不注入）</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                pendingPromptId === null ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
              }`}
              onClick={() => setPendingPrompt(null)}
            >
              不用
            </button>
            {prompts.map((p) => (
              <button
                key={p.id}
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                  pendingPromptId === p.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => setPendingPrompt(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMinimal && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {isTavern ? '选角色卡（可加世界书）' : '选设定文件，可多选'}
            </span>
            <button
              className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={13} />
              {busy ? '导入中…' : '导入'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".png,.json,.txt,.pdf,.docx,.xlsx,.pptx,.charx,.zip,application/json,image/png,text/plain,application/zip"
              multiple
              className="hidden"
              onChange={(e) => void onImport(e.target.files)}
            />
          </div>

          {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}

          {available.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-200 px-3 py-6 text-center">
              <p className="text-[11px] leading-relaxed text-neutral-400">
                导入角色卡或世界书
                <br />
                PNG / JSON / CHARX / 压缩包都能直接选
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {available.map((doc) => {
                const active = pendingSettingIds.includes(doc.id)
                // 列一下这段数，用户才知道这张卡有几段开场可选
                const count = isTavern ? greetingsOf(doc, userName).length : 0
                const greetingHint = count > 1 ? ` · ${count} 段开场` : count === 1 ? ' · 有开场白' : ''
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                      active ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
                    }`}
                  >
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => togglePendingSetting(doc.id)}
                    >
                      {doc.avatar ? (
                        <img src={doc.avatar} alt={doc.name} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-[11px] text-neutral-400">
                          {doc.name.slice(0, 1)}
                        </div>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-neutral-800">{doc.name}</span>
                        <span className="block truncate text-[10px] text-neutral-400">
                          {doc.entries.length} 条条目{greetingHint}
                        </span>
                      </span>
                    </button>
                    <span
                      className={`h-4 w-4 shrink-0 rounded-full border ${
                        active ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'
                      }`}
                    />
                    <button
                      className="shrink-0 text-[10px] text-neutral-300 active:text-red-500"
                      onClick={() => removeSetting(doc.id)}
                    >
                      删
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {greetingDocs.length > 0 ? (
            <div className="mt-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs text-neutral-500">开场白</span>
                <span className="text-[10px] tabular-nums text-neutral-400">
                  {greetingChoices.length > 0
                    ? `${pick + 1} / ${greetingChoices.length}`
                    : `${greetingDocs.length} 张卡各一段`}
                </span>
              </div>

              {greetingChoices.length > 0 ? (
                <div className="space-y-1.5">
                  {(showAllGreetings ? greetingChoices : greetingChoices.slice(0, GREETING_PREVIEW)).map(
                    (text, i) => {
                      const current = i === pick
                      return (
                        <button
                          key={i}
                          className={`block w-full rounded-xl border px-3 py-2 text-left ${
                            current ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 active:bg-neutral-50'
                          }`}
                          onClick={() => setPendingGreeting(i)}
                        >
                          <span className="mb-0.5 flex items-center gap-1.5">
                            <span className="text-[10px] tabular-nums text-neutral-400">第 {i + 1} 段</span>
                            {current && (
                              <span className="rounded bg-neutral-900 px-1.5 py-px text-[9px] text-white">
                                用这段
                              </span>
                            )}
                          </span>
                          <span
                            className={`line-clamp-2 block text-[12px] leading-relaxed ${
                              current ? 'text-neutral-800' : 'text-neutral-500'
                            }`}
                          >
                            {text}
                          </span>
                        </button>
                      )
                    }
                  )}
                  {greetingChoices.length > GREETING_PREVIEW && (
                    <button
                      className="w-full py-1 text-[11px] text-neutral-400 active:text-neutral-600"
                      onClick={() => setShowAllGreetings((v) => !v)}
                    >
                      {showAllGreetings ? '收起' : `展开全部 ${greetingChoices.length} 段`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="rounded-xl bg-neutral-50 px-3 py-2 text-[10px] leading-relaxed text-neutral-500">
                  {greetingDocs.map((d) => d.name).join('、')} 同场，各自用自己的第一段开场。
                </p>
              )}

              <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">
                开场白会跟着你的第一句话一起发出。
              </p>
            </div>
          ) : (
            /*
              没有开场白就没有「开始」按钮：空会话什么都不会发生。
              直接发第一句话，设定也跟着一起落库。
            */
            <p className="mt-3 text-[10px] leading-relaxed text-neutral-400">
              {pendingSettingIds.length > 0
                ? `已勾 ${pendingSettingIds.length} 份，在下面发第一句话开始。`
                : isTavern
                  ? '勾一张角色卡，有开场白的会先让你挑一段。'
                  : '也可以什么都不挂，直接开始写。'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
