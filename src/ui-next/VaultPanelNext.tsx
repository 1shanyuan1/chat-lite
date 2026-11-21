import { useMemo, useRef, useState } from 'react'
import { buildBundle, bundleFileName, collectBundleItems } from '@/chat/bundle-export'
import { buildCharx, charxFileName } from '@/chat/charx-export'
import { buildPngCard, pngCardFileName } from '@/chat/png-export'
import { FOLDER_CONTENTS, type FolderArea } from '@/chat/folders'
import { humanizeError } from '@/chat/errors'
import { platform } from '@/platform'
import { emptySetting, summaryOf, type DocKind, type SettingDoc } from '@/chat/settings'
import { formatSettingText, formattedDraft } from '@/chat/setting-format'
import {
  applySettingText,
  parseSettingText,
  renderSettingText,
  settingTextFileName,
} from '@/chat/setting-text'
import { applyMacros } from '@/chat/characters'
import { useApp } from '@/chat/store'
import type { PromptItem } from '@/chat/vault'
import { ChevronLeftIcon, PlusIcon } from '@/ui/icons'
import SheetNext from './SheetNext'
import { useImportFiles } from '@/ui/useImportFiles'

/*
 * 寄存区（实验版）。逻辑与正式版 VaultPanel 逐行对应，只换视觉层：
 * 5 档字阶（22/17/16/14/12）、灰度下限 neutral-500（-400 只做占位）、
 * 容器 2xl / 控件胶囊两族圆角、删除类固定红字。
 */

type Area = FolderArea | 'common'
type NewKind = DocKind | 'prompt'

const AREAS: Array<{ id: Area; label: string; hint: string }> = [
  { id: 'tavern', label: '酒馆', hint: '角色卡、世界书、提示词，按文件夹整理' },
  { id: 'writing', label: '写作', hint: '设定与提示词，按文件夹整理' },
  { id: 'common', label: '通用', hint: '未归入文件夹的提示词' },
]

/** 新建菜单里每种东西的一句话说明：只写「设定 / 提示词」太干，用户得知道它们是什么 */
const KIND_HINTS: Record<DocKind | 'prompt', string> = {
  setting: '正文 + 关键词条目，写作模式挂载',
  prompt: '可复用的系统提示词片段；不放进文件夹时在「通用」区',
  character: '角色卡：正文、开场白、世界书条目',
  world: '关键词触发的世界书，酒馆模式挂载',
}

/** 单行输入：胶囊；多行文本域：2xl 容器族 */
const field = 'w-full h-10 rounded-full border border-neutral-200 px-4 text-[14px] outline-none focus:border-neutral-500'
const fieldArea =
  'w-full rounded-2xl border border-neutral-200 px-4 py-2.5 text-[14px] outline-none focus:border-neutral-500'

const pill = 'inline-flex h-7 items-center rounded-full px-3 text-[12px]'
const pillOn = 'bg-neutral-900 text-white'
const pillOff = 'bg-neutral-100 text-neutral-600 active:bg-neutral-200'

/** AI 整理的额外要求：跟着这台设备记，下次打开还在 */
const FORMAT_INSTRUCTION_KEY = 'cl.formatInstruction'

/** 复制全文：WebView 里 clipboard 偶尔不可用，退回到临时 textarea */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/**
 * 一行简介。
 * 角色卡用正文第一段；世界书通常没有正文，就用前几条的关键词——不然列表里
 * 一列世界书长得一模一样，只剩名字和条数。
 *
 * 这里的 {{char}} / {{user}} 必须替换掉：卡里的描述几乎都写成「{{char}} is a…」，
 * 原样摆出来会像没解析成功。
 */
function docSummary(doc: SettingDoc, userName: string): string {
  const text = summaryOf(doc.body)
  if (text) return applyMacros(text, doc.name, userName)
  const keys = doc.entries
    .slice(0, 4)
    .map((entry) => entry.keys.slice(0, 2).join('/'))
    .filter(Boolean)
    .join(' · ')
  return keys.length > 110 ? `${keys.slice(0, 110)}…` : keys
}

function AreaTabs({ area, onPick }: { area: Area; onPick: (a: Area) => void }) {
  return (
    <div className="flex gap-1">
      {AREAS.map((a) => (
        <button
          key={a.id}
          className={`${pill} ${area === a.id ? pillOn : pillOff}`}
          onClick={() => onPick(a.id)}
          title={a.hint}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/**
 * 卡片自带的元信息：规范、标签、简介、作者、条目统计。
 * 编辑面板顶部先给一眼「这是张什么卡」，再往下才是可改的字段。
 */
function CardInfo({ doc }: { doc: SettingDoc }) {
  const userName = useApp((s) => s.config.userName) ?? '你'
  const spec = doc.spec?.includes('v3') ? 'V3 卡' : doc.spec?.includes('v2') ? 'V2 卡' : ''
  const openings = doc.firstMessage || (doc.greetings?.length ?? 0) > 0 ? 1 + (doc.greetings?.length ?? 0) : 0
  const constant = doc.entries.filter((entry) => entry.constant).length
  const summary = docSummary(doc, userName)
  const facts = [
    doc.creator ? `作者 ${doc.creator}` : '',
    doc.version ? `版本 ${doc.version}` : '',
    doc.entries.length > 0 ? `${doc.entries.length} 条条目${constant > 0 ? `（${constant} 条常驻）` : ''}` : '',
    openings > 0 ? `${openings} 段开场` : '',
    doc.body ? `${doc.body.length} 字正文` : '',
  ].filter(Boolean)

  if (!spec && !doc.tags?.length && !summary && facts.length === 0) return null

  return (
    <div className="mb-3 rounded-2xl bg-neutral-50 p-3">
      {(spec || doc.tags?.length) && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {spec && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[12px] text-neutral-600 ring-1 ring-neutral-200">
              {spec}
            </span>
          )}
          {doc.tags?.map((tag) => (
            <span key={tag} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-neutral-500 ring-1 ring-neutral-200">
              {tag}
            </span>
          ))}
        </div>
      )}
      {/* 世界书没有正文框可看，这里给一眼条目覆盖的主题；角色卡的正文就在下面，不重复 */}
      {doc.kind === 'world' && summary && <p className="line-clamp-3 text-[12px] leading-relaxed text-neutral-600">{summary}</p>}
      {facts.length > 0 && <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">{facts.join(' · ')}</p>}
      {doc.creatorNotes && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] text-neutral-500">作者备注</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-600">{doc.creatorNotes}</p>
        </details>
      )}
    </div>
  )
}

function DocRow({
  doc,
  readOnly,
  onEdit,
  onDelete,
}: {
  doc: SettingDoc
  readOnly?: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const userName = useApp((s) => s.config.userName) ?? '你'
  const openings = doc.firstMessage || (doc.greetings?.length ?? 0) > 0 ? 1 + (doc.greetings?.length ?? 0) : 0
  // 简介直接由正文现算：导入的老卡没有额外字段也能显示，改完正文立刻同步
  const summary = docSummary(doc, userName)
  const meta =
    [
      doc.derivedFrom ? '发展稿' : '',
      doc.entries.length > 0 ? `${doc.entries.length} 条条目` : '',
      openings > 0 ? `${openings} 段开场` : '',
      doc.body ? `${doc.body.length} 字正文` : '',
      doc.changelog?.length ? `${doc.changelog.length} 次改动` : '',
    ]
      .filter(Boolean)
      .join(' · ') || '空'

  return (
    <div className="flex items-center gap-2 border-b border-neutral-50 px-4 py-3">
      <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onEdit}>
        {doc.avatar ? (
          <img src={doc.avatar} alt={doc.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-[12px] text-neutral-500">
            {doc.name.slice(0, 1)}
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] text-neutral-800">{doc.name}</span>
            {doc.tags?.slice(0, 2).map((tag) => (
              <span key={tag} className="max-w-[4.5rem] shrink-0 truncate rounded-full bg-neutral-100 px-2 py-0.5 text-[12px] leading-tight text-neutral-500">
                {tag}
              </span>
            ))}
          </span>
          {/* 卡自带的简介：先看一行，够判断这是哪张卡；全文在详情里 */}
          {summary && <span className="mt-0.5 line-clamp-1 block text-[12px] leading-relaxed text-neutral-500">{summary}</span>}
          <span className="mt-0.5 block truncate text-[12px] text-neutral-500">{meta}</span>
        </span>
      </button>
      <button className="shrink-0 text-[12px] text-red-600 active:opacity-70 disabled:opacity-30" disabled={readOnly} onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

function PromptRow({
  item,
  active,
  disabled,
  onEdit,
  onDelete,
  onApply,
}: {
  item: PromptItem
  active: boolean
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
  onApply: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-neutral-50 px-4 py-3">
      <button className="min-w-0 flex-1 text-left" onClick={onEdit}>
        <span className="block truncate text-[14px] text-neutral-800">{item.name}</span>
        <span className="block text-[12px] text-neutral-500">{item.text.length} 字</span>
      </button>
      <button className={`${pill} shrink-0 ${active ? pillOff : pillOn} disabled:opacity-40`} disabled={disabled} onClick={onApply}>
        {active ? '取消' : '应用'}
      </button>
      <button className="shrink-0 text-[12px] text-red-600 active:opacity-70" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

/** 列表分组头：12px 辅助灰，带「新建」动作。模块级——内联组件会随父重渲染整棵重挂载 */
function GroupHead({ label, onNew }: { label: string; onNew?: () => void }) {
  return (
    <div className="flex items-center justify-between bg-neutral-50 px-4 py-1.5">
      <span className="text-[12px] text-neutral-500">{label}</span>
      {onNew && (
        <button className="text-[12px] text-blue-600" onClick={onNew}>
          新建
        </button>
      )}
    </div>
  )
}

export default function VaultPanelNext() {
  const store = useApp()
  const {
    prompts,
    sessions,
    currentId,
    folders,
    importSetting,
    removeSetting,
    savePrompt,
    removePrompt,
    applyPrompt,
    createFolder,
    renameFolder,
    removeFolder,
  } = store
  // 演示数据：只看不改。写操作全部挡掉，免得把演示卡存进真实寄存区
  const preview = store.settingsPreview
  const settings = preview ?? store.settings
  const readOnly = Boolean(preview)

  const [area, setArea] = useState<Area>('tavern')
  const [folderId, setFolderId] = useState<string | null>(null)
  const { importFiles, busy, error, fileRef } = useImportFiles({
    textAs: area === 'writing' ? 'setting' : 'prompt',
  })

  const [editing, setEditing] = useState<SettingDoc | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<PromptItem | null>(null)
  const [menu, setMenu] = useState<'new' | 'folder' | null>(null)
  const [folderDraft, setFolderDraft] = useState('')
  const [exporting, setExporting] = useState(false)
  /** 设定/世界书的编辑方式：整篇文本（默认）或逐条结构 */
  const [textMode, setTextMode] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  /** 粘贴导入时让模型拆成正文 + 条目 */
  const [aiFormat, setAiFormat] = useState(false)
  const [formatting, setFormatting] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  /** 用户自己写的整理要求，作为系统提示词的最后一段（最高优先级） */
  const [formatInstruction, setFormatInstruction] = useState(() => {
    try {
      return localStorage.getItem(FORMAT_INSTRUCTION_KEY) ?? ''
    } catch {
      return ''
    }
  })
  /** 当前打开的是 AI 整理出来的草稿，还没落库 */
  const [aiDraft, setAiDraft] = useState(false)
  /** 当前打开的是「新建」产生、尚未落库的草稿 */
  const [newDraft, setNewDraft] = useState(false)
  const formatController = useRef<AbortController | null>(null)
  const pasteFileRef = useRef<HTMLInputElement>(null)

  /** 打开详情：写作设定默认落在整篇文本；角色卡和世界书仍走结构表单 */
  const openDoc = (doc: SettingDoc) => {
    setEditing(doc)
    setTextMode(doc.kind === 'setting')
    setTextDraft(renderSettingText(doc))
    setAiDraft(false)
    setNewDraft(false)
  }

  const openPaste = () => {
    setFormatError(null)
    setPasteOpen(true)
  }

  const updateFormatInstruction = (value: string) => {
    setFormatInstruction(value)
    try {
      localStorage.setItem(FORMAT_INSTRUCTION_KEY, value)
    } catch {
      /* 配额不够就只留在内存里，不影响这次整理 */
    }
  }

  /** 从文件读进粘贴框：这样「导入 .txt + AI 整理」和直接粘贴走同一条路 */
  const loadPasteFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setPasteText(await file.text())
      if (!pasteName.trim()) setPasteName(file.name.replace(/\.[^.]+$/, ''))
      setFormatError(null)
    } catch (e) {
      setFormatError(humanizeError(e))
    }
  }

  const currentFolder = folders.find((f) => f.id === folderId)
  const currentSession = sessions.find((s) => s.id === currentId)
  const areaFolders = folders.filter((f) => f.area === area)
  const allowed = area === 'common' ? [] : FOLDER_CONTENTS[area]
  /** 新建菜单：文件夹里按文件夹的类型，顶层按当前分区；两处共用一份逻辑 */
  const newKinds = currentFolder ? FOLDER_CONTENTS[currentFolder.area] : allowed

  const docsOf = (kind: DocKind) =>
    settings.filter((d) => d.kind === kind && (folderId ? d.folderId === folderId : !d.folderId))
  const promptsOf = () => prompts.filter((p) => (folderId ? p.folderId === folderId : !p.folderId))
  const countInFolder = (id: string) =>
    settings.filter((d) => d.folderId === id).length + prompts.filter((p) => p.folderId === id).length

  const createNew = (kind: NewKind) => {
    setMenu(null)
    if (kind === 'prompt') {
      setEditingPrompt({
        id: crypto.randomUUID(),
        folderId: folderId ?? undefined,
        name: '',
        text: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return
    }
    const doc = emptySetting(kind)
    doc.folderId = folderId ?? undefined
    doc.name = kind === 'character' ? '新角色' : kind === 'world' ? '新世界书' : '新设定'
    openDoc(doc)
  }

  /** 文本里识别出来的条目数、正文长度；只在文本模式下算 */
  const parsedText = useMemo(
    () => (editing && textMode ? parseSettingText(textDraft, editing) : null),
    [editing, textMode, textDraft]
  )

  const showText = () => {
    if (!editing || textMode) return
    setTextDraft(renderSettingText(editing))
    setTextMode(true)
  }

  /** 切回结构表单前先把文本解析一遍，免得用户以为改了、其实没带上 */
  const showStructure = () => {
    if (!editing || !textMode) return
    setEditing(applySettingText(textDraft, editing).doc)
    setTextMode(false)
  }

  const saveEditing = () => {
    if (!editing) return
    if (textMode) {
      const { doc, stats } = applySettingText(textDraft, editing)
      if (
        stats.lockedRemoved > 0 &&
        !confirm(`有 ${stats.lockedRemoved} 条锁定条目会随这次保存被删掉，继续？`)
      ) {
        return
      }
      importSetting(doc)
    } else {
      importSetting(editing)
    }
    // 新建 / AI 草稿存下来之后，把输入框里的原文清掉，避免下次打开还留着上一份
    if (aiDraft || newDraft) {
      setPasteName('')
      setPasteText('')
    }
    setEditing(null)
    setTextMode(false)
    setAiDraft(false)
    setNewDraft(false)
  }

  /** 导出当前文本（含还没保存的修改），手机上走系统分享 */
  const exportText = async () => {
    if (!editing) return
    const text = textMode ? textDraft : renderSettingText(editing)
    try {
      await platform().exportTextFile(settingTextFileName(editing.name), `${text}\n`, 'text/plain;charset=utf-8')
    } catch (e) {
      alert(humanizeError(e))
    }
  }

  const copyDocText = async () => {
    if (!editing) return
    const text = textMode ? textDraft : renderSettingText(editing)
    if (!(await copyText(text))) alert('复制失败，可以改用「导出 .txt」')
  }

  /**
   * AI 整理：把这一大篇交给模型拆成正文 + 条目，结果只做成草稿打开，
   * 用户点「保存」才写进寄存区。整理失败/取消时原文仍留在粘贴框里。
   */
  const runAiFormat = async (text: string, name: string) => {
    setFormatting(true)
    setFormatError(null)
    const controller = new AbortController()
    formatController.current = controller
    try {
      const formatted = await formatSettingText(
        text,
        useApp.getState().config,
        controller.signal,
        name,
        formatInstruction
      )
      const base = emptySetting('setting')
      base.folderId = folderId ?? undefined
      const doc = formattedDraft(formatted, base, name)
      setPasteOpen(false)
      setAiDraft(true)
      setNewDraft(true)
      setEditing(doc)
      setTextMode(true)
      setTextDraft(formatted)
    } catch (e) {
      if (controller.signal.aborted) return
      setFormatError(humanizeError(e))
    } finally {
      setFormatting(false)
      formatController.current = null
    }
  }

  const submitPaste = () => {
    const text = pasteText.trim()
    if (aiFormat && text) {
      void runAiFormat(text, pasteName.trim())
      return
    }

    // 空白新建 / 直接新建：都先做成草稿，点保存才落库
    const base = emptySetting('setting')
    base.folderId = folderId ?? undefined
    base.name = pasteName.trim() || '新设定'
    const doc = text ? applySettingText(text, base).doc : base
    // 用户手填的名字优先于文本里的【设定：…】
    if (pasteName.trim()) doc.name = pasteName.trim()

    setPasteOpen(false)
    setAiDraft(false)
    setNewDraft(true)
    setEditing(doc)
    setTextMode(true)
    setTextDraft(renderSettingText(doc))
  }

  const onExport = async () => {
    if (!currentFolder) return
    const folderDocs = settings.filter((d) => d.folderId === currentFolder.id)
    const folderPrompts = prompts.filter((p) => p.folderId === currentFolder.id)
    if (folderDocs.length === 0 && folderPrompts.length === 0) return
    setExporting(true)
    try {
      const items = collectBundleItems(folderDocs, folderPrompts)
      await platform().exportBinaryFile(bundleFileName(currentFolder.name), buildBundle(currentFolder.name, items))
    } catch (e) {
      alert(humanizeError(e))
    } finally {
      setExporting(false)
    }
  }

  /** 在文件夹里导入的内容直接归到这个文件夹，不用导完再挪 */
  const onImport = (files: FileList | null) => void importFiles(files, folderId ?? undefined)

  const renderArea = (withEmpty = false) =>
    allowed.map(({ kind, label }) => {
      if (kind === 'prompt') {
        // 提示词只在文件夹里成组出现；未分类的统一落在「通用」区
        if (!folderId) return null
        const list = promptsOf()
        if (!withEmpty && list.length === 0) return null
        return (
          <div key="prompt">
            <GroupHead label={`${label} · ${list.length}`} onNew={() => createNew('prompt')} />
            {list.length === 0 && <p className="px-4 py-3 text-center text-[12px] text-neutral-400">空</p>}
            {list.map((item) => (
              <PromptRow
                key={item.id}
                item={item}
                active={currentSession?.promptId === item.id}
                disabled={!currentId}
                onEdit={() => setEditingPrompt(item)}
                onDelete={() => removePrompt(item.id)}
                onApply={() => void applyPrompt(item)}
              />
            ))}
          </div>
        )
      }
      const list = docsOf(kind)
      if (!withEmpty && list.length === 0) return null
      return (
        <div key={kind}>
          <GroupHead label={`${label} · ${list.length}`} />
          {list.length === 0 && <p className="px-4 py-3 text-center text-[12px] text-neutral-400">空</p>}
          {list.map((doc) => (
            <DocRow
              key={doc.id}
              doc={doc}
              readOnly={readOnly}
              onEdit={() => openDoc(doc)}
              onDelete={() => removeSetting(doc.id)}
            />
          ))}
        </div>
      )
    })

  const emptyArea =
    !currentFolder &&
    area !== 'common' &&
    areaFolders.length === 0 &&
    docsOf('character').length === 0 &&
    docsOf('world').length === 0 &&
    docsOf('setting').length === 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pb-2 pt-1">
        {currentFolder ? (
          <button className="flex min-w-0 items-center gap-1 text-[14px] text-neutral-700" onClick={() => setFolderId(null)}>
            <ChevronLeftIcon />
            <span className="truncate">{currentFolder.name}</span>
          </button>
        ) : (
          <AreaTabs
            area={area}
            onPick={(a) => {
              setArea(a)
              setFolderId(null)
            }}
          />
        )}

        {currentFolder ? (
          <div className="flex gap-1.5">
            <button
              className={`${pill} border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40`}
              disabled={busy || readOnly}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={12} />
              {busy ? '…' : '导入'}
            </button>
            <button
              className={`${pill} border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40`}
              disabled={exporting || countInFolder(currentFolder.id) === 0}
              onClick={() => void onExport()}
            >
              {exporting ? '打包中…' : '导出'}
            </button>
            <button className={`${pill} ${pillOn} disabled:opacity-40`} disabled={readOnly} onClick={() => setMenu('new')}>
              新建
            </button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            {area !== 'common' && (
              <button
                className={`${pill} border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40`}
                disabled={readOnly}
                onClick={() => setMenu('folder')}
              >
                <PlusIcon size={12} />
                文件夹
              </button>
            )}
            <button
              className={`${pill} border border-neutral-200 bg-white text-neutral-600 disabled:opacity-40`}
              disabled={busy || readOnly}
              onClick={() => fileRef.current?.click()}
            >
              <PlusIcon size={12} />
              {busy ? '…' : '导入'}
            </button>
            {area === 'writing' && (
              <button className={`${pill} ${pillOn} disabled:opacity-40`} disabled={readOnly} onClick={() => setMenu('new')}>
                新建
              </button>
            )}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".png,.json,.txt,.pdf,.docx,.xlsx,.pptx,.charx,.zip,application/json,image/png,text/plain,application/zip"
          multiple
          className="hidden"
          onChange={(e) => void onImport(e.target.files)}
        />
      </div>

      <p className="px-4 pb-2 text-[12px] text-neutral-500">
        {currentFolder
          ? `${currentFolder.name} · ${countInFolder(currentFolder.id)} 项`
          : (AREAS.find((a) => a.id === area)?.hint ?? '')}
      </p>
      {readOnly && (
        <p className="mx-4 mb-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
          演示数据：元信息取自真实 V2 卡（正文已换成中性示例）。这里只能看，改动和删除都不会保存。
        </p>
      )}
      {error && <p className="px-4 pb-2 text-[12px] text-red-600">{error}</p>}

      <div className="flex-1 overflow-y-auto">
        {!currentFolder && area !== 'common' && (
          <>
            {areaFolders.map((folder) => (
              <div key={folder.id} className="flex items-center gap-2 border-b border-neutral-50 px-4 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setFolderId(folder.id)}>
                  <span className="block truncate text-[14px] text-neutral-800">{folder.name}</span>
                  <span className="block text-[12px] text-neutral-500">{countInFolder(folder.id)} 项</span>
                </button>
                <button
                  className="shrink-0 text-[12px] text-neutral-500"
                  onClick={() => {
                    const name = prompt('文件夹名称', folder.name)
                    if (name !== null) renameFolder(folder.id, name)
                  }}
                >
                  改名
                </button>
                <button className="shrink-0 text-[12px] text-red-600 active:opacity-70" onClick={() => removeFolder(folder.id)}>
                  删除
                </button>
              </div>
            ))}

            {renderArea()}

            {emptyArea && (
              <p className="px-4 py-8 text-center text-[12px] leading-relaxed text-neutral-500">
                还没有内容
                <br />
                先建个文件夹，或直接导入
              </p>
            )}
          </>
        )}

        {currentFolder && <>{renderArea(true)}</>}

        {area === 'common' && !currentFolder && (
          <>
            <GroupHead label={`提示词 · ${promptsOf().length}`} onNew={() => createNew('prompt')} />
            {promptsOf().length === 0 && (
              <p className="px-4 py-4 text-center text-[12px] text-neutral-500">还没有未归类的提示词</p>
            )}
            {promptsOf().map((item) => (
              <PromptRow
                key={item.id}
                item={item}
                active={currentSession?.promptId === item.id}
                disabled={!currentId}
                onEdit={() => setEditingPrompt(item)}
                onDelete={() => removePrompt(item.id)}
                onApply={() => void applyPrompt(item)}
              />
            ))}
          </>
        )}
      </div>

      {menu === 'folder' && (
        <SheetNext title="新建文件夹" onClose={() => setMenu(null)}>
          <input
            autoFocus
            className={`${field} mb-2`}
            placeholder={area === 'tavern' ? '例如：星海宇宙' : '例如：长篇第一卷'}
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
          />
          <p className="mb-3 text-[12px] text-neutral-500">可以往里放：{allowed.map((a) => a.label).join('、')}</p>
          <button
            className="h-11 w-full rounded-full bg-neutral-900 text-[14px] text-white"
            onClick={() => {
              createFolder(area as FolderArea, folderDraft)
              setFolderDraft('')
              setMenu(null)
            }}
          >
            创建
          </button>
        </SheetNext>
      )}

      {menu === 'new' && (
        <SheetNext title={currentFolder ? `在「${currentFolder.name}」里新建` : '新建'} onClose={() => setMenu(null)}>
          {newKinds.map((item) => (
            <button
              key={item.kind}
              className="mb-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-left active:bg-neutral-50"
              onClick={() => {
                // 设定走「新建」面板：可以空白建、粘贴、读文件或让 AI 整理
                if (item.kind === 'setting') {
                  setMenu(null)
                  openPaste()
                  return
                }
                createNew(item.kind)
              }}
            >
              <span className="block text-[14px] text-neutral-800">{item.label}</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">{KIND_HINTS[item.kind]}</span>
            </button>
          ))}
        </SheetNext>
      )}

      {editing && (
        <SheetNext
          title={editing.kind === 'character' ? '角色卡' : editing.kind === 'world' ? '世界书' : '设定'}
          onClose={() => {
            setEditing(null)
            setTextMode(false)
            setAiDraft(false)
            setNewDraft(false)
          }}
        >
          {editing.kind === 'setting' && (
            <div className="mb-3 flex rounded-full bg-neutral-100 p-1">
              <button
                className={`flex-1 rounded-full py-1.5 text-[12px] transition-colors ${
                  textMode ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
                onClick={showText}
              >
                整篇文本
              </button>
              <button
                className={`flex-1 rounded-full py-1.5 text-[12px] transition-colors ${
                  !textMode ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
                onClick={showStructure}
              >
                结构编辑
              </button>
            </div>
          )}

          {textMode ? (
            <>
              {aiDraft && (
                <p className="mb-2 rounded-2xl bg-emerald-50 px-3 py-2 text-[12px] leading-relaxed text-emerald-700">
                  AI 整理结果，还没保存。确认无误后点下面的「保存」；不满意可以直接改，或关掉重来。
                </p>
              )}
              <textarea
                className={`${fieldArea} h-[46vh] min-h-[240px] resize-none leading-relaxed`}
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder={
                  '【设定：名字】\n\n正文写在这里，每一轮都会带给模型。\n\n【条目：关键词, 关键词】\n写到这些词时才注入的内容。'
                }
                spellCheck={false}
              />
              <div className="mt-2 flex items-center justify-between text-[12px] text-neutral-500">
                <span>
                  正文 {parsedText?.stats.bodyChars ?? 0} 字 · 条目 {parsedText?.stats.entries ?? 0} 条
                </span>
                {parsedText &&
                  editing.entries.length > 0 &&
                  (parsedText.stats.added > 0 || parsedText.stats.removed > 0) && (
                    <span>
                      新增 {parsedText.stats.added} · 删除 {parsedText.stats.removed}
                    </span>
                  )}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
                【条目：关键词】开头的一段会成为条目；没有标记就整篇都是正文。名字写在第一行【设定：…】里。
              </p>
              {parsedText && parsedText.stats.lockedRemoved > 0 && (
                <p className="mt-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
                  有 {parsedText.stats.lockedRemoved} 条锁定条目不在文本里，保存后会被删掉。
                </p>
              )}
            </>
          ) : (
            <>
              <input
                className={`${field} mb-3`}
                placeholder="名字"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />

              <CardInfo doc={editing} />

              {editing.kind !== 'world' && (
                <>
                  <label className="mb-1.5 block text-[12px] text-neutral-500">
                    {editing.kind === 'character' ? '设定正文（角色描述、性格、情境）' : '设定正文'}
                  </label>
                  <textarea
                    className={`${fieldArea} mb-3 h-40 resize-none`}
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  />
                </>
              )}

              {editing.kind === 'character' && (
                <>
                  <label className="mb-1.5 block text-[12px] text-neutral-500">开场白（有则开新会话时插入）</label>
                  <textarea
                    className={`${fieldArea} mb-3 h-20 resize-none`}
                    value={editing.firstMessage ?? ''}
                    onChange={(e) => setEditing({ ...editing, firstMessage: e.target.value })}
                  />

                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-neutral-500">备选开场（{(editing.greetings ?? []).length}）</span>
                    <button
                      className="text-[12px] text-blue-600"
                      onClick={() => setEditing({ ...editing, greetings: [...(editing.greetings ?? []), ''] })}
                    >
                      ＋ 加一段
                    </button>
                  </div>
                  {(editing.greetings ?? []).map((text, i) => (
                    <div key={i} className="mb-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[12px] text-neutral-500">第 {i + 2} 段</span>
                        <button
                          className="text-[12px] text-neutral-500 active:text-red-600"
                          onClick={() =>
                            setEditing({
                              ...editing,
                              greetings: (editing.greetings ?? []).filter((_, k) => k !== i),
                            })
                          }
                        >
                          删除
                        </button>
                      </div>
                      <textarea
                        className={`${fieldArea} h-16 resize-none`}
                        placeholder="另一段开场；聊天页的「换开场」里能选到"
                        value={text}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            greetings: (editing.greetings ?? []).map((g, k) => (k === i ? e.target.value : g)),
                          })
                        }
                      />
                    </div>
                  ))}

                  <label className="mb-1.5 mt-2 block text-[12px] text-neutral-500">后置指令（贴在历史末尾，权重更高）</label>
                  <textarea
                    className={`${fieldArea} mb-3 h-16 resize-none`}
                    placeholder="每轮都追加的提醒，比如「保持第三人称」「不要替用户做决定」"
                    value={editing.postHistory ?? ''}
                    onChange={(e) => setEditing({ ...editing, postHistory: e.target.value || undefined })}
                  />
                </>
              )}

              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">关键词条目（{editing.entries.length}）</span>
                <button
                  className="text-[12px] text-blue-600"
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
                <div key={entry.id} className="mb-2 rounded-2xl border border-neutral-200 p-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1 text-[12px] text-neutral-500">
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
                      <label className="flex items-center gap-1 text-[12px] text-neutral-500">
                        <input
                          type="checkbox"
                          checked={Boolean(entry.locked)}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              entries: editing.entries.map((x) =>
                                x.id === entry.id ? { ...x, locked: e.target.checked || undefined } : x
                              ),
                            })
                          }
                        />
                        锁定
                      </label>
                      <label className="flex items-center gap-1 text-[12px] text-neutral-500">
                        <input
                          type="checkbox"
                          checked={Boolean(entry.constant)}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              entries: editing.entries.map((x) =>
                                x.id === entry.id ? { ...x, constant: e.target.checked || undefined } : x
                              ),
                            })
                          }
                        />
                        常驻
                      </label>
                    </div>
                    <button
                      className="text-[12px] text-red-600 active:opacity-70"
                      onClick={() => setEditing({ ...editing, entries: editing.entries.filter((x) => x.id !== entry.id) })}
                    >
                      删除
                    </button>
                  </div>
                  <input
                    className={`${field} mb-1.5`}
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
                  <input
                    className={`${field} mb-1.5`}
                    placeholder="二级关键词（可选）：主键和它都命中才注入"
                    value={(entry.secondaryKeys ?? []).join(', ')}
                    onChange={(e) => {
                      const secondaryKeys = e.target.value.split(',').map((k) => k.trim()).filter(Boolean)
                      setEditing({
                        ...editing,
                        entries: editing.entries.map((x) =>
                          x.id === entry.id
                            ? { ...x, secondaryKeys: secondaryKeys.length ? secondaryKeys : undefined }
                            : x
                        ),
                      })
                    }}
                  />
                  <textarea
                    className={`${fieldArea} h-16 resize-none`}
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

              {editing.changelog?.length ? (
                <div className="mb-3 mt-3 rounded-2xl bg-neutral-50 p-3">
                  <div className="mb-1.5 text-[12px] text-neutral-500">设定变更（{editing.changelog.length}）</div>
                  <div className="space-y-1.5">
                    {editing.changelog.map((item, i) => (
                      <div key={i} className="text-[12px] leading-relaxed text-neutral-500">
                        <span className="tabular-nums text-neutral-400">第 {item.turn + 1} 轮</span>
                        {item.note ? ` · ${item.note}` : ''}
                        <div className="mt-0.5 text-neutral-500">{item.changes.join('；')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {editing.kind === 'character' && (
            <div className={`mt-3 space-y-2 ${readOnly ? 'pointer-events-none opacity-40' : ''}`}>
              <button
                className="h-11 w-full rounded-full border border-neutral-200 text-[14px] text-neutral-700"
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
                className="h-11 w-full rounded-full border border-neutral-200 text-[14px] text-neutral-700"
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

          {editing.kind === 'setting' && (
            <div className="mt-3 flex gap-2">
              <button className="h-11 flex-1 rounded-full border border-neutral-200 text-[14px] text-neutral-700" onClick={() => void exportText()}>
                导出 .txt
              </button>
              <button className="h-11 flex-1 rounded-full border border-neutral-200 text-[14px] text-neutral-700" onClick={() => void copyDocText()}>
                复制全文
              </button>
            </div>
          )}

          <button
            className="mt-3 h-11 w-full rounded-full bg-neutral-900 text-[14px] text-white disabled:opacity-40"
            disabled={readOnly}
            onClick={saveEditing}
          >
            {readOnly ? '演示数据不可保存' : '保存'}
          </button>
        </SheetNext>
      )}

      {pasteOpen && (
        <SheetNext
          title="新建设定"
          onClose={() => {
            formatController.current?.abort()
            setPasteOpen(false)
          }}
        >
          <p className="mb-2 text-[12px] text-neutral-500">
            {folderId
              ? `保存到「${folders.find((f) => f.id === folderId)?.name ?? '文件夹'}」`
              : '不放进文件夹，留在写作区顶层'}
          </p>
          <input
            className={`${field} mb-2`}
            placeholder="名字（可省略；不填就叫「新设定」）"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
            disabled={formatting}
          />
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">可以直接写，也可以粘贴或从文件读取 .txt / .md</span>
            <button className="text-[12px] text-blue-600 disabled:opacity-40" disabled={formatting} onClick={() => pasteFileRef.current?.click()}>
              从文件读取
            </button>
            <input
              ref={pasteFileRef}
              type="file"
              accept=".txt,.md,.docx,.pdf,.xlsx,.pptx,text/plain,text/markdown"
              className="hidden"
              onChange={(e) => {
                void loadPasteFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
          <textarea
            className={`${fieldArea} mb-2 h-56 resize-none leading-relaxed`}
            placeholder={
              '可以直接开始写；也可以把一大篇现成设定粘进来。\n\n不需要任何标记。只有【条目：关键词】开头的一段会变成关键词条目，其余都是正文。'
            }
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value)
              // 改了内容，上一次整理失败的错误就不再相关
              if (formatError) setFormatError(null)
            }}
            spellCheck={false}
            disabled={formatting}
          />

          {pasteText.trim() && (
            <label className="mb-2 flex items-start gap-2 rounded-2xl border border-neutral-200 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-1"
                checked={aiFormat}
                disabled={formatting}
                onChange={(e) => {
                  setAiFormat(e.target.checked)
                  setFormatError(null)
                }}
              />
              <span className="min-w-0">
                <span className="block text-[14px] text-neutral-800">让 AI 整理成条目</span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">
                  {`把这一大篇拆成常驻正文 + 关键词条目；先给你预览，保存才写入。用当前模型${
                    store.config.model ? `（${store.config.model}）` : ''
                  }整理，不写入对话记录。长文可能要几十秒。`}
                </span>
              </span>
            </label>
          )}

          {aiFormat && pasteText.trim() && (
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">前置说明（可选，放在最前；会记住）</span>
                {formatInstruction.trim() && (
                  <button className="text-[12px] text-neutral-500" disabled={formatting} onClick={() => updateFormatInstruction('')}>
                    清空
                  </button>
                )}
              </div>
              <textarea
                className={`${fieldArea} h-16 resize-none text-[12px] leading-relaxed`}
                placeholder="例如：这是一份冷峻的悬疑小说设定，读者是成年人；保留原文语气，角色的立场不要做道德评判。"
                value={formatInstruction}
                onChange={(e) => updateFormatInstruction(e.target.value)}
                disabled={formatting}
                spellCheck={false}
              />
              <p className="mt-1.5 text-[12px] leading-relaxed text-neutral-500">
                先交代这份设定是什么、给谁用、语气和边界；它排在所有整理规则之前。【设定：】/【条目：】的标记格式仍不可改。
              </p>
            </div>
          )}

          {formatError && (
            <p className="mb-2 rounded-2xl bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-600">{formatError}</p>
          )}

          <p className="mb-2 text-[12px] leading-relaxed text-neutral-500">
            {aiFormat && pasteText.trim()
              ? '整理结果会打开在文本编辑器里，不会立刻落库；确认后点「保存」。'
              : pasteText.trim()
                ? '会打开文本编辑器，点「保存」才写进寄存区。'
                : '创建后会打开文本编辑器，点「保存」才写进寄存区。'}
          </p>

          <div className="flex gap-2">
            {formatting && (
              <button
                className="h-11 flex-1 rounded-full border border-neutral-200 text-[14px] text-neutral-600"
                onClick={() => formatController.current?.abort()}
              >
                取消
              </button>
            )}
            <button
              className="h-11 flex-1 rounded-full bg-neutral-900 text-[14px] text-white disabled:opacity-40"
              disabled={formatting}
              onClick={submitPaste}
            >
              {formatting
                ? '正在整理…'
                : aiFormat && pasteText.trim()
                  ? 'AI 整理（先预览）'
                  : pasteText.trim()
                    ? '新建并编辑'
                    : '新建空白设定'}
            </button>
          </div>
        </SheetNext>
      )}

      {editingPrompt && (
        <SheetNext title="提示词" onClose={() => setEditingPrompt(null)}>
          <p className="mb-2 text-[12px] text-neutral-500">
            {editingPrompt.folderId
              ? `在「${folders.find((f) => f.id === editingPrompt.folderId)?.name ?? '文件夹'}」里`
              : '不放进文件夹，会出现在「通用」区'}
          </p>
          <input
            className={`${field} mb-3`}
            placeholder="名字"
            value={editingPrompt.name}
            onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
          />
          <textarea
            className={`${fieldArea} mb-3 h-40 resize-none`}
            value={editingPrompt.text}
            onChange={(e) => setEditingPrompt({ ...editingPrompt, text: e.target.value })}
          />
          <button
            className="h-11 w-full rounded-full bg-neutral-900 text-[14px] text-white"
            onClick={() => {
              savePrompt(editingPrompt)
              setEditingPrompt(null)
            }}
          >
            保存
          </button>
        </SheetNext>
      )}
    </div>
  )
}
