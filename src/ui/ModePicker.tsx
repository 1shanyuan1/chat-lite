import { useState } from 'react'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { useApp } from '@/chat/store'
import { PlusIcon } from './icons'
import { useImportFiles } from './useImportFiles'

/** 新建对话：先选极简还是挂设定；挂设定时可多选 */
export default function ModePicker() {
  const { config, setPack, settings, startWithSettings, removeSetting } = useApp()
  const { importFiles, busy, error, fileRef } = useImportFiles()
  const [selected, setSelected] = useState<string[]>([])
  const [starting, setStarting] = useState(false)

  const pack = findPack(config.packId)
  const isSettings = pack.id === 'settings'

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="px-1 pt-6">
      <h1 className="text-center text-base font-medium text-neutral-800">开始</h1>
      <p className="mt-1 text-center text-[11px] text-neutral-400">不挂设定就是普通聊天</p>

      <div className="mt-4 flex gap-2">
        {BUILTIN_PACKS.map((p) => {
          const active = p.id === pack.id
          return (
            <button
              key={p.id}
              className={`flex-1 rounded-xl border px-2 py-2.5 text-center ${
                active ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-700'
              }`}
              onClick={() => {
                setSelected([])
                void setPack(p.id)
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

      {isSettings ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {settings.length > 0 ? '选设定文件，可多选' : '还没有设定文件'}
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
              accept=".png,.json,.txt,application/json,image/png,text/plain"
              multiple
              className="hidden"
              onChange={(e) => void importFiles(e.target.files)}
            />
          </div>

          {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}

          {settings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-200 px-3 py-6 text-center">
              <p className="text-[11px] leading-relaxed text-neutral-400">
                导入角色卡或世界书
                <br />
                它们都会变成设定文件，可以编辑
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {settings.map((doc) => {
                const active = selected.includes(doc.id)
                return (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${
                      active ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
                    }`}
                  >
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggle(doc.id)}>
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
                          {doc.entries.length} 条条目{doc.firstMessage ? ' · 有开场白' : ''}
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
                      onClick={() => {
                        setSelected((prev) => prev.filter((x) => x !== doc.id))
                        removeSetting(doc.id)
                      }}
                    >
                      删
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {selected.length > 0 && (
            <button
              className="mt-3 w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white disabled:opacity-40"
              disabled={starting}
              onClick={() => {
                setStarting(true)
                void startWithSettings(selected).finally(() => setStarting(false))
              }}
            >
              开始（挂 {selected.length} 份设定）
            </button>
          )}
        </div>
      ) : (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-neutral-400">
          直接在下面输入即可
          <br />
          想挂设定就切到「设定」
        </p>
      )}
    </div>
  )
}
