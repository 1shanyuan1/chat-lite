import { useState } from 'react'
import { normalizeCard, type CharacterCard } from '@/chat/characters'
import {
  detectKind,
  toPresetItem,
  toPromptItem,
  toWorldItem,
  VAULT_KINDS,
  type PresetItem,
  type PromptItem,
  type WorldItem,
} from '@/chat/vault'
import { useApp } from '@/chat/store'
import { CloseIcon, PlusIcon } from './icons'
import { useImportCharacter } from './useImportCharacter'

type Kind = (typeof VAULT_KINDS)[number]['id']

const field = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

function Row({
  title,
  meta,
  onEdit,
  onDelete,
  extra,
}: {
  title: string
  meta: string
  onEdit?: () => void
  onDelete: () => void
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
      <button className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <div className="truncate text-sm text-neutral-800">{title}</div>
        <div className="truncate text-[10px] text-neutral-400">{meta}</div>
      </button>
      {extra}
      <button className="shrink-0 text-[11px] text-neutral-300 active:text-red-500" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative max-h-[88%] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {children}
        <button className="mt-3 w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white" onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  )
}

export default function VaultPanel() {
  const {
    characters,
    worlds,
    presets,
    prompts,
    importCharacter,
    removeCharacter,
    startWithCharacter,
    saveVaultItem,
    removeVaultItem,
    applyPreset,
    applyPrompt,
  } = useApp()
  const { importFiles, busy, error: importError, fileRef } = useImportCharacter()

  const [kind, setKind] = useState<Kind>('character')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<
    | { kind: 'character'; card: CharacterCard }
    | { kind: 'world'; item: WorldItem }
    | { kind: 'preset'; item: PresetItem }
    | { kind: 'prompt'; item: PromptItem }
    | null
  >(null)
  const [binding, setBinding] = useState<WorldItem | null>(null)

  /** 统一入口：按内容结构判断类型，不靠扩展名 */
  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setError(null)
    const list = Array.from(files)
    for (const file of list) {
      const lower = file.name.toLowerCase()
      try {
        if (lower.endsWith('.png')) {
          await importFiles([file])
          continue
        }
        const text = await file.text()
        let payload: unknown = text
        try {
          payload = JSON.parse(text)
        } catch {
          /* 纯文本当提示词 */
        }
        const detected = detectKind(payload)
        const baseName = file.name.replace(/\.[^.]+$/, '')
        if (detected === 'character') importCharacter(normalizeCard(payload))
        else if (detected === 'world') saveVaultItem('world', toWorldItem(payload, baseName))
        else if (detected === 'preset') saveVaultItem('preset', toPresetItem(payload, baseName))
        else if (detected === 'prompt') saveVaultItem('prompt', toPromptItem(payload, baseName))
        else throw new Error(`${file.name} 认不出是什么类型`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const items =
    kind === 'character'
      ? characters.map((c) => ({ id: c.id, name: c.name, meta: `${c.worldInfo.length} 条世界书` }))
      : kind === 'world'
        ? worlds.map((w) => ({ id: w.id, name: w.name, meta: `${w.entries.length} 条条目` }))
        : kind === 'preset'
          ? presets.map((p) => ({
              id: p.id,
              name: p.name,
              meta: [p.temperature !== undefined ? `温度 ${p.temperature}` : '', p.maxTokens ? `长度 ${p.maxTokens}` : '']
                .filter(Boolean)
                .join(' · ') || '未设置参数',
            }))
          : prompts.map((p) => ({ id: p.id, name: p.name, meta: `${p.text.length} 字` }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <div className="flex gap-1 overflow-x-auto">
          {VAULT_KINDS.map((k) => (
            <button
              key={k.id}
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                kind === k.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
              }`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <PlusIcon size={13} />
          {busy ? '…' : '导入'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.json,.txt,application/json,image/png,text/plain"
          multiple
          className="hidden"
          onChange={(e) => void onPick(e.target.files)}
        />
      </div>

      <p className="px-4 pb-2 text-[10px] text-neutral-400">
        {VAULT_KINDS.find((k) => k.id === kind)?.hint}
      </p>

      {(error || importError) && (
        <p className="px-4 pb-2 text-[11px] text-red-500">{error ?? importError}</p>
      )}

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <p className="px-4 py-8 text-center text-[11px] leading-relaxed text-neutral-400">
            还没有{VAULT_KINDS.find((k) => k.id === kind)?.label}
            <br />
            点右上角导入，文件会被复制到本机，可随时修改
          </p>
        )}

        {kind === 'character' &&
          characters.map((card) => (
            <Row
              key={card.id}
              title={card.name}
              meta={`${card.worldInfo.length} 条世界书`}
              onEdit={() => setEditing({ kind: 'character', card })}
              onDelete={() => removeCharacter(card.id)}
              extra={
                <button
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() => void startWithCharacter(card.id)}
                >
                  对话
                </button>
              }
            />
          ))}

        {kind === 'world' &&
          worlds.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              meta={`${item.entries.length} 条条目`}
              onEdit={() => setEditing({ kind: 'world', item })}
              onDelete={() => removeVaultItem('world', item.id)}
              extra={
                <button
                  className="shrink-0 rounded-md border border-neutral-200 px-2 py-0.5 text-[10px] text-neutral-600"
                  onClick={() => setBinding(item)}
                >
                  绑到角色
                </button>
              }
            />
          ))}

        {kind === 'preset' &&
          presets.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              meta={
                [item.temperature !== undefined ? `温度 ${item.temperature}` : '', item.maxTokens ? `长度 ${item.maxTokens}` : '']
                  .filter(Boolean)
                  .join(' · ') || '未设置参数'
              }
              onEdit={() => setEditing({ kind: 'preset', item })}
              onDelete={() => removeVaultItem('preset', item.id)}
              extra={
                <button
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() => applyPreset(item)}
                >
                  应用
                </button>
              }
            />
          ))}

        {kind === 'prompt' &&
          prompts.map((item) => (
            <Row
              key={item.id}
              title={item.name}
              meta={`${item.text.length} 字`}
              onEdit={() => setEditing({ kind: 'prompt', item })}
              onDelete={() => removeVaultItem('prompt', item.id)}
              extra={
                <button
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() => applyPrompt(item)}
                >
                  应用
                </button>
              }
            />
          ))}
      </div>

      {editing?.kind === 'character' && (
        <Sheet onClose={() => setEditing(null)}>
          <h3 className="mb-3 text-sm font-medium">编辑角色卡</h3>
          {(
            [
              ['名字', 'name'],
              ['设定', 'description'],
              ['性格', 'personality'],
              ['情境', 'scenario'],
              ['开场白', 'firstMessage'],
              ['系统提示词', 'systemPrompt'],
            ] as Array<[string, keyof CharacterCard]>
          ).map(([label, key]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 block text-[11px] text-neutral-500">{label}</label>
              <textarea
                className={`${field} ${key === 'name' ? 'h-9' : 'h-20'} resize-none`}
                value={String(editing.card[key] ?? '')}
                onChange={(e) =>
                  setEditing({ kind: 'character', card: { ...editing.card, [key]: e.target.value } })
                }
              />
            </div>
          ))}
          <button
            className="w-full rounded-xl border border-neutral-200 py-2 text-xs text-neutral-700"
            onClick={() => {
              importCharacter(editing.card)
              setEditing(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}

      {editing?.kind === 'world' && (
        <Sheet onClose={() => setEditing(null)}>
          <h3 className="mb-3 text-sm font-medium">编辑世界书</h3>
          <input
            className={`${field} mb-3`}
            value={editing.item.name}
            onChange={(e) => setEditing({ kind: 'world', item: { ...editing.item, name: e.target.value } })}
          />
          {editing.item.entries.map((entry, index) => (
            <div key={entry.id} className="mb-3 rounded-lg border border-neutral-200 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">条目 {index + 1}</span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] text-neutral-500">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) => {
                        const entries = editing.item.entries.map((x) =>
                          x.id === entry.id ? { ...x, enabled: e.target.checked } : x
                        )
                        setEditing({ kind: 'world', item: { ...editing.item, entries } })
                      }}
                    />
                    启用
                  </label>
                  <button
                    className="text-[10px] text-neutral-400"
                    onClick={() =>
                      setEditing({
                        kind: 'world',
                        item: { ...editing.item, entries: editing.item.entries.filter((x) => x.id !== entry.id) },
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              <input
                className={`${field} mb-1.5 text-xs`}
                placeholder="关键词，逗号分隔"
                value={entry.keys.join(', ')}
                onChange={(e) => {
                  const keys = e.target.value.split(',').map((k) => k.trim()).filter(Boolean)
                  const entries = editing.item.entries.map((x) => (x.id === entry.id ? { ...x, keys } : x))
                  setEditing({ kind: 'world', item: { ...editing.item, entries } })
                }}
              />
              <textarea
                className={`${field} h-16 resize-none text-xs`}
                placeholder="命中后注入的内容"
                value={entry.content}
                onChange={(e) => {
                  const entries = editing.item.entries.map((x) =>
                    x.id === entry.id ? { ...x, content: e.target.value } : x
                  )
                  setEditing({ kind: 'world', item: { ...editing.item, entries } })
                }}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              className="flex-1 rounded-xl border border-neutral-200 py-2 text-xs text-neutral-700"
              onClick={() =>
                setEditing({
                  kind: 'world',
                  item: {
                    ...editing.item,
                    entries: [
                      ...editing.item.entries,
                      { id: crypto.randomUUID(), keys: [], content: '', enabled: true },
                    ],
                  },
                })
              }
            >
              加一条
            </button>
            <button
              className="flex-1 rounded-xl bg-neutral-900 py-2 text-xs text-white"
              onClick={() => {
                saveVaultItem('world', editing.item)
                setEditing(null)
              }}
            >
              保存
            </button>
          </div>
        </Sheet>
      )}

      {editing?.kind === 'preset' && (
        <Sheet onClose={() => setEditing(null)}>
          <h3 className="mb-3 text-sm font-medium">编辑预设</h3>
          <input
            className={`${field} mb-3`}
            value={editing.item.name}
            onChange={(e) => setEditing({ kind: 'preset', item: { ...editing.item, name: e.target.value } })}
          />
          {(
            [
              ['温度 temperature', 'temperature'],
              ['top_p', 'topP'],
              ['最大长度 max_tokens', 'maxTokens'],
            ] as Array<[string, 'temperature' | 'topP' | 'maxTokens']>
          ).map(([label, key]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 block text-[11px] text-neutral-500">{label}</label>
              <input
                className={field}
                inputMode="decimal"
                value={editing.item[key] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const value = raw === '' ? undefined : Number(raw)
                  setEditing({
                    kind: 'preset',
                    item: { ...editing.item, [key]: Number.isFinite(value as number) ? value : undefined },
                  })
                }}
              />
            </div>
          ))}
          <button
            className="w-full rounded-xl bg-neutral-900 py-2 text-xs text-white"
            onClick={() => {
              saveVaultItem('preset', editing.item)
              setEditing(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}

      {editing?.kind === 'prompt' && (
        <Sheet onClose={() => setEditing(null)}>
          <h3 className="mb-3 text-sm font-medium">编辑提示词</h3>
          <input
            className={`${field} mb-3`}
            value={editing.item.name}
            onChange={(e) => setEditing({ kind: 'prompt', item: { ...editing.item, name: e.target.value } })}
          />
          <textarea
            className={`${field} mb-3 h-40 resize-none`}
            value={editing.item.text}
            onChange={(e) => setEditing({ kind: 'prompt', item: { ...editing.item, text: e.target.value } })}
          />
          <button
            className="w-full rounded-xl bg-neutral-900 py-2 text-xs text-white"
            onClick={() => {
              saveVaultItem('prompt', editing.item)
              setEditing(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}

      {binding && (
        <Sheet onClose={() => setBinding(null)}>
          <h3 className="mb-2 text-sm font-medium">把「{binding.name}」绑到角色</h3>
          <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
            条目会追加进该角色的世界书，之后开这个角色的对话都会生效
          </p>
          {characters.length === 0 && <p className="text-[11px] text-neutral-400">还没有角色卡</p>}
          {characters.map((card) => (
            <button
              key={card.id}
              className="mb-1.5 flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left"
              onClick={() => {
                importCharacter({ ...card, worldInfo: [...card.worldInfo, ...binding.entries] })
                setBinding(null)
              }}
            >
              <span className="truncate text-xs text-neutral-700">{card.name}</span>
              <span className="shrink-0 text-[10px] text-neutral-400">{card.worldInfo.length} 条</span>
            </button>
          ))}
        </Sheet>
      )}

      {kind === 'character' && characters.length > 0 && (
        <div className="border-t border-neutral-100 px-4 py-2 text-[10px] text-neutral-300">
          <CloseIcon size={10} className="mr-1 inline" />
          文件都保存在本机，编辑只改本地副本
        </div>
      )}
    </div>
  )
}
