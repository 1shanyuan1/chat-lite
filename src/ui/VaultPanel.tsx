import { useState } from 'react'
import { buildBundle, bundleFileName, collectBundleItems } from '@/chat/bundle-export'
import { buildCharx, charxFileName } from '@/chat/charx-export'
import { buildPngCard, pngCardFileName } from '@/chat/png-export'
import { FOLDER_CONTENTS, type FolderArea } from '@/chat/folders'
import { humanizeError } from '@/chat/errors'
import { platform } from '@/platform'
import { emptySetting, type DocKind, type SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import type { PresetItem, PromptItem } from '@/chat/vault'
import { ChevronLeftIcon, PlusIcon } from './icons'
import { useImportFiles } from './useImportFiles'

type Area = FolderArea | 'common'
type NewKind = DocKind | 'preset'

const AREAS: Array<{ id: Area; label: string; hint: string }> = [
  { id: 'tavern', label: '酒馆', hint: '角色卡、世界书、预设，按文件夹整理' },
  { id: 'writing', label: '写作', hint: '自由设定与预设，按文件夹整理' },
  { id: 'common', label: '通用', hint: '未归入文件夹的预设与提示词' },
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

function PresetRow({ item, onEdit, onDelete, onApply }: { item: PresetItem; onEdit: () => void; onDelete: () => void; onApply: () => void }) {
  const meta =
    [item.topP !== undefined ? `top_p ${item.topP}` : '', item.maxTokens ? `长度 ${item.maxTokens}` : '']
      .filter(Boolean)
      .join(' · ') || '未设置参数'

  return (
    <div className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
      <button className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <span className="block truncate text-sm text-neutral-800">{item.name}</span>
        <span className="block text-[10px] text-neutral-400">{meta}</span>
      </button>
      <button className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-[10px] text-white" onClick={onApply}>
        应用
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
    folders,
    importSetting,
    removeSetting,
    startWithSettings,
    savePreset,
    removePreset,
    savePrompt,
    removePrompt,
    applyPreset,
    applyPrompt,
    createFolder,
    renameFolder,
    removeFolder,
  } = useApp()
  const { importFiles, busy, error, fileRef } = useImportFiles()

  const [area, setArea] = useState<Area>('tavern')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SettingDoc | null>(null)
  const [editingPreset, setEditingPreset] = useState<PresetItem | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null)
  const [menu, setMenu] = useState<'new' | 'folder' | null>(null)
  const [folderDraft, setFolderDraft] = useState('')
  const [exporting, setExporting] = useState(false)

  const currentFolder = folders.find((f) => f.id === folderId)
  const areaFolders = folders.filter((f) => f.area === area)
  const allowed = area === 'common' ? [] : FOLDER_CONTENTS[area]

  const docsOf = (kind: DocKind) =>
    settings.filter((d) => d.kind === kind && (folderId ? d.folderId === folderId : !d.folderId))
  const presetsOf = () => presets.filter((p) => (folderId ? p.folderId === folderId : !p.folderId))
  const countInFolder = (id: string) =>
    settings.filter((d) => d.folderId === id).length + presets.filter((p) => p.folderId === id).length

  const createNew = (kind: NewKind) => {
    setMenu(null)
    if (kind === 'preset') {
      setEditingPreset({
        id: crypto.randomUUID(),
        folderId: folderId ?? undefined,
        name: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return
    }
    const doc = emptySetting(kind)
    doc.folderId = folderId ?? undefined
    doc.name = kind === 'character' ? '新角色' : kind === 'world' ? '新世界书' : '新设定'
    setEditing(doc)
  }

  const onExport = async () => {
    if (!currentFolder) return
    const folderDocs = settings.filter((d) => d.folderId === currentFolder.id)
    const folderPresets = presets.filter((p) => p.folderId === currentFolder.id)
    if (folderDocs.length === 0 && folderPresets.length === 0) return
    setExporting(true)
    try {
      const items = collectBundleItems(folderDocs, folderPresets)
      await platform().exportBinaryFile(bundleFileName(currentFolder.name), buildBundle(currentFolder.name, items))
    } catch (e) {
      alert(humanizeError(e))
    } finally {
      setExporting(false)
    }
  }

  const onImport = async (files: FileList | null) => {
    const ids = await importFiles(files)
    if (!folderId || ids.length === 0) return
    // 在文件夹里导入的内容直接归到这个文件夹
    for (const id of ids) {
      const doc = useApp.getState().settings.find((d) => d.id === id)
      if (doc && doc.folderId !== folderId) importSetting({ ...doc, folderId })
    }
  }

  const renderDocs = (withEmpty = false) =>
    allowed.map(({ kind, label }) => {
      if (kind === 'preset') return null
      const list = docsOf(kind as DocKind)
      if (!withEmpty && list.length === 0) return null
      return (
        <div key={kind}>
          <div className="bg-neutral-50 px-4 py-1 text-[10px] text-neutral-500">
            {label} · {list.length}
          </div>
          {list.length === 0 && <p className="px-4 py-3 text-center text-[10px] text-neutral-300">空</p>}
          {list.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              onEdit={() => setEditing(doc)}
              onDelete={() => removeSetting(doc.id)}
              onStart={() => void startWithSettings([doc.id])}
            />
          ))}
        </div>
      )
    })

  const presetSection = (withEmpty = false) => {
    const list = presetsOf()
    if (!withEmpty && list.length === 0) return null
    return (
      <div>
        <div className="bg-neutral-50 px-4 py-1 text-[10px] text-neutral-500">预设 · {list.length}</div>
        {list.length === 0 && <p className="px-4 py-3 text-center text-[10px] text-neutral-300">空</p>}
        {list.map((item) => (
          <PresetRow
            key={item.id}
            item={item}
            onEdit={() => setEditingPreset(item)}
            onDelete={() => removePreset(item.id)}
            onApply={() => applyPreset(item)}
          />
        ))}
      </div>
    )
  }

  const emptyArea =
    !currentFolder &&
    area !== 'common' &&
    areaFolders.length === 0 &&
    docsOf('character').length === 0 &&
    docsOf('world').length === 0 &&
    docsOf('setting').length === 0 &&
    previewsEmpty()

  function previewsEmpty() {
    return presets.filter((p) => !p.folderId).length === 0
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        {currentFolder ? (
          <button className="flex min-w-0 items-center gap-1 text-sm text-neutral-700" onClick={() => setFolderId(null)}>
            <ChevronLeftIcon />
            <span className="truncate">{currentFolder.name}</span>
          </button>
        ) : (
          <div className="flex gap-1">
            {AREAS.map((a) => (
              <button
                key={a.id}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  area === a.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => {
                  setArea(a.id)
                  setFolderId(null)
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        {currentFolder ? (
          <div className="flex gap-1.5">
            <button
              className="rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 disabled:opacity-40"
              disabled={exporting || countInFolder(currentFolder.id) === 0}
              onClick={() => void onExport()}
            >
              {exporting ? '打包中…' : '导出'}
            </button>
            <button className="rounded-lg bg-neutral-900 px-2 py-1 text-[11px] text-white" onClick={() => setMenu('new')}>
              新建
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            {area !== 'common' && (
              <button
                className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
                onClick={() => setMenu('folder')}
              >
                <PlusIcon size={12} />
                文件夹
              </button>
            )}
            <button
              className="flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={12} />
              {busy ? '…' : '导入'}
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".png,.json,.txt,.charx,.zip,application/json,image/png,text/plain,application/zip"
          multiple
          className="hidden"
          onChange={(e) => void onImport(e.target.files)}
        />
      </div>

      <p className="px-4 pb-2 text-[10px] text-neutral-400">
        {currentFolder
          ? `${currentFolder.name} · ${countInFolder(currentFolder.id)} 项`
          : (AREAS.find((a) => a.id === area)?.hint ?? '')}
      </p>
      {error && <p className="px-4 pb-2 text-[11px] text-red-500">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {!currentFolder && area !== 'common' && (
          <>
            {areaFolders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-2.5">
                <button className="min-w-0 flex-1 text-left" onClick={() => setFolderId(folder.id)}>
                  <span className="block truncate text-sm text-neutral-800">{folder.name}</span>
                  <span className="block text-[10px] text-neutral-400">{countInFolder(folder.id)} 项</span>
                </button>
                <button
                  className="shrink-0 text-[11px] text-neutral-300"
                  onClick={() => {
                    const name = prompt('文件夹名称', folder.name)
                    if (name !== null) renameFolder(folder.id, name)
                  }}
                >
                  改名
                </button>
                <button className="shrink-0 text-[11px] text-neutral-300" onClick={() => removeFolder(folder.id)}>
                  删除
                </button>
              </div>
            ))}

            {renderDocs()}
            {presetSection()}

            {emptyArea && (
              <p className="px-4 py-8 text-center text-[11px] leading-relaxed text-neutral-400">
                还没有内容
                <br />
                先建个文件夹，或直接导入
              </p>
            )}
          </>
        )}

        {currentFolder && (
          <>
            {renderDocs(true)}
            {presetSection(true)}
          </>
        )}

        {area === 'common' && !currentFolder && (
          <>
            <div className="flex items-center justify-between bg-neutral-50 px-4 py-1">
              <span className="text-[10px] text-neutral-500">预设 · {presetsOf().length}</span>
              <button className="text-[10px] text-blue-600" onClick={() => createNew('preset')}>
                新建
              </button>
            </div>
            {presetsOf().length === 0 && (
              <p className="px-4 py-4 text-center text-[11px] text-neutral-400">没有未归类的预设</p>
            )}
            {presetsOf().map((item) => (
              <PresetRow
                key={item.id}
                item={item}
                onEdit={() => setEditingPreset(item)}
                onDelete={() => removePreset(item.id)}
                onApply={() => applyPreset(item)}
              />
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
                  <span className="block truncate text-sm text-neutral-800">{item.name}</span>
                  <span className="block text-[10px] text-neutral-400">{item.text.length} 字</span>
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

      {menu === 'folder' && (
        <Sheet title="新建文件夹" onClose={() => setMenu(null)}>
          <input
            autoFocus
            className={`${field} mb-2`}
            placeholder={area === 'tavern' ? '例如：星海宇宙' : '例如：长篇第一卷'}
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
          />
          <p className="mb-3 text-[10px] text-neutral-400">可以往里放：{allowed.map((a) => a.label).join('、')}</p>
          <button
            className="w-full rounded-xl bg-neutral-900 py-2.5 text-sm text-white"
            onClick={() => {
              createFolder(area as FolderArea, folderDraft)
              setFolderDraft('')
              setMenu(null)
            }}
          >
            创建
          </button>
        </Sheet>
      )}

      {menu === 'new' && currentFolder && (
        <Sheet title={`在「${currentFolder.name}」里新建`} onClose={() => setMenu(null)}>
          {FOLDER_CONTENTS[currentFolder.area].map((item) => (
            <button
              key={item.kind}
              className="mb-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm text-neutral-700"
              onClick={() => createNew(item.kind)}
            >
              {item.label}
            </button>
          ))}
        </Sheet>
      )}

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

          {editing.kind === 'character' && (
            <div className="mt-2 space-y-1.5">
              <button
                className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm text-neutral-700"
                onClick={async () => {
                  try {
                    importSetting(editing)
                    const png = buildPngCard(editing)
                    if (!png) {
                      alert('这张卡没有 PNG 头像，无法写回 PNG。请用 CHARX 或 JSON 导出。')
                      return
                    }
                    await platform().exportBinaryFile(pngCardFileName(editing.name), png, 'image/png')
                  } catch (e) {
                    alert(humanizeError(e))
                  }
                }}
              >
                导出为 PNG（SillyTavern 直接拖入）
              </button>
              <button
                className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm text-neutral-700"
                onClick={async () => {
                  try {
                    importSetting(editing)
                    await platform().exportBinaryFile(charxFileName(editing.name), buildCharx(editing), 'application/zip')
                  } catch (e) {
                    alert(humanizeError(e))
                  }
                }}
              >
                导出为 CHARX（V3 生态）
              </button>
            </div>
          )}

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
