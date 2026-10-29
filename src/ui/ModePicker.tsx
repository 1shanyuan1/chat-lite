import { useState } from 'react'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { useApp } from '@/chat/store'
import { PlusIcon } from './icons'
import { useImportCharacter } from './useImportCharacter'

function Avatar({ src, name, size = 'md' }: { src?: string; name: string; size?: 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'h-16 w-16 text-xl' : 'h-14 w-14 text-base'
  if (src) {
    return <img src={src} alt={name} className={`${cls} rounded-xl object-cover ring-1 ring-neutral-200`} />
  }
  return (
    <div
      className={`${cls} flex items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 ring-1 ring-neutral-200`}
    >
      {name.slice(0, 1)}
    </div>
  )
}

/** 新建对话时在聊天页里选模式；角色模式附带角色卡选择 */
export default function ModePicker() {
  const { config, setPack, characters, startWithCharacter, removeCharacter } = useApp()
  const { importFiles, busy, error, fileRef } = useImportCharacter()
  const [starting, setStarting] = useState<string | null>(null)

  const pack = findPack(config.packId)
  const isRoleplay = pack.id === 'roleplay'

  return (
    <div className="px-1 pt-6">
      <h1 className="text-center text-base font-medium text-neutral-800">开始新对话</h1>
      <p className="mt-1 text-center text-[11px] text-neutral-400">先选一个模式，随时可以换</p>

      <div className="mt-4 flex gap-2">
        {BUILTIN_PACKS.map((p) => {
          const active = p.id === pack.id
          return (
            <button
              key={p.id}
              className={`flex-1 rounded-xl border px-2 py-2.5 text-center ${
                active
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 bg-white text-neutral-700'
              }`}
              onClick={() => void setPack(p.id)}
            >
              <div className="text-[13px] font-medium">{p.name}</div>
              <div className={`mt-0.5 text-[10px] leading-tight ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                {p.hint}
              </div>
            </button>
          )
        })}
      </div>

      {isRoleplay ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {characters.length > 0 ? '选一个角色开始' : '还没有角色卡'}
            </span>
            <button
              className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={13} />
              {busy ? '导入中…' : '导入角色卡'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".png,.json,application/json,image/png"
              multiple
              className="hidden"
              onChange={(e) => void importFiles(e.target.files)}
            />
          </div>

          {error && <p className="mb-2 text-[11px] text-red-500">{error}</p>}

          {characters.length === 0 ? (
            <div className="rounded-xl border border-dashed border-neutral-200 px-3 py-6 text-center">
              <p className="text-[11px] leading-relaxed text-neutral-400">
                导入 SillyTavern 的 PNG 角色卡
                <br />
                直接拖进来或点上面的按钮
              </p>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {characters.map((card) => (
                <div key={card.id} className="relative shrink-0">
                  <button
                    className="flex w-16 flex-col items-center gap-1"
                    disabled={Boolean(starting)}
                    onClick={() => {
                      setStarting(card.id)
                      void startWithCharacter(card.id)
                    }}
                  >
                    <Avatar src={card.avatar} name={card.name} />
                    <span className="w-16 truncate text-center text-[10px] text-neutral-600">{card.name}</span>
                  </button>
                  <button
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] text-neutral-400 ring-1 ring-neutral-200"
                    onClick={() => removeCharacter(card.id)}
                    aria-label="删除角色"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-6 text-center text-[11px] leading-relaxed text-neutral-400">
          直接在下面输入即可
          <br />
          模式只影响注入的提示词
        </p>
      )}
    </div>
  )
}
