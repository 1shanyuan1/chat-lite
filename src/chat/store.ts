import { create } from 'zustand'
import {
  activeVariant,
  newId,
  type ChatTurn,
  type Session,
  type ToolCallRecord,
  type TurnAssistant,
} from '@/db'
import { getRepo } from '@/db/runtime'
import {
  CHAT_SEARCH_TOOL,
  MEMORY_WRITE_TOOL,
  PROFILE_BUDGET,
  appendProfile,
  consolidateProfile as consolidateProfileMemory,
  loadProfile,
  maybeConsolidateProfile,
  memorySystemBlock,
  type ConsolidateOutcome,
  recordFeedback,
  reviseProfileFromFeedback,
  runSearchChats,
  runWriteMemory,
} from './memory'
import { checkUpdate, type UpdateInfo } from './update'
import { completeText, streamChat, type ChatConfig, type WireTurn } from './client'
import { humanizeError } from './errors'
import {
  collectEntries,
  greetingList,
  greetingScript,
  renderCast,
  renderPersona,
  renderSettings,
  type SettingDoc,
} from './settings'
import { deleteSetting, migrateLegacySettings, saveSetting } from '@/db/settings'
import type { MemoryRecord } from '@/db'
import type { FolderArea, VaultFolder } from './folders'
import * as folderStore from '@/db/folders'
import { findTurnHits } from './hit-nav'
import { type PromptItem } from './vault'
import { deletePrompt, listPrompts, savePrompt } from '@/db/vault'
import { expireImages, hasContent, IMAGE_RESEND_TURNS, userText, wireImages, type Attachment } from './attachments'
import { describeAttachments } from './vision'
import { withCredential } from './credentials'
import { contextWindow, matchWorldEntries, renderWorldEntries } from './lore'
import { DEFAULT_PACK_ID, findPack, renderTemplate } from './packs'
import { PROVIDERS, findProvider } from './providers'
import { fetchModels, loadCachedModels, type ModelInfo } from './models'
import { reasoningEfforts } from './reasoning'
import { resolveProtocol } from './protocol'
import type { WireMessage, WireTool } from './protocol'
import { applyMacros } from './characters'
import { buildPrompt, type PromptInput } from './prompt/build'
import {
  UPDATE_SETTING_TOOL,
  applySettingUpdate,
  describeUpdate,
  evolutionActive,
  evolutionSystemBlock,
  renderEntryIndex,
  reviewNudge,
} from './evolution'
import { pathOf, resolveChain } from './branches'
import {
  formatSearchOutput,
  localSearchReady,
  mergeSources,
  resolveSearchKey,
  resolveSearchMode,
  resolveSearchSource,
  searchMany,
  SEARCH_SOURCES,
} from './web-search'
import type { WebSource } from './web-search-types'
import { nativeSearchPayload } from './native-search'
import {
  emptyUsage,
  estimateCacheHit,
  estimateTokens,
  estimateUsage,
  isCacheEstimated,
  mergeUsage,
  type Usage,
} from './tokens'

const CONFIG_KEY = 'cl.config'
const draftKey = (sessionId: string | null) => `cl.draft.${sessionId ?? 'new'}`

const defaultConfig: ChatConfig = {
  baseUrl: PROVIDERS[0].baseUrl,
  apiKey: '',
  model: PROVIDERS[0].model ?? '',
  systemPrompt: '',
  protocol: PROVIDERS[0].protocol,
  packId: DEFAULT_PACK_ID,
  userName: '你',
}

function loadConfig(): ChatConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? { ...defaultConfig, ...(JSON.parse(raw) as Partial<ChatConfig>) } : defaultConfig
  } catch {
    return defaultConfig
  }
}

let controller: AbortController | null = null
let lastPersist = 0

/**
 * 用第一条「用户说的话」做标题。
 *
 * 不能取第一轮：角色卡会话的第一轮是开场白，user 内容是空的，
 * 取它会把标题改成空字符串（之前的 bug）。
 * 找不到就返回 null，调用方据此跳过改名。
 */
function sessionTitleFor(turns: ChatTurn[], sessionId: string): string | null {
  const mine = turns.filter((t) => t.sessionId === sessionId).sort((a, b) => a.idx - b.idx)
  const first = mine.find((t) => activeVariant(t).user.content.trim())
  if (!first) return null
  const text = activeVariant(first).user.content.trim()
  return text.slice(0, 20) + (text.length > 20 ? '…' : '')
}

/** 暴露给模型的联网搜索工具，参数形状参考 DeepSeek Harness */
const WEB_SEARCH_TOOL: WireTool = {
  name: 'web_search',
  description:
    '搜索公开网络获取最新信息。返回若干条来源（标题、链接、摘要）。需要最新事实、新闻、版本号、价格时使用。',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        description: '1–3 条搜索查询，结果会合并。用不同措辞或拆成子问题能提高召回。',
        items: { type: 'string' },
      },
    },
    required: ['queries'],
  },
}

/** 每隔几轮强制审查一次设定（只做兜底，主判断还是每轮由模型自己做） */
const REVIEW_EVERY = 3

/** 一轮对话里最多连续调用几次工具，防止模型来回搜不停 */
const MAX_TOOL_ROUNDS = 3

/** 把某轮之前的历史拍平成下游要的 messages（只取激活版本） */
function wireHistory(turns: ChatTurn[], uptoIdx: number, imageResendTurns: number): WireTurn[] {
  const out: WireTurn[] = []
  // 图片只保留最近 N 轮（含本轮）：历史里的原图每一轮都会重新计费，
  // 更早的换成占位说明，模型知道有图但看不到。识图描述本来就是文字，不受影响。
  const keepFrom = uptoIdx - (imageResendTurns - 1)
  for (const turn of turns) {
    if (turn.idx > uptoIdx) break
    const variant = activeVariant(turn)
    const attachments =
      turn.idx >= keepFrom ? variant.user.attachments : expireImages(variant.user.attachments, imageResendTurns)
    if (hasContent(variant.user.content, variant.user.attachments)) {
      out.push({
        role: 'user',
        content: userText(variant.user.content, attachments),
        images: wireImages(attachments),
      })
    }
    // 工具调用要按 assistant(tool_calls) → tool(result) 成对回放，
    // 否则模型在后续轮次里会忘了自己查过什么
    for (const call of variant.assistant?.toolCalls ?? []) {
      out.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }],
      })
      out.push({ role: 'tool', content: call.result, toolCallId: call.id, toolName: call.name })
    }
    if (variant.assistant?.content) out.push({ role: 'assistant', content: variant.assistant.content })
  }
  return out
}

interface AppState {
  ready: boolean
  config: ChatConfig
  sessions: Session[]
  currentId: string | null
  turns: ChatTurn[]
  streamingTurnId: string | null
  error: string | null
  /** 正在跑工具时的提示文字，null 表示没有 */
  toolStatus: string | null
  drawerOpen: boolean
  /** 抽屉打开时看哪个 tab；提到 store 里是为了让演示壳能直接落到「寄存区」 */
  drawerTab: 'chats' | 'chars'
  setDrawerTab: (tab: 'chats' | 'chars') => void
  settingsOpen: boolean
  draft: string
  /** 演示用：非空时「查看记忆」显示这份数据，不碰真实存储 */
  memoryPreview: MemoryRecord[] | null
  /** 演示用：非空时寄存区显示这份设定，且写操作全部禁用，不碰真实存储 */
  settingsPreview: SettingDoc[] | null
  /** 正在改写哪一轮；非空时输入框进入编辑态，发送走 editResend */
  editingTurnId: string | null
  startEdit: (turnId: string) => void
  cancelEdit: () => void
  /** 新建对话前选好的提示词，等第一次发送时落到会话上（极简模式没有「开始」按钮） */
  pendingPromptId: string | null
  setPendingPrompt: (id: string | null) => void
  /**
   * 新建对话前勾好的设定/角色卡。
   * 和 pendingPromptId 一样不立即建会话——点了就建会留下一个没有消息的空会话，
   * 用户看到的就是「点了开始，结果什么都没有」。等第一句话发出去再一起落库。
   */
  pendingSettingIds: string[]
  togglePendingSetting: (id: string) => void
  clearPendingSettings: () => void
  /**
   * 起始页选好的开场白序号（针对第一张带开场的卡）。
   * 开场白不单独成一轮：它跟着用户的第一句话一起发出去，
   * 由 send() 在建会话时落成第 0 轮，用户这句话接在后面。
   */
  pendingGreetingIndex: number
  setPendingGreeting: (index: number) => void
  /** 搜索命中浏览状态：当前会话里正在看第几条命中 */
  browse: { query: string; index: number } | null
  settings: SettingDoc[]
  prompts: PromptItem[]
  folders: VaultFolder[]
  createFolder: (area: FolderArea, name: string) => void
  renameFolder: (id: string, name: string) => void
  removeFolder: (id: string) => void
  models: ModelInfo[]
  modelsLoading: boolean
  modelsError: string | null

  loadModels: (force?: boolean) => Promise<void>
  selectModel: (model: ModelInfo) => void
  setReasoningLevel: (level: string | undefined) => void

  importSetting: (doc: SettingDoc) => void
  removeSetting: (id: string) => void
  /**
   * 直接用一组设定开新会话。
   * 界面上走 startFromGreeting（选了开场白才开），这里保留给自检脚本跑完整链路。
   */
  startWithSettings: (ids: string[], promptId?: string, greetingIndex?: number) => Promise<void>
  savePrompt: (item: PromptItem) => void
  removePrompt: (id: string) => void
  applyPrompt: (prompt: PromptItem) => Promise<void>

  /** GitHub 最新 Release（只在安卓端检查）；null = 已是最新或还没查 */
  updateInfo: UpdateInfo | null
  init: () => Promise<void>
  saveConfig: (patch: Partial<ChatConfig>) => void
  setDraft: (text: string) => void
  setDrawer: (open: boolean) => void
  setSettings: (open: boolean) => void
  setPack: (packId: string) => Promise<void>
  applyAction: (template: string) => void
  openSearchHit: (sessionId: string, query: string) => Promise<void>
  setBrowseIndex: (index: number) => void
  exitBrowse: () => void
  newSession: () => void
  selectSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  send: (text: string, attachments?: Attachment[]) => Promise<void>
  stop: () => void
  regenerate: (turnId: string, instruction?: string) => Promise<void>
  editResend: (turnId: string, newText: string, attachments?: Attachment[]) => Promise<void>
  /** 舞台指令：对最后一条回复重新生成，附带一条角色看不见的指令 */
  steer: (instruction: string) => Promise<void>
  /** 手动改会话标题；改过之后不再被第一句话覆盖 */
  renameSession: (id: string, title: string) => Promise<void>
  /** 换开场：只在还没开口时可用，替换第一轮的开场白 */
  switchGreeting: (turnId: string, index: number) => Promise<void>
  /** 赞/踩反馈：连同这一轮的问答一起存档 */
  sendFeedback: (turnId: string, rating: 'up' | 'down', text: string) => Promise<void>
  clearMemory: () => Promise<void>
  listMemoryFiles: () => Promise<MemoryRecord[]>
  /** 让模型把画像去重合并一遍；条目太少 / 太大 / 上一次还在跑时返回对应的未整理原因 */
  consolidateProfile: () => Promise<ConsolidateOutcome>
  switchVariant: (turnId: string, index: number) => Promise<void>
  branchFrom: (turnId: string, options?: { compress?: boolean }) => Promise<void>
  /**
   * 从某一条单回复链开新会话：把这条链原样搬过去，作为新会话的历史。
   * 只复制链上的版本，不复制兄弟分支；设置发展模式下禁用。
   */
  forkFromChain: (turnId: string, variantIndex: number) => Promise<void>
}

export const useApp = create<AppState>()((set, get) => {
  const patchAssistant = (turnId: string, index: number, patch: Partial<TurnAssistant>) =>
    set((state) => ({
      turns: state.turns.map((t) =>
        t.id === turnId
          ? {
              ...t,
              variants: t.variants.map((v, i) =>
                i === index ? { ...v, assistant: { content: '', ...v.assistant, ...patch } } : v
              ),
            }
          : t
      ),
    }))

  const persistTurn = async (turnId: string) => {
    const turn = get().turns.find((t) => t.id === turnId)
    if (turn) await getRepo().updateTurn(turn)
  }

  /** 跑一次生成，把结果写进指定轮的指定变体 */
  const generate = async (
    turnId: string,
    index: number,
    history: WireTurn[],
    sessionId: string,
    /** 舞台指令：只对这一次生成生效，贴在历史末尾，角色听不见 */
    extraSystem?: string
  ) => {
    // 计时从「点发送」开始，含思考、工具轮次和所有重试，到最后一个字为止
    const startedAt = Date.now()
    set({ streamingTurnId: turnId, error: null })
    patchAssistant(turnId, index, { content: '', model: get().config.model })
    controller = new AbortController()
    lastPersist = 0

    // 提示词分层：包规范 → 角色卡 → 命中的世界书 → 会话摘要 → 会话绑定的提示词
    const session = get().sessions.find((s) => s.id === sessionId)
    const pack = findPack(session?.packId ?? get().config.packId)
    const userName = get().config.userName ?? '你'
    const ids = session?.settingIds?.length ? session.settingIds : session?.characterId ? [session.characterId] : []
    const docs = ids
      .map((id) => get().settings.find((d) => d.id === id))
      .filter((d): d is SettingDoc => Boolean(d))

    let settingBlock = ''
    let personaBlock = ''
    let castBlock = ''
    let worldBlock = ''
    let worldHits: string[] = []
    let postHistory = ''
    if (docs.length > 0) {
      settingBlock = renderSettings(docs, userName)
      castBlock = renderCast(docs)
      // 多个「角色卡」同场时 {{char}} 指向谁都不对，统一说「对方」；
      // 写作模式的多份设定不是多角色，仍按第一份的名字替换
      const castCount = docs.filter((d) => d.kind === 'character').length
      personaBlock = renderPersona(get().config.persona, userName, castCount > 1 ? '对方' : (docs[0]?.name ?? ''))
      const recent = contextWindow(history.map((m) => m.content))
      const matched = matchWorldEntries(collectEntries(docs, userName), recent)
      worldBlock = renderWorldEntries(matched)
      worldHits = matched.map((e) => e.content.trim().replace(/\s+/g, ' ').slice(0, 40))
      // 历史之后的追加指令：每轮都贴在最末尾，比 system 更靠近当前发言
      postHistory = docs
        .map((doc) => (doc.postHistory?.trim() ? applyMacros(doc.postHistory, doc.name, userName) : ''))
        .filter(Boolean)
        .join('\n\n')
    }

    // 提示词按会话绑定：选了才带，不选就什么都不注入
    const sessionPrompt = session?.promptId ? get().prompts.find((p) => p.id === session.promptId) : undefined

    // 三种联网方式：上游自带 / 本地源（工具循环）/ Bing 兜底
    const searchMode = resolveSearchMode(get().config)
    const protocol = resolveProtocol(get().config.protocol, get().config.baseUrl)
    const providerId = findProvider(get().config.baseUrl)?.id
    const nativeSearch = searchMode === 'native' ? nativeSearchPayload(protocol, providerId) : null
    // 选了上游搜索但这个服务商不支持（比如换到了 OpenAI），退回本地源或 Bing
    const effectiveMode =
      searchMode === 'native' && !nativeSearch
        ? localSearchReady(get().config)
          ? 'local'
          : 'bing'
        : searchMode
    const searchSource = effectiveMode === 'bing' ? SEARCH_SOURCES.bing : resolveSearchSource(get().config)
    // 长记忆只在极简模式生效：写作/酒馆已经有提示词包在定义行为，再叠记忆会互相干扰
    const longMemory = Boolean(get().config.longMemory) && pack.id === 'minimal'

    // 设定发展模式：写作模式 + 开关，且这次会话挂的是发展稿
    const evolvedDoc = docs.find((d) => d.derivedFrom)
    const evolution = evolutionActive(get().config.settingEvolution, pack.id, docs)

    const toolList: WireTool[] = []
    if (effectiveMode === 'local' || effectiveMode === 'bing') toolList.push(WEB_SEARCH_TOOL)
    if (longMemory) {
      toolList.push(MEMORY_WRITE_TOOL)
      // 只有一个会话时「回忆」没有可查的东西——挂了只会让模型对着空历史乱查，
      // 还会因为查不到而误以为上下文也丢了
      if (get().sessions.length > 1) toolList.push(CHAT_SEARCH_TOOL)
    }
    if (evolution) toolList.push(UPDATE_SETTING_TOOL)
    const tools = toolList.length > 0 ? toolList : undefined
    // 记忆、搜索、设定更新都要调工具，轮次上限得放宽，否则查到一半就断了
    const maxRounds = longMemory || evolution ? 5 : MAX_TOOL_ROUNDS

    const profile = longMemory ? await loadProfile() : ''

    // 强制审查：不是每轮都催，隔几轮回头看一眼设定有没有落后于正文
    const turnIdx = get().turns.find((t) => t.id === turnId)?.idx ?? 0

    // 所有提示词在这里一次性组装。调用方只填原料，顺序由 buildPrompt 的 SLOTS 决定——
    // 以前这里是 10 个位置参数，加一层就得改签名、改测试、改调用点。
    const promptInput: PromptInput = {
      memory: longMemory ? memorySystemBlock(profile) : '',
      evolution: evolution ? evolutionSystemBlock() : '',
      pack: pack.systemPrompt,
      settings: settingBlock,
      entryIndex: evolution && evolvedDoc ? renderEntryIndex(evolvedDoc) : '',
      cast: castBlock,
      persona: personaBlock,
      world: worldBlock,
      recap: session?.systemPrompt,
      prompt: sessionPrompt?.text,
      postHistory,
      steer: extraSystem,
      review: evolution && turnIdx > 0 && turnIdx % REVIEW_EVERY === 0 ? reviewNudge() : '',
    }
    const built = buildPrompt(promptInput)

    const effectiveConfig: ChatConfig = {
      ...get().config,
      nativeSearch: nativeSearch ?? undefined,
      systemPrompt: built.system,
    }

    let answer = ''
    let thinking = ''
    let usage: Usage | undefined
    let failure: string | null = null
    const toolCalls: ToolCallRecord[] = []
    let nativeSources: WebSource[] = []
    // 追加层贴在历史之后：位置最靠后，权重最高，且不进对话记录
    let messages: WireMessage[] = built.tail
      ? [...history, { role: 'system', content: built.tail }]
      : history

    /** 执行一次工具调用；失败也要把错误回传给模型，否则它没法自我纠正 */
    const runTool = async (id: string, name: string, argsJson: string): Promise<ToolCallRecord> => {
      try {
        if (name === MEMORY_WRITE_TOOL.name) {
          const result = await runWriteMemory(argsJson, get().config.memoryBudget ?? PROFILE_BUDGET)
          // 画像快满时后台整理一次（合并/淘汰/重组），不阻塞本轮回答
          void maybeConsolidateProfile(get().config)
          return { id, name, arguments: argsJson, result }
        }
        if (name === CHAT_SEARCH_TOOL.name) {
          return { id, name, arguments: argsJson, result: await runSearchChats(argsJson, sessionId) }
        }
        if (name === UPDATE_SETTING_TOOL.name) {
          // 每次从 store 重新取，避免同一轮里多次调用拿到旧的副本
          const target = get().settings.find((d) => d.id === evolvedDoc?.id)
          if (!target) throw new Error('当前会话没有设定副本')
          const { doc, changes } = applySettingUpdate(target, argsJson, turnIdx)
          if (changes.length > 0) get().importSetting(doc)
          return { id, name, arguments: argsJson, result: describeUpdate(changes) }
        }
        if (name !== WEB_SEARCH_TOOL.name) throw new Error(`不认识这个工具：${name}`)
        let queries: string[] = []
        try {
          const parsed = JSON.parse(argsJson) as { queries?: unknown }
          if (Array.isArray(parsed.queries)) queries = parsed.queries.map((q) => String(q))
        } catch {
          throw new Error('工具参数不是合法 JSON')
        }
        if (queries.length === 0) throw new Error('没有给出查询词')

        const result = await searchMany(queries, {
          source: searchSource,
          ctx: {
            apiKey: resolveSearchKey(get().config) ?? undefined,
            // 单独配了搜索 key 时走 DeepSeek 官方；否则沿用当前服务地址
            baseUrl: get().config.searchApiKey?.trim() ? undefined : get().config.baseUrl,
            custom: get().config.searchCustom,
          },
        })
        return { id, name, arguments: argsJson, result: formatSearchOutput(result), sources: result.sources }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { id, name, arguments: argsJson, result: `搜索失败：${message}`, error: message }
      }
    }

    try {
      for (let round = 0; ; round++) {
        let roundText = ''
        // 工具调用是流式拼出来的：name/id 先到，arguments 一片片来
        const pending = new Map<number, { id: string; name: string; arguments: string }>()

        for await (const delta of streamChat(messages, effectiveConfig, controller.signal, tools)) {
          if (delta.usage) usage = mergeUsage(usage, delta.usage)
          if (delta.reasoning) thinking += delta.reasoning
          if (delta.content) roundText += delta.content
          if (delta.sources?.length) nativeSources = mergeSources(nativeSources, delta.sources)
          if (delta.toolCall) {
            const entry = pending.get(delta.toolCall.index) ?? { id: '', name: '', arguments: '' }
            if (delta.toolCall.id) entry.id = delta.toolCall.id
            if (delta.toolCall.name) entry.name = delta.toolCall.name
            if (delta.toolCall.arguments) entry.arguments += delta.toolCall.arguments
            pending.set(delta.toolCall.index, entry)
          }
          if (delta.reasoning || delta.content) {
            patchAssistant(turnId, index, {
              content: answer + roundText,
              reasoning: thinking || undefined,
            })
            if (Date.now() - lastPersist > 900) {
              lastPersist = Date.now()
              void persistTurn(turnId)
            }
          }
        }

        // 这一轮之后还要继续调工具吗？
        const continues = pending.size > 0 && Boolean(tools) && round < maxRounds

        // 正文区只放成品：中间轮的文字是「我先查一下」「我先更新一下设定」这类前导语，
        // 一律不进正文。这样用户提示词里写「只输出正文」才真的成立——
        // 工具调用在幕后，正文永远是模型最后那一轮的输出。
        answer = continues ? '' : roundText

        // 没请求工具、没开工具、或轮次用满，就收工
        if (!continues) break

        for (const call of pending.values()) {
          if (!call.name) continue
          const id = call.id || `call_${round}_${toolCalls.length}`
          set({
            toolStatus:
              call.name === WEB_SEARCH_TOOL.name
                ? '正在搜索…'
                : call.name === CHAT_SEARCH_TOOL.name
                  ? '正在回忆…'
                  : call.name === MEMORY_WRITE_TOOL.name
                    ? '正在整理记忆…'
                    : `正在执行 ${call.name}…`,
          })
          const record = await runTool(id, call.name, call.arguments || '{}')
          toolCalls.push(record)
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id, name: call.name, arguments: call.arguments || '{}' }],
            },
            { role: 'tool', content: record.result, toolCallId: id, toolName: call.name },
          ]
        }
        set({ toolStatus: null })
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (!aborted) failure = humanizeError(error)
    } finally {
      controller = null
      set({ toolStatus: null })
    }

    let finalUsage: Usage =
      usage ??
      (answer || thinking
        ? estimateUsage(
            history.map((m) => m.content).join('\n'),
            answer,
            thinking
          )
        : emptyUsage())

    // 接口没回报命中字段时，按前缀重叠做本地估算（并在 UI 上标为估算）。
    // 系统提示词也在缓存前缀里，必须算进去，否则长 system 会被漏掉
    if (isCacheEstimated(finalUsage)) {
      const prefix = [effectiveConfig.systemPrompt ?? '', ...history.map((m) => m.content)]
      finalUsage = { ...finalUsage, cacheRead: estimateCacheHit(prefix) }
    }

    const assistant: TurnAssistant = {
      content: answer || (thinking ? '' : failure ? `（${failure}）` : '（已取消）'),
      reasoning: thinking || undefined,
      usage: finalUsage,
      model: get().config.model,
      durationMs: Date.now() - startedAt,
      reasoningLevel: get().config.reasoningLevel,
      reasoningSupported:
        reasoningEfforts(
          protocol,
          get().config.baseUrl,
          get().config.model,
          get().models.find((m) => m.id === get().config.model)
        ).length > 0,
      interrupted: Boolean(failure) || (!answer && !thinking),
      worldEntries: worldHits.length > 0 ? worldHits : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      sources: nativeSources.length > 0 ? nativeSources : undefined,
    }

    set((state) => ({
      streamingTurnId: null,
      toolStatus: null,
      error: failure,
      turns: state.turns.map((t) =>
        t.id === turnId
          ? { ...t, variants: t.variants.map((v, i) => (i === index ? { ...v, assistant } : v)) }
          : t
      ),
    }))
    await persistTurn(turnId)
    // 挂了角色卡的会话保留角色名做标题——改成第一句话反而看不出是谁；
    // 用户手动改过的标题更不该被覆盖
    const hasCast = Boolean(session?.settingIds?.length || session?.characterId)
    const nextTitle = hasCast || session?.titleLocked ? null : sessionTitleFor(get().turns, sessionId)
    if (nextTitle) await getRepo().renameSession(sessionId, nextTitle)
    set({ sessions: await getRepo().listSessions() })
  }

  /**
   * 勾好的设定 → 实际要挂到会话上的文档。
   * 设定发展模式下换成发展稿副本：同一张卡重复开会话复用同一份，原卡永远不动。
   */
  const mountSettings = (ids: string[]): SettingDoc[] => {
    const picked = ids
      .map((id) => get().settings.find((d) => d.id === id))
      .filter((d): d is SettingDoc => Boolean(d))

    const evolve = Boolean(get().config.settingEvolution) && (get().config.packId ?? 'tavern') === 'writing'
    return evolve
      ? picked.map((doc) => {
          if (doc.derivedFrom) return doc
          const existing = get().settings.find((d) => d.derivedFrom === doc.id)
          if (existing) return existing
          const copy: SettingDoc = {
            ...doc,
            id: newId(),
            name: `${doc.name} · 发展稿`,
            derivedFrom: doc.id,
            changelog: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
          get().importSetting(copy)
          return copy
        })
      : picked
  }

  /**
   * 这份会话是否正在跑设定发展模式。
   *
   * 发展稿是随剧情单向生长的：往回切版本、从旧轮次分叉、编辑旧轮次重发，
   * 都会让「已经推进过的设定」和「改写后的过去」对不上。所以这些操作在发展模式下禁用。
   */
  const evolving = (sessionId: string): boolean => {
    const { config, sessions, settings } = get()
    if (!config.settingEvolution) return false
    const session = sessions.find((s) => s.id === sessionId)
    if (!session) return false
    const pack = findPack(session.packId ?? config.packId)
    const ids = session.settingIds?.length ? session.settingIds : session.characterId ? [session.characterId] : []
    const docs = ids
      .map((id) => settings.find((doc) => doc.id === id))
      .filter((doc): doc is SettingDoc => Boolean(doc))
    return evolutionActive(config.settingEvolution, pack.id, docs)
  }

  /**
   * 把开场白写成第一条「只有 assistant」的轮次。
   * pick 是用户选的那一段：单卡按序号取，群聊仍然是每张卡各出第一段。
   */
  const appendGreeting = async (sessionId: string, docs: SettingDoc[], pick = 0): Promise<void> => {
    const text = greetingScript(docs, get().config.userName ?? '你', pick)
    if (!text) return
    await getRepo().appendTurn({
      id: newId(),
      sessionId,
      idx: 0,
      active: 0,
      createdAt: Date.now(),
      variants: [{ user: { content: '' }, assistant: { content: text }, path: [] }],
    })
  }

  /** 会话标题：一张卡用卡名，多张拼起来；都没有就是「新会话」 */
  const titleFor = (docs: SettingDoc[], seed = '新会话'): string =>
    docs.length === 0
      ? seed.slice(0, 20) + (seed.length > 20 ? '…' : '')
      : docs.length === 1
        ? docs[0].name
        : docs.map((d) => d.name).join(' · ').slice(0, 20)

  return {
    ready: false,
    config: loadConfig(),
    sessions: [],
    currentId: null,
    turns: [],
    streamingTurnId: null,
    toolStatus: null,
    editingTurnId: null,
    memoryPreview: null,
    settingsPreview: null,
    error: null,
    drawerOpen: false,
    drawerTab: 'chats',
    settingsOpen: false,
    draft: '',
    pendingPromptId: null,
    pendingSettingIds: [],
    pendingGreetingIndex: 0,
    browse: null,
    settings: [],
    prompts: [],
    folders: [],
    models: [],
    modelsLoading: false,
    modelsError: null,
    updateInfo: null,

    async init() {
      // 以前「应用提示词」写的是全局 systemPrompt。改成按会话选之后，
      // 把这段旧值收进寄存区，别让它无声失效
      const legacyPrompt = get().config.systemPrompt?.trim()
      if (legacyPrompt) {
        savePrompt({
          id: crypto.randomUUID(),
          name: '原有系统提示词',
          text: legacyPrompt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        get().saveConfig({ systemPrompt: '' })
      }
      set({
        folders: folderStore.listFolders(),
        settings: migrateLegacySettings(),
        prompts: listPrompts(),
      })
      const sessions = await getRepo().listSessions()
      const current = sessions[0] ?? null
      set({
        ready: true,
        sessions,
        currentId: current?.id ?? null,
        turns: current ? await getRepo().listTurns(current.id) : [],
        draft: localStorage.getItem(draftKey(current?.id ?? null)) ?? '',
      })
      // 新版本检查：节流在 update.ts 内部，失败静默
      void checkUpdate().then((info) => set({ updateInfo: info }))
    },

    saveConfig(patch) {
      // 顺手记住用过的 Key，辅助模型可以直接从里面挑服务商
      const config = withCredential({ ...get().config, ...patch })
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      set({ config })
    },

    setDraft(text) {
      localStorage.setItem(draftKey(get().currentId), text)
      set({ draft: text })
    },

    /** 把某一轮打回输入框：文字进草稿，附件由 Composer 从这一轮取 */
    startEdit(turnId) {
      if (get().streamingTurnId) return
      const turn = get().turns.find((t) => t.id === turnId)
      if (!turn) return
      get().setDraft(activeVariant(turn).user.content)
      set({ editingTurnId: turnId, error: null })
    },

    cancelEdit() {
      set({ editingTurnId: null })
      get().setDraft('')
    },

    setPendingPrompt(id) {
      set({ pendingPromptId: id })
    },

    togglePendingSetting(id) {
      const current = get().pendingSettingIds
      const doc = get().settings.find((d) => d.id === id)
      set({
        pendingSettingIds: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
        // 换卡就回到第一段重新挑；加一张世界书不该把已经选好的开场冲掉
        ...(doc?.kind === 'character' ? { pendingGreetingIndex: 0 } : {}),
      })
    },

    clearPendingSettings() {
      set({ pendingSettingIds: [], pendingGreetingIndex: 0 })
    },

    setPendingGreeting(index) {
      set({ pendingGreetingIndex: Math.max(0, index) })
    },

    setDrawer: (open) => set({ drawerOpen: open }),
    setDrawerTab: (tab) => set({ drawerTab: tab }),
    setSettings: (open) => set({ settingsOpen: open }),

    createFolder(area, name) {
      set({ folders: folderStore.createFolder(area, name) })
    },

    renameFolder(id, name) {
      set({ folders: folderStore.renameFolder(id, name) })
    },

    removeFolder(id) {
      // 删文件夹不删内容，只把它们退回未分类
      const settingsNext = get().settings.map((d) => (d.folderId === id ? { ...d, folderId: undefined } : d))
      for (const doc of settingsNext) saveSetting(doc)
      const promptsNext = get().prompts.map((p) => (p.folderId === id ? { ...p, folderId: undefined } : p))
      for (const prompt of promptsNext) savePrompt(prompt)
      set({ folders: folderStore.deleteFolder(id), settings: settingsNext, prompts: promptsNext })
    },

    /** 拉模型列表：先吃缓存，force 时强制重拉 */
    async loadModels(force = false) {
      const { config } = get()
      const protocol = resolveProtocol(config.protocol, config.baseUrl)
      if (!force) {
        const cached = loadCachedModels(config.baseUrl, protocol)
        if (cached) {
          set({ models: cached })
          return
        }
      }
      set({ modelsLoading: true, modelsError: null })
      try {
        set({ models: await fetchModels(config) })
      } catch (e) {
        set({ modelsError: humanizeError(e) })
      } finally {
        set({ modelsLoading: false })
      }
    },

    /** 选模型：顺带记住上下文长度，档位不合法就重置 */
    selectModel(model) {
      const { config } = get()
      const protocol = resolveProtocol(config.protocol, config.baseUrl)
      const efforts = reasoningEfforts(protocol, config.baseUrl, model.id, model)
      const keepLevel =
        config.reasoningLevel !== undefined && efforts.some((option) => option.id === config.reasoningLevel)
      // 上限属于模型，不属于用户：换模型必须跟着换。
      // 新模型没声明长度时要清空，否则会拿上一个模型的窗口算进度条，用量被低估。
      // 例外是重选同一个模型——那多半是用户手填的值，不能覆盖掉。
      const sameModel = model.id === config.model
      get().saveConfig({
        model: model.id,
        contextLimit: model.contextLength ?? (sameModel ? config.contextLimit : undefined),
        reasoningLevel: keepLevel ? config.reasoningLevel : undefined,
      })
    },

    setReasoningLevel(level) {
      get().saveConfig({ reasoningLevel: level })
    },

    importSetting(doc) {
      set({ settings: saveSetting(doc) })
    },

    removeSetting(id) {
      set({
        settings: deleteSetting(id),
        // 删掉的卡不该还留在待挂列表里
        pendingSettingIds: get().pendingSettingIds.filter((x) => x !== id),
      })
    },

    savePrompt(item) {
      set({ prompts: savePrompt(item) })
    },

    removePrompt(id) {
      set({ prompts: deletePrompt(id) })
    },

    /** 应用提示词：绑到当前会话，再点一次取消。没有会话时不动 */
    async applyPrompt(prompt) {
      const sessionId = get().currentId
      if (!sessionId) return
      const session = get().sessions.find((s) => s.id === sessionId)
      const next = session?.promptId === prompt.id ? undefined : prompt.id
      await getRepo().setSessionPrompt(sessionId, next)
      set({ sessions: get().sessions.map((s) => (s.id === sessionId ? { ...s, promptId: next } : s)) })
    },

    /** 用一组设定文件开新会话：建会话 → 插入开场白 → 切过去（自检脚本用） */
    async startWithSettings(ids, promptId, greetingIndex = 0) {
      const docs = mountSettings(ids)
      const session = await getRepo().createSession(
        titleFor(docs),
        undefined,
        get().config.packId ?? 'tavern',
        docs.length > 0 ? docs.map((d) => d.id) : undefined,
        promptId
      )
      await appendGreeting(session.id, docs, greetingIndex)

      set({
        sessions: await getRepo().listSessions(),
        currentId: session.id,
        editingTurnId: null,
        turns: await getRepo().listTurns(session.id),
        drawerOpen: false,
        error: null,
        draft: '',
        browse: null,
        pendingPromptId: null,
        pendingSettingIds: [],
        pendingGreetingIndex: 0,
      })
    },

    /** 切换提示词包：写回全局默认，同时绑定到当前会话 */
    async setPack(packId) {
      const { config, currentId, sessions } = get()
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, packId }))
      // 换模式后之前勾的卡不一定还适用（写作看「设定」、酒馆看「角色卡」），一并清掉
      set({ config: { ...config, packId }, pendingSettingIds: [], pendingGreetingIndex: 0 })
      if (currentId) {
        await getRepo().setSessionPack(currentId, packId)
        set({ sessions: sessions.map((s) => (s.id === currentId ? { ...s, packId } : s)) })
      }
    },

    /** 点快捷动作：把模板渲染进输入框，用户还能改完再发 */
    applyAction(template) {
      set({ draft: renderTemplate(template, get().draft) })
    },

    /** 从搜索结果进入会话：顺带进入命中浏览模式 */
    async openSearchHit(sessionId, query) {
      await get().selectSession(sessionId)
      const hits = findTurnHits(get().turns, query)
      set({ browse: hits.length > 0 ? { query, index: 0 } : null, drawerOpen: false })
    },

    setBrowseIndex(index) {
      const browse = get().browse
      if (!browse) return
      const hits = findTurnHits(get().turns, browse.query)
      if (hits.length === 0) return
      set({ browse: { ...browse, index: Math.min(Math.max(index, 0), hits.length - 1) } })
    },

    exitBrowse() {
      set({ browse: null })
    },

    newSession() {
      set({
        currentId: null,
        editingTurnId: null,
        turns: [],
        drawerOpen: false,
        error: null,
        browse: null,
        pendingPromptId: null,
        pendingSettingIds: [],
        pendingGreetingIndex: 0,
        draft: localStorage.getItem(draftKey(null)) ?? '',
      })
    },

    async selectSession(id) {
      set({
        currentId: id,
        turns: await getRepo().listTurns(id),
        drawerOpen: false,
        error: null,
        browse: null,
        // 切会话时不带着上一次在起始页勾的卡走，否则会挂到别人的对话上
        pendingSettingIds: [],
        pendingGreetingIndex: 0,
        draft: localStorage.getItem(draftKey(id)) ?? '',
      })
    },

    async deleteSession(id) {
      await getRepo().deleteSession(id)
      localStorage.removeItem(draftKey(id))
      const sessions = await getRepo().listSessions()
      const wasCurrent = get().currentId === id
      set({
        sessions,
        ...(wasCurrent ? { currentId: null, turns: [], draft: '' } : {}),
      })
    },

    async stop() {
      controller?.abort()
      controller = null
    },

    async send(text, attachments) {
      const content = text.trim()
      const files = attachments?.length ? attachments : undefined
      if (!hasContent(content, files) || get().streamingTurnId) return

      const { config } = get()
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      // 配了辅助识图就把图片先转成文字，主模型只收文本
      let prepared = files
      if (files?.some((file) => file.kind === 'image')) {
        prepared = await describeAttachments(files, config, (message) => set({ toolStatus: message }))
        set({ toolStatus: null })
      }

      let sessionId = get().currentId
      if (!sessionId) {
        // 起始页勾好的设定随第一句话一起落库——直接打字也算「开始」，
        // 开场白用当时选的那一段，不会默默退回第一段
        const docs = mountSettings(get().pendingSettingIds)
        // 只有附件时用文件名当标题，否则第一句话；挂了卡就用卡名，方便在抽屉里认
        const seed = content || prepared?.[0]?.name || '新会话'
        const session = await getRepo().createSession(
          titleFor(docs, seed),
          undefined,
          get().config.packId,
          docs.length > 0 ? docs.map((d) => d.id) : undefined,
          get().pendingPromptId ?? undefined
        )
        sessionId = session.id
        const pick = get().pendingGreetingIndex
        set({
          currentId: session.id,
          sessions: await getRepo().listSessions(),
          pendingPromptId: null,
          pendingSettingIds: [],
          pendingGreetingIndex: 0,
        })
        // 开场白先落成第一条，用户这句话接在它后面
        await appendGreeting(session.id, docs, pick)
        set({ turns: await getRepo().listTurns(session.id) })
      } else if (get().turns.length === 0 && get().pendingSettingIds.length > 0) {
        // 已经处在一个空会话里（从抽屉点进来的），把刚勾的设定补挂上去
        const docs = mountSettings(get().pendingSettingIds)
        const pick = get().pendingGreetingIndex
        await getRepo().setSessionSettings(
          sessionId,
          docs.map((d) => d.id)
        )
        set({ sessions: await getRepo().listSessions(), pendingSettingIds: [], pendingGreetingIndex: 0 })
        await appendGreeting(sessionId, docs, pick)
        set({ turns: await getRepo().listTurns(sessionId) })
      }

      const turn: ChatTurn = {
        id: newId(),
        sessionId,
        idx: get().turns.length,
        variants: [
          {
            user: { content, ...(prepared ? { attachments: prepared } : {}) },
            // 记下这一轮生成时前面每一轮用的是哪一版
            path: pathOf(get().turns, get().turns.length),
          },
        ],
        active: 0,
        createdAt: Date.now(),
      }
      await getRepo().appendTurn(turn)
      set({ turns: [...get().turns, turn], error: null })
      localStorage.removeItem(draftKey(sessionId))
      set({ draft: '' })

      await generate(turn.id, 0, wireHistory(get().turns, turn.idx, get().config.imageResendTurns ?? IMAGE_RESEND_TURNS), sessionId)
    },

    async regenerate(turnId, instruction) {
      const { turns, streamingTurnId, config } = get()
      if (streamingTurnId) return
      const turn = turns.find((t) => t.id === turnId)
      if (!turn) return
      const lastIdx = turns[turns.length - 1]?.idx ?? turn.idx
      if (evolving(turn.sessionId) && turn.idx < lastIdx) {
        set({ error: '设定发展模式下只能重生成最后一轮：发展稿已经推进，不能回到之前的轮次' })
        return
      }
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      const variant = activeVariant(turn)
      const nextIndex = turn.variants.length
      const updated: ChatTurn = {
        ...turn,
        variants: [...turn.variants, { user: variant.user, path: pathOf(turns, turn.idx) }],
        active: nextIndex,
      }
      set({ turns: turns.map((t) => (t.id === turnId ? updated : t)) })
      await getRepo().updateTurn(updated)

      await generate(turnId, nextIndex, wireHistory(get().turns, turn.idx, get().config.imageResendTurns ?? IMAGE_RESEND_TURNS), turn.sessionId, instruction)
    },

    async editResend(turnId, newText, attachments) {
      const content = newText.trim()
      const files = attachments?.length ? attachments : undefined
      const { turns, streamingTurnId, config } = get()
      if ((!content && !files) || streamingTurnId) return
      const turn = turns.find((t) => t.id === turnId)
      if (!turn) return
      if (evolving(turn.sessionId)) {
        set({ error: '设定发展模式下不支持编辑旧轮次：发展稿已经按原剧情推进，改过去会对不上' })
        return
      }
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      const nextIndex = turn.variants.length
      const previous = activeVariant(turn)
      // 传了附件就以传入的为准（空数组等于清空）；没传则沿用原来的，避免调用方漏传就丢图
      const kept = attachments === undefined ? previous.user.attachments : files
      const updated: ChatTurn = {
        ...turn,
        variants: [
          ...turn.variants,
          {
            user: { content, ...(kept?.length ? { attachments: kept } : {}) },
            path: pathOf(turns, turn.idx),
          },
        ],
        active: nextIndex,
      }

      // 后续轮次暂时保留（不删）。改的是第 N 轮，第 N+1 轮之后的上下文已经对不上，
      // 但直接删掉不可逆；等做到「失效标记」再处理。
      set({ turns: turns.map((t) => (t.id === turnId ? updated : t)), editingTurnId: null })
      await getRepo().updateTurn(updated)
      get().setDraft('')

      await generate(turnId, nextIndex, wireHistory(get().turns, turn.idx, get().config.imageResendTurns ?? IMAGE_RESEND_TURNS), turn.sessionId)
    },

    async steer(instruction) {
      const { turns, streamingTurnId } = get()
      if (streamingTurnId) return
      const last = turns[turns.length - 1]
      if (!last) return
      await get().regenerate(last.id, instruction)
    },

    async renameSession(id, title) {
      const next = title.trim()
      if (!next) return
      await getRepo().renameSession(id, next, true)
      set({ sessions: await getRepo().listSessions() })
    },

    async switchGreeting(turnId, index) {
      const turn = get().turns.find((t) => t.id === turnId)
      if (!turn) return
      const session = get().sessions.find((s) => s.id === turn.sessionId)
      const ids = session?.settingIds?.length
        ? session.settingIds
        : session?.characterId
          ? [session.characterId]
          : []
      const docs = ids
        .map((id) => get().settings.find((d) => d.id === id))
        .filter((d): d is SettingDoc => Boolean(d))
      const text = greetingList(docs, get().config.userName ?? '你')[index]
      if (!text) return

      const updated: ChatTurn = {
        ...turn,
        variants: turn.variants.map((v, i) =>
          i === turn.active ? { ...v, assistant: { ...(v.assistant ?? { content: '' }), content: text } } : v
        ),
      }
      set({ turns: get().turns.map((t) => (t.id === turnId ? updated : t)) })
      await getRepo().updateTurn(updated)
    },

    async sendFeedback(turnId, rating, text) {
      const turn = get().turns.find((t) => t.id === turnId)
      if (!turn) return
      const variant = activeVariant(turn)
      const payload = {
        rating,
        text,
        user: variant.user.content,
        assistant: variant.assistant?.content ?? '',
      }
      await recordFeedback({ turnId, sessionId: turn.sessionId, ...payload })

      // 画像整理要调一次模型，别让按钮一直转：先存反馈，再后台消化。
      // 失败也不影响用户——反馈本身已经落库，下次还能重新整理。
      const config = get().config
      void reviseProfileFromFeedback(payload, config, new AbortController().signal)
        .then((entries) => (entries.length > 0 ? appendProfile(entries) : undefined))
        .catch(() => undefined)
    },

    async clearMemory() {
      // 演示数据只存在预览槽里，清它不能动真实存储
      if (get().memoryPreview) {
        set({ memoryPreview: null })
        return
      }
      await getRepo().deleteMemory()
    },

    async listMemoryFiles() {
      return get().memoryPreview ?? getRepo().listMemory()
    },

    async consolidateProfile() {
      // 演示数据只存在预览槽里，真实的整理调用不能动它
      if (get().memoryPreview) return { ok: false, reason: 'busy' }
      return consolidateProfileMemory(get().config, new AbortController().signal)
    },

    async switchVariant(turnId, index) {
      const turns = get().turns
      const turn = turns.find((t) => t.id === turnId)
      if (!turn || index < 0 || index >= turn.variants.length) return
      if (evolving(turn.sessionId)) {
        set({ error: '设定发展模式下不支持回溯版本：设定副本已经随剧情推进，切回旧版本会对不上' })
        return
      }
      const updated: ChatTurn = { ...turn, active: index }
      set({ turns: turns.map((t) => (t.id === turnId ? updated : t)) })
      await getRepo().updateTurn(updated)
    },

    /**
     * 从某轮开始新会话：[0, idx) 压缩成摘要写进 systemPrompt，[idx, end] 原样搬过去。
     * 原会话保持不动，随时可以回来看。
     */
    async branchFrom(turnId, options = {}) {
      const { turns, currentId, config, sessions } = get()
      const turn = turns.find((t) => t.id === turnId)
      if (!turn || !currentId) return

      const current = sessions.find((s) => s.id === currentId)
      if (evolving(currentId)) {
        set({ error: '设定发展模式下不支持从旧轮次开新对话：发展稿已经推进，无法回到过去' })
        return
      }
      const prefix = turns.filter((t) => t.idx < turn.idx)
      const rest = turns.filter((t) => t.idx >= turn.idx)
      if (rest.length === 0) return

      const prefixText = prefix
        .map((t) => {
          const v = activeVariant(t)
          return `用户：${v.user.content}\n助手：${v.assistant?.content ?? ''}`
        })
        .join('\n\n')

      const prefixTokens = estimateTokens(prefixText)
      const shouldCompress = Boolean(options.compress) || prefixTokens > 6000

      // 续接时如果本来就有前情摘要，要把它一起消化掉，否则压缩第二次会丢掉第一次的内容
      const priorRecap = current?.recap?.trim() ?? ''
      const hasDocs = Boolean(current?.settingIds?.length)
      const narrative = hasDocs

      let summary = ''
      if ((prefix.length > 0 || priorRecap) && shouldCompress) {
        if (!config.apiKey) {
          set({ error: '压缩需要调用模型，请先在设置里填写 API Key' })
          return
        }
        set({ error: null })
        const source = [priorRecap ? `【已有的前情摘要】\n${priorRecap}` : '', prefixText]
          .filter(Boolean)
          .join('\n\n')
        const who = config.userName?.trim() || '用户'
        const instruction = narrative
          ? [
              '你在帮一段角色扮演对话做「续接摘要」。读这段摘要的人将接手继续扮演，但它看不到原文。',
              '输出 400–600 字的连续叙述，必须包含：',
              '- 现在的时间、地点、在场人物，以及各自的身体状态和情绪；',
              '- 人物关系的最新变化（谁对谁做了什么、态度怎么转了）；',
              '- 已经发生的关键事件，按因果讲，不要流水账；',
              '- 尚未解决的悬念、约定、未说完的话；',
              '- 称呼习惯和说话特征（谁习惯用哪些昵称、句子长短、语气）。',
              `要求：用叙述而不是条目；不要评价；用角色名字指代角色，用「${who}」指代对方，不要写「用户」「受测者」这类称呼；不要超过 600 字。`,
              '注意：每轮回复结尾重复出现的固定标记或口头禅不是剧情内容，摘要里不要提。',
            ].join('\n')
          : '把下面这段对话压缩成要点，供后续继续对话使用。保留：结论、事实、用户偏好、未完成的事项、专有名词。去掉寒暄和重复。用简洁的条目输出，不要评论。'

        try {
          summary = await completeText(
            [{ role: 'user', content: `${instruction}\n\n${source}` }],
            { ...config, systemPrompt: narrative ? '你是一个叙事摘要器，只输出摘要正文。' : '你是一个对话摘要器，只输出压缩后的要点。' },
            controller?.signal ?? new AbortController().signal
          )
          summary = summary.trim()
        } catch (error) {
          set({ error: humanizeError(error) })
          return
        }
      }

      const systemParts = [
        current?.systemPrompt,
        summary ? `【前情】\n${summary}` : '',
      ].filter(Boolean)

      // 标题沿用原名：续开的会话在列表里看起来就是同一段对话的继续
      const created = await getRepo().createSession(
        current?.title ?? '新话题',
        systemParts.join('\n\n') || undefined,
        current?.packId,
        current?.settingIds,
        current?.promptId,
        summary || priorRecap || undefined
      )

      for (const [i, old] of rest.entries()) {
        // 新会话从分叉点开始，前面的轮次已经压进摘要/系统提示词了；
        // 旧 path 指向的父节点不在这里，留着只会让导出误判成精确历史链
        const variants = old.variants.map((variant) => ({ ...variant, path: undefined }))
        await getRepo().appendTurn({ ...old, id: newId(), sessionId: created.id, idx: i, variants })
      }

      set({
        sessions: await getRepo().listSessions(),
        currentId: created.id,
        turns: await getRepo().listTurns(created.id),
        drawerOpen: false,
        error: null,
        draft: '',
      })
    },

    /**
     * 从选中的单回复链开新会话。
     *
     * 和「从此轮开新话题」不同：不是把后半段复制到新会话、前面压成摘要，
     * 而是把这条链原样搬过去，作为新会话的完整前情，然后从链尾继续。
     * 原会话不动。设定发展模式下禁用（发展稿不能回到过去）。
     */
    async forkFromChain(turnId, variantIndex) {
      const { turns, currentId, sessions, streamingTurnId } = get()
      if (!currentId || streamingTurnId) return
      const current = sessions.find((s) => s.id === currentId)
      if (!current) return

      const chain = resolveChain(turns, turnId, variantIndex)
      if (!chain || chain.steps.length === 0) return

      const title = `${current.title} · 分支`
      const settingIds = current.settingIds?.length
        ? current.settingIds
        : current.characterId
          ? [current.characterId]
          : undefined
      const created = await getRepo().createSession(
        title,
        current.systemPrompt,
        current.packId,
        settingIds,
        current.promptId,
        current.recap
      )

      for (const [i, step] of chain.steps.entries()) {
        const variant = step.turn.variants[step.variant]
        if (!variant) continue
        await getRepo().appendTurn({
          id: newId(),
          sessionId: created.id,
          idx: i,
          active: 0,
          createdAt: Date.now(),
          // 新会话只保留这条链；path 重新记成一条直线
          variants: [{ ...variant, path: i === 0 ? [] : Array.from({ length: i }, () => 0) }],
        })
      }

      // 分支标题固定下来，避免下一条消息把「· 分支」覆盖掉
      await getRepo().renameSession(created.id, title, true)
      set({
        sessions: await getRepo().listSessions(),
        currentId: created.id,
        turns: await getRepo().listTurns(created.id),
        drawerOpen: false,
        editingTurnId: null,
        error: null,
        draft: '',
      })
    },
  }
})
