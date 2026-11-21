import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// 关于页展示的版本号，与 package.json 保持一致
import packageInfo from '../package.json'
import type { ChatConfig } from '@/chat/client'
import { humanizeError } from '@/chat/errors'
import { platform } from '@/platform'
import { fetchModels, loadCachedModels, type ModelInfo } from '@/chat/models'
import { resolveProtocol, type ProtocolSetting } from '@/chat/protocol'
import { labelOf, reasoningEfforts, supportsTemperature } from '@/chat/reasoning'
import { BUILTIN_PACKS, findPack } from '@/chat/packs'
import { findProvider, PROVIDER_GROUPS, PROVIDERS, PROVIDER_LABEL_CUSTOM, type Provider } from '@/chat/providers'
import {
  compressThreshold,
  estimateTokens,
  formatPercent,
  formatTokens,
  hitRate,
  isCacheEstimated,
  missTokens,
  sumUsage,
} from '@/chat/tokens'
import { useApp } from '@/chat/store'
import { formatSize, MAX_IMAGES, readAttachment, type Attachment } from '@/chat/attachments'
import { CUSTOM_PRESETS, resolveSearchMode, resolveSearchSource } from '@/chat/web-search'
import { resolveVisionTarget } from '@/chat/vision'
import { listProviders, keyForProvider } from '@/chat/credentials'
import { searchModeHint, searchModeStatuses } from '@/chat/search-status'
import { findTurnHits, hitElementId } from '@/chat/hit-nav'
import { activeVariant, type ChatTurn, type ToolCallRecord } from '@/db'
import AboutSheet from '@/ui/AboutSheet'
import ModePicker from '@/ui/ModePicker'
import SessionDrawer from '@/ui/SessionDrawer'
import TreeView from '@/ui/TreeView'
import ExportSheet from '@/ui/ExportSheet'
import GreetingPicker from '@/ui/GreetingPicker'
import PalettePicker from '@/ui/PalettePicker'
import { applyPalette, normalizePalette } from '@/ui/palette'
import { greetingList, greetingScript, type SettingDoc } from '@/chat/settings'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  MenuIcon,
  PaperclipIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SlidersIcon,
  StopIcon,
  TreeIcon,
} from '@/ui/icons'

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

const field = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-400'

/**
 * 某个服务商的模型列表：先吃缓存，没有就现拉一次。
 *
 * 辅助模型以前只读缓存——没在这个会话里点过「刷新模型」就没有列表，只能手填模型名。
 * 现在缺缓存会主动去拉，和主模型看到的是同一份清单。
 */
function useProviderModels(config: ChatConfig, baseUrl: string, enabled: boolean) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  // 设置页里 config 是草稿对象，改一个字就是新引用；依赖只跟地址和 Key，
  // 否则每敲一个字符都会重新拉一次模型列表
  const configRef = useRef(config)
  configRef.current = config

  useEffect(() => {
    if (!baseUrl) {
      setModels([])
      setFailed(false)
      return
    }
    const cached = loadCachedModels(baseUrl, resolveProtocol('auto', baseUrl))
    if (cached) {
      setModels(cached)
      setFailed(false)
      return
    }
    setModels([])
    if (!enabled) return
    const current = configRef.current
    const apiKey = keyForProvider(current, baseUrl)
    if (!apiKey) {
      setFailed(true)
      return
    }
    let alive = true
    setLoading(true)
    setFailed(false)
    fetchModels({ ...current, baseUrl, apiKey, protocol: 'auto' })
      .then((list) => {
        if (alive) setModels(list)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, config.baseUrl, config.apiKey, enabled, tick])

  return { models, loading, failed, reload: () => setTick((n) => n + 1) }
}

/**
 * 辅助模型选择：先定服务商，再从它的模型列表里选模型。
 *
 * 和主对话同一套逻辑（服务商 → /models 清单 → 点选），支持图片的排在前面并标「图」。
 * 服务商留空就跟随当前对话，模型留空就是当前模型——这也是最常用的那一种。
 */
function AuxModelPicker({
  title,
  hint,
  value,
  onChange,
  current,
}: {
  title: string
  hint: string
  value: ChatConfig['visionModel']
  onChange: (next: NonNullable<ChatConfig['visionModel']>) => void
  /** 设置页里的草稿配置：地址和 Key 可能还没保存，列表要跟着草稿走 */
  current: ChatConfig
}) {
  const providers = listProviders(current)
  const enabled = value?.enabled ?? false
  const picked = value?.baseUrl ?? ''
  // 留空 = 跟随当前对话的服务商
  const baseUrl = picked || current.baseUrl
  const { models, loading, failed, reload } = useProviderModels(current, baseUrl, enabled)
  const [query, setQuery] = useState('')

  const patch = (next: Partial<NonNullable<ChatConfig['visionModel']>>) =>
    onChange({ enabled: true, baseUrl: '', model: '', ...value, ...next })

  // 能看图的排前面：识图的时候第一屏就该是这些
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models
      .filter((m) => (q ? m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q) : true))
      .sort((a, b) => Number(Boolean(b.vision)) - Number(Boolean(a.vision)))
  }, [models, query])

  return (
    <div className="mb-3 rounded-lg bg-neutral-50 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs text-neutral-600">{title}</span>
        <button
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            enabled ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'
          }`}
          onClick={() => onChange({ enabled: !enabled, baseUrl: value?.baseUrl, model: value?.model })}
        >
          {enabled ? '已开启' : '关闭'}
        </button>
      </div>

      {enabled && (
        <>
          <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5">
            <button
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                picked ? 'bg-white text-neutral-500' : 'bg-neutral-900 text-white'
              }`}
              onClick={() => patch({ baseUrl: '', model: '' })}
            >
              当前服务商
            </button>
            {providers
              .filter((p) => !p.current)
              .map((p) => (
                <button
                  key={p.baseUrl}
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                    picked === p.baseUrl ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-500'
                  }`}
                  onClick={() => patch({ baseUrl: p.baseUrl, model: '' })}
                >
                  {p.label}
                </button>
              ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <input
              className="w-full border-b border-neutral-100 px-2.5 py-1.5 text-[11px] outline-none placeholder:text-neutral-400"
              placeholder={models.length > 0 ? `在 ${models.length} 个模型里搜` : '模型名'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto">
              {!picked && (
                <button
                  className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] ${
                    !value?.model ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                  }`}
                  onClick={() => patch({ model: '' })}
                >
                  <span className="truncate">沿用当前对话的模型</span>
                  <span className={`shrink-0 text-[10px] ${!value?.model ? 'text-white/60' : 'text-neutral-400'}`}>
                    {current.model}
                  </span>
                </button>
              )}

              {loading && <p className="px-2.5 py-2 text-[11px] text-neutral-400">正在获取模型列表…</p>}
              {!loading && failed && (
                <p className="px-2.5 py-2 text-[11px] leading-relaxed text-neutral-400">
                  没拿到这个服务商的模型列表，
                  <button className="text-blue-600" onClick={reload}>
                    重试
                  </button>
                  或在下面手填。
                </p>
              )}
              {!loading &&
                visible.map((model) => {
                  const active = value?.model === model.id
                  return (
                    <button
                      key={model.id}
                      className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left ${
                        active ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                      }`}
                      onClick={() => patch({ model: model.id })}
                    >
                      <span className="min-w-0 truncate text-[11px]">{model.label ?? model.id}</span>
                      <span className={`shrink-0 text-[10px] ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                        {model.vision ? '图 · ' : ''}
                        {model.contextLength ? `${Math.round(model.contextLength / 1000)}k` : model.id}
                      </span>
                    </button>
                  )
                })}
              {!loading && !failed && visible.length === 0 && models.length > 0 && (
                <p className="px-2.5 py-2 text-[11px] text-neutral-400">没有匹配的模型</p>
              )}
            </div>
          </div>

          {(failed || models.length === 0) && (
            <input
              className={`${field} mt-1.5`}
              placeholder="手填模型名（留空用当前模型）"
              value={value?.model ?? ''}
              onChange={(e) => patch({ model: e.target.value })}
            />
          )}

          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">{hint}</p>
        </>
      )}
    </div>
  )
}

/** 舞台指令：不进对话记录，只影响这一次生成 */
const STAGE_DIRECTIONS = [
  { label: '继续', text: '顺着上文继续写下去。不要重复已有内容，不要总结，不要解释。' },
  { label: '重写', text: '换一种写法重写你上一条回复：情节不变，措辞和细节不同。' },
  { label: '更短', text: '把你上一条回复压缩到一半以内，只保留关键动作和台词。' },
  { label: '更细', text: '在你上一条回复里补充环境和身体细节，但不要推进剧情。' },
]

/** 耗时：不足 10 秒留一位小数，再往上按秒/分说 */
function formatDuration(ms: number): string {
  const sec = ms / 1000
  if (sec < 1) return '不足 1 秒'
  if (sec < 10) return `${sec.toFixed(1)} 秒`
  if (sec < 60) return `${Math.round(sec)} 秒`
  const min = Math.floor(sec / 60)
  return `${min} 分 ${Math.round(sec - min * 60)} 秒`
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="md text-[16px] leading-[1.75]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          /* 超宽表格（长英文表头/单元格）在表内横滚，不撑破消息区 */
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** 工具名 → 人话 */
const TOOL_LABEL: Record<string, string> = {
  web_search: '搜索',
  write_memory: '记忆',
  search_chats: '回忆',
  update_setting: '设定',
}

/** 一次工具调用的一句话摘要；解析失败就退回工具名 */
function toolSummary(call: ToolCallRecord): string {
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>
    if (call.name === 'web_search') {
      const queries = args.queries
      return Array.isArray(queries) ? queries.join('、') : ''
    }
    if (call.name === 'write_memory') {
      const entries = args.entries
      return Array.isArray(entries) ? `${entries.length} 条` : ''
    }
    if (call.name === 'search_chats') return String(args.query ?? '')
    if (call.name === 'update_setting') return String(args.note ?? '')
  } catch {
    /* 参数不是 JSON 就只显示工具名 */
  }
  return ''
}

/**
 * 过程区：思考 + 工具调用，一个折叠块。
 *
 * 正文永远只放成品，过程全在这里。这样「只输出正文」的提示词才成立，
 * 也不用因为某个模式开了什么功能就把整块过程藏起来——用户想看随时能看。
 */
function Process({
  reasoning,
  calls,
  live,
  status,
  durationMs,
}: {
  reasoning?: string
  calls?: ToolCallRecord[]
  live: boolean
  status?: string | null
  durationMs?: number
}) {
  const [open, setOpen] = useState(live)
  const [openCall, setOpenCall] = useState<number | null>(null)
  useEffect(() => setOpen(live), [live])

  const count = calls?.length ?? 0
  const hasThinking = Boolean(reasoning?.trim())
  if (!hasThinking && count === 0 && !live) return null

  // 生成中显示当前在干什么；结束后显示步数和总用时
  const title = live
    ? status || '正在思考…'
    : `过程${count > 0 ? ` ${count} 步` : ''}${durationMs ? ` · ${formatDuration(durationMs)}` : ''}`

  return (
    <div className="mb-2">
      <button
        className="flex items-center gap-1 py-0.5 text-[12px] text-neutral-400"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{title}</span>
        <span className="text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {/* 刚发出请求时只有标题，内容为空就先不展开，等第一段到达再显示 */}
      {open && (hasThinking || count > 0) && (
        <div className="mt-1 border-l-2 border-neutral-100 pl-2.5">
          {/* 思考单独限高、单独滚动——否则长思考会把下面的工具条目挤出可视区 */}
          {hasThinking && (
            <div className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-[1.7] text-neutral-400">
              {reasoning}
            </div>
          )}
          {(calls ?? []).map((call, i) => {
            const summary = toolSummary(call)
            return (
              <div key={call.id} className="mb-1.5">
                <button
                  className="flex w-full items-center gap-1.5 text-left"
                  onClick={() => setOpenCall(openCall === i ? null : i)}
                >
                  <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-px text-[10px] text-neutral-500">
                    {TOOL_LABEL[call.name] ?? call.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-500">{summary}</span>
                </button>
                {openCall === i && (
                  <div className="mt-1 space-y-1 rounded-lg bg-neutral-50 p-2 text-[10px] leading-relaxed text-neutral-500">
                    <div className="break-words">
                      <span className="text-neutral-400">参数 </span>
                      {call.arguments}
                    </div>
                    <div className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words">
                      <span className="text-neutral-400">结果 </span>
                      {call.result}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function VariantSwitcher({ turn, onSwitch }: { turn: ChatTurn; onSwitch: (i: number) => void }) {
  if (turn.variants.length < 2) return null
  return (
    <div className="flex items-center gap-0.5 text-[12px] text-neutral-400">
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
  const [showWorld, setShowWorld] = useState(false)
  if (!assistant) return null
  const usage = assistant.usage
  // 字数只算正文，不含思考——思考长度和「写了多少」是两回事
  const chars = [...assistant.content.trim()].length
  if (!usage && chars === 0) return null

  // 每轮只显示一次耗时：有过程区的放在过程标题上，没有的落在这里
  const hasProcess = Boolean(assistant.reasoning?.trim()) || (assistant.toolCalls?.length ?? 0) > 0
  const showDuration = !hasProcess && assistant.durationMs

  const level = assistant.reasoningLevel
  const levelLabel = level === 'off' ? '关' : level ? labelOf(level) : '默认'

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-neutral-400">
      {assistant.reasoningSupported && (
        <span className="rounded bg-neutral-100 px-1.5 py-px text-[10px] text-neutral-500">思考·{levelLabel}</span>
      )}
      {assistant.worldEntries?.length ? (
        <button
          className={`rounded px-1.5 py-px text-[10px] ${
            showWorld ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
          }`}
          onClick={() => setShowWorld((v) => !v)}
          title="这一轮注入的世界书条目"
        >
          设定 {assistant.worldEntries.length}
        </button>
      ) : null}
      <span>{assistant.model}</span>
      {chars > 0 && <span className="tabular-nums">{chars.toLocaleString('zh-CN')} 字</span>}
      {showDuration ? <span className="tabular-nums">{formatDuration(assistant.durationMs!)}</span> : null}
      {showWorld && assistant.worldEntries?.length ? (
        <div className="w-full space-y-0.5 rounded-lg bg-emerald-50/60 px-2 py-1.5">
          {assistant.worldEntries.map((text, i) => (
            <div key={i} className="text-[10px] leading-relaxed text-emerald-800">
              · {text}…
            </div>
          ))}
        </div>
      ) : null}
      {usage && (
        <>
          <span>入 {formatTokens(usage.input)}</span>
          <span>出 {formatTokens(usage.output)}</span>
          {usage.cacheRead > 0 && (
            <span>
              命中 {isCacheEstimated(usage) ? '≈' : ''}
              {formatTokens(usage.cacheRead)}
            </span>
          )}
          {usage.estimated && <span>整条估算</span>}
        </>
      )}
    </div>
  )
}

/**
 * 赞/踩。点任一按钮都邀请写具体原因——没有文字的赞踩对改进几乎没用，
 * 但允许「跳过」，强制写会让人干脆不敢点。
 */
function Feedback({ turn }: { turn: ChatTurn }) {
  const { sendFeedback } = useApp()
  const [rating, setRating] = useState<'up' | 'down' | null>(null)
  const [text, setText] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const commit = async (value: 'up' | 'down', note: string) => {
    setBusy(true)
    try {
      await sendFeedback(turn.id, value, note)
      setDone(true)
    } finally {
      setBusy(false)
    }
  }

  if (done) return <p className="mt-1.5 text-[11px] text-neutral-400">已记下，谢谢</p>

  if (!rating) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <button
          className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] text-neutral-600 active:bg-neutral-200"
          onClick={() => setRating('up')}
        >
          赞
        </button>
        <button
          className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] text-neutral-600 active:bg-neutral-200"
          onClick={() => setRating('down')}
        >
          踩
        </button>
      </div>
    )
  }

  return (
    <div className="mt-1.5 rounded-xl bg-neutral-50 p-2">
      <textarea
        className="h-16 w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-neutral-400"
        placeholder={rating === 'up' ? '哪里好？说具体一点它才知道该保持什么' : '哪里不对？说具体一点它才知道该避开什么'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex items-center justify-end gap-2">
        <button
          className="px-2 py-1 text-[11px] text-neutral-500"
          onClick={() => void commit(rating, '')}
          disabled={busy}
        >
          跳过
        </button>
        <button
          className="rounded-lg bg-neutral-900 px-3 py-1 text-[11px] text-white disabled:opacity-40"
          onClick={() => void commit(rating, text)}
          disabled={busy || !text.trim()}
        >
          提交
        </button>
      </div>
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

/** 模型面板里的数值参数：失焦或回车才提交，避免输入「0.」时被当成 0 吃掉 */
function ParamInput({
  label,
  value,
  placeholder,
  hint,
  disabled,
  onCommit,
}: {
  label: string
  value?: number
  placeholder: string
  hint?: string
  disabled?: boolean
  onCommit: (value: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value))

  useEffect(() => {
    setText(value === undefined ? '' : String(value))
  }, [value])

  const commit = () => {
    const raw = text.trim()
    if (!raw) {
      onCommit(undefined)
      return
    }
    const next = Number(raw)
    if (!Number.isFinite(next)) {
      setText(value === undefined ? '' : String(value))
      return
    }
    onCommit(next)
  }

  return (
    <label className="flex items-center gap-2">
      <span className="w-[52px] shrink-0 text-[10px] text-neutral-400">{label}</span>
      <input
        className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-[11px] tabular-nums outline-none focus:border-neutral-400 disabled:bg-neutral-100 disabled:text-neutral-400"
        inputMode="decimal"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      {hint && <span className="shrink-0 text-[10px] text-neutral-300">{hint}</span>}
    </label>
  )
}

/**
 * 长记忆的开关与查看。放在设置里，和「设定发展」并列——
 * 两者都是「AI 背着你维护某些东西」，摆在一起用户才容易理解。
 */
function MemorySection({
  value,
  onChange,
  budget,
  onBudgetChange,
}: {
  value: boolean
  onChange: (v: boolean) => void
  budget?: number
  onBudgetChange: (n: number | undefined) => void
}) {
  const { clearMemory, listMemoryFiles, consolidateProfile } = useApp()
  const [profile, setProfile] = useState('')
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [warned, setWarned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeNote, setMergeNote] = useState<string | null>(null)

  const refresh = async () => {
    const files = await listMemoryFiles()
    setCount(files.length)
    setProfile(files.find((f) => f.kind === 'profile' && f.key === 'main')?.body ?? '')
  }
  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div className="mb-3">
      <button
        className="mb-1 flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left"
        onClick={() => onChange(!value)}
      >
        <span className="min-w-0 pr-2">
          <span className="block text-sm text-neutral-800">长记忆</span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-400">
            只在极简模式生效。聊到值得记的事它自己会记，赞 / 踩可以纠偏。
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
            value ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
          }`}
        >
          {value ? '已开启' : '已关闭'}
        </span>
      </button>

      <div className="mb-1 flex items-center justify-between">
        <label className="block text-xs text-neutral-500">记忆预算（token）</label>
        <span className="text-[10px] text-neutral-400">推荐 6000，可按上下文大小自定</span>
      </div>
      <input
        className={`${field} mb-1`}
        inputMode="numeric"
        placeholder="默认 6000"
        value={budget ?? ''}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '')
          onBudgetChange(raw ? Math.min(200000, Math.max(600, Number(raw))) : undefined)
        }}
        aria-label="记忆预算"
      />
      <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
        AI 在预算内自由合并、淘汰，超了从最旧开始丢；画像每轮都注入 system，预算越大 token 成本越高。
      </p>

      <div className="mb-1 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
        <span className="min-w-0 pr-2">
          <span className="block text-[12px] text-neutral-700">查看画像</span>
          <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-400">
            只读的测试功能，画像难免有偏差。
          </span>
        </span>
        <button
          className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] text-neutral-600"
          onClick={() => {
            if (open) {
              setOpen(false)
              return
            }
            if (!warned) {
              setWarned(true)
              return
            }
            setOpen(true)
            void refresh()
          }}
        >
          {open ? '收起' : '查看'}
        </button>
      </div>

      {warned && !open && (
        <p className="mb-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-800">
          画像难免有偏差，看着别太当真。再点一次「查看」继续。
        </p>
      )}

      {open && (
        <pre className="mb-1 whitespace-pre-wrap break-words rounded-lg bg-neutral-50 p-2.5 text-[11px] leading-relaxed text-neutral-600">
          {profile.trim() || '还没有画像。聊到值得记的事，它就会开始记。'}
        </pre>
      )}

      <button
        className="mb-1 w-full rounded-lg border border-neutral-200 py-1.5 text-[11px] text-neutral-600 disabled:opacity-40"
        disabled={merging}
          onClick={async () => {
            setMerging(true)
            setMergeNote(null)
            try {
              const result = await consolidateProfile()
              if (result.ok) {
                setMergeNote(`整理完成：${result.before} 条 → ${result.after} 条`)
                await refresh()
              } else {
                const notes: Record<typeof result.reason, string> = {
                  busy: '上一次整理还在进行，稍后再试。',
                  small: '条目还少（不足 10 条），暂不需要整理。',
                  'too-big': '画像超过 3 万 token，单次整理放不下（受模型输出上限约束），已跳过——原画像未动。',
                  empty: '模型没有给出有效输出，原画像未动。',
                }
                setMergeNote(notes[result.reason])
              }
            } catch (e) {
              setMergeNote(`整理失败：${e instanceof Error ? e.message : String(e)}`)
            } finally {
              setMerging(false)
            }
          }}
      >
        {merging ? '整理中…' : '整理画像（去重合并）'}
      </button>
      {mergeNote && <p className="mb-1 text-[10px] leading-relaxed text-neutral-400">{mergeNote}</p>}

      <button
        className="w-full rounded-lg border border-red-200 py-1.5 text-[11px] text-red-600 disabled:opacity-40"
        disabled={busy || count === 0}
        onClick={async () => {
          if (!confirm('清空全部记忆？画像、索引、反馈都会删除，不可恢复。')) return
          setBusy(true)
          try {
            await clearMemory()
            await refresh()
            setOpen(false)
            setWarned(false)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? '清理中…' : '清空记忆'}
      </button>
    </div>
  )
}

function SettingsSheet() {
  const { config, saveConfig, settingsOpen, setSettings } = useApp()
  const [draft, setDraft] = useState<ChatConfig>(config)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  /** 草稿与已存配置不同 → 显示悬浮小保存 */
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)
  /** 开关/胶囊类改一项存一项，不用滚到底 */
  const instantSave = (patch: Partial<ChatConfig>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    saveConfig(next)
  }

  const provider = findProvider(draft.baseUrl)
  const protocol = resolveProtocol(draft.protocol, draft.baseUrl)
  const canListModels = provider?.supportsModelList !== false

  /** 自定义搜索配置的局部更新：url 必须存在，所以给个空串兜底 */
  const patchCustom = (patch: Partial<NonNullable<ChatConfig['searchCustom']>>) =>
    setDraft({ ...draft, searchCustom: { url: '', ...draft.searchCustom, ...patch } })

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

  // 打开设置时同步草稿并拉缓存模型；打开后 config 变化只跟随草稿
  // （外观/开关都是即时保存，config 会跟着变，不能在这里重复拉模型）
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!settingsOpen) {
      wasOpen.current = false
      return
    }
    if (!wasOpen.current) {
      wasOpen.current = true
      setError(null)
      setProviderOpen(false)
      const cached = loadCachedModels(config.baseUrl, resolveProtocol(config.protocol, config.baseUrl))
      setModels(cached ?? [])
      const current = findProvider(config.baseUrl)
      if (current?.supportsModelList !== false && !cached && config.apiKey) void load(config)
    }
    setDraft(config)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, config])

  if (!settingsOpen) return null

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

        <div className="mb-4 rounded-xl border border-neutral-200 px-3 py-2.5">
          <div className="mb-2 text-xs text-neutral-500">色组（含明暗）</div>
          <PalettePicker
            theme={config.theme === 'dark' ? 'dark' : 'light'}
            palette={normalizePalette(config.palette)}
            onChange={({ theme, palette }) => saveConfig({ theme, palette })}
          />
          <div className="mt-3 mb-1.5 text-xs text-neutral-500">消息样式</div>
          <div className="mb-1.5 flex gap-1.5">
            {(
              [
                [false, '平铺'],
                [true, '气泡'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                className={`flex-1 rounded-lg py-1.5 text-[12px] ${
                  Boolean(config.bubbles) === value
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => saveConfig({ bubbles: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-xs text-neutral-500">圆角风格</div>
          <div className="mt-1.5 flex gap-1.5">
            {(
              [
                ['round', '圆角'],
                ['sharp', '直角'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`flex-1 rounded-lg py-1.5 text-[12px] ${
                  (config.corners ?? 'round') === value
                    ? 'bg-neutral-900 text-white'
                    : 'bg-neutral-100 text-neutral-600'
                }`}
                onClick={() => saveConfig({ corners: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">点一下立即生效，不用保存。</p>
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

        <label className="mb-1 block text-xs text-neutral-500">联网搜索 Key（可选）</label>
        <input
          className={`${field} mb-1`}
          type="password"
          placeholder="留空则复用上面的 Key（仅 DeepSeek 地址）"
          value={draft.searchApiKey ?? ''}
          onChange={(e) => setDraft({ ...draft, searchApiKey: e.target.value || undefined })}
        />
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          填了走 DeepSeek 搜索，约 ¥0.005 一次；不填可改用「自定义接口」。
        </p>

        <label className="mb-1 block text-xs text-neutral-500">本地搜索源</label>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(
            [
              ['deepseek', 'DeepSeek'],
              ['custom', '自定义接口'],
              ['native', '模型内（辅助）'],
            ] as Array<[NonNullable<ChatConfig['searchSource']>, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={`rounded-lg border px-2.5 py-1 text-[11px] ${
                (draft.searchSource === 'custom' || draft.searchSource === 'native'
                  ? draft.searchSource
                  : 'deepseek') === value
                  ? 'border-neutral-900 bg-neutral-900 text-white'
                  : 'border-neutral-200 text-neutral-600'
              }`}
              onClick={() => instantSave({ searchSource: value })}
            >
              {label}
            </button>
          ))}
        </div>
        {draft.searchSource === 'native' && (
          <>
            <p className="mb-2 text-[10px] leading-relaxed text-neutral-400">
              用一次额外的模型调用换结构化搜索；想让主对话和搜索用不同服务商，在下面挑。
            </p>
            <AuxModelPicker
              title="搜索模型"
              hint="不选就用当前对话的模型（需要它本身支持上游搜索）。"
              value={draft.searchModel}
              onChange={(next) => setDraft({ ...draft, searchModel: next })}
              current={draft}
            />
          </>
        )}

        {draft.searchSource === 'custom' && (
          <div className="mb-3 rounded-lg bg-neutral-50 p-2">
            <div className="mb-1.5 flex flex-wrap gap-1">
              {CUSTOM_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className="rounded border border-neutral-200 bg-white px-2 py-0.5 text-[10px] text-neutral-600"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      searchCustom: { ...preset.config, key: draft.searchCustom?.key },
                    })
                  }
                >
                  {preset.label}
                </button>
              ))}
              <span className="self-center text-[10px] text-neutral-400">点一下自动填</span>
            </div>

            <input
              className={`${field} mb-1.5`}
              placeholder="接口地址，可含 {{query}}"
              value={draft.searchCustom?.url ?? ''}
              onChange={(e) => patchCustom({ url: e.target.value })}
            />
            <input
              className={`${field} mb-1.5`}
              type="password"
              placeholder="Key（默认放进 Authorization: Bearer）"
              value={draft.searchCustom?.key ?? ''}
              onChange={(e) => patchCustom({ key: e.target.value })}
            />

            <div className="mb-1.5 flex gap-1.5">
              {(['GET', 'POST'] as const).map((method) => (
                <button
                  key={method}
                  className={`rounded border px-2 py-0.5 text-[10px] ${
                    (draft.searchCustom?.method ?? 'POST') === method
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 bg-white text-neutral-600'
                  }`}
                  onClick={() =>
                    patchCustom({ method })
                  }
                >
                  {method}
                </button>
              ))}
            </div>

            <textarea
              className={`${field} mb-1.5 h-14 resize-none font-mono text-[11px]`}
              placeholder='请求头 JSON（可选），如 {"X-API-KEY":"{{key}}"}'
              value={draft.searchCustom?.headers ?? ''}
              onChange={(e) => patchCustom({ headers: e.target.value })}
            />
            <textarea
              className={`${field} h-14 resize-none font-mono text-[11px]`}
              placeholder='请求体模板（POST 用），默认 {"query":"{{query}}","count":{{count}}}'
              value={draft.searchCustom?.body ?? ''}
              onChange={(e) => patchCustom({ body: e.target.value })}
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
              占位符：{'{{query}}'} 查询词、{'{{count}}'} 条数、{'{{key}}'} 你的 Key。
              返回结构会自动识别常见的 results / data / webPages 等字段。
            </p>
          </div>
        )}

        <label className="mb-1 block text-xs text-neutral-500">辅助识图</label>
        <AuxModelPicker
          title="识图模型"
          hint="图片会先由这个模型转成文字描述，再交给主模型——主模型不需要支持看图。关掉就把原图直接发给主模型。"
          value={draft.visionModel}
          onChange={(next) => setDraft({ ...draft, visionModel: next })}
          current={draft}
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
                saveConfig(next)
              }}
            >
              {label}
            </button>
          ))}
        </div>

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
              onPick={(m) =>
                setDraft((prev) => ({
                  ...prev,
                  model: m.id,
                  // 与 store.selectModel 同一规则：换模型就换上限，没声明长度则清空；
                  // 重选同一模型时保留用户手填的值
                  contextLimit: m.contextLength ?? (m.id === prev.model ? prev.contextLimit : undefined),
                }))
              }
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

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-neutral-500">压缩预警</label>
          <span className="text-[10px] tabular-nums text-neutral-400">{draft.compressAt ?? 80}%</span>
        </div>
        <input
          type="range"
          min={50}
          max={95}
          step={5}
          value={draft.compressAt ?? 80}
          onChange={(e) => setDraft({ ...draft, compressAt: Number(e.target.value) })}
          className="mb-1.5 w-full accent-neutral-900"
          aria-label="压缩预警百分比"
        />
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          到这个比例就出提醒条；也可随时点「压缩」——前情压成摘要接着写，原会话不删。
        </p>

        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-neutral-500">图片保留轮数</label>
          <span className="text-[10px] tabular-nums text-neutral-400">{draft.imageResendTurns ?? 2} 轮</span>
        </div>
        <input
          type="range"
          min={1}
          max={9}
          step={1}
          value={draft.imageResendTurns ?? 2}
          onChange={(e) => setDraft({ ...draft, imageResendTurns: Number(e.target.value) })}
          className="mb-1.5 w-full accent-neutral-900"
          aria-label="图片保留轮数"
        />
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          只给最近这几轮带原图，更早的换成占位说明；历史图片每轮重新计费，识图描述不受影响。
        </p>


        <div className="mb-1 mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">写作</div>
        <button
          className="mb-1 flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left"
          onClick={() => instantSave({ settingEvolution: !draft.settingEvolution })}
        >
          <span className="min-w-0 pr-2">
            <span className="block text-sm text-neutral-800">设定发展模式</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-400">
              AI 把设定复制成发展稿，边写边补；原卡不动。
            </span>
          </span>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] ${
              draft.settingEvolution ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
            }`}
          >
            {draft.settingEvolution ? '已开启' : '已关闭'}
          </span>
        </button>
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          只对写作模式生效；同一张卡的会话复用同一份发展稿。
        </p>

        <div className="mb-1 mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">角色扮演</div>
        <label className="mb-1 mt-2 block text-xs text-neutral-500">我的名字</label>
        <input
          className={`${field} mb-1`}
          placeholder="你"
          value={draft.userName ?? ''}
          onChange={(e) => setDraft({ ...draft, userName: e.target.value || undefined })}
        />
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          角色卡里的 <code>{'{{user}}'}</code> 会替换成这个名字。留空则显示「你」。
        </p>

        <label className="mb-1 block text-xs text-neutral-500">我的设定（可选）</label>
        <textarea
          className={`${field} mb-1 h-24 resize-none`}
          placeholder="一段自我介绍：身份、外貌、和角色的关系。角色会把它当成对你的已知信息。"
          value={draft.persona ?? ''}
          onChange={(e) => setDraft({ ...draft, persona: e.target.value || undefined })}
        />
        <p className="mb-3 text-[10px] leading-relaxed text-neutral-400">
          只在挂了设定文件（角色卡/世界书）时注入。支持 <code>{'{{user}}'}</code>，<code>{'{{char}}'}</code> 会替换成角色名。
        </p>

        <div className="mb-1 mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">记忆</div>
        <MemorySection
          value={Boolean(draft.longMemory)}
          onChange={(v) => {
            // 打开长记忆时顺手把思考档位带到中间档（记忆整理要靠推理）；用户已设过档位就不动
            if (v && !draft.longMemory && (!draft.reasoningLevel || draft.reasoningLevel === 'off')) {
              const protocol = resolveProtocol(draft.protocol, draft.baseUrl)
              const efforts = reasoningEfforts(protocol, draft.baseUrl, draft.model, models.find((m) => m.id === draft.model))
              const level = efforts.some((e) => e.id === 'high') ? 'high' : undefined
              instantSave(level ? { longMemory: v, reasoningLevel: level } : { longMemory: v })
              return
            }
            instantSave({ longMemory: v })
          }}
          budget={draft.memoryBudget}
          onBudgetChange={(n) => setDraft({ ...draft, memoryBudget: n })}
        />

        <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-400">
          Key 只保存在本机，请求直连你填写的接口，不经过任何中转
        </p>

        {/* 悬浮小保存：有未保存的修改时钉在底部，不用滚回最下面 */}
        {dirty && (
          <div className="sticky bottom-0 -mx-5 mt-5 border-t border-neutral-100 bg-white px-5 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
            <button
              className="w-full rounded-xl bg-neutral-900 py-3 text-sm text-white"
              onClick={() => {
                saveConfig(draft)
                setSavedFlash(true)
                setTimeout(() => setSavedFlash(false), 1600)
              }}
            >
              {savedFlash ? '已保存 ✓' : '保存修改'}
            </button>
          </div>
        )}

        {/* 关于页入口：整块可点，正文在 src/ui/about-text.ts */}
        <button
          className="mt-4 flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 text-left"
          onClick={() => setAboutOpen(true)}
        >
          <img src="/logo.svg" alt="Chat Lite logo" className="h-10 w-10 rounded-xl" />
          <span className="flex-1">
            <span className="block text-sm font-medium text-neutral-700">关于 Chat Lite</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-400">
              v{packageInfo.version} · 已开源
            </span>
          </span>
          <ChevronRightIcon size={14} className="text-neutral-300" />
        </button>
      </div>
      {aboutOpen && <AboutSheet onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function Composer({ meter, opening }: { meter?: React.ReactNode; opening?: string }) {
  const {
    draft,
    setDraft,
    send,
    streamingTurnId,
    toolStatus,
    stop,
    sessions,
    currentId,
    config,
    saveConfig,
    setPack,
    applyAction,
    models,
    modelsLoading,
    modelsError,
    loadModels,
    selectModel,
    setReasoningLevel,
    turns,
    editingTurnId,
    editResend,
    cancelEdit,
  } = useApp()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [packOpen, setPackOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [reasonOpen, setReasonOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  const pack = findPack(sessions.find((s) => s.id === currentId)?.packId ?? config.packId)
  const protocol = resolveProtocol(config.protocol, config.baseUrl)
  const currentModel = models.find((m) => m.id === config.model)
  // 档位由适配器决定：不同服务商的方言、可用档位都不一样
  const efforts = reasoningEfforts(protocol, config.baseUrl, config.model, currentModel)
  const reasoningValue = config.reasoningLevel
  const reasoningLabel = efforts.find((option) => option.id === reasoningValue)?.label ?? '默认'
  // 三种联网方式：上游自带（优先推荐）/ 本地源 / Bing 兜底
  const searchMode = resolveSearchMode(config)
  const searchSource = resolveSearchSource(config)
  // 配了辅助识图，主模型看不看图都无所谓
  const visionReady = Boolean(resolveVisionTarget(config))
  const searchStatuses = searchModeStatuses(config, protocol, findProvider(config.baseUrl)?.id)
  const activeSearch = searchStatuses.find((status) => status.id === searchMode) ?? searchStatuses[0]
  const searchLabel =
    searchMode === 'off' ? '联网' : (activeSearch?.label ?? '联网').replace(' · 推荐', '')

  // 推理模型不接收温度；Anthropic 开着思考时温度必须是 1，所以也不发
  const tempDisabled = !supportsTemperature(config.model)
  const tempHint = tempDisabled
    ? '该模型不接收'
    : protocol === 'anthropic' && reasoningValue !== undefined && reasoningValue !== 'off'
      ? '思考开启时忽略'
      : undefined

  useEffect(() => {
    if (models.length === 0 && !modelsLoading) void loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl, config.protocol])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [draft])

  const [files, setFiles] = useState<Attachment[]>([])

  // 打回输入框时，这一轮原有的附件一起搬过来，允许增删
  useEffect(() => {
    if (!editingTurnId) return
    const turn = useApp.getState().turns.find((t) => t.id === editingTurnId)
    setFiles(turn ? (activeVariant(turn).user.attachments ?? []) : [])
    requestAnimationFrame(() => ref.current?.focus())
  }, [editingTurnId])

  const editingTurn = turns.find((t) => t.id === editingTurnId)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const pickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setAttachError(null)
    setReading(true)
    try {
      const picked: Attachment[] = []
      for (const file of Array.from(list)) {
        try {
          picked.push(await readAttachment(file))
        } catch (e) {
          setAttachError(e instanceof Error ? e.message : String(e))
        }
      }
      // 图片有上限：再多既贵又容易触发网关限制
      let images = files.filter((f) => f.kind === 'image').length
      const accepted: Attachment[] = []
      for (const item of picked) {
        if (item.kind === 'image') {
          if (images >= MAX_IMAGES) {
            setAttachError(`最多带 ${MAX_IMAGES} 张图片`)
            continue
          }
          images += 1
        }
        accepted.push(item)
      }
      if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted])
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = async () => {
    const payload = files.length > 0 ? files : undefined
    if ((!draft.trim() && !payload) || streamingTurnId) return

    if (editingTurnId) {
      // 改写：不新建轮次，往这一轮的变体里追加一版再重新生成
      await editResend(editingTurnId, draft, files)
    } else {
      await send(draft, payload)
    }
    // 成功发送后 store 会清空草稿；失败时保留附件，省得重传
    if (!useApp.getState().draft) setFiles([])
  }

  return (
    <div className="bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5">
      {meter}

      {editingTurnId && (
        <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-relaxed text-amber-800">
            正在改写第 {(editingTurn?.idx ?? 0) + 1} 轮，发送后重新生成
          </span>
          <button className="shrink-0 px-1 text-[11px] text-amber-700" onClick={cancelEdit}>
            取消
          </button>
        </div>
      )}

      <div className="mb-1.5 flex items-center gap-1.5">
        <button
          className={`flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
            modelOpen ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
          }`}
          onClick={() => {
            setReasonOpen(false)
            setModelOpen((v) => !v)
          }}
        >
          <span className="max-w-[150px] truncate">{config.model || '选模型'}</span>
          <span className="shrink-0 opacity-60">{modelOpen ? '×' : '▾'}</span>
        </button>

        {efforts.length > 0 && (
          <button
            className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${
              reasonOpen ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
            }`}
            onClick={() => {
              setModelOpen(false)
              setReasonOpen((v) => !v)
            }}
          >
            思考 {reasoningLabel}
            <span className="opacity-60">{reasonOpen ? '×' : '▾'}</span>
          </button>
        )}

        <button
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
            searchMode !== 'off' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
          }`}
          onClick={() => {
            setModelOpen(false)
            setReasonOpen(false)
            setSearchOpen((v) => !v)
          }}
        >
          {searchLabel}
        </button>

        {modelsLoading && <span className="text-[10px] text-neutral-400">拉取模型…</span>}
      </div>

      {searchOpen && (
        <div className="mb-1.5 rounded-lg bg-neutral-50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-neutral-400">联网搜索</span>
            {activeSearch?.recommended && <span className="text-[10px] text-emerald-600">当前模型支持自带搜索</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searchStatuses.map((status) => (
              <button
                key={status.id}
                disabled={!status.available}
                title={status.reason}
                className={`rounded-full px-2.5 py-0.5 text-[11px] disabled:opacity-40 ${
                  searchMode === status.id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
                }`}
                onClick={() => {
                  saveConfig({ searchMode: status.id })
                  setSearchOpen(false)
                }}
              >
                {status.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
            {searchModeHint(activeSearch, searchSource.label)}
          </p>
        </div>
      )}

      {modelOpen && (
        <div className="mb-2 rounded-lg bg-neutral-50 p-2">
          {modelsError && <p className="mb-1 text-[10px] text-red-500">{modelsError}</p>}
          {models.length === 0 && !modelsLoading ? (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-neutral-400">还没有模型列表</span>
              <button className="text-[10px] text-blue-600" onClick={() => void loadModels(true)}>
                拉取
              </button>
            </div>
          ) : (
            <ModelPicker
              models={models}
              value={config.model}
              onPick={(m) => {
                // 不关闭面板：选完模型通常还要顺手调温度和长度
                selectModel(m)
              }}
            />
          )}

          <div className="mt-2 space-y-1.5 border-t border-neutral-200 pt-2">
            <ParamInput
              label="温度"
              value={config.temperature}
              placeholder="默认"
              hint={tempHint}
              disabled={tempDisabled}
              onCommit={(v) => saveConfig({ temperature: v })}
            />
            <ParamInput
              label="最大输出"
              value={config.maxTokens}
              placeholder="默认"
              onCommit={(v) => saveConfig({ maxTokens: v })}
            />
            <ParamInput
              label="上下文"
              value={config.contextLimit}
              placeholder="未声明，手填"
              hint={currentModel?.contextLength === config.contextLimit ? '来自模型' : undefined}
              onCommit={(v) => saveConfig({ contextLimit: v })}
            />
          </div>
        </div>
      )}

      {reasonOpen && (
        <div className="mb-2 rounded-lg bg-neutral-50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] text-neutral-400">思考强度</span>
            <button className="text-[10px] text-blue-600" onClick={() => void loadModels(true)}>
              刷新模型信息
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                reasoningValue === undefined ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
              }`}
              onClick={() => {
                setReasoningLevel(undefined)
                setReasonOpen(false)
              }}
            >
              默认
            </button>
            {efforts.map((option) => (
              <button
                key={option.id}
                className={`rounded-full px-2.5 py-0.5 text-[11px] ${
                  reasoningValue === option.id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
                }`}
                onClick={() => {
                  setReasoningLevel(option.id)
                  setReasonOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400">
            档位由服务商的方言决定，不支持的选项不会出现
            {reasoningValue === undefined ? '；默认表示不发送参数，用服务商自己的设置' : ''}
          </p>
        </div>
      )}

      {pack.actions.length > 0 && (
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
      )}

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

      {(files.length > 0 || attachError) && (        <div className="mb-1.5">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="relative flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white py-1 pl-1 pr-6"
                >
                  {file.kind === 'image' && file.dataUrl ? (
                    <img src={file.dataUrl} alt={file.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-neutral-100 text-[10px] text-neutral-500">
                      文
                    </span>
                  )}
                  <span className="max-w-[120px] truncate text-[11px] text-neutral-600">{file.name}</span>
                  <span className="shrink-0 text-[10px] text-neutral-400">{formatSize(file.size)}</span>
                  <button
                    className="absolute right-1 top-1 rounded text-neutral-300 active:text-red-500"
                    onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                    aria-label={`移除 ${file.name}`}
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachError && <p className="mt-1 text-[10px] leading-relaxed text-red-500">{attachError}</p>}
          {!attachError && files.some((f) => f.kind === 'image') && currentModel && !currentModel.vision && !visionReady && (
            <p className="mt-1 text-[10px] leading-relaxed text-amber-600">
              当前模型未声明支持图片，可能无法识别
            </p>
          )}
        </div>
      )}

      {toolStatus && (
        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
          {toolStatus}
        </p>
      )}

      <div className="flex items-end gap-2 rounded-[22px] bg-neutral-100 px-2.5 py-1.5">
        <button
          className="mb-1 shrink-0 rounded-full p-1.5 text-neutral-500 active:bg-neutral-200 disabled:opacity-40"
          disabled={Boolean(streamingTurnId) || reading}
          onClick={() => fileRef.current?.click()}
          aria-label="添加附件"
        >
          <PaperclipIcon size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,.pdf,.docx,.xlsx,.pptx,.zip,.txt,.md,.markdown,.json,.jsonl,.csv,.tsv,.yaml,.yml,.xml,.html,.htm,.css,.js,.jsx,.ts,.tsx,.vue,.py,.java,.kt,.go,.rs,.c,.h,.cpp,.hpp,.cs,.php,.rb,.swift,.lua,.sh,.bash,.sql,.log,.ini,.toml,.conf,.env,.properties,.gradle"
          onChange={(e) => void pickFiles(e.target.files)}
        />
        <textarea
          ref={ref}
          rows={1}
          className="max-h-[140px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-[1.5] outline-none placeholder:text-neutral-400"
          placeholder={editingTurnId ? '改写这一句…' : opening ? '回这句开场…' : '发消息…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {streamingTurnId ? (
          <button
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white active:bg-neutral-700"
            onClick={stop}
            aria-label="停止生成"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white active:bg-neutral-700 disabled:bg-neutral-300"
            disabled={(!draft.trim() && files.length === 0) || reading}
            onClick={() => void submit()}
            aria-label={editingTurnId ? '重新生成' : '发送'}
          >
            <SendIcon />
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
    toolStatus,
    error,
    config,
    sessions,
    currentId,
    setDrawer,
    setSettings,
    regenerate,
    startEdit,
    steer,
    switchGreeting,
    editingTurnId,
    switchVariant,
    branchFrom,
    browse,
    setBrowseIndex,
    exitBrowse,
    settings,
    prompts,
    pendingSettingIds,
    pendingGreetingIndex,
  } = useApp()
  const bottomRef = useRef<HTMLDivElement>(null)
  const openingRef = useRef<HTMLDivElement>(null)
  const session = sessions.find((s) => s.id === currentId)

  // 外观写到 html 的 data 属性上；色组重写全套 --color-* 中性阶（含明暗、全局无例外）
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = config.theme === 'dark' ? 'dark' : 'light'
    root.dataset.corners = config.corners === 'sharp' ? 'sharp' : 'round'
    applyPalette(root, normalizePalette(config.palette), config.theme === 'dark' ? 'dark' : 'light')
  }, [config.theme, config.corners, config.palette])
  const settingIds = session?.settingIds?.length
    ? session.settingIds
    : session?.characterId
      ? [session.characterId]
      : []
  const activeSetting = settings.find((d) => d.id === settingIds[0])
  const activePackId = findPack(sessions.find((s) => s.id === currentId)?.packId ?? config.packId).id
  // 长记忆只在极简模式生效，写作/酒馆有提示词包在定义行为
  const longMemory = Boolean(config.longMemory) && activePackId === 'minimal'
  const [statsOpen, setStatsOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [greetingOpen, setGreetingOpen] = useState(false)
  const [recapOpen, setRecapOpen] = useState(false)
  /** 正在导出哪一条回答之上的链 */
  const [exportTarget, setExportTarget] = useState<{ turnId: string; variant: number } | null>(null)

  const sessionDocs = useMemo(() => {
    const ids = session?.settingIds?.length
      ? session.settingIds
      : session?.characterId
        ? [session.characterId]
        : []
    return ids.map((id) => settings.find((d) => d.id === id)).filter((d): d is SettingDoc => Boolean(d))
  }, [session, settings])
  const greetings = useMemo(
    () => greetingList(sessionDocs, config.userName ?? '你'),
    [sessionDocs, config.userName]
  )
  /**
   * 设定发展模式：写作 + 开关 + 挂的是发展稿。
   * 发展稿随剧情单向生长，回溯版本、编辑旧轮次、从旧链分叉都会让它和过去对不上。
   */
  const evolutionMode =
    Boolean(config.settingEvolution) &&
    activePackId === 'writing' &&
    sessionDocs.some((doc) => Boolean(doc.derivedFrom))
  // 起始页选好、还没发出去的开场白。它不是一轮消息：等你敲第一句话时一起发给模型
  const pendingDocs = useMemo(
    () =>
      pendingSettingIds
        .map((id) => settings.find((d) => d.id === id))
        .filter((d): d is SettingDoc => Boolean(d)),
    [pendingSettingIds, settings]
  )
  const openingText =
    turns.length === 0 ? greetingScript(pendingDocs, config.userName ?? '你', pendingGreetingIndex) : ''
  const openingName =
    pendingDocs.find((d) => d.firstMessage?.trim() || (d.greetings?.length ?? 0) > 0)?.name ?? ''
  const firstTurn = turns[0]
  // 只有「一条消息、且是开场白」时才能换——说过话之后换，上下文就对不上了
  const greetingTurnId =
    firstTurn && turns.length === 1 && !activeVariant(firstTurn).user.content.trim() && greetings.length > 1
      ? firstTurn.id
      : null
  const activeGreeting = greetingTurnId
    ? greetings.indexOf(activeVariant(firstTurn).assistant?.content ?? '')
    : -1

  const browseHits = useMemo(() => (browse ? findTurnHits(turns, browse.query) : []), [browse?.query, turns])
  const activeHit = browse && browseHits.length > 0 ? browseHits[Math.min(browse.index, browseHits.length - 1)] : null
  const activeHitKey = activeHit ? `${activeHit.turnId}-${activeHit.field}` : ''
  const scrollLockRef = useRef('')

  // 浏览状态下不追底，否则每来一段流式内容都会把用户拽回去
  useEffect(() => {
    if (browse) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, browse])

  // 换了一段开场就把预览拉到眼前——这段马上会跟着第一句话发出去，得让用户看清
  const lastPickRef = useRef(pendingGreetingIndex)
  useEffect(() => {
    if (lastPickRef.current === pendingGreetingIndex) return
    lastPickRef.current = pendingGreetingIndex
    if (!openingText) return
    openingRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [pendingGreetingIndex, openingText])

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
    const promptText = session?.promptId ? (prompts.find((p) => p.id === session.promptId)?.text ?? '') : ''
    let sum = estimateTokens(`${promptText}\n${session?.systemPrompt ?? ''}`)
    for (const turn of turns) {
      const v = activeVariant(turn)
      sum += estimateTokens(v.user.content) + estimateTokens(v.assistant?.content ?? '')
    }
    return sum
  }, [turns, prompts, sessions, currentId])

  const limit = config.contextLimit ?? 0
  const ratio = limit > 0 ? contextTokens / limit : 0
  // 预警水位可调：小窗口留 20% 和大窗口留 20% 不是一回事，所以交给用户定
  const compressAt = compressThreshold(config.compressAt)
  const nearLimit = ratio >= compressAt / 100
  const lastTurn = turns[turns.length - 1]

  /** 压缩并开新对话：保留最近两轮原文，更早的压成前情摘要 */
  const compressNow = () => {
    const from = turns[Math.max(0, turns.length - 2)]
    if (!from) return
    void branchFrom(from.id, { compress: true })
  }

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
            onClick={compressNow}
          >
            压缩并开新对话
          </button>
        </div>
      ) : (
        <div className="mb-1.5">
          <div className="flex items-center gap-1.5 px-0.5 py-0.5">
            <button
              className="flex min-w-0 flex-1 items-center gap-2"
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
            {/* 手动压缩：不等预警线，想开新话题又不想丢掉前情时随时能用 */}
            {lastTurn && (
              <button
                className="shrink-0 rounded-md border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-500 active:bg-neutral-100"
                onClick={compressNow}
                title={`把更早的对话压成摘要，保留最近两轮，开一个新会话继续（预警线 ${compressAt}%）`}
              >
                压缩
              </button>
            )}
          </div>

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
      <header className="flex items-center justify-between px-2 py-2 pt-[max(8px,env(safe-area-inset-top))]">
        <button
          className="rounded-full p-2 text-neutral-600 active:bg-neutral-100"
          onClick={() => setDrawer(true)}
          aria-label="会话列表"
        >
          <MenuIcon />
        </button>
        <div className="min-w-0 px-2 text-center">
          {/* 标题是这一段对话的名字，不是供应商也不是模型——那两个在设置里看 */}
          <div className="truncate text-[15px] font-medium leading-tight">{session?.title || '新对话'}</div>
          {(activeSetting || session?.promptId) && (
            <div className="truncate text-[11px] leading-tight text-neutral-400">
              {[
                settingIds.length > 1 ? `${settingIds.length} 份设定` : activeSetting?.name,
                session?.promptId ? prompts.find((p) => p.id === session.promptId)?.name : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
        </div>
        <div className="flex items-center">
          <button
            className="rounded-full p-2 text-neutral-600 active:bg-neutral-100"
            onClick={() => setTreeOpen(true)}
            aria-label="分支图（测试）"
            title="分支图：按轮分层，可以检索和切版本"
          >
            <TreeIcon />
          </button>
          <button
            className="rounded-full p-2 text-neutral-600 active:bg-neutral-100"
            onClick={() => setSettings(true)}
            aria-label="设置"
          >
            <SlidersIcon />
          </button>
        </div>
      </header>

      {/* overflow-x-hidden：消息区只允许纵向滚。断行兜底在 styles.css 的 main 规则里 */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        {session?.recap && (
          <div className="mb-4 rounded-xl bg-neutral-50 px-3 py-2">
            <button
              className="flex w-full items-center justify-between text-[11px] text-neutral-500"
              onClick={() => setRecapOpen((v) => !v)}
            >
              <span>前情摘要 · {session.recap.length} 字</span>
              <span className="text-neutral-400">{recapOpen ? '收起' : '展开'}</span>
            </button>
            {recapOpen && (
              <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-600">
                {session.recap}
              </p>
            )}
          </div>
        )}
        {turns.length === 0 && <ModePicker />}

        {/* 选好的开场白摆在这里：读得到、但还没发出去，按下发送时和你的第一句话一起走 */}
        {turns.length === 0 && openingText && (
          <div ref={openingRef} className="mt-4 rounded-xl border border-dashed border-neutral-200 px-3 py-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-neutral-400">
              <span className="rounded bg-neutral-100 px-1.5 py-px text-neutral-500">开场白</span>
              {openingName && <span className="truncate">{openingName}</span>}
            </div>
            <Markdown content={openingText} />
          </div>
        )}

        {turns.map((turn) => {
          const variant = activeVariant(turn)
          const live = streamingTurnId === turn.id
          // 过程区：思考 + 工具调用，折叠在正文之外
          const calls = variant.assistant?.toolCalls ?? []
          const hasProcess = Boolean(variant.assistant?.reasoning?.trim()) || calls.length > 0
          const userHasContent = Boolean(variant.user.content.trim()) || Boolean(variant.user.attachments?.length)
          // 同一轮里可能搜了多次，按 url 去重后一起列出来；上游搜索的来源单独挂在 assistant 上
          const assistantSources = Array.from(
            new Map(
              [
                ...(variant.assistant?.sources ?? []),
                ...(variant.assistant?.toolCalls ?? []).flatMap((call) => call.sources ?? []),
              ].map((source) => [source.url, source])
            ).values()
          )
          return (
            <div key={turn.id} className="mb-6">
              {userHasContent && (
                  <div className="flex justify-end">
                    <div
                      id={hitElementId({ turnId: turn.id, field: 'user' })}
                      className={`max-w-[80%] rounded-[18px] rounded-br-[6px] bg-[var(--bubble-bg)] px-4 py-2.5 text-[16px] leading-[1.6] text-[var(--bubble-fg)] ${
                        activeHitKey === `${turn.id}-user`
                          ? 'ring-2 ring-amber-400 ring-offset-2'
                          : editingTurnId === turn.id
                            ? 'ring-2 ring-amber-300 ring-offset-2'
                            : ''
                      }`}
                    >
                      {variant.user.attachments?.length ? (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {variant.user.attachments.map((file) =>
                            file.kind === 'image' && file.dataUrl ? (
                              <img
                                key={file.id}
                                src={file.dataUrl}
                                alt={file.name}
                                className="h-24 w-24 rounded-lg object-cover"
                              />
                            ) : (
                              <span
                                key={file.id}
                                className="max-w-[180px] truncate rounded-md bg-white/15 px-2 py-1 text-[11px] text-white/80"
                              >
                                {file.name}
                              </span>
                            )
                          )}
                        </div>
                      ) : null}
                      {variant.user.content.trim() && (
                        <div className="whitespace-pre-wrap">{variant.user.content}</div>
                      )}
                    </div>
                  </div>
                  )}
                  {userHasContent && (
                  <div className="mt-1.5 flex items-center justify-end gap-3.5">
                    {!evolutionMode && (
                      <>
                        <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />
                        <button
                          className="py-0.5 text-[12px] text-neutral-400"
                          onClick={() => startEdit(turn.id)}
                        >
                          编辑
                        </button>
                        {turn.idx > 0 && (
                          <button className="py-0.5 text-[12px] text-neutral-400" onClick={() => void branchFrom(turn.id)}>
                            在此开新话题
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  )}

              <div
                id={hitElementId({ turnId: turn.id, field: 'assistant' })}
                className={`mt-2 w-full rounded-xl ${
                  activeHitKey === `${turn.id}-assistant` ? 'bg-amber-50/70 px-2 py-1 ring-1 ring-amber-300' : ''
                }`}
              >
                {(hasProcess || live) && (
                  <Process
                    reasoning={variant.assistant?.reasoning}
                    calls={calls}
                    live={live && !variant.assistant?.content}
                    status={live ? toolStatus : null}
                    durationMs={variant.assistant?.durationMs}
                  />
                )}
                {variant.assistant?.content ? (
                  config.bubbles ? (
                    /* 气泡模式：助手回复也装进气泡（用户气泡本来就是气泡） */
                    <div className="inline-block max-w-[88%] rounded-2xl rounded-tl-lg bg-neutral-100 px-4 py-3">
                      <Markdown content={variant.assistant.content} />
                    </div>
                  ) : (
                    <Markdown content={variant.assistant.content} />
                  )
                ) : null}

                {assistantSources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assistantSources.map((source, i) => (
                      <button
                        key={source.url}
                        className="max-w-full truncate rounded-md bg-neutral-50 px-2.5 py-1 text-[11px] text-neutral-500 active:bg-neutral-100"
                        onClick={() => void platform().openLink(source.url)}
                        title={source.url}
                      >
                        {i + 1}. {source.title || source.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </button>
                    ))}
                  </div>
                )}

                {variant.assistant && !live && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
                    {activePackId !== 'minimal' && turn.id === turns[turns.length - 1]?.id && (
                      <>
                        {STAGE_DIRECTIONS.map((d) => (
                          <button
                            key={d.label}
                            className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 active:bg-neutral-200"
                            onClick={() => void steer(d.text)}
                            title={d.text}
                          >
                            {d.label}
                          </button>
                        ))}
                      </>
                    )}
                    {greetingTurnId === turn.id && (
                      <button
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600 active:bg-neutral-200"
                        onClick={() => setGreetingOpen(true)}
                      >
                        换开场 {activeGreeting >= 0 ? activeGreeting + 1 : 1}/{greetings.length}
                      </button>
                    )}
                    <button
                      className="flex items-center gap-1 py-0.5 text-[12px] text-neutral-400"
                      onClick={() => void navigator.clipboard?.writeText(variant.assistant?.content ?? '')}
                    >
                      <CopyIcon />
                      复制
                    </button>
                    <button
                      className="flex items-center gap-1 py-0.5 text-[12px] text-neutral-400"
                      onClick={() => setExportTarget({ turnId: turn.id, variant: turn.active })}
                    >
                      <DownloadIcon />
                      导出
                    </button>
                    {/* 开场白这一轮没有用户发言，重新生成只会让模型把开场接着往下写；
                        想换一句请用上面的「换开场」 */}
                    {userHasContent && (!evolutionMode || turn.id === turns[turns.length - 1]?.id) && (
                      <button
                        className="flex items-center gap-1 py-0.5 text-[12px] text-neutral-400"
                        onClick={() => void regenerate(turn.id)}
                      >
                        <RefreshIcon />
                        重新生成
                      </button>
                    )}
                    {!evolutionMode && <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />}
                  </div>
                )}
                {variant.assistant && !live && longMemory && <Feedback turn={turn} />}
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

      <Composer meter={meter} opening={openingText} />
      <SessionDrawer />
      <SettingsSheet />
      {treeOpen && (
        <TreeView
          onClose={() => setTreeOpen(false)}
          evolutionMode={evolutionMode}
          onExport={(turnId, variant) => {
            setTreeOpen(false)
            setExportTarget({ turnId, variant })
          }}
        />
      )}
      {exportTarget && (
        <ExportSheet
          turnId={exportTarget.turnId}
          variant={exportTarget.variant}
          onClose={() => setExportTarget(null)}
        />
      )}
      {greetingOpen && greetingTurnId && (
        <GreetingPicker
          list={greetings}
          active={activeGreeting}
          onClose={() => setGreetingOpen(false)}
          onPick={(i) => {
            void switchGreeting(greetingTurnId, i)
            setGreetingOpen(false)
          }}
        />
      )}
    </div>
  )
}
