import { useState } from 'react'
import { emptySetting, type SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import type { PresetItem, PromptItem } from '@/chat/vault'
import { PlusIcon } from './icons'
import { useImportFiles } from './useImportFiles'

type Kind = 'setting' | 'preset' | 'prompt'

const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'setting', label: '设定', hint: '角色、世界观、风格都写这里；一个会话可挂多份' },
  { id: 'preset', label: '预设', hint: '温度、top_p、输出长度' },
  { id: 'prompt', label: '提示词', hint: '可复用的系统提示词片段' },
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

  const [kind, setKind] = useState<Kind>('setting')
  const [editingSetting, setEditingSetting] = useState<SettingDoc | null>(null)
  const [editingPreset, setEditingPreset] = useState<PresetItem | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null)

  const counts = { setting: settings.length, preset: presets.length, prompt: prompts.length }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                kind === k.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
              }`}
              onClick={() => setKind(k.id)}
            >
              {k.label}
              {counts[k.id] > 0 && <span className="ml-1 opacity-60">{counts[k.id]}</span>}
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
          accept=".png,.json,.txt,application/json,image/png,text/plain"
          multiple
          className="hidden"
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>

      <p className="px-4 pb-2 text-[10px] text-neutral-400">{KINDS.find((k) => k.id === kind)?.hint}</p>
      {error && <p className="px-4 pb-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {counts[kind] === 0 && (
          <p className="px-4 py-8 text-center text-[11px] leading-relaxed text-neutral-400">
            还没有{KINDS.find((k) => k.id === kind)?.label}
            <br />
            导入的文件会复制到本机，可随时修改
          </p>
        )}

        {kind === 'setting' &&
          settings.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditingSetting(doc)}>
                <div className="truncate text-sm text-neutral-800">{doc.name}</div>
                <div className="truncate text-[10px] text-neutral-400">
                  {doc.entries.length} 条条目{doc.firstMessage ? ' · 有开场白' : ''} · {doc.body.length} 字设定
                </div>
              </button>
              <button
                className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white"
                onClick={() => void startWithSettings([doc.id])}
              >
                对话
              </button>
              <button className="shrink-0 text-[11px] text-neutral-300" onClick={() => removeSetting(doc.id)}>
                删除
              </button>
            </div>
          ))}

        {kind === 'preset' &&
          presets.map((item) => (
            <div key={item.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
              <button className="min-w-0 flex-1 text-left" onClick={() => setEditingPreset(item)}>
                <div className="truncate text-sm text-neutral-800">{item.name}</div>
                <div className="truncate text-[10px] text-neutral-400">
                  {[item.temperature !== undefined ? `温度 ${item.temperature}` : '', item.maxTokens ? `长度 ${item.maxTokens}` : '']
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

        {kind === 'prompt' &&
          prompts.map((item) => (
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
      </div>

      <div className="border-t border-neutral-100 px-4 py-2">
        <button
          className="w-full rounded-lg border border-neutral-200 py-1.5 text-[11px] text-neutral-600"
          onClick={() => {
            if (kind === 'setting') setEditingSetting(emptySetting())
            else if (kind === 'preset')
              setEditingPreset({ id: crypto.randomUUID(), name: '', createdAt: Date.now(), updatedAt: Date.now() })
            else setEditingPrompt({ id: crypto.randomUUID(), name: '', text: '', createdAt: Date.now(), updatedAt: Date.now() })
          }}
        >
          新建{KINDS.find((k) => k.id === kind)?.label}
        </button>
      </div>

      {editingSetting && (
        <Sheet title="设定文件" onClose={() => setEditingSetting(null)}>
          <input
            className={`${field} mb-3`}
            placeholder="名字，例如「林深」或「夜航世界观」"
            value={editingSetting.name}
            onChange={(e) => setEditingSetting({ ...editingSetting, name: e.target.value })}
          />
          <label className="mb-1 block text-[11px] text-neutral-500">设定正文（常驻注入）</label>
          <textarea
            className={`${field} mb-3 h-40 resize-none`}
            placeholder="人物、世界观、写作风格…写多少都行"
            value={editingSetting.body}
            onChange={(e) => setEditingSetting({ ...editingSetting, body: e.target.value })}
          />
          <label className="mb-1 block text-[11px] text-neutral-500">开场白（可选，有则开新会话时插入）</label>
          <textarea
            className={`${field} mb-3 h-20 resize-none`}
            value={editingSetting.firstMessage ?? ''}
            onChange={(e) => setEditingSetting({ ...editingSetting, firstMessage: e.target.value })}
          />

          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-neutral-500">关键词条目（{editingSetting.entries.length}）</span>
            <button
              className="text-[11px] text-blue-600"
              onClick={() =>
                setEditingSetting({
                  ...editingSetting,
                  entries: [
                    ...editingSetting.entries,
                    { id: crypto.randomUUID(), keys: [], content: '', enabled: true },
                  ],
                })
              }
            >
              + 加一条
            </button>
          </div>

          {editingSetting.entries.map((entry) => (
            <div key={entry.id} className="mb-2 rounded-lg border border-neutral-200 p-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="flex items-center gap-1 text-[10px] text-neutral-500">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) =>
                      setEditingSetting({
                        ...editingSetting,
                        entries: editingSetting.entries.map((x) =>
                          x.id === entry.id ? { ...x, enabled: e.target.checked } : x
                        ),
                      })
                    }
                  />
                  启用
                </label>
                <button
                  className="text-[10px] text-neutral-400"
                  onClick={() =>
                    setEditingSetting({
                      ...editingSetting,
                      entries: editingSetting.entries.filter((x) => x.id !== entry.id),
                    })
                  }
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
                  setEditingSetting({
                    ...editingSetting,
                    entries: editingSetting.entries.map((x) => (x.id === entry.id ? { ...x, keys } : x)),
                  })
                }}
              />
              <textarea
                className={`${field} h-16 resize-none text-xs`}
                placeholder="命中后注入的内容"
                value={entry.content}
                onChange={(e) =>
                  setEditingSetting({
                    ...editingSetting,
                    entries: editingSetting.entries.map((x) =>
                      x.id === entry.id ? { ...x, content: e.target.value } : x
                    ),
                  })
                }
              />
            </div>
          ))}

          <button
            className="mt-2 w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white"
            onClick={() => {
              importSetting(editingSetting)
              setEditingSetting(null)
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
                value={editingPreset[key] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const value = raw === '' ? undefined : Number(raw)
                  setEditingPreset({
                    ...editingPreset,
                    [key]: Number.isFinite(value as number) ? value : undefined,
                  })
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
