import { useState } from 'react'
import { useApp } from '@/chat/store'
import { PlusIcon } from './icons'
import { useImportCharacter } from './useImportCharacter'

export default function CharacterList() {
  const { characters, removeCharacter, startWithCharacter } = useApp()
  const { importFiles, busy, error, fileRef } = useImportCharacter()
  const [pending, setPending] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-[10px] text-neutral-400">
          {characters.length > 0 ? `${characters.length} 个角色 · 支持 SillyTavern 角色卡` : '导入一张角色卡开始'}
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
          accept=".png,.json,application/json,image/png"
          multiple
          className="hidden"
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>

      {error && <p className="px-4 pb-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {characters.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-xs leading-relaxed text-neutral-400">
              角色卡是酒馆生态的通行证
              <br />
              从社区下载的 PNG 卡可以直接导入
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {characters.map((card) => (
            <div key={card.id} className="relative">
              <button
                className="flex w-full flex-col items-center gap-1"
                disabled={Boolean(pending)}
                onClick={() => {
                  setPending(card.id)
                  void startWithCharacter(card.id)
                }}
              >
                {card.avatar ? (
                  <img
                    src={card.avatar}
                    alt={card.name}
                    className="aspect-square w-full rounded-xl object-cover ring-1 ring-neutral-200"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-neutral-100 text-lg text-neutral-400 ring-1 ring-neutral-200">
                    {card.name.slice(0, 1)}
                  </div>
                )}
                <span className="w-full truncate text-center text-[11px] text-neutral-700">{card.name}</span>
              </button>
              <button
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] text-neutral-400 shadow ring-1 ring-neutral-200"
                onClick={() => removeCharacter(card.id)}
                aria-label="删除角色"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
