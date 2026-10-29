import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatConfig } from '@/chat/client'
import { humanizeError } from '@/chat/errors'
import { fetchModels, loadCachedModels, type ModelInfo } from '@/chat/models'
import { resolveProtocol, type ProtocolSetting } from '@/chat/protocol'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { findProvider, PROVIDER_GROUPS, PROVIDERS, PROVIDER_LABEL_CUSTOM, type Provider } from '@/chat/providers'
import {
  estimateTokens,
  formatPercent,
  formatTokens,
  hitRate,
  isCacheEstimated,
  missTokens,
  sumUsage,
} from '@/chat/tokens'
import { useApp } from '@/chat/store'
import { findTurnHits, hitElementId } from '@/chat/hit-nav'
import { activeVariant, type ChatTurn } from '@/db'
import SessionDrawer from '@/ui/SessionDrawer'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  MenuIcon,
  RefreshIcon,
  SearchIcon,
  SlidersIcon,
} from '@/ui/icons'

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

function Markdown({ content }: { content: string }) {
  return (
    <div className="md text-[15px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(live)
  useEffect(() => setOpen(live), [live])
  return (
    <div className="mb-2">
      <button className="flex items-center gap-1 text-[11px] text-neutral-400" onClick={() => setOpen((v) => !v)}>
        <span>{live ? '正在思考' : '思考过程'}</span>
        <span className="text-[9px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1 max-h-52 overflow-y-auto whitespace-pre-wrap border-l-2 border-neutral-100 pl-2.5 text-[12px] leading-relaxed text-neutral-400">
          {text}
        </div>
      )}
    </div>
  )
}

function VariantSwitcher({ turn, onSwitch }: { turn: ChatTurn; onSwitch: (i: number) => void }) {
  if (turn.variants.length < 2) return null
  return (
    <div className="flex items-center gap-0.5 text-[11px] text-neutral-400">
      <button
        className="p-0.5 disabled:opacity-25"
        disabled={turn.active === 0}
        onClick={() => onSwitch(turn.active - 1)}
        aria-label="上一版"
      >
        <ChevronLeftIcon />
      </button>
      <span className="tabular-nums">
        {turn.active + 1}/{turn.variants.length}
      </span>
      <button
        className="p-0.5 disabled:opacity-25"
        disabled={turn.active === turn.variants.length - 1}
        onClick={() => onSwitch(turn.active + 1)}
        aria-label="下一版"
      >
        <ChevronRightIcon />
      </button>
    </div>
  )
}

function UsageLine({ turn }: { turn: ChatTurn }) {
  const assistant = activeVariant(turn).assistant
  const usage = assistant?.usage
  if (!usage) return null
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-neutral-400">
      <span>{assistant?.model}</span>
      <span>入 {formatTokens(usage.input)}</span>
      <span>出 {formatTokens(usage.output)}</span>
      {usage.cacheRead > 0 && (
        <span>
          命中 {isCacheEstimated(usage) ? '≈' : ''}
          {formatTokens(usage.cacheRead)}
        </span>
      )}
      {usage.estimated && <span>整条估算</span>}
    </div>
  )
}

function ProviderPicker({ current, onPick }: { current?: Provider; onPick: (p: Provider) => void }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return PROVIDERS
    return PROVIDERS.filter((p) => p.label.toLowerCase().includes(q) || p.baseUrl.toLowerCase().includes(q))
  }, [query])

  return (
    <div>
      <input
        className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-xs outline-none focus:border-neutral-400"
        placeholder={`搜索服务商（共 ${PROVIDERS.length} 家）`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-neutral-200">
        {PROVIDER_GROUPS.map((group) => {
          const items = filtered.filter((p) => p.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              <div className="bg-neutral-50 px-3 py-1 text-[10px] text-neutral-500">{group}</div>
              {items.map((p) => {
                const active = p.id === current?.id
                return (
                  <button
                    key={p.id}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                    }`}
                    onClick={() => onPick(p)}
                  >
                    <span className="truncate text-xs">{p.label}</span>
                    <span className={`shrink-0 text-[10px] ${active ? 'text-white/50' : 'text-neutral-400'}`}>
                      {p.protocol === 'anthropic' || p.protocol === 'gemini' ? p.protocol : hostOf(p.baseUrl)}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="px-3 py-3 text-[11px] text-neutral-400">没有匹配的服务商</p>}
      </div>
    </div>
  )
}

function ModelPicker({
  models,
  value,
  onPick,
}: {
  models: ModelInfo[]
  value: string
  onPick: (m: ModelInfo) => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models
  }, [models, query])

  return (
    <div>
      <input
        className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-1.5 text-xs outline-none focus:border-neutral-400"
        placeholder={`搜索模型（共 ${models.length} 个）`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-neutral-200">
        {filtered.length === 0 && <p className="px-3 py-3 text-[11px] text-neutral-400">没有匹配的模型</p>}
        {filtered.map((m) => {
          const active = m.id === value
          return (
            <button
              key={m.id}
              className={`block w-full px-3 py-2 text-left ${active ? 'bg-neutral-900 text-white' : 'text-neutral-700'}`}
              onClick={() => onPick(m)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-xs">
                  {m.id}
                  {m.label && m.label !== m.id && <span className="ml-1 opacity-50">{m.label}</span>}
                </span>
                <span className={`shrink-0 text-[10px] ${active ? 'text-white/50' : 'text-neutral-400'}`}>
                  {m.contextLength ? `${Math.round(m.contextLength / 1000)}k` : ''}
                  {m.vision ? ' · 图' : ''}
                </span>
              </div>
              {(m.inputPrice || m.outputPrice) && (
                <div className={`mt-0.5 text-[10px] ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                  入 {m.inputPrice ?? '-'} / 出 {m.outputPrice ?? '-'}（每百万 token）
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SettingsSheet() {
  const { config, saveConfig, settingsOpen, setSettings, setPack } = useApp()
  const [draft, setDraft] = useState<ChatConfig>(config)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)

  const provider = findProvider(draft.baseUrl)
  const protocol = resolveProtocol(draft.protocol, draft.baseUrl)
  const canListModels = provider?.supportsModelList !== false

  const load = async (cfg: ChatConfig) => {
    setLoading(true)
    setError(null)
    try {
      setModels(await fetchModels(cfg))
    } catch (e) {
      setError(humanizeError(e))
    } finally {
      setLoading(false)
    }
  }

  const applyProvider = (next: ChatConfig) => {
    setDraft(next)
    const cached = loadCachedModels(next.baseUrl, resolveProtocol(next.protocol, next.baseUrl))
    setModels(cached ?? [])
    const target = findProvider(next.baseUrl)
    if (target?.supportsModelList === false) return
    if (!cached && draft.apiKey) void load(next)
  }

  // 模型列表里有上下文长度时自动带出，省得用户还要手填上限
  useEffect(() => {
    if (draft.contextLimit) return
    const hit = models.find((m) => m.id === draft.model)
    if (hit?.contextLength) setDraft((prev) => ({ ...prev, contextLimit: hit.contextLength }))
  }, [models, draft.model, draft.contextLimit])

  useEffect(() => {
    if (!settingsOpen) return
    setDraft(config)
    setError(null)
    setProviderOpen(false)
    const cached = loadCachedModels(config.baseUrl, resolveProtocol(config.protocol, config.baseUrl))
    setModels(cached ?? [])
    const current = findProvider(config.baseUrl)
    if (current?.supportsModelList !== false && !cached && config.apiKey) void load(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, config])

  if (!settingsOpen) return null

  const field = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={() => setSettings(false)} />
      <div className="relative max-h-[90%] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium">设置</h2>
          <button className="text-xs text-neutral-400" onClick={() => setSettings(false)}>
            关闭
          </button>
        </div>

        <label className="mb-1 block text-xs text-neutral-500">服务商</label>
        <button
          className="mb-2 flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left"
          onClick={() => setProviderOpen((v) => !v)}
        >
          <span className="text-sm">{provider?.label ?? PROVIDER_LABEL_CUSTOM}</span>
          <span className="text-[10px] text-neutral-400">{providerOpen ? '收起 ▲' : '更换 ▾'}</span>
        </button>

        {providerOpen && (
          <div className="mb-3">
            <ProviderPicker
              current={provider}
              onPick={(p: Provider) =>
                applyProvider({ ...draft, baseUrl: p.baseUrl, protocol: p.protocol, model: p.model ?? '' })
              }
            />
          </div>
        )}

        <label className="mb-1 block text-xs text-neutral-500">API 地址</label>
        <input className={`${field} mb-3`} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />

        <label className="mb-1 block text-xs text-neutral-500">API Key</label>
        <input
          className={`${field} mb-3`}
          type="password"
          placeholder="sk-..."
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
        />

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-neutral-500">协议</label>
          <span className="text-[10px] text-neutral-400">{draft.protocol === 'auto' ? `自动 → ${protocol}` : ''}</span>
        </div>
        <div className="mb-3 flex gap-1.5">
          {(
            [
              ['auto', '自动'],
              ['openai', 'OpenAI'],
              ['anthropic', 'Anthropic'],
              ['gemini', 'Gemini'],
            ] as Array<[ProtocolSetting, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                draft.protocol === key ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-neutral-600'
              }`}
              onClick={() => {
                const next = { ...draft, protocol: key }
                setDraft(next)
                setModels(loadCachedModels(next.baseUrl, resolveProtocol(key, next.baseUrl)) ?? [])
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs text-neutral-500">提示词包</label>
        <div className="mb-1 flex gap-1.5">
          {BUILTIN_PACKS.map((p) => (
            <button
              key={p.id}
              className={`flex-1 rounded-lg border px-2 py-1 text-[11px] ${
                (draft.packId ?? 'minimal') === p.id
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 text-neutral-600'
              }`}
              onClick={() => {
                setDraft({ ...draft, packId: p.id })
                void setPack(p.id)
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">{findPack(draft.packId).hint}</p>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-neutral-500">模型</label>
          {canListModels ? (
            <button className="text-xs text-blue-600 disabled:opacity-40" disabled={loading} onClick={() => load(draft)}>
              {loading ? '获取中…' : models.length ? '刷新' : '获取模型列表'}
            </button>
          ) : (
            <span className="text-[10px] text-neutral-400">该平台不提供模型列表</span>
          )}
        </div>
        <input className={`${field} mb-2`} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />

        {provider?.modelHint && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
            {provider.modelHint}
          </p>
        )}

        {error && <p className="mb-2 text-[11px] leading-relaxed text-red-500">拉取失败：{error}，可直接手填模型名</p>}

        {models.length > 0 && (
          <div className="mb-3">
            <ModelPicker
              models={models}
              value={draft.model}
              onPick={(m) => setDraft({ ...draft, model: m.id, contextLimit: m.contextLength })}
            />
          </div>
        )}

        <label className="mb-1 block text-xs text-neutral-500">上下文上限（token，留空则不做超限提醒）</label>
        <input
          className={`${field} mb-3`}
          inputMode="numeric"
          placeholder="例如 128000"
          value={draft.contextLimit ?? ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, '')
            setDraft({ ...draft, contextLimit: raw ? Number(raw) : undefined })
          }}
        />

        <label className="mb-1 block text-xs text-neutral-500">系统提示词（可选）</label>
        <textarea
          className={`${field} mb-4 h-20 resize-none`}
          value={draft.systemPrompt}
          onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
        />

        <button
          className="w-full rounded-xl bg-neutral-900 py-3 text-sm text-white"
          onClick={() => {
            saveConfig(draft)
            setSettings(false)
          }}
        >
          保存
        </button>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-400">
          Key 只保存在本机，请求直连你填写的接口，不经过任何中转
        </p>
      </div>
    </div>
  )
}

function Composer({ meter }: { meter?: React.ReactNode }) {
  const { draft, setDraft, send, streamingTurnId, stop, sessions, currentId, config, setPack, applyAction } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [packOpen, setPackOpen] = useState(false)

  const pack = findPack(sessions.find((s) => s.id === currentId)?.packId ?? config.packId)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const submit = () => {
    if (!draft.trim() || streamingTurnId) return
    void send(draft)
  }

  return (
    <div className="border-t border-neutral-100 bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5">
      {meter}

      <div className="mb-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5">
        <button
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
            packOpen ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
          }`}
          onClick={() => setPackOpen((v) => !v)}
        >
          {pack.name}
        </button>
        {pack.actions.map((action) => (
          <button
            key={action.id}
            className="shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 text-[11px] text-neutral-600 active:bg-neutral-100"
            onClick={() => applyAction(action.template)}
          >
            {action.label}
          </button>
        ))}
      </div>

      {packOpen && (
        <div className="mb-1.5 rounded-lg bg-neutral-50 p-2">
          <div className="flex gap-1.5">
            {BUILTIN_PACKS.map((p) => (
              <button
                key={p.id}
                className={`flex-1 rounded-md py-1 text-[11px] ${
                  p.id === pack.id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
                }`}
                onClick={() => {
                  void setPack(p.id)
                  setPackOpen(false)
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">{pack.hint}</p>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 px-3 py-2">
        <textarea
          ref={ref}
          rows={1}
          className="max-h-[140px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-relaxed outline-none"
          placeholder="发消息…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {streamingTurnId ? (
          <button className="shrink-0 rounded-lg bg-neutral-200 px-3 py-1.5 text-xs" onClick={stop}>
            停止
          </button>
        ) : (
          <button
            className="shrink-0 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-30"
            disabled={!draft.trim()}
            onClick={submit}
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const {
    turns,
    streamingTurnId,
    error,
    config,
    sessions,
    currentId,
    setDrawer,
    setSettings,
    regenerate,
    editResend,
    switchVariant,
    branchFrom,
    browse,
    setBrowseIndex,
    exitBrowse,
  } = useApp()
  const bottomRef = useRef<HTMLDivElement>(null)
  const provider = findProvider(config.baseUrl)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [statsOpen, setStatsOpen] = useState(false)

  const browseHits = useMemo(() => (browse ? findTurnHits(turns, browse.query) : []), [browse?.query, turns])
  const activeHit = browse && browseHits.length > 0 ? browseHits[Math.min(browse.index, browseHits.length - 1)] : null
  const activeHitKey = activeHit ? `${activeHit.turnId}-${activeHit.field}` : ''
  const scrollLockRef = useRef('')

  // 浏览状态下不追底，否则每来一段流式内容都会把用户拽回去
  useEffect(() => {
    if (browse) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, browse])

  useEffect(() => {
    if (!browse || !activeHit) {
      scrollLockRef.current = ''
      return
    }
    const key = `${activeHit.turnId}-${activeHit.field}-${browse.index}`
    if (scrollLockRef.current === key) return
    scrollLockRef.current = key
    const el = document.getElementById(hitElementId(activeHit))
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [browse, activeHit])

  const contextTokens = useMemo(() => {
    const session = sessions.find((s) => s.id === currentId)
    let sum = estimateTokens(`${config.systemPrompt}\n${session?.systemPrompt ?? ''}`)
    for (const turn of turns) {
      const v = activeVariant(turn)
      sum += estimateTokens(v.user.content) + estimateTokens(v.assistant?.content ?? '')
    }
    return sum
  }, [turns, config.systemPrompt, sessions, currentId])

  const limit = config.contextLimit ?? 0
  const ratio = limit > 0 ? contextTokens / limit : 0
  const nearLimit = ratio >= 0.8
  const lastTurn = turns[turns.length - 1]

  const sessionUsage = useMemo(
    () => sumUsage(turns.map((t) => activeVariant(t).assistant?.usage)),
    [turns]
  )

  const meter =
    turns.length > 0 || limit > 0 ? (
      nearLimit && lastTurn ? (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-2.5 py-1.5">
          <span className="text-[11px] leading-relaxed text-amber-800">
            上下文已用 {formatPercent(ratio)}（{formatTokens(contextTokens)} / {formatTokens(limit)}）
          </span>
          <button
            className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] text-white"
            onClick={() => void branchFrom(lastTurn.id, { compress: true })}
          >
            压缩并开新对话
          </button>
        </div>
      ) : (
        <div className="mb-1.5">
          <button
            className="flex w-full items-center gap-2 px-0.5 py-0.5"
            onClick={() => setStatsOpen((v) => !v)}
            aria-label="展开用量"
          >
            <span className="shrink-0 text-[10px] text-neutral-400">上下文</span>
            {limit > 0 && (
              <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-neutral-300 transition-[width] duration-300"
                  style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                />
              </div>
            )}
            <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
              {formatTokens(contextTokens)}
              {limit > 0 ? ` / ${formatTokens(limit)}` : ''}
            </span>
            <span className="shrink-0 text-neutral-300">
              {statsOpen ? <ChevronDownIcon size={12} /> : <ChevronUpIcon size={12} />}
            </span>
          </button>

          {statsOpen && (
            <div className="mt-1 rounded-lg bg-neutral-50 px-2.5 py-2">
              <div className="mb-1 text-[10px] text-neutral-400">
                本会话累计消耗 · {turns.length} 轮
                {sessionUsage.estimated ? ' · 含估算' : ' · 来自接口返回'}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] tabular-nums text-neutral-600">
                <span>输入 {formatTokens(sessionUsage.input)}</span>
                <span>输出 {formatTokens(sessionUsage.output)}</span>
                <span>
                  缓存命中 {isCacheEstimated(sessionUsage) ? '≈' : ''}
                  {formatTokens(sessionUsage.cacheRead)}
                </span>
                <span>未命中 {formatTokens(missTokens(sessionUsage))}</span>
                <span className="col-span-2 text-neutral-400">
                  平均命中率 {isCacheEstimated(sessionUsage) ? '≈' : ''}
                  {formatPercent(hitRate(sessionUsage))}
                  {sessionUsage.cacheWrite ? ` · 写入缓存 ${formatTokens(sessionUsage.cacheWrite)}` : ''}
                  {isCacheEstimated(sessionUsage) ? ' · 接口未提供命中数据' : ''}
                </span>
              </div>
            </div>
          )}
        </div>
      )
    ) : null

  return (
    <div className="relative mx-auto flex h-full max-w-[720px] flex-col overflow-hidden bg-white">
      <header className="flex items-center justify-between border-b border-neutral-100 px-2 py-2 pt-[max(8px,env(safe-area-inset-top))]">
        <button
          className="rounded-lg p-1.5 text-neutral-600 active:bg-neutral-100"
          onClick={() => setDrawer(true)}
          aria-label="会话列表"
        >
          <MenuIcon />
        </button>
        <div className="min-w-0 px-2 text-center">
          <div className="truncate text-sm font-medium">{provider?.label ?? 'Chat Lite'}</div>
          <div className="truncate text-[10px] text-neutral-400">{config.model || '未选模型'}</div>
        </div>
        <button
          className="rounded-lg p-1.5 text-neutral-600 active:bg-neutral-100"
          onClick={() => setSettings(true)}
          aria-label="设置"
        >
          <SlidersIcon />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 && (
          <div className="mt-16 text-center">
            <h1 className="text-lg font-medium">Chat Lite</h1>
            <p className="mt-2 text-xs leading-relaxed text-neutral-400">
              纯聊天，无代理无中转
              <br />
              在设置里选服务商、填 Key 即可开始
            </p>
          </div>
        )}

        {turns.map((turn) => {
          const variant = activeVariant(turn)
          const live = streamingTurnId === turn.id
          return (
            <div key={turn.id} className="mb-5">
              {editingId === turn.id ? (
                <div className="mb-2 rounded-xl border border-neutral-200 p-2">
                  <textarea
                    className="h-24 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <button className="px-2 py-1 text-xs text-neutral-500" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                    <button
                      className="rounded-lg bg-neutral-900 px-3 py-1 text-xs text-white"
                      onClick={() => {
                        setEditingId(null)
                        void editResend(turn.id, editText)
                      }}
                    >
                      保存并重发
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-end">
                    <div
                      id={hitElementId({ turnId: turn.id, field: 'user' })}
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-900 px-3.5 py-2.5 text-[15px] leading-relaxed text-white ${
                        activeHitKey === `${turn.id}-user` ? 'ring-2 ring-amber-400 ring-offset-2' : ''
                      }`}
                    >
                      {variant.user.content}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-end gap-3">
                    <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />
                    <button
                      className="text-[11px] text-neutral-400"
                      onClick={() => {
                        setEditingId(turn.id)
                        setEditText(variant.user.content)
                      }}
                    >
                      编辑
                    </button>
                    {turn.idx > 0 && (
                      <button className="text-[11px] text-neutral-400" onClick={() => void branchFrom(turn.id)}>
                        在此开新话题
                      </button>
                    )}
                  </div>
                </>
              )}

              <div
                id={hitElementId({ turnId: turn.id, field: 'assistant' })}
                className={`mt-2 w-full rounded-xl ${
                  activeHitKey === `${turn.id}-assistant` ? 'bg-amber-50/70 px-2 py-1 ring-1 ring-amber-300' : ''
                }`}
              >
                {variant.assistant?.reasoning && (
                  <Thinking text={variant.assistant.reasoning} live={live && !variant.assistant.content} />
                )}
                {variant.assistant?.content ? (
                  <Markdown content={variant.assistant.content} />
                ) : live ? (
                  !variant.assistant?.reasoning && <span className="text-sm text-neutral-400">正在连接…</span>
                ) : null}

                {variant.assistant && !live && (
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      className="flex items-center gap-1 text-[11px] text-neutral-400"
                      onClick={() => void navigator.clipboard?.writeText(variant.assistant?.content ?? '')}
                    >
                      <CopyIcon />
                      复制
                    </button>
                    <button
                      className="flex items-center gap-1 text-[11px] text-neutral-400"
                      onClick={() => void regenerate(turn.id)}
                    >
                      <RefreshIcon />
                      重新生成
                    </button>
                    <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />
                  </div>
                )}
                {variant.assistant && !live && <UsageLine turn={turn} />}
              </div>
            </div>
          )
        })}

        {error && <div className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{error}</div>}
        <div ref={bottomRef} className={streamingTurnId ? 'h-1' : undefined} />
      </main>

      {browse && browseHits.length > 0 && (
        <div className="mx-3 mb-2 flex items-center gap-1.5 rounded-xl bg-neutral-100 px-2.5 py-1.5">
          <SearchIcon className="shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-600">{browse.query}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
            {Math.min(browse.index + 1, browseHits.length)}/{browseHits.length}
          </span>
          <button
            className="rounded p-1 text-neutral-500 disabled:opacity-25"
            disabled={browse.index <= 0}
            onClick={() => setBrowseIndex(browse.index - 1)}
            aria-label="上一条"
          >
            <ChevronUpIcon />
          </button>
          <button
            className="rounded p-1 text-neutral-500 disabled:opacity-25"
            disabled={browse.index >= browseHits.length - 1}
            onClick={() => setBrowseIndex(browse.index + 1)}
            aria-label="下一条"
          >
            <ChevronDownIcon />
          </button>
          <button className="rounded p-1 text-neutral-400" onClick={exitBrowse} aria-label="退出浏览">
            <CloseIcon />
          </button>
        </div>
      )}

      <Composer meter={meter} />
      <SessionDrawer />
      <SettingsSheet />
    </div>
  )
}
