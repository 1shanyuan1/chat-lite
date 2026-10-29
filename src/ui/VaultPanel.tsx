import { useState } from 'react'
import { emptySetting, type DocKind, type SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import type { PresetItem, PromptItem } from '@/chat/vault'
import { PlusIcon } from './icons'
import { useImportFiles } from './useImportFiles'

type Area = 'tavern' | 'writing' | 'common'

const AREAS: Array<{ id: Area; label: string; hint: string }> = [
  { id: 'tavern', label: '酒馆', hint: '角色卡与世界书，保持社区格式，可与 SillyTavern 互导' },
  { id: 'writing', label: '写作', hint: '设定文件，自由写法，不要求任何格式' },
  { id: 'common', label: '通用', hint: '预设与提示词，两种模式都能用' },
]

const field = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative max-h-[88%] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">{title}</h3>
          <button className="text-xs text-neutral-400" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function DocRow({ doc, onEdit, onDelete, onStart }: { doc: SettingDoc; onEdit: () => void; onDelete: () => void; onStart: () => void }) {
  const meta =
    [
      doc.entries.length > 0 ? `${doc.entries.length} 条条目` : '',
      doc.firstMessage ? '有开场白' : '',
      doc.body ? `${doc.body.length} 字正文` : '',
    ]
      .filter(Boolean)
      .join(' · ') || '空'

  return (
    <div className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={onEdit}>
        {doc.avatar ? (
          <img src={doc.avatar} alt={doc.name} className="h-8 w-8 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-[11px] text-neutral-400">
            {doc.name.slice(0, 1)}
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-neutral-800">{doc.name}</span>
          <span className="block truncate text-[10px] text-neutral-400">{meta}</span>
        </span>
      </button>
      <button className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white" onClick={onStart}>
        开始
      </button>
      <button className="shrink-0 text-[11px] text-neutral-300 active:text-red-500" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

export default function VaultPanel() {
  const {
    settings,
    presets,
    prompts,
    importSetting,
    removeSetting,
    startWithSettings,
    savePreset,
    removePreset,
    savePrompt,
    removePrompt,
    applyPreset,
    applyPrompt,
  } = useApp()
  const { importFiles, busy, error, fileRef } = useImportFiles()

  const [area, setArea] = useState<Area>('tavern')
  const [editing, setEditing] = useState<SettingDoc | null>(null)
  const [editingPreset, setEditingPreset] = useState<PresetItem | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null)

  const characters = settings.filter((d) => d.kind === 'character')
  const worlds = settings.filter((d) => d.kind === 'world')
  const docs = settings.filter((d) => d.kind === 'setting')

  const newDoc = (kind: DocKind) => {
    const doc = emptySetting(kind)
    doc.name = kind === 'character' ? '新角色' : kind === 'world' ? '新世界书' : '新设定'
    setEditing(doc)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <div className="flex gap-1">
          {AREAS.map((a) => (
            <button
              key={a.id}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                area === a.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
              }`}
              onClick={() => setArea(a.id)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <button
          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <PlusIcon size={13} />
          {busy ? '…' : '导入'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.json,.txt,.charx,.zip,application/json,image/png,text/plain,application/zip"
          multiple
          className="hidden"
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>

      <p className="px-4 pb-2 text-[10px] text-neutral-400">{AREAS.find((a) => a.id === area)?.hint}</p>
      {error && <p className="px-4 pb-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {area === 'tavern' && (
          <>
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">角色卡 · {characters.length}</span>
              <button className="text-[10px] text-blue-600" onClick={() => newDoc('character')}>
                新建
              </button>
            </div>
            {characters.length === 0 && (
              <p className="px-4 py-4 text-center text-[11px] text-neutral-400">导入 SillyTavern 的 PNG 角色卡</p>
            )}
            {characters.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onEdit={() => setEditing(doc)}
                onDelete={() => removeSetting(doc.id)}
                onStart={() => void startWithSettings([doc.id])}
              />
            ))}

            <div className="mt-1 flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">世界书 · {worlds.length}</span>
              <button className="text-[10px] text-blue-600" onClick={() => newDoc('world')}>
                新建
              </button>
            </div>
            {worlds.length === 0 && (
              <p className="px-4 py-4 text-center text-[11px] text-neutral-400">导入世界书 JSON，或手动新建条目</p>
            )}
            {worlds.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onEdit={() => setEditing(doc)}
                onDelete={() => removeSetting(doc.id)}
                onStart={() => void startWithSettings([doc.id])}
              />
            ))}
          </>
        )}

        {area === 'writing' && (
          <>
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">设定 · {docs.length}</span>
              <button className="text-[10px] text-blue-600" onClick={() => newDoc('setting')}>
                新建
              </button>
            </div>
            {docs.length === 0 && (
              <p className="px-4 py-6 text-center text-[11px] leading-relaxed text-neutral-400">
                设定是自由格式：人物、世界观、文风都可以写
                <br />
                一个会话可以挂多份
              </p>
            )}
            {docs.map((doc) => (
              <DocRow
                key={doc.id}
                doc={doc}
                onEdit={() => setEditing(doc)}
                onDelete={() => removeSetting(doc.id)}
                onStart={() => void startWithSettings([doc.id])}
              />
            ))}
          </>
        )}

        {area === 'common' && (
          <>
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">预设 · {presets.length}</span>
              <button
                className="text-[10px] text-blue-600"
                onClick={() =>
                  setEditingPreset({ id: crypto.randomUUID(), name: '', createdAt: Date.now(), updatedAt: Date.now() })
                }
              >
                新建
              </button>
            </div>
            {presets.length === 0 && <p className="px-4 py-4 text-center text-[11px] text-neutral-400">导入预设 JSON</p>}
            {presets.map((item) => (
              <div key={item.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditingPreset(item)}>
                  <div className="truncate text-sm text-neutral-800">{item.name}</div>
                  <div className="truncate text-[10px] text-neutral-400">
                    {[item.topP !== undefined ? `top_p ${item.topP}` : '', item.maxTokens ? `长度 ${item.maxTokens}` : '']
                      .filter(Boolean)
                      .join(' · ') || '未设置参数'}
                  </div>
                </button>
                <button
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() => applyPreset(item)}
                >
                  应用
                </button>
                <button className="shrink-0 text-[11px] text-neutral-300" onClick={() => removePreset(item.id)}>
                  删除
                </button>
              </div>
            ))}

            <div className="mt-1 flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">提示词 · {prompts.length}</span>
              <button
                className="text-[10px] text-blue-600"
                onClick={() =>
                  setEditingPrompt({
                    id: crypto.randomUUID(),
                    name: '',
                    text: '',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                  })
                }
              >
                新建
              </button>
            </div>
            {prompts.map((item) => (
              <div key={item.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setEditingPrompt(item)}>
                  <div className="truncate text-sm text-neutral-800">{item.name}</div>
                  <div className="truncate text-[10px] text-neutral-400">{item.text.length} 字</div>
                </button>
                <button
                  className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                  onClick={() => applyPrompt(item)}
                >
                  应用
                </button>
                <button className="shrink-0 text-[11px] text-neutral-300" onClick={() => removePrompt(item.id)}>
                  删除
                </button>
              </div>
            ))}
          </>
        )}
      </div>

      {editing && (
        <Sheet
          title={editing.kind === 'character' ? '角色卡' : editing.kind === 'world' ? '世界书' : '设定'}
          onClose={() => setEditing(null)}
        >
          <input
            className={`${field} mb-3`}
            placeholder="名字"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />

          {editing.kind !== 'world' && (
            <>
              <label className="mb-1 block text-[11px] text-neutral-500">
                {editing.kind === 'character' ? '设定正文（角色描述、性格、情境）' : '设定正文'}
              </label>
              <textarea
                className={`${field} mb-3 h-40 resize-none`}
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              />
            </>
          )}

          {editing.kind === 'character' && (
            <>
              <label className="mb-1 block text-[11px] text-neutral-500">开场白（有则开新会话时插入）</label>
              <textarea
                className={`${field} mb-3 h-20 resize-none`}
                value={editing.firstMessage ?? ''}
                onChange={(e) => setEditing({ ...editing, firstMessage: e.target.value })}
              />
            </>
          )}

          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-neutral-500">关键词条目（{editing.entries.length}）</span>
            <button
              className="text-[11px] text-blue-600"
              onClick={() =>
                setEditing({
                  ...editing,
                  entries: [...editing.entries, { id: crypto.randomUUID(), keys: [], content: '', enabled: true }],
                })
              }
            >
              + 加一条
            </button>
          </div>

          {editing.entries.map((entry) => (
            <div key={entry.id} className="mb-2 rounded-lg border border-neutral-200 p-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="flex items-center gap-1 text-[10px] text-neutral-500">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        entries: editing.entries.map((x) =>
                          x.id === entry.id ? { ...x, enabled: e.target.checked } : x
                        ),
                      })
                    }
                  />
                  启用
                </label>
                <button
                  className="text-[10px] text-neutral-400"
                  onClick={() => setEditing({ ...editing, entries: editing.entries.filter((x) => x.id !== entry.id) })}
                >
                  删除
                </button>
              </div>
              <input
                className={`${field} mb-1.5 text-xs`}
                placeholder="关键词，逗号分隔"
                value={entry.keys.join(', ')}
                onChange={(e) => {
                  const keys = e.target.value.split(',').map((k) => k.trim()).filter(Boolean)
                  setEditing({
                    ...editing,
                    entries: editing.entries.map((x) => (x.id === entry.id ? { ...x, keys } : x)),
                  })
                }}
              />
              <textarea
                className={`${field} h-16 resize-none text-xs`}
                placeholder="命中后注入的内容"
                value={entry.content}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    entries: editing.entries.map((x) => (x.id === entry.id ? { ...x, content: e.target.value } : x)),
                  })
                }
              />
            </div>
          ))}

          <button
            className="mt-2 w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white"
            onClick={() => {
              importSetting(editing)
              setEditing(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}

      {editingPreset && (
        <Sheet title="预设" onClose={() => setEditingPreset(null)}>
          <input
            className={`${field} mb-3`}
            placeholder="名字"
            value={editingPreset.name}
            onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
          />
          {(
            [
              ['top_p（可选，多数情况不用调）', 'topP'],
              ['最大长度 max_tokens', 'maxTokens'],
            ] as Array<[string, 'topP' | 'maxTokens']>
          ).map(([label, key]) => (
            <div key={key} className="mb-3">
              <label className="mb-1 block text-[11px] text-neutral-500">{label}</label>
              <input
                className={field}
                inputMode="decimal"
                value={editingPreset[key] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const value = raw === '' ? undefined : Number(raw)
                  setEditingPreset({ ...editingPreset, [key]: Number.isFinite(value as number) ? value : undefined })
                }}
              />
            </div>
          ))}
          <button
            className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white"
            onClick={() => {
              savePreset(editingPreset)
              setEditingPreset(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}

      {editingPrompt && (
        <Sheet title="提示词" onClose={() => setEditingPrompt(null)}>
          <input
            className={`${field} mb-3`}
            placeholder="名字"
            value={editingPrompt.name}
            onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
          />
          <textarea
            className={`${field} mb-3 h-40 resize-none`}
            value={editingPrompt.text}
            onChange={(e) => setEditingPrompt({ ...editingPrompt, text: e.target.value })}
          />
          <button
            className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white"
            onClick={() => {
              savePrompt(editingPrompt)
              setEditingPrompt(null)
            }}
          >
            保存
          </button>
        </Sheet>
      )}
    </div>
  )
}
