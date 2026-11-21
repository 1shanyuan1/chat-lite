import { useEffect, useMemo, useRef, useState } from 'react'
import { exportFilename, sessionToMarkdown } from '@/chat/export'
import { humanizeError } from '@/chat/errors'
import { matchSessions } from '@/chat/session-search'
import { useApp } from '@/chat/store'
import { formatPercent, formatTokens, hitRate, isCacheEstimated, missTokens, sumUsage } from '@/chat/tokens'
import { activeVariant, type ChatTurn, type SearchHit, type Session } from '@/db'
import { getRepo } from '@/db/runtime'
import { platform } from '@/platform'
import VaultPanel from './VaultPanel'
import { CloseIcon, DownloadIcon, PlusIcon, SearchIcon } from './icons'

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-amber-200/80 text-inherit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

function UsageCard({ turns }: { turns: ChatTurn[] }) {
  const total = sumUsage(turns.map((t) => activeVariant(t).assistant?.usage))
  if (turns.length === 0) return null
  return (
    <div className="border-b border-neutral-100 px-4 py-3">
      <div className="mb-1 text-[10px] text-neutral-400">当前会话用量 · {turns.length} 轮</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        <span>输入 {formatTokens(total.input)}</span>
        <span>输出 {formatTokens(total.output)}</span>
        <span>
          缓存命中 {isCacheEstimated(total) ? '≈' : ''}
          {formatTokens(total.cacheRead)}
        </span>
        <span>未命中 {formatTokens(missTokens(total))}</span>
        <span className="col-span-2 text-neutral-400">
          平均命中率 {isCacheEstimated(total) ? '≈' : ''}
          {formatPercent(hitRate(total))}
          {isCacheEstimated(total) ? ' · 命中为估算' : total.estimated ? ' · 含估算' : ''}
        </span>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  active,
  query,
  snippet,
  hits,
  onOpen,
  onDelete,
  onRename,
}: {
  session: Session
  active: boolean
  query: string
  snippet?: string
  hits: number
  onOpen: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(session.title)
  // Enter 和失焦都会触发提交，用 ref 防止重复
  const doneRef = useRef(false)

  const start = () => {
    setText(session.title)
    doneRef.current = false
    setEditing(true)
  }
  const commit = () => {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const next = text.trim()
    if (next && next !== session.title) onRename(next)
  }
  const cancel = () => {
    doneRef.current = true
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="px-4 py-2.5">
        <input
          autoFocus
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-neutral-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
        />
        <div className="mt-1 text-[10px] text-neutral-400">回车保存，Esc 取消</div>
      </div>
    )
  }

  return (
    <div className={`px-4 py-2.5 ${active ? 'bg-neutral-100' : ''}`}>
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <div className="truncate text-sm text-neutral-800">
            <Highlight text={session.title} query={query} />
          </div>
          {snippet && (
            <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-neutral-400">
              <Highlight text={snippet} query={query} />
            </div>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          {hits > 1 && <span className="text-[10px] text-neutral-300">{hits} 处</span>}
          <button className="text-[11px] text-neutral-400 active:text-neutral-700" onClick={start}>
            改名
          </button>
          <button className="text-[11px] text-neutral-400 active:text-red-500" onClick={onDelete}>
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SessionDrawer() {
  const {
    sessions,
    currentId,
    turns,
    drawerOpen,
    drawerTab,
    setDrawer,
    setDrawerTab,
    selectSession,
    deleteSession,
    renameSession,
    newSession,
    openSearchHit,
    error,
  } = useApp()
  const [query, setQuery] = useState('')
  const [contentHits, setContentHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  // tab 放在 store 里：演示壳要能一进来就落在「寄存区」
  const tab = drawerTab
  const setTab = setDrawerTab

  const q = query.trim().toLowerCase()

  useEffect(() => {
    if (!drawerOpen) {
      setQuery('')
      setContentHits([])
    }
  }, [drawerOpen])

  useEffect(() => {
    if (!q) {
      setContentHits([])
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        setContentHits(await getRepo().search(q, 200))
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [q])

  const { byTitle, byContent, hitCount, hitSnippet } = useMemo(
    () => matchSessions(sessions, contentHits, query),
    [sessions, contentHits, query]
  )

  if (!drawerOpen) return null

  const current = sessions.find((s) => s.id === currentId)
  const searching_ = Boolean(q)
  const empty = searching_ ? byTitle.length === 0 && byContent.length === 0 : sessions.length === 0

  const onExport = async () => {
    if (!current) return
    try {
      await platform().exportTextFile(exportFilename(current.title), sessionToMarkdown(current, turns))
    } catch (e) {
      alert(humanizeError(e))
    }
  }

  // 有关键词时进会话即进入命中浏览，没有关键词就是普通打开
  const openSession = (id: string) => {
    if (q) void openSearchHit(id, query.trim())
    else void selectSession(id)
  }

  return (
    <div className="absolute inset-0 z-30 flex">
      <div className="absolute inset-0 bg-black/25" onClick={() => setDrawer(false)} />
      <aside className="relative flex h-full w-[82%] max-w-[340px] flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 pt-[max(12px,env(safe-area-inset-top))] pb-1">
          <div className="flex gap-1">
            {(
              [
                ['chats', '会话'],
                ['chars', '寄存区'],
              ] as Array<['chats' | 'chars', string]>
            ).map(([key, label]) => (
              <button
                key={key}
                className={`rounded-lg px-2 py-1 text-sm ${
                  tab === key ? 'bg-neutral-100 font-medium text-neutral-900' : 'text-neutral-400'
                }`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'chats' && (
            <button
              className="flex items-center gap-1 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs text-white"
              onClick={newSession}
            >
              <PlusIcon />
              新对话
            </button>
          )}
        </div>

        {tab === 'chars' && <VaultPanel />}

        {tab === 'chats' && (
          <>

        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-2.5 py-1.5">
            <SearchIcon className="shrink-0 text-neutral-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
              placeholder="搜索标题或消息内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="shrink-0 text-neutral-400" onClick={() => setQuery('')} aria-label="清空">
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        {!searching_ && <UsageCard turns={turns} />}

        {error && <div className="px-4 py-2 text-[11px] text-red-500">{error}</div>}

        {searching_ && (
          <div className="px-4 pb-1 text-[10px] text-neutral-400">
            {searching ? (
              '搜索中…'
            ) : (
              <>
                标题 {byTitle.length} 个 · 内容 {byContent.length} 个
                <span className="ml-1 text-neutral-300">· 点进去可逐个浏览</span>
              </>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {empty && (
            <p className="px-4 py-6 text-xs text-neutral-400">
              {searching_ ? '没有匹配的会话或消息' : '还没有会话'}
            </p>
          )}

          {byTitle.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === currentId}
              query={query.trim()}
              snippet={hitSnippet.get(s.id)}
              hits={hitCount.get(s.id) ?? 0}
              onOpen={() => openSession(s.id)}
              onDelete={() => deleteSession(s.id)}
              onRename={(title) => void renameSession(s.id, title)}
            />
          ))}

          {byContent.length > 0 && (
            <>
              {byTitle.length > 0 && (
                <div className="bg-neutral-50 px-4 py-1 text-[10px] text-neutral-400">消息内容匹配</div>
              )}
              {byContent.map(({ session: s, snippet, hits }) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  active={s.id === currentId}
                  query={query.trim()}
                  snippet={snippet}
                  hits={hits}
                  onOpen={() => openSession(s.id)}
                  onDelete={() => deleteSession(s.id)}
              onRename={(title) => void renameSession(s.id, title)}
                />
              ))}
            </>
          )}

          {!searching_ &&
            sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === currentId}
                query=""
                hits={0}
                onOpen={() => openSession(s.id)}
                onDelete={() => deleteSession(s.id)}
              onRename={(title) => void renameSession(s.id, title)}
              />
            ))}
        </div>

        <div className="border-t border-neutral-100 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 py-2 text-xs text-neutral-700 disabled:opacity-30"
            disabled={!current}
            onClick={onExport}
          >
            <DownloadIcon />
            导出当前会话
          </button>
        </div>
          </>
        )}
      </aside>
    </div>
  )
}
