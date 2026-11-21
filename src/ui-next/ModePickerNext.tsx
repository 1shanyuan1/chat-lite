import { useState } from 'react'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { greetingsOf, type SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import { PlusIcon } from '@/ui/icons'
import { useImportFiles } from '@/ui/useImportFiles'

/** 起始页默认只铺 4 段开场，卡片多的角色卡动辄十几段，全展开会把列表顶飞 */
const GREETING_PREVIEW = 4

/**
 * 新建对话（实验版）：先选极简/写作/酒馆，再勾设定；酒馆再选一段开场白。
 * 逻辑与正式版 ModePicker 一致；视觉按新设计语言重排——
 * 模式卡 2xl、提示文字 12px 并限两行（三张卡高度一致）、列表行统一密度。
 */
export default function ModePickerNext() {
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
  const { importFiles, busy, error, fileRef } = useImportFiles({
    textAs: pack.id === 'writing' ? 'setting' : 'prompt',
  })
  const [showAllGreetings, setShowAllGreetings] = useState(false)

  const isMinimal = pack.id === 'minimal'
  const isTavern = pack.id === 'tavern'
  const userName = config.userName ?? '你'

  const available = isTavern
    ? settings.filter((d) => d.kind === 'character' || d.kind === 'world')
    : settings.filter((d) => d.kind === 'setting')

  const pickedDocs = pendingSettingIds
    .map((id) => settings.find((d) => d.id === id))
    .filter((d): d is SettingDoc => Boolean(d))
  const greetingDocs = isTavern ? pickedDocs.filter((d) => greetingsOf(d, userName).length > 0) : []
  const greetingChoices = greetingDocs.length === 1 ? greetingsOf(greetingDocs[0], userName) : []
  const pick = Math.min(pendingGreetingIndex, Math.max(greetingChoices.length - 1, 0))

  const onImport = async (files: FileList | null) => {
    const ids = await importFiles(files)
    if (!isTavern || ids.length === 0) return
    const state = useApp.getState()
    const imported = state.settings.filter((d) => d.kind === 'character' && ids.includes(d.id))
    if (imported.length === 1 && !state.pendingSettingIds.includes(imported[0].id)) {
      state.togglePendingSetting(imported[0].id)
    }
  }

  const pill = 'inline-flex h-7 items-center rounded-full px-3 text-[12px]'
  const pillOn = 'bg-neutral-900 text-white'
  const pillOff = 'bg-neutral-100 text-neutral-600 active:bg-neutral-200'

  return (
    <div className="px-1 pt-2">
      {/* 三种模式：卡片高度一致（提示限两行），选中 = 黑卡 */}
      <div className="flex gap-2">
        {BUILTIN_PACKS.map((p) => {
          const active = p.id === pack.id
          return (
            <button
              key={p.id}
              className={`flex-1 rounded-2xl border px-2 py-3 text-center ${
                active ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-800'
              }`}
              onClick={() => {
                if (p.id !== pack.id) void setPack(p.id)
              }}
            >
              <div className="text-[14px] font-medium leading-tight">{p.name}</div>
              <div className={`mt-1 line-clamp-2 text-[12px] leading-snug ${active ? 'text-white/60' : 'text-neutral-500'}`}>
                {p.hint}
              </div>
            </button>
          )
        })}
      </div>

      {prompts.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 text-[12px] text-neutral-500">提示词（可选，不选就什么都不注入）</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <button className={`${pill} shrink-0 ${pendingPromptId === null ? pillOn : pillOff}`} onClick={() => setPendingPrompt(null)}>
              不用
            </button>
            {prompts.map((p) => (
              <button key={p.id} className={`${pill} shrink-0 ${pendingPromptId === p.id ? pillOn : pillOff}`} onClick={() => setPendingPrompt(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isMinimal && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">{isTavern ? '选角色卡（可加世界书）' : '选设定文件，可多选'}</span>
            <button
              className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1.5 text-[12px] text-neutral-600 active:bg-neutral-100"
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

          {error && <p className="mb-2 text-[12px] text-red-600">{error}</p>}

          {available.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-neutral-300 px-4 py-6 text-center">
              <p className="text-[12px] leading-relaxed text-neutral-500">
                导入角色卡或世界书
                <br />
                PNG / JSON / CHARX / 压缩包都能直接选
                <br />
                它们都会变成设定文件，可以编辑
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {available.map((doc) => {
                const active = pendingSettingIds.includes(doc.id)
                const count = isTavern ? greetingsOf(doc, userName).length : 0
                const greetingHint = count > 1 ? ` · ${count} 段开场` : count === 1 ? ' · 有开场白' : ''
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${
                      active ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
                    }`}
                  >
                    <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => togglePendingSetting(doc.id)}>
                      {doc.avatar ? (
                        <img src={doc.avatar} alt={doc.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-[12px] text-neutral-500">
                          {doc.name.slice(0, 1)}
                        </div>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] text-neutral-800">{doc.name}</span>
                        <span className="block truncate text-[12px] text-neutral-500">
                          {doc.entries.length} 条条目{greetingHint}
                        </span>
                      </span>
                    </button>
                    <span
                      className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                        active ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'
                      }`}
                    />
                    <button
                      className="shrink-0 text-[12px] text-neutral-500 active:text-red-600"
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
            <div className="mt-5">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-[12px] text-neutral-500">开场白</span>
                <span className="text-[12px] tabular-nums text-neutral-500">
                  {greetingChoices.length > 0
                    ? `${pick + 1} / ${greetingChoices.length}`
                    : `${greetingDocs.length} 张卡各一段`}
                </span>
              </div>

              {greetingChoices.length > 0 ? (
                <div className="space-y-2">
                  {(showAllGreetings ? greetingChoices : greetingChoices.slice(0, GREETING_PREVIEW)).map((text, i) => {
                    const current = i === pick
                    return (
                      <button
                        key={i}
                        className={`block w-full rounded-2xl border px-4 py-3 text-left ${
                          current ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white active:bg-neutral-50'
                        }`}
                        onClick={() => setPendingGreeting(i)}
                      >
                        <span className="mb-1 flex items-center gap-1.5">
                          <span className="text-[12px] tabular-nums text-neutral-500">第 {i + 1} 段</span>
                          {current && <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[12px] text-white">用这段</span>}
                        </span>
                        <span className={`line-clamp-2 block text-[12px] leading-relaxed ${current ? 'text-neutral-800' : 'text-neutral-600'}`}>
                          {text}
                        </span>
                      </button>
                    )
                  })}
                  {greetingChoices.length > GREETING_PREVIEW && (
                    <button className="w-full py-1.5 text-[12px] text-neutral-500 active:text-neutral-700" onClick={() => setShowAllGreetings((v) => !v)}>
                      {showAllGreetings ? '收起' : `展开全部 ${greetingChoices.length} 段`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="rounded-2xl bg-neutral-50 px-4 py-2.5 text-[12px] leading-relaxed text-neutral-500">
                  {greetingDocs.map((d) => d.name).join('、')} 同场，各自用自己的第一段开场。
                </p>
              )}

              <p className="mt-2.5 text-[12px] leading-relaxed text-neutral-500">
                选好后在下面回一句，开场白会跟着你这句话一起发出去。
              </p>
            </div>
          ) : (
            <p className="mt-3 text-[12px] leading-relaxed text-neutral-500">
              {pendingSettingIds.length > 0
                ? `已勾 ${pendingSettingIds.length} 份，在下面发第一句话就带着它们开始。`
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
