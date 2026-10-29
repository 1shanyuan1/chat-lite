import { create } from 'zustand'
import {
  activeVariant,
  newId,
  type ChatTurn,
  type Session,
  type TurnAssistant,
} from '@/db'
import { getRepo } from '@/db/runtime'
import { completeText, streamChat, type ChatConfig, type WireTurn } from './client'
import { humanizeError } from './errors'
import { applyMacros, renderCard, type CharacterCard } from './characters'
import { listCharacters, saveCharacter, deleteCharacter as removeCharacter } from '@/db/characters'
import { findTurnHits } from './hit-nav'
import { contextWindow, matchWorldEntries, renderWorldEntries } from './lore'
import { composeSystemPrompt, DEFAULT_PACK_ID, findPack, renderTemplate } from './packs'
import { PROVIDERS } from './providers'
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

/** 用第一轮的用户提问做标题 */
function sessionTitleFor(turns: ChatTurn[], sessionId: string): string {
  const first = turns.filter((t) => t.sessionId === sessionId).sort((a, b) => a.idx - b.idx)[0]
  const text = first ? activeVariant(first).user.content : '新会话'
  return text.slice(0, 20) + (text.length > 20 ? '…' : '')
}

/** 把某轮之前的历史拍平成下游要的 messages（只取激活版本） */
function wireHistory(turns: ChatTurn[], uptoIdx: number): WireTurn[] {
  const out: WireTurn[] = []
  for (const turn of turns) {
    if (turn.idx > uptoIdx) break
    const variant = activeVariant(turn)
    if (variant.user.content.trim()) out.push({ role: 'user', content: variant.user.content })
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
  drawerOpen: boolean
  settingsOpen: boolean
  draft: string
  /** 搜索命中浏览状态：当前会话里正在看第几条命中 */
  browse: { query: string; index: number } | null
  characters: CharacterCard[]

  importCharacter: (card: CharacterCard) => void
  removeCharacter: (id: string) => void
  startWithCharacter: (characterId: string) => Promise<void>

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
  send: (text: string) => Promise<void>
  stop: () => void
  regenerate: (turnId: string) => Promise<void>
  editResend: (turnId: string, newText: string) => Promise<void>
  switchVariant: (turnId: string, index: number) => Promise<void>
  branchFrom: (turnId: string, options?: { compress?: boolean }) => Promise<void>
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
  const generate = async (turnId: string, index: number, history: WireTurn[], sessionId: string) => {
    set({ streamingTurnId: turnId, error: null })
    patchAssistant(turnId, index, { content: '', model: get().config.model })
    controller = new AbortController()
    lastPersist = 0

    // 提示词分层：包规范 → 角色卡 → 命中的世界书 → 会话摘要 → 用户设置
    const session = get().sessions.find((s) => s.id === sessionId)
    const pack = findPack(session?.packId ?? get().config.packId)
    const userName = get().config.userName ?? '你'
    const card = session?.characterId ? get().characters.find((c) => c.id === session.characterId) : undefined

    let characterBlock = ''
    let worldBlock = ''
    if (card) {
      characterBlock = renderCard(card, userName)
      const recent = contextWindow(history.map((m) => m.content))
      worldBlock = renderWorldEntries(matchWorldEntries(card.worldInfo, recent))
    }

    const effectiveConfig: ChatConfig = {
      ...get().config,
      systemPrompt: composeSystemPrompt(
        pack.systemPrompt,
        characterBlock,
        worldBlock,
        session?.systemPrompt,
        get().config.systemPrompt
      ),
    }

    let answer = ''
    let thinking = ''
    let usage: Usage | undefined
    let failure: string | null = null

    try {
      for await (const delta of streamChat(history, effectiveConfig, controller.signal)) {
        if (delta.usage) usage = mergeUsage(usage, delta.usage)
        if (delta.reasoning) thinking += delta.reasoning
        if (delta.content) answer += delta.content
        if (delta.reasoning || delta.content) {
          patchAssistant(turnId, index, { content: answer, reasoning: thinking || undefined })
          if (Date.now() - lastPersist > 900) {
            lastPersist = Date.now()
            void persistTurn(turnId)
          }
        }
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      if (!aborted) failure = humanizeError(error)
    } finally {
      controller = null
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
      interrupted: Boolean(failure) || (!answer && !thinking),
    }

    set((state) => ({
      streamingTurnId: null,
      error: failure,
      turns: state.turns.map((t) =>
        t.id === turnId
          ? { ...t, variants: t.variants.map((v, i) => (i === index ? { ...v, assistant } : v)) }
          : t
      ),
    }))
    await persistTurn(turnId)
    await getRepo().renameSession(sessionId, sessionTitleFor(get().turns, sessionId))
    set({ sessions: await getRepo().listSessions() })
  }

  return {
    ready: false,
    config: loadConfig(),
    sessions: [],
    currentId: null,
    turns: [],
    streamingTurnId: null,
    error: null,
    drawerOpen: false,
    settingsOpen: false,
    draft: '',
    browse: null,
    characters: [],

    async init() {
      set({ characters: listCharacters() })
      const sessions = await getRepo().listSessions()
      const current = sessions[0] ?? null
      set({
        ready: true,
        sessions,
        currentId: current?.id ?? null,
        turns: current ? await getRepo().listTurns(current.id) : [],
        draft: localStorage.getItem(draftKey(current?.id ?? null)) ?? '',
      })
    },

    saveConfig(patch) {
      const config = { ...get().config, ...patch }
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
      set({ config })
    },

    setDraft(text) {
      localStorage.setItem(draftKey(get().currentId), text)
      set({ draft: text })
    },

    setDrawer: (open) => set({ drawerOpen: open }),
    setSettings: (open) => set({ settingsOpen: open }),

    importCharacter(card) {
      set({ characters: saveCharacter(card) })
    },

    removeCharacter(id) {
      set({ characters: removeCharacter(id) })
    },

    /** 用角色开新会话：建会话 → 插入开场白 → 切过去 */
    async startWithCharacter(characterId) {
      const card = get().characters.find((c) => c.id === characterId)
      if (!card) return
      const session = await getRepo().createSession(card.name, undefined, 'roleplay', card.id)

      const greeting = card.firstMessage.trim()
      if (greeting) {
        await getRepo().appendTurn({
          id: newId(),
          sessionId: session.id,
          idx: 0,
          active: 0,
          createdAt: Date.now(),
          variants: [
            {
              user: { content: '' },
              assistant: { content: applyMacros(greeting, card.name, get().config.userName ?? '你') },
            },
          ],
        })
      }

      set({
        sessions: await getRepo().listSessions(),
        currentId: session.id,
        turns: await getRepo().listTurns(session.id),
        drawerOpen: false,
        error: null,
        draft: '',
        browse: null,
      })
    },

    /** 切换提示词包：写回全局默认，同时绑定到当前会话 */
    async setPack(packId) {
      const { config, currentId, sessions } = get()
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, packId }))
      set({ config: { ...config, packId } })
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
        turns: [],
        drawerOpen: false,
        error: null,
        browse: null,
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

    async send(text) {
      const content = text.trim()
      if (!content || get().streamingTurnId) return

      const { config } = get()
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      let sessionId = get().currentId
      if (!sessionId) {
        const title = content.slice(0, 20) + (content.length > 20 ? '…' : '')
        // 全局 systemPrompt 不落库，每次生成时再合并，避免改设置后旧会话不生效
        const session = await getRepo().createSession(title, undefined, get().config.packId)
        sessionId = session.id
        set({ currentId: session.id, sessions: await getRepo().listSessions() })
      }

      const turn: ChatTurn = {
        id: newId(),
        sessionId,
        idx: get().turns.length,
        variants: [{ user: { content } }],
        active: 0,
        createdAt: Date.now(),
      }
      await getRepo().appendTurn(turn)
      set({ turns: [...get().turns, turn], error: null })
      localStorage.removeItem(draftKey(sessionId))
      set({ draft: '' })

      await generate(turn.id, 0, wireHistory(get().turns, turn.idx), sessionId)
    },

    async regenerate(turnId) {
      const { turns, streamingTurnId, config } = get()
      if (streamingTurnId) return
      const turn = turns.find((t) => t.id === turnId)
      if (!turn) return
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      const variant = activeVariant(turn)
      const nextIndex = turn.variants.length
      const updated: ChatTurn = { ...turn, variants: [...turn.variants, { user: variant.user }], active: nextIndex }
      set({ turns: turns.map((t) => (t.id === turnId ? updated : t)) })
      await getRepo().updateTurn(updated)

      await generate(turnId, nextIndex, wireHistory(get().turns, turn.idx), turn.sessionId)
    },

    async editResend(turnId, newText) {
      const content = newText.trim()
      const { turns, streamingTurnId, config } = get()
      if (!content || streamingTurnId) return
      const turn = turns.find((t) => t.id === turnId)
      if (!turn) return
      if (!config.apiKey) {
        set({ error: '请先在设置里填写 API Key', settingsOpen: true })
        return
      }

      // 编辑会改写上下文，之后的轮次不再成立，直接截断（旧内容仍保留在本轮变体里）
      await getRepo().deleteTurnsFrom(turn.sessionId, turn.idx + 1)
      const remaining = turns.filter((t) => t.idx <= turn.idx)
      const nextIndex = turn.variants.length
      const updated: ChatTurn = { ...turn, variants: [...turn.variants, { user: { content } }], active: nextIndex }
      set({ turns: remaining.map((t) => (t.id === turnId ? updated : t)) })
      await getRepo().updateTurn(updated)

      await generate(turnId, nextIndex, wireHistory(get().turns, turn.idx), turn.sessionId)
    },

    async switchVariant(turnId, index) {
      const turns = get().turns
      const turn = turns.find((t) => t.id === turnId)
      if (!turn || index < 0 || index >= turn.variants.length) return
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
      const prefix = turns.filter((t) => t.idx < turn.idx)
      const rest = turns.filter((t) => t.idx >= turn.idx)

      const prefixText = prefix
        .map((t) => {
          const v = activeVariant(t)
          return `用户：${v.user.content}\n助手：${v.assistant?.content ?? ''}`
        })
        .join('\n\n')

      const prefixTokens = estimateTokens(prefixText)
      const shouldCompress = Boolean(options.compress) || prefixTokens > 6000

      let summary = ''
      if (prefix.length > 0 && shouldCompress) {
        if (!config.apiKey) {
          set({ error: '压缩需要调用模型，请先在设置里填写 API Key' })
          return
        }
        set({ error: null })
        try {
          summary = await completeText(
            [
              {
                role: 'user',
                content: `把下面这段对话压缩成要点，供后续继续对话使用。保留：结论、事实、用户偏好、未完成的事项、专有名词。去掉寒暄和重复。用简洁的条目输出，不要评论。\n\n${prefixText}`,
              },
            ],
            { ...config, systemPrompt: '你是一个对话摘要器，只输出压缩后的要点。' },
            controller?.signal ?? new AbortController().signal
          )
        } catch (error) {
          set({ error: humanizeError(error) })
          return
        }
      }

      const systemParts = [current?.systemPrompt, summary ? `先前对话摘要：\n${summary}` : ''].filter(Boolean)
      const created = await getRepo().createSession(
        `${current?.title ?? '新话题'} · 续`,
        systemParts.join('\n\n') || undefined
      )

      for (const [i, old] of rest.entries()) {
        await getRepo().appendTurn({ ...old, id: newId(), sessionId: created.id, idx: i })
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
  }
})
