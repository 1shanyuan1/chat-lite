import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import ModePickerNext from './ModePickerNext'
import DrawerNext from './DrawerNext'
import TreeViewNext from './TreeViewNext'
import ExportSheetNext from './ExportSheetNext'
import GreetingPickerNext from './GreetingPickerNext'
import PalettePicker from '@/ui/PalettePicker'
import { applyPalette, normalizePalette } from '@/ui/palette'
import { greetingList, greetingScript, type SettingDoc } from '@/chat/settings'
import Markdown from '@/ui/Markdown'
import QuickReplies from '@/ui/QuickReplies'
import GroupSpeakers from '@/ui/GroupSpeakers'
import GroupPanel from '@/ui/GroupPanel'
import { thDomMessage } from '@/ui/th-message-id'
import { mountThRuntime } from '@/chat/th-runtime'
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

/*
 * ── UI 实验版设计语言（落地 docs/ui-design-review.md 的 P0/P1 建议）──
 *
 * 字阶只有 5 档：22 展示 / 17 标题 / 16 正文 / 14 界面 / 12 辅助。
 *   不再出现 9–11px；元信息靠字重与灰度区分，不靠缩小字号。
 * 灰度纪律：正文 neutral-800、界面默认 neutral-600、辅助 neutral-500；
 *   neutral-400 只做占位/禁用；不再用 -300/-400 当可读文字。
 * 圆角两族：rounded-2xl（卡片、面板、气泡、弹层、输入条）+ rounded-full（胶囊、圆钮、搜索框）。
 * 控件统一：次级动作一律「胶囊」（h-7 = 12px 字，h-8 以上 = 14px 字）；
 *   选中 = 黑底白字（pillOn），默认 = 灰底深字（pillOff），危险 = 红描边/红字。
 * 语义色只保留状态：amber 警示、red 危险、emerald 设定命中、blue 链接。无品牌强调色（单色系统）。
 *
 * 逻辑与正式版 App.tsx 逐行对应，只有视觉层不同——评估时看同一份数据。
 */

const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

/** 单行输入：胶囊形（设计语言：所有小控件都是胶囊） */
const field = 'w-full h-10 rounded-full border border-neutral-200 px-4 text-[14px] outline-none focus:border-neutral-500'
/** 多行输入/文本域：容器族（2xl） */
const fieldArea =
  'w-full rounded-2xl border border-neutral-200 px-4 py-2.5 text-[14px] outline-none focus:border-neutral-500'

/** 次级动作胶囊：h-7 配 12px 字。pillOn = 选中态，pillOff = 默认态 */
const pill = 'inline-flex h-7 items-center rounded-full px-3 text-[12px]'
const pillOn = 'bg-neutral-900 text-white'
const pillOff = 'bg-neutral-100 text-neutral-600 active:bg-neutral-200'

/** 分段选择器：灰底圆槽 + 白色滑块（深度随主题变量走，深色下自动反转） */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-full bg-neutral-100 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={`flex-1 rounded-full py-1.5 text-[14px] transition-colors ${
            value === v ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500 active:text-neutral-700'
          }`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/**
 * 某个服务商的模型列表：先吃缓存，没有就现拉一次。（逻辑与正式版一致）
 */
function useProviderModels(config: ChatConfig, baseUrl: string, enabled: boolean) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
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

/** 辅助模型选择（逻辑与正式版一致，视觉统一为胶囊 + 2xl 列表） */
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
  current: ChatConfig
}) {
  const providers = listProviders(current)
  const enabled = value?.enabled ?? false
  const picked = value?.baseUrl ?? ''
  const baseUrl = picked || current.baseUrl
  const { models, loading, failed, reload } = useProviderModels(current, baseUrl, enabled)
  const [query, setQuery] = useState('')

  const patch = (next: Partial<NonNullable<ChatConfig['visionModel']>>) =>
    onChange({ enabled: true, baseUrl: '', model: '', ...value, ...next })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return models
      .filter((m) => (q ? m.id.toLowerCase().includes(q) || (m.label ?? '').toLowerCase().includes(q) : true))
      .sort((a, b) => Number(Boolean(b.vision)) - Number(Boolean(a.vision)))
  }, [models, query])

  return (
    <div className="mb-3 rounded-2xl bg-neutral-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium text-neutral-600">{title}</span>
        <button className={`${pill} ${enabled ? pillOn : pillOff}`} onClick={() => onChange({ enabled: !enabled, baseUrl: value?.baseUrl, model: value?.model })}>
          {enabled ? '已开启' : '关闭'}
        </button>
      </div>

      {enabled && (
        <>
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-0.5">
            <button className={`${pill} shrink-0 ${picked ? pillOff : pillOn}`} onClick={() => patch({ baseUrl: '', model: '' })}>
              当前服务商
            </button>
            {providers
              .filter((p) => !p.current)
              .map((p) => (
                <button
                  key={p.baseUrl}
                  className={`${pill} shrink-0 ${picked === p.baseUrl ? pillOn : pillOff}`}
                  onClick={() => patch({ baseUrl: p.baseUrl, model: '' })}
                >
                  {p.label}
                </button>
              ))}
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
            <input
              className="w-full border-b border-neutral-100 px-3 py-2 text-[14px] outline-none placeholder:text-neutral-400"
              placeholder={models.length > 0 ? `在 ${models.length} 个模型里搜` : '模型名'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-40 overflow-y-auto">
              {!picked && (
                <button
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-[14px] ${
                    !value?.model ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                  }`}
                  onClick={() => patch({ model: '' })}
                >
                  <span className="truncate">沿用当前对话的模型</span>
                  <span className={`shrink-0 text-[12px] ${!value?.model ? 'text-white/60' : 'text-neutral-400'}`}>
                    {current.model}
                  </span>
                </button>
              )}

              {loading && <p className="px-3 py-2.5 text-[12px] text-neutral-400">正在获取模型列表…</p>}
              {!loading && failed && (
                <p className="px-3 py-2.5 text-[12px] leading-relaxed text-neutral-500">
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
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left ${
                        active ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                      }`}
                      onClick={() => patch({ model: model.id })}
                    >
                      <span className="min-w-0 truncate text-[14px]">{model.label ?? model.id}</span>
                      <span className={`shrink-0 text-[12px] ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                        {model.vision ? '图 · ' : ''}
                        {model.contextLength ? `${Math.round(model.contextLength / 1000)}k` : model.id}
                      </span>
                    </button>
                  )
                })}
              {!loading && !failed && visible.length === 0 && models.length > 0 && (
                <p className="px-3 py-2.5 text-[12px] text-neutral-400">没有匹配的模型</p>
              )}
            </div>
          </div>

          {(failed || models.length === 0) && (
            <input className={`${field} mt-2`} placeholder="手填模型名（留空用当前模型）" value={value?.model ?? ''} onChange={(e) => patch({ model: e.target.value })} />
          )}

          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{hint}</p>
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
 * 标题 12px 辅助灰；展开后思考与工具详情同为辅助层，不给正文抢戏。
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

  const title = live
    ? status || '正在思考…'
    : `过程${count > 0 ? ` ${count} 步` : ''}${durationMs ? ` · ${formatDuration(durationMs)}` : ''}`

  return (
    <div className="mb-2">
      <button className="flex items-center gap-1 py-0.5 text-[12px] text-neutral-500" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="text-neutral-400">{open ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}</span>
      </button>

      {open && (hasThinking || count > 0) && (
        <div className="mt-1.5 border-l-2 border-neutral-200 pl-3">
          {hasThinking && (
            <div className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-500">
              {reasoning}
            </div>
          )}
          {(calls ?? []).map((call, i) => {
            const summary = toolSummary(call)
            return (
              <div key={call.id} className="mb-2">
                <button className="flex w-full items-center gap-1.5 text-left" onClick={() => setOpenCall(openCall === i ? null : i)}>
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[12px] text-neutral-600">
                    {TOOL_LABEL[call.name] ?? call.name}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-600">{summary}</span>
                </button>
                {openCall === i && (
                  <div className="mt-1.5 space-y-1.5 rounded-2xl bg-neutral-50 p-3 text-[12px] leading-relaxed text-neutral-500">
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
    <span className="inline-flex h-7 items-center gap-0.5 rounded-full bg-neutral-100 px-1.5 text-[12px] text-neutral-600">
      <button className="p-0.5 disabled:opacity-30" disabled={turn.active === 0} onClick={() => onSwitch(turn.active - 1)} aria-label="上一版">
        <ChevronLeftIcon />
      </button>
      <span className="tabular-nums">
        {turn.active + 1}/{turn.variants.length}
      </span>
      <button
        className="p-0.5 disabled:opacity-30"
        disabled={turn.active === turn.variants.length - 1}
        onClick={() => onSwitch(turn.active + 1)}
        aria-label="下一版"
      >
        <ChevronRightIcon />
      </button>
    </span>
  )
}

/**
 * 赞/踩。点任一按钮都邀请写具体原因（逻辑与正式版一致）。
 * 实验版里收进「详情」展开层，不再常驻每条回答下方。
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

  if (done) return <p className="mt-2 text-[12px] text-neutral-500">已记下，谢谢</p>

  if (!rating) {
    return (
      <div className="mt-2 flex items-center gap-1.5">
        <span className="text-[12px] text-neutral-500">这条回答对你有用吗？</span>
        <button className={`${pill} ${pillOff}`} onClick={() => setRating('up')}>
          赞
        </button>
        <button className={`${pill} ${pillOff}`} onClick={() => setRating('down')}>
          踩
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-2xl bg-white p-3">
      <textarea
        className="h-16 w-full resize-none bg-transparent text-[14px] leading-relaxed outline-none placeholder:text-neutral-400"
        placeholder={rating === 'up' ? '哪里好？说具体一点它才知道该保持什么' : '哪里不对？说具体一点它才知道该避开什么'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex items-center justify-end gap-2">
        <button className="px-2 py-1 text-[12px] text-neutral-500" onClick={() => void commit(rating, '')} disabled={busy}>
          跳过
        </button>
        <button className={`${pill} ${pillOn} px-3.5 disabled:opacity-40`} onClick={() => void commit(rating, text)} disabled={busy || !text.trim()}>
          提交
        </button>
      </div>
    </div>
  )
}

/**
 * 回答元信息：正式版有 4 层附属物（舞台指令 / 操作行 / 赞踩 / 用量行），
 * 实验版收敛为一行元信息 + 一行操作 + 可展开的「详情」。
 * 用量、赞踩、设定条目全部收进详情层——正文之外最多两行。
 */
function AnswerMeta({
  turn,
  showFeedback,
}: {
  turn: ChatTurn
  showFeedback: boolean
}) {
  const assistant = activeVariant(turn).assistant
  const [showWorld, setShowWorld] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (!assistant) return null
  const usage = assistant.usage
  const chars = [...assistant.content.trim()].length
  if (!usage && chars === 0) return null

  const hasProcess = Boolean(assistant.reasoning?.trim()) || (assistant.toolCalls?.length ?? 0) > 0
  const showDuration = !hasProcess && assistant.durationMs
  const level = assistant.reasoningLevel
  const levelLabel = level === 'off' ? '关' : level ? labelOf(level) : '默认'
  const hasDetails = Boolean(usage) || Boolean(assistant.worldEntries?.length) || showFeedback

  return (
    <div className="mt-1.5">
      {/* 元信息行：辅助层，一行说完，超出折叠 */}
      <div className="flex items-center gap-x-2 gap-y-1 overflow-hidden text-[12px] text-neutral-500">
        {assistant.speaker && (
          <span className="shrink-0 rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-white">
            {assistant.speaker}
          </span>
        )}
        <span className="min-w-0 truncate">{assistant.model}</span>
        {assistant.reasoningSupported && <span className="shrink-0">思考·{levelLabel}</span>}
        {chars > 0 && <span className="shrink-0 tabular-nums">{chars.toLocaleString('zh-CN')} 字</span>}
        {showDuration && <span className="shrink-0 tabular-nums">{formatDuration(assistant.durationMs!)}</span>}
        {usage && (
          <span className="shrink-0 tabular-nums">
            入 {formatTokens(usage.input)} / 出 {formatTokens(usage.output)}
          </span>
        )}
        {usage && usage.cacheRead > 0 && (
          <span className="shrink-0 tabular-nums">
            命中 {isCacheEstimated(usage) ? '≈' : ''}
            {formatTokens(usage.cacheRead)}
          </span>
        )}
        {assistant.worldEntries?.length ? (
          <button className="shrink-0 font-medium text-emerald-600" onClick={() => setShowWorld((v) => !v)}>
            设定 {assistant.worldEntries.length}
          </button>
        ) : null}
        {hasDetails && (
          <button
            className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-neutral-500"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-label="展开详情"
          >
            详情
            <span className="text-neutral-400">{detailsOpen ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}</span>
          </button>
        )}
      </div>

      {showWorld && assistant.worldEntries?.length ? (
        <div className="mt-1.5 rounded-2xl bg-emerald-50 px-3 py-2">
          {assistant.worldEntries.map((text, i) => (
            <div key={i} className="text-[12px] leading-relaxed text-emerald-800">
              · {text}…
            </div>
          ))}
        </div>
      ) : null}

      {detailsOpen && (
        <div className="mt-1.5 rounded-2xl bg-neutral-50 p-3">
          {usage && (
            <>
              <div className="mb-1.5 text-[12px] text-neutral-500">{usage.estimated ? '本轮消耗 · 含估算' : '本轮消耗'}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] tabular-nums text-neutral-600">
                <span>输入 {formatTokens(usage.input)}</span>
                <span>输出 {formatTokens(usage.output)}</span>
                {usage.cacheRead > 0 && (
                  <span>
                    命中 {isCacheEstimated(usage) ? '≈' : ''}
                    {formatTokens(usage.cacheRead)}
                  </span>
                )}
                {usage.cacheWrite ? <span>写入缓存 {formatTokens(usage.cacheWrite)}</span> : null}
                {usage.estimated && <span className="text-neutral-500">接口未返回精确用量，整条按字数估算</span>}
              </div>
            </>
          )}
          {showFeedback && <Feedback turn={turn} />}
        </div>
      )}
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
        className={`${field} mb-2`}
        placeholder={`搜索服务商（共 ${PROVIDERS.length} 家）`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-64 overflow-y-auto rounded-2xl border border-neutral-200">
        {PROVIDER_GROUPS.map((group) => {
          const items = filtered.filter((p) => p.group === group)
          if (items.length === 0) return null
          return (
            <div key={group}>
              <div className="bg-neutral-50 px-3 py-1.5 text-[12px] text-neutral-500">{group}</div>
              {items.map((p) => {
                const active = p.id === current?.id
                return (
                  <button
                    key={p.id}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left ${
                      active ? 'bg-neutral-900 text-white' : 'text-neutral-700'
                    }`}
                    onClick={() => onPick(p)}
                  >
                    <span className="truncate text-[14px]">{p.label}</span>
                    <span className={`shrink-0 text-[12px] ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                      {p.protocol === 'anthropic' || p.protocol === 'gemini' ? p.protocol : hostOf(p.baseUrl)}
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {filtered.length === 0 && <p className="px-3 py-3 text-[12px] text-neutral-400">没有匹配的服务商</p>}
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
        className={`${field} mb-2`}
        placeholder={`搜索模型（共 ${models.length} 个）`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-56 overflow-y-auto rounded-2xl border border-neutral-200">
        {filtered.length === 0 && <p className="px-3 py-3 text-[12px] text-neutral-400">没有匹配的模型</p>}
        {filtered.map((m) => {
          const active = m.id === value
          return (
            <button
              key={m.id}
              className={`block w-full px-3 py-2.5 text-left ${active ? 'bg-neutral-900 text-white' : 'text-neutral-700'}`}
              onClick={() => onPick(m)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[14px]">
                  {m.id}
                  {m.label && m.label !== m.id && <span className="ml-1 opacity-50">{m.label}</span>}
                </span>
                <span className={`shrink-0 text-[12px] ${active ? 'text-white/60' : 'text-neutral-400'}`}>
                  {m.contextLength ? `${Math.round(m.contextLength / 1000)}k` : ''}
                  {m.vision ? ' · 图' : ''}
                </span>
              </div>
              {(m.inputPrice || m.outputPrice) && (
                <div className={`mt-0.5 text-[12px] ${active ? 'text-white/60' : 'text-neutral-500'}`}>
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

/** 模型面板里的数值参数：失焦或回车才提交（逻辑与正式版一致） */
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
      <span className="w-[56px] shrink-0 text-[12px] text-neutral-500">{label}</span>
      <input
        className="h-8 min-w-0 flex-1 rounded-full border border-neutral-200 bg-white px-3 text-[14px] tabular-nums outline-none focus:border-neutral-500 disabled:bg-neutral-100 disabled:text-neutral-400"
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
      {hint && <span className="shrink-0 text-[12px] text-neutral-400">{hint}</span>}
    </label>
  )
}

/** 长记忆的开关与查看（逻辑与正式版一致，卡片统一 2xl） */
function MemorySection({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { clearMemory, listMemoryFiles } = useApp()
  const [profile, setProfile] = useState('')
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [warned, setWarned] = useState(false)
  const [busy, setBusy] = useState(false)

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
        className="mb-2 flex w-full items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3 text-left"
        onClick={() => onChange(!value)}
      >
        <span className="min-w-0 pr-2">
          <span className="block text-[14px] text-neutral-800">长记忆</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">
            只在极简模式生效。它会自己记下关于你的事，回答时只给成品。
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] ${value ? pillOn : 'bg-neutral-100 text-neutral-600'}`}>
          {value ? '已开启' : '已关闭'}
        </span>
      </button>

      <div className="mb-2 flex items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3">
        <span className="min-w-0 pr-2">
          <span className="block text-[14px] text-neutral-800">查看画像</span>
          <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">
            只读，默认关闭。这是测试功能，画像难免有令人不满之处。
          </span>
        </span>
        <button
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] ${open ? pillOn : pillOff}`}
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
        <p className="mb-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
          它记下的东西难免有偏差，也可能让你不快。看到了容易反复琢磨「它怎么这么看我」，而实际效果并不因此变好。再点一次「查看」继续。
        </p>
      )}

      {open && (
        <pre className="mb-2 whitespace-pre-wrap break-words rounded-2xl bg-neutral-50 p-3 text-[12px] leading-relaxed text-neutral-600">
          {profile.trim() || '还没有画像。它只在觉得「值得长期记住」时才写；点一次赞或踩、写两句原因，画像会立刻更新。'}
        </pre>
      )}

      <button
        className="w-full rounded-full border border-red-200 py-2.5 text-[14px] text-red-600 disabled:opacity-40"
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

/** 设置里的小节标题：12px 辅助灰，靠间距分节（不再用细线切割）。
 *  必须放在组件外——内联组件会让每次重渲染都整棵重挂载子树（丢焦点、丢内部状态） */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="mb-3 text-[12px] font-medium text-neutral-500">{title}</div>
      {children}
    </div>
  )
}

/** 输入框上方的可展开面板统一容器（同样必须模块级，理由同上） */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 rounded-2xl bg-neutral-50 p-3">{children}</div>
}

/** 设置面板：按「外观 / 连接 / 行为」三节重排（逻辑与正式版一致，仅重组与换肤） */
function SettingsSheet() {
  const { config, saveConfig, settingsOpen, setSettings } = useApp()
  const [draft, setDraft] = useState<ChatConfig>(config)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)

  const provider = findProvider(draft.baseUrl)
  const protocol = resolveProtocol(draft.protocol, draft.baseUrl)
  const canListModels = provider?.supportsModelList !== false

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

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={() => setSettings(false)} />
      <div className="relative max-h-[90%] overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[17px] font-medium text-neutral-800">设置</h2>
          <button className={`${pill} ${pillOff}`} onClick={() => setSettings(false)}>
            关闭
          </button>
        </div>

        <Section title="外观">
          <div className="rounded-2xl border border-neutral-200 p-4">
            {/* 明暗已并入色组（预设自带浅/深两套，自定义面板里有明暗切换），
                这里不再有独立的浅色/深色开关 */}
            <div className="mb-2 text-[12px] text-neutral-500">色组</div>
            <PalettePicker
              theme={config.theme === 'dark' ? 'dark' : 'light'}
              palette={normalizePalette(config.palette)}
              onChange={({ theme, palette }) => saveConfig({ theme, palette })}
            />
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="mb-2 text-[12px] text-neutral-500">消息样式</div>
              <Segmented
                value={config.bubbles ? 'bubble' : 'flat'}
                options={[
                  ['flat', '平铺'],
                  ['bubble', '气泡'],
                ]}
                onChange={(v) => saveConfig({ bubbles: v === 'bubble' })}
              />
            </div>
            <div className="mt-3 border-t border-neutral-100 pt-3">
              <div className="mb-2 text-[12px] text-neutral-500">圆角风格</div>
              <Segmented
                value={config.corners ?? 'round'}
                options={[
                  ['round', '圆角'],
                  ['sharp', '直角'],
                ]}
                onChange={(v) => saveConfig({ corners: v })}
              />
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">点一下立即生效，不用保存。</p>
          </div>
        </Section>

        <Section title="连接">
          <label className="mb-1.5 block text-[12px] text-neutral-500">服务商</label>
          <button
            className="mb-3 flex w-full items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3 text-left"
            onClick={() => setProviderOpen((v) => !v)}
          >
            <span className="text-[14px] text-neutral-800">{provider?.label ?? PROVIDER_LABEL_CUSTOM}</span>
            <span className="text-[12px] text-neutral-500">{providerOpen ? '收起 ▲' : '更换 ▾'}</span>
          </button>

          {providerOpen && (
            <div className="mb-3">
              <ProviderPicker
                current={provider}
                onPick={(p: Provider) => applyProvider({ ...draft, baseUrl: p.baseUrl, protocol: p.protocol, model: p.model ?? '' })}
              />
            </div>
          )}

          <label className="mb-1.5 block text-[12px] text-neutral-500">API 地址</label>
          <input className={`${field} mb-3`} value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />

          <label className="mb-1.5 block text-[12px] text-neutral-500">API Key</label>
          <input
            className={`${field} mb-3`}
            type="password"
            placeholder="sk-..."
            value={draft.apiKey}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          />

          <label className="mb-1.5 block text-[12px] text-neutral-500">联网搜索 Key（可选）</label>
          <input
            className={`${field} mb-1.5`}
            type="password"
            placeholder="留空则复用上面的 Key（仅 DeepSeek 地址）"
            value={draft.searchApiKey ?? ''}
            onChange={(e) => setDraft({ ...draft, searchApiKey: e.target.value || undefined })}
          />
          <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
            填了走 DeepSeek 搜索（结构化、稳定，约 ¥0.005 一次）；不填也可以改用「自定义接口」。用哪种搜索在输入框上的开关里选。
          </p>

          <label className="mb-1.5 block text-[12px] text-neutral-500">本地搜索源</label>
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
                className={`rounded-full px-3.5 py-1.5 text-[12px] ${
                  (draft.searchSource === 'custom' || draft.searchSource === 'native' ? draft.searchSource : 'deepseek') === value
                    ? pillOn
                    : pillOff
                }`}
                onClick={() => setDraft({ ...draft, searchSource: value })}
              >
                {label}
              </button>
            ))}
          </div>
          {draft.searchSource === 'native' && (
            <>
              <p className="mb-2 text-[12px] leading-relaxed text-neutral-500">
                用一次额外的模型调用换搜索结果：主对话上下文更干净，来源也结构化，代价是多一次调用费。
                想「主对话用 A、搜索借 B」就在下面挑一个别的服务商。
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
            <div className="mb-3 rounded-2xl bg-neutral-50 p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {CUSTOM_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className="rounded-full bg-white px-2.5 py-1 text-[12px] text-neutral-600 ring-1 ring-neutral-200"
                    onClick={() => setDraft({ ...draft, searchCustom: { ...preset.config, key: draft.searchCustom?.key } })}
                  >
                    {preset.label}
                  </button>
                ))}
                <span className="self-center text-[12px] text-neutral-400">点一下自动填</span>
              </div>

              <input
                className={`${field} mb-2`}
                placeholder="接口地址，可含 {{query}}"
                value={draft.searchCustom?.url ?? ''}
                onChange={(e) => patchCustom({ url: e.target.value })}
              />
              <input
                className={`${field} mb-2`}
                type="password"
                placeholder="Key（默认放进 Authorization: Bearer）"
                value={draft.searchCustom?.key ?? ''}
                onChange={(e) => patchCustom({ key: e.target.value })}
              />

              <div className="mb-2 flex gap-1.5">
                {(['GET', 'POST'] as const).map((method) => (
                  <button
                    key={method}
                    className={`rounded-full px-3 py-1.5 text-[12px] ${
                      (draft.searchCustom?.method ?? 'POST') === method ? pillOn : pillOff
                    }`}
                    onClick={() => patchCustom({ method })}
                  >
                    {method}
                  </button>
                ))}
              </div>

              <textarea
                className={`${fieldArea} mb-2 h-14 resize-none font-mono text-[12px]`}
                placeholder='请求头 JSON（可选），如 {"X-API-KEY":"{{key}}"}'
                value={draft.searchCustom?.headers ?? ''}
                onChange={(e) => patchCustom({ headers: e.target.value })}
              />
              <textarea
                className={`${fieldArea} h-14 resize-none font-mono text-[12px]`}
                placeholder='请求体模板（POST 用），默认 {"query":"{{query}}","count":{{count}}}'
                value={draft.searchCustom?.body ?? ''}
                onChange={(e) => patchCustom({ body: e.target.value })}
              />
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
                占位符：{'{{query}}'} 查询词、{'{{count}}'} 条数、{'{{key}}'} 你的 Key。
                返回结构会自动识别常见的 results / data / webPages 等字段。
              </p>
            </div>
          )}

          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-[12px] text-neutral-500">协议</label>
            <span className="text-[12px] text-neutral-400">{draft.protocol === 'auto' ? `自动 → ${protocol}` : ''}</span>
          </div>
          <div className="mb-3 flex flex-wrap gap-1.5">
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
                className={`rounded-full px-3.5 py-1.5 text-[12px] ${draft.protocol === key ? pillOn : pillOff}`}
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

          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-[12px] text-neutral-500">模型</label>
            {canListModels ? (
              <button className="text-[14px] text-blue-600 disabled:opacity-40" disabled={loading} onClick={() => load(draft)}>
                {loading ? '获取中…' : models.length ? '刷新' : '获取模型列表'}
              </button>
            ) : (
              <span className="text-[12px] text-neutral-400">该平台不提供模型列表</span>
            )}
          </div>
          <input className={`${field} mb-2`} value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />

          {provider?.modelHint && (
            <p className="mb-2 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">{provider.modelHint}</p>
          )}

          {error && <p className="mb-2 text-[12px] leading-relaxed text-red-600">拉取失败：{error}，可直接手填模型名</p>}

          {models.length > 0 && (
            <div className="mb-3">
              <ModelPicker
                models={models}
                value={draft.model}
                onPick={(m) =>
                  setDraft((prev) => ({
                    ...prev,
                    model: m.id,
                    contextLimit: m.contextLength ?? (m.id === prev.model ? prev.contextLimit : undefined),
                  }))
                }
              />
            </div>
          )}

          <label className="mb-1.5 block text-[12px] text-neutral-500">上下文上限（token，留空则不做超限提醒）</label>
          <input
            className={`${field} mb-1`}
            inputMode="numeric"
            placeholder="例如 128000"
            value={draft.contextLimit ?? ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d]/g, '')
              setDraft({ ...draft, contextLimit: raw ? Number(raw) : undefined })
            }}
          />

          <label className="mb-1.5 mt-4 block text-[12px] text-neutral-500">辅助识图</label>
          <AuxModelPicker
            title="识图模型"
            hint="图片会先由这个模型转成文字描述，再交给主模型——主模型不需要支持看图。关掉就把原图直接发给主模型。"
            value={draft.visionModel}
            onChange={(next) => setDraft({ ...draft, visionModel: next })}
            current={draft}
          />
        </Section>

        <Section title="行为">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-[12px] text-neutral-500">压缩预警</label>
            <span className="text-[12px] tabular-nums text-neutral-500">{draft.compressAt ?? 80}%</span>
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
          <p className="mb-4 text-[12px] leading-relaxed text-neutral-500">
            上下文占用到这个比例时，输入框上方会变成提醒条。平时也可以点那一行的「压缩」手动压缩——
            保留最近两轮原文，更早的压成前情摘要，原会话不删。
          </p>

          <button
            className="mb-2 flex w-full items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3 text-left"
            onClick={() => setDraft({ ...draft, settingEvolution: !draft.settingEvolution })}
          >
            <span className="min-w-0 pr-2">
              <span className="block text-[14px] text-neutral-800">设定发展模式</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-neutral-500">
                写作时 AI 会把设定复制成一份发展稿，边写边补。原卡不动，副本可以查看和导出。
              </span>
            </span>
            <span className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] ${draft.settingEvolution ? pillOn : 'bg-neutral-100 text-neutral-600'}`}>
              {draft.settingEvolution ? '已开启' : '已关闭'}
            </span>
          </button>
          <p className="mb-4 text-[12px] leading-relaxed text-neutral-500">
            只对写作模式生效。开启后新开的会话会挂发展稿；同一张卡重复开会话会复用同一份。
          </p>

          <label className="mb-1.5 block text-[12px] text-neutral-500">我的名字</label>
          <input
            className={`${field} mb-1`}
            placeholder="你"
            value={draft.userName ?? ''}
            onChange={(e) => setDraft({ ...draft, userName: e.target.value || undefined })}
          />
          <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
            角色卡里的 <code>{'{{user}}'}</code> 会替换成这个名字。留空则显示「你」。
          </p>

          <label className="mb-1.5 block text-[12px] text-neutral-500">我的设定（可选）</label>
          <textarea
            className={`${fieldArea} mb-1 h-24`}
            placeholder="一段自我介绍：身份、外貌、和角色的关系。角色会把它当成对你的已知信息。"
            value={draft.persona ?? ''}
            onChange={(e) => setDraft({ ...draft, persona: e.target.value || undefined })}
          />
          <p className="mb-4 text-[12px] leading-relaxed text-neutral-500">
            只在挂了设定文件（角色卡/世界书）时注入。支持 <code>{'{{user}}'}</code>，<code>{'{{char}}'}</code> 会替换成角色名。
          </p>

          <MemorySection value={Boolean(draft.longMemory)} onChange={(v) => setDraft({ ...draft, longMemory: v })} />
        </Section>

        <button
          className="mt-2 w-full rounded-full bg-neutral-900 py-3.5 text-[14px] text-white"
          onClick={() => {
            let next = draft
            if (draft.longMemory && !config.longMemory) {
              const protocol = resolveProtocol(draft.protocol, draft.baseUrl)
              const efforts = reasoningEfforts(protocol, draft.baseUrl, draft.model, models.find((m) => m.id === draft.model))
              const level = efforts.some((e) => e.id === 'high') ? 'high' : undefined
              if (level && (!next.reasoningLevel || next.reasoningLevel === 'off')) {
                next = { ...next, reasoningLevel: level }
              }
            }
            saveConfig(next)
            setSettings(false)
          }}
        >
          保存
        </button>
        <p className="mt-3 text-center text-[12px] leading-relaxed text-neutral-500">
          Key 只保存在本机，请求直连你填写的接口，不经过任何中转
        </p>
      </div>
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
  const efforts = reasoningEfforts(protocol, config.baseUrl, config.model, currentModel)
  const reasoningValue = config.reasoningLevel
  const reasoningLabel = efforts.find((option) => option.id === reasoningValue)?.label ?? '默认'
  const searchMode = resolveSearchMode(config)
  const searchSource = resolveSearchSource(config)
  const visionReady = Boolean(resolveVisionTarget(config))
  const searchStatuses = searchModeStatuses(config, protocol, findProvider(config.baseUrl)?.id)
  const activeSearch = searchStatuses.find((status) => status.id === searchMode) ?? searchStatuses[0]
  const searchLabel = searchMode === 'off' ? '联网' : (activeSearch?.label ?? '联网').replace(' · 推荐', '')

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
      await editResend(editingTurnId, draft, files)
    } else {
      await send(draft, payload)
    }
    if (!useApp.getState().draft) setFiles([])
  }

  return (
    <div className="bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5">
      {meter}

      {editingTurnId && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] leading-relaxed text-amber-800">
            正在改写第 {(editingTurn?.idx ?? 0) + 1} 轮，发送后重新生成
          </span>
          <button className="shrink-0 text-[12px] font-medium text-amber-700" onClick={cancelEdit}>
            取消
          </button>
        </div>
      )}

      {/* 功能胶囊行：模型 / 思考 / 联网，同一形状同一高度 */}
      <div className="mb-2 flex items-center gap-1.5">
        <button
          className={`${pill} min-w-0 ${modelOpen ? pillOn : pillOff}`}
          onClick={() => {
            setReasonOpen(false)
            setModelOpen((v) => !v)
          }}
        >
          <span className="max-w-[150px] truncate">{config.model || '选模型'}</span>
          <span className="shrink-0 pl-0.5 opacity-60">{modelOpen ? '×' : '▾'}</span>
        </button>

        {efforts.length > 0 && (
          <button
            className={`${pill} shrink-0 ${reasonOpen ? pillOn : pillOff}`}
            onClick={() => {
              setModelOpen(false)
              setReasonOpen((v) => !v)
            }}
          >
            思考 {reasoningLabel}
            <span className="shrink-0 pl-0.5 opacity-60">{reasonOpen ? '×' : '▾'}</span>
          </button>
        )}

        <button className={`${pill} shrink-0 ${searchMode !== 'off' ? pillOn : pillOff}`} onClick={() => {
          setModelOpen(false)
          setReasonOpen(false)
          setSearchOpen((v) => !v)
        }}>
          {searchLabel}
        </button>

        {modelsLoading && <span className="text-[12px] text-neutral-400">拉取模型…</span>}
      </div>

      {searchOpen && (
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">联网搜索</span>
            {activeSearch?.recommended && <span className="text-[12px] text-emerald-600">当前模型支持自带搜索</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searchStatuses.map((status) => (
              <button
                key={status.id}
                disabled={!status.available}
                title={status.reason}
                className={`${pill} disabled:opacity-40 ${searchMode === status.id ? pillOn : 'bg-white text-neutral-600'}`}
                onClick={() => {
                  saveConfig({ searchMode: status.id })
                  setSearchOpen(false)
                }}
              >
                {status.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{searchModeHint(activeSearch, searchSource.label)}</p>
        </Panel>
      )}

      {modelOpen && (
        <Panel>
          {modelsError && <p className="mb-1.5 text-[12px] text-red-600">{modelsError}</p>}
          {models.length === 0 && !modelsLoading ? (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-500">还没有模型列表</span>
              <button className="text-[12px] text-blue-600" onClick={() => void loadModels(true)}>
                拉取
              </button>
            </div>
          ) : (
            <ModelPicker
              models={models}
              value={config.model}
              onPick={(m) => {
                selectModel(m)
              }}
            />
          )}

          <div className="mt-2 space-y-2 border-t border-neutral-200 pt-2.5">
            <ParamInput label="温度" value={config.temperature} placeholder="默认" hint={tempHint} disabled={tempDisabled} onCommit={(v) => saveConfig({ temperature: v })} />
            <ParamInput label="最大输出" value={config.maxTokens} placeholder="默认" onCommit={(v) => saveConfig({ maxTokens: v })} />
            <ParamInput
              label="上下文"
              value={config.contextLimit}
              placeholder="未声明，手填"
              hint={currentModel?.contextLength === config.contextLimit ? '来自模型' : undefined}
              onCommit={(v) => saveConfig({ contextLimit: v })}
            />
          </div>
        </Panel>
      )}

      {reasonOpen && (
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">思考强度</span>
            <button className="text-[12px] text-blue-600" onClick={() => void loadModels(true)}>
              刷新模型信息
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`${pill} ${reasoningValue === undefined ? pillOn : 'bg-white text-neutral-600'}`}
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
                className={`${pill} ${reasoningValue === option.id ? pillOn : 'bg-white text-neutral-600'}`}
                onClick={() => {
                  setReasoningLevel(option.id)
                  setReasonOpen(false)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
            档位由服务商的方言决定，不支持的选项不会出现
            {reasoningValue === undefined ? '；默认表示不发送参数，用服务商自己的设置' : ''}
          </p>
        </Panel>
      )}

      {pack.actions.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <button className={`${pill} shrink-0 ${packOpen ? pillOn : pillOff}`} onClick={() => setPackOpen((v) => !v)}>
            {pack.name}
          </button>
          {pack.actions.map((action) => (
            <button key={action.id} className={`${pill} shrink-0 border border-neutral-200 bg-white text-neutral-600 active:bg-neutral-100`} onClick={() => applyAction(action.template)}>
              {action.label}
            </button>
          ))}
        </div>
      )}

      {packOpen && (
        <Panel>
          <div className="flex gap-1.5">
            {BUILTIN_PACKS.map((p) => (
              <button
                key={p.id}
                className={`h-8 flex-1 rounded-full text-[12px] ${p.id === pack.id ? pillOn : 'bg-white text-neutral-600'}`}
                onClick={() => {
                  void setPack(p.id)
                  setPackOpen(false)
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{pack.hint}</p>
        </Panel>
      )}

      {(files.length > 0 || attachError) && (
        <div className="mb-2">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((file) => (
                <div key={file.id} className="relative flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white py-1.5 pl-1.5 pr-7">
                  {file.kind === 'image' && file.dataUrl ? (
                    <img src={file.dataUrl} alt={file.name} className="h-8 w-8 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100 text-[12px] text-neutral-500">文</span>
                  )}
                  <span className="max-w-[120px] truncate text-[12px] text-neutral-600">{file.name}</span>
                  <span className="shrink-0 text-[12px] text-neutral-400">{formatSize(file.size)}</span>
                  <button
                    className="absolute right-1.5 top-1.5 rounded text-neutral-400 active:text-red-600"
                    onClick={() => setFiles((prev) => prev.filter((f) => f.id !== file.id))}
                    aria-label={`移除 ${file.name}`}
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachError && <p className="mt-1.5 text-[12px] leading-relaxed text-red-600">{attachError}</p>}
          {!attachError && files.some((f) => f.kind === 'image') && currentModel && !currentModel.vision && !visionReady && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-700">当前模型未声明支持图片，可能无法识别</p>
          )}
        </div>
      )}

      {toolStatus && (
        <p className="mb-2 flex items-center gap-1.5 text-[12px] text-neutral-500">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
          {toolStatus}
        </p>
      )}

      <GroupSpeakers />
      <QuickReplies />

      <div className="flex items-end gap-2 rounded-2xl bg-neutral-100 px-2.5 py-1.5">
        <button
          className="mb-1 shrink-0 rounded-full p-2 text-neutral-600 active:bg-neutral-200 disabled:opacity-40"
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
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white active:bg-neutral-700"
            onClick={stop}
            aria-label="停止生成"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white active:bg-neutral-700 disabled:bg-neutral-300"
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

export default function AppNext() {
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

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = config.theme === 'dark' ? 'dark' : 'light'
    root.dataset.corners = config.corners === 'sharp' ? 'sharp' : 'round'
    // 色组：重写全套 --color-* 中性阶，对两种主题、所有组件全局生效
    applyPalette(root, normalizePalette(config.palette), config.theme === 'dark' ? 'dark' : 'light')
  }, [config.theme, config.corners, config.palette])
  const settingIds = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
  const activeSetting = settings.find((d) => d.id === settingIds[0])
  const activePackId = findPack(sessions.find((s) => s.id === currentId)?.packId ?? config.packId).id
  const longMemory = Boolean(config.longMemory) && activePackId === 'minimal'
  const [statsOpen, setStatsOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [greetingOpen, setGreetingOpen] = useState(false)
  const [recapOpen, setRecapOpen] = useState(false)
  const [exportTarget, setExportTarget] = useState<{ turnId: string; variant: number } | null>(null)

  const sessionDocs = useMemo(() => {
    const ids = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
    return ids.map((id) => settings.find((d) => d.id === id)).filter((d): d is SettingDoc => Boolean(d))
  }, [session, settings])
  const userName = config.userName ?? '你'
  const greetings = useMemo(() => greetingList(sessionDocs, config.userName ?? '你'), [sessionDocs, config.userName])
  const evolutionMode =
    Boolean(config.settingEvolution) && activePackId === 'writing' && sessionDocs.some((doc) => Boolean(doc.derivedFrom))
  const pendingDocs = useMemo(
    () =>
      pendingSettingIds
        .map((id) => settings.find((d) => d.id === id))
        .filter((d): d is SettingDoc => Boolean(d)),
    [pendingSettingIds, settings]
  )
  // 酒馆助手运行时：挂了带全局脚本的卡时启用（含起始页预挂的卡——开场面板要能在发第一条前交互）
  useEffect(() => {
    const docs = sessionDocs.some((d) => (d.helperScripts?.length ?? 0) > 0) ? sessionDocs : pendingDocs
    if (docs.some((d) => (d.helperScripts?.length ?? 0) > 0)) {
      mountThRuntime(docs)
    }
  }, [sessionDocs, pendingDocs])
  const openingText = turns.length === 0 ? greetingScript(pendingDocs, config.userName ?? '你', pendingGreetingIndex) : ''
  const openingName = pendingDocs.find((d) => d.firstMessage?.trim() || (d.greetings?.length ?? 0) > 0)?.name ?? ''
  const firstTurn = turns[0]
  const greetingTurnId =
    firstTurn && turns.length === 1 && !activeVariant(firstTurn).user.content.trim() && greetings.length > 1 ? firstTurn.id : null
  const activeGreeting = greetingTurnId ? greetings.indexOf(activeVariant(firstTurn).assistant?.content ?? '') : -1

  const browseHits = useMemo(() => (browse ? findTurnHits(turns, browse.query) : []), [browse?.query, turns])
  const activeHit = browse && browseHits.length > 0 ? browseHits[Math.min(browse.index, browseHits.length - 1)] : null
  const activeHitKey = activeHit ? `${activeHit.turnId}-${activeHit.field}` : ''
  const scrollLockRef = useRef('')

  useEffect(() => {
    if (browse) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [turns, browse])

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
  const compressAt = compressThreshold(config.compressAt)
  const nearLimit = ratio >= compressAt / 100
  const lastTurn = turns[turns.length - 1]

  const compressNow = () => {
    const from = turns[Math.max(0, turns.length - 2)]
    if (!from) return
    void branchFrom(from.id, { compress: true })
  }

  const sessionUsage = useMemo(() => sumUsage(turns.map((t) => activeVariant(t).assistant?.usage)), [turns])
  // 消息气泡模式：true = 助手回复也用气泡
  const bubbleMode = Boolean(config.bubbles)

  const meter =
    turns.length > 0 || limit > 0 ? (
      nearLimit && lastTurn ? (
        <div className="mb-2 flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2.5">
          <span className="text-[12px] leading-relaxed text-amber-800">
            上下文已用 {formatPercent(ratio)}（{formatTokens(contextTokens)} / {formatTokens(limit)}）
          </span>
          <button className="shrink-0 rounded-full bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white" onClick={compressNow}>
            压缩并开新对话
          </button>
        </div>
      ) : (
        <div className="mb-2">
          <div className="flex items-center gap-2 px-0.5 py-0.5">
            <button className="flex min-w-0 flex-1 items-center gap-2" onClick={() => setStatsOpen((v) => !v)} aria-label="展开用量">
              <span className="shrink-0 text-[12px] text-neutral-500">上下文</span>
              {limit > 0 && (
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-neutral-400 transition-[width] duration-300" style={{ width: `${Math.min(ratio * 100, 100)}%` }} />
                </div>
              )}
              <span className="shrink-0 text-[12px] tabular-nums text-neutral-500">
                {formatTokens(contextTokens)}
                {limit > 0 ? ` / ${formatTokens(limit)}` : ''}
              </span>
              <span className="shrink-0 text-neutral-400">{statsOpen ? <ChevronDownIcon size={12} /> : <ChevronUpIcon size={12} />}</span>
            </button>
            {lastTurn && (
              <button className={`${pill} shrink-0 ${pillOff}`} onClick={compressNow} title={`把更早的对话压成摘要，保留最近两轮，开一个新会话继续（预警线 ${compressAt}%）`}>
                压缩
              </button>
            )}
          </div>

          {statsOpen && (
            <div className="mt-1.5 rounded-2xl bg-neutral-50 px-3 py-2.5">
              <div className="mb-1.5 text-[12px] text-neutral-500">
                本会话累计消耗 · {turns.length} 轮
                {sessionUsage.estimated ? ' · 含估算' : ' · 来自接口返回'}
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] tabular-nums text-neutral-600">
                <span>输入 {formatTokens(sessionUsage.input)}</span>
                <span>输出 {formatTokens(sessionUsage.output)}</span>
                <span>
                  缓存命中 {isCacheEstimated(sessionUsage) ? '≈' : ''}
                  {formatTokens(sessionUsage.cacheRead)}
                </span>
                <span>未命中 {formatTokens(missTokens(sessionUsage))}</span>
                <span className="col-span-2 text-neutral-500">
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
        <button className="rounded-full p-2.5 text-neutral-600 active:bg-neutral-100" onClick={() => setDrawer(true)} aria-label="会话列表">
          <MenuIcon />
        </button>
        <div className="min-w-0 px-2 text-center">
          <div className="truncate text-[17px] font-medium leading-tight text-neutral-800">{session?.title || '新对话'}</div>
          {(activeSetting || session?.promptId) && (
            <div className="mt-0.5 truncate text-[12px] leading-tight text-neutral-500">
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
            className="rounded-full p-2.5 text-neutral-600 active:bg-neutral-100"
            onClick={() => setTreeOpen(true)}
            aria-label="分支图（测试）"
            title="分支图：按轮分层，可以检索和切版本"
          >
            <TreeIcon />
          </button>
          <button className="rounded-full p-2.5 text-neutral-600 active:bg-neutral-100" onClick={() => setSettings(true)} aria-label="设置">
            <SlidersIcon />
          </button>
        </div>
      </header>

      <main id="chat" className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">

        {session?.recap && (
          <div className="mb-5 rounded-2xl bg-neutral-50 px-4 py-3">
            <button className="flex w-full items-center justify-between text-[12px] text-neutral-500" onClick={() => setRecapOpen((v) => !v)}>
              <span>前情摘要 · {session.recap.length} 字</span>
              <span className="text-neutral-400">{recapOpen ? '收起' : '展开'}</span>
            </button>
            {recapOpen && <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-600">{session.recap}</p>}
          </div>
        )}
        {turns.length === 0 && <ModePickerNext />}

        {turns.length === 0 && openingText && (
          <div ref={openingRef} className="mt-5 rounded-2xl border border-dashed border-neutral-300 px-4 py-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px]">
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">开场白</span>
              {openingName && <span className="truncate text-neutral-500">{openingName}</span>}
            </div>
            <Markdown content={openingText} docs={pendingDocs.length > 0 ? pendingDocs : sessionDocs} userName={userName} />
          </div>
        )}

        {turns.map((turn) => {
          const variant = activeVariant(turn)
          const live = streamingTurnId === turn.id
          const calls = variant.assistant?.toolCalls ?? []
          const hasProcess = Boolean(variant.assistant?.reasoning?.trim()) || calls.length > 0
          const userHasContent = Boolean(variant.user.content.trim()) || Boolean(variant.user.attachments?.length)
          const assistantSources = Array.from(
            new Map(
              [
                ...(variant.assistant?.sources ?? []),
                ...(variant.assistant?.toolCalls ?? []).flatMap((call) => call.sources ?? []),
              ].map((source) => [source.url, source])
            ).values()
          )
          return (
            <div
              key={turn.id}
              className="mb-8 mes"
              ref={(el) => {
                // 酒馆生态脚本的 ST DOM 锚点：.mes[mesid][is_user]，id 与 TH 扁平消息表对齐
                if (el) {
                  const dom = thDomMessage(turns, turn.id)
                  el.setAttribute('mesid', String(dom.mesid))
                  el.setAttribute('is_user', String(dom.isUser))
                }
              }}
            >

              {userHasContent && (
                <div className="flex justify-end">
                  <div
                    id={hitElementId({ turnId: turn.id, field: 'user' })}
                    className={`max-w-[80%] rounded-2xl rounded-br-lg bg-[var(--bubble-bg)] px-4 py-2.5 text-[16px] leading-[1.6] text-[var(--bubble-fg)] ${
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
                            <img key={file.id} src={file.dataUrl} alt={file.name} className="h-24 w-24 rounded-lg object-cover" />
                          ) : (
                            <span key={file.id} className="max-w-[180px] truncate rounded-full bg-white/15 px-2.5 py-1 text-[12px] text-white/80">
                              {file.name}
                            </span>
                          )
                        )}
                      </div>
                    ) : null}
                    {variant.user.content.trim() && <div className="whitespace-pre-wrap">{variant.user.content}</div>}
                  </div>
                </div>
              )}
              {userHasContent && (
                <div className="mt-2 flex items-center justify-end gap-1.5">
                  {!evolutionMode && (
                    <>
                      <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />
                      <button className={`${pill} ${pillOff}`} onClick={() => startEdit(turn.id)}>
                        编辑
                      </button>
                      {turn.idx > 0 && (
                        <button className={`${pill} ${pillOff}`} onClick={() => void branchFrom(turn.id)}>
                          在此开新话题
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}

              <div
                id={hitElementId({ turnId: turn.id, field: 'assistant' })}
                className={`mt-2.5 w-full rounded-2xl ${
                  activeHitKey === `${turn.id}-assistant` ? 'bg-amber-50/70 px-2.5 py-1.5 ring-1 ring-amber-300' : ''
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
                  bubbleMode ? (
                    /* 气泡模式：助手回复也装进气泡（用户气泡本来就是气泡） */
                    <div className="inline-block max-w-[88%] rounded-2xl rounded-tl-lg bg-neutral-100 px-4 py-3">
                      <Markdown content={variant.assistant.content} docs={sessionDocs} userName={userName} />
                    </div>
                  ) : (
                    <Markdown content={variant.assistant.content} docs={sessionDocs} userName={userName} />
                  )
                ) : null}

                {assistantSources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assistantSources.map((source, i) => (
                      <button
                        key={source.url}
                        className="h-7 max-w-full truncate rounded-full bg-neutral-100 px-3 text-[12px] text-neutral-600 active:bg-neutral-200"
                        onClick={() => void platform().openLink(source.url)}
                        title={source.url}
                      >
                        {i + 1}. {source.title || source.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </button>
                    ))}
                  </div>
                )}

                {variant.assistant && !live && (
                  <>
                    {/* 操作行：唯一一层动作，全部是胶囊 */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {activePackId !== 'minimal' && turn.id === turns[turns.length - 1]?.id && (
                        <>
                          {STAGE_DIRECTIONS.map((d) => (
                            <button key={d.label} className={`${pill} ${pillOff}`} onClick={() => void steer(d.text)} title={d.text}>
                              {d.label}
                            </button>
                          ))}
                        </>
                      )}
                      {greetingTurnId === turn.id && (
                        <button className={`${pill} ${pillOff}`} onClick={() => setGreetingOpen(true)}>
                          换开场 {activeGreeting >= 0 ? activeGreeting + 1 : 1}/{greetings.length}
                        </button>
                      )}
                      <button
                        className={`${pill} ${pillOff} gap-1`}
                        onClick={() => void navigator.clipboard?.writeText(variant.assistant?.content ?? '')}
                      >
                        <CopyIcon />
                        复制
                      </button>
                      <button className={`${pill} ${pillOff} gap-1`} onClick={() => setExportTarget({ turnId: turn.id, variant: turn.active })}>
                        <DownloadIcon />
                        导出
                      </button>
                      {userHasContent && (!evolutionMode || turn.id === turns[turns.length - 1]?.id) && (
                        <button className={`${pill} ${pillOff} gap-1`} onClick={() => void regenerate(turn.id)}>
                          <RefreshIcon />
                          重新生成
                        </button>
                      )}
                      {!evolutionMode && <VariantSwitcher turn={turn} onSwitch={(i) => void switchVariant(turn.id, i)} />}
                    </div>
                    {/* 元信息行 + 可展开详情（用量、赞踩都收进详情） */}
                    <AnswerMeta turn={turn} showFeedback={longMemory} />
                  </>
                )}
              </div>
            </div>
          )
        })}

        {error && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-[12px] leading-relaxed text-red-600">{error}</div>}
        <div ref={bottomRef} className={streamingTurnId ? 'h-1' : undefined} />
      </main>

      {browse && browseHits.length > 0 && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-2">
          <SearchIcon className="shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-600">{browse.query}</span>
          <span className="shrink-0 text-[12px] tabular-nums text-neutral-500">
            {Math.min(browse.index + 1, browseHits.length)}/{browseHits.length}
          </span>
          <button
            className="rounded-full p-1 text-neutral-500 disabled:opacity-30"
            disabled={browse.index <= 0}
            onClick={() => setBrowseIndex(browse.index - 1)}
            aria-label="上一条"
          >
            <ChevronUpIcon />
          </button>
          <button
            className="rounded-full p-1 text-neutral-500 disabled:opacity-30"
            disabled={browse.index >= browseHits.length - 1}
            onClick={() => setBrowseIndex(browse.index + 1)}
            aria-label="下一条"
          >
            <ChevronDownIcon />
          </button>
          <button className="rounded-full p-1 text-neutral-400" onClick={exitBrowse} aria-label="退出浏览">
            <CloseIcon />
          </button>
        </div>
      )}

      <Composer meter={meter} opening={openingText} />
      <DrawerNext />
      <SettingsSheet />
      <GroupPanel />
      {treeOpen && (
        <TreeViewNext
          onClose={() => setTreeOpen(false)}
          evolutionMode={evolutionMode}
          onExport={(turnId, variant) => {
            setTreeOpen(false)
            setExportTarget({ turnId, variant })
          }}
        />
      )}
      {exportTarget && (
        <ExportSheetNext turnId={exportTarget.turnId} variant={exportTarget.variant} onClose={() => setExportTarget(null)} />
      )}
      {greetingOpen && greetingTurnId && (
        <GreetingPickerNext
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
