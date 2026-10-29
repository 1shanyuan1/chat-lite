import { useRef, useState } from 'react'
import { extractCardFromPng, normalizeCard, type CharacterCard } from '@/chat/characters'
import { useApp } from '@/chat/store'
import { PlusIcon } from './icons'

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })

async function parseFile(file: File): Promise<CharacterCard> {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.png')) {
    const raw = extractCardFromPng(await file.arrayBuffer())
    if (!raw) throw new Error('这张 PNG 里没有角色卡数据')
    const card = normalizeCard(raw)
    try {
      card.avatar = await readAsDataUrl(file)
    } catch {
      /* 头像失败不影响导入 */
    }
    return card
  }
  if (lower.endsWith('.json')) {
    return normalizeCard(JSON.parse(await file.text()))
  }
  throw new Error('只支持 .png 或 .json 角色卡')
}

export default function CharacterList() {
  const { characters, importCharacter, removeCharacter, startWithCharacter } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        importCharacter(await parseFile(file))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>

      {error && <p className="px-4 pb-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {characters.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-xs leading-relaxed text-neutral-400">
              角色卡是酒馆生态的通行证
              <br />
              从 SillyTavern 社区下载的 PNG 卡可以直接拖进来
            </p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {characters.map((card) => (
            <div key={card.id} className="relative">
              <button
                className="flex w-full flex-col items-center gap-1"
                onClick={() => {
                  setPending(card.id)
                  void startWithCharacter(card.id)
                }}
                disabled={Boolean(pending)}
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
