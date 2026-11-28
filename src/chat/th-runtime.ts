import type { SettingDoc } from './settings'
import type { WorldEntry } from './characters'
import { applyMacros } from './characters'
import { expandVarMacros, extractUpdateVariables, readPointer, applyJsonPatch } from './variables'
import { executeStscript, type StscriptApi } from './stscript'
import type { ChatConfig } from './client'
import type { CardHelperScript } from './characters'
import { getRepo } from '@/db/runtime'
import { newId, type ChatTurn } from '@/db'

/** store 注入：避免 th-runtime ↔ store 的静态循环导入（store 启动时 bindThStore(useApp)） */
/** TH 运行时需要的最小 store 形状（结构化类型，零循环导入） */
export interface ThState {
  currentId: string | null
  sessions: Array<{ id: string; variables?: Record<string, unknown> }>
  config: { userName?: string; maxTokens?: number }
  turns: Array<{
    id: string
    idx: number
    active: number
    variants: Array<{
      user: { content: string }
      assistant?: { content: string; variables?: Record<string, unknown>; speaker?: string }
    }>
  }>
  send(text: string, attachments?: unknown): Promise<void>
  regenerate(turnId: string, instruction?: string): Promise<void>
  setSessionVariables(id: string, variables: Record<string, unknown>): Promise<void>
  importSetting(doc: unknown): void
}
export interface ThStoreBinding {
  getState(): ThState
  setTurns(turns: ChatTurn[]): void
}
let binding: ThStoreBinding | null = null
export function bindThStore(b: ThStoreBinding): void {
  binding = b
}
function setTurns(turns: ChatTurn[]): void {
  binding?.setTurns(turns)
}
function thState(): ThState {
  if (!binding) throw new Error('[TH] store 未绑定')
  return binding.getState()
}

/** store 接线：面板桥和 QR 按钮共用同一套执行环境 */
export function stscriptApiFromStore(): StscriptApi {
  return {
    send: (text) => thState().send(text),
    regenerateLast: async () => {
      const turns = thState().turns
      const last = turns[turns.length - 1]
      if (last) await thState().regenerate(last.id)
    },
    setVar: async (path, value) => {
      const s = thState()
      if (!s.currentId) return
      const current = s.sessions.find((x) => x.id === s.currentId)?.variables ?? {}
      const { vars } = applyJsonPatch(current, [
        { op: 'add', path: path.startsWith('/') ? path : `/${path.startsWith('/') ? path.slice(1) : path}`, value: safeClone(value) },
      ])
      await s.setSessionVariables(s.currentId, vars as Record<string, unknown>)
    },
  }
}

function safeClone(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

/**
 * 酒馆助手运行时（主窗口版）。
 *
 * 酒馆生态的全局脚本（ext.tavern_helper.scripts）按卡的原样跑在主窗口里：
 * 它们用 eventOn(tavern_events.X) 订阅事件、直接查消息 DOM 的 ST 类名（.mes_text），
 * 并调用 TH API（getChatMessages / triggerSlash / 世界书三件套 / 变量读写）。
 * 这里提供这些宿主能力；脚本内容本身一字不改。
 *
 * 信任模型与酒馆一致：带助手脚本的卡是用户主动导入的内容，其脚本拥有
 * 主窗口执行权（消息 iframe 也会以同源模式渲染）——不用助手卡的会话不注入。
 */

/* ---------------- 事件总线（独立模块，避免 store 循环导入） ---------------- */

import { fireThEvent, thOff, thOn, TH_EVENTS, type ThHandler } from './th-events'

export { fireThEvent, TH_EVENTS }

/* ---------------- 会话上下文 ---------------- */

/** 当前挂载的带助手脚本的卡文档；没有则 TH 运行时保持惰性 */
let mountedDocs: SettingDoc[] = []

export function thActive(): boolean {
  return mountedDocs.some((doc) => (doc.helperScripts?.length ?? 0) > 0)
}

/* ---------------- ST 形状的消息扁平视图（getChatMessages / 变量定位共用） ---------------- */

interface FlatMessage {
  message_id: number
  turnId: string
  turnIdx: number
  role: 'user' | 'assistant'
  is_user: boolean
  name: string
  message: string
  variables?: Record<string, unknown>
}

function flatMessages(): FlatMessage[] {
  const state = thState()
  const doc = mountedDocs[0]
  const userName = state.config.userName ?? '你'
  const out: FlatMessage[] = []
  let id = 0
  for (const turn of state.turns) {
    const v = turn.variants[turn.active] ?? turn.variants[0]
    if (!v) continue
    const user = v.user?.content ?? ''
    if (user) {
      out.push({ message_id: id++, turnId: turn.id, turnIdx: turn.idx, role: 'user', is_user: true, name: userName, message: user })
    }
    if (v.assistant) {
      out.push({
        message_id: id++,
        turnId: turn.id,
        turnIdx: turn.idx,
        role: 'assistant',
        is_user: false,
        name: doc?.name ?? '角色',
        message: v.assistant.content ?? '',
        variables: v.assistant.variables,
      })
    }
  }
  return out
}

/** TH 的消息定位：数字或 'N-M' 区间（负数从末尾倒数） */
function resolveMessageIds(flat: FlatMessage[], path?: string | number): FlatMessage[] {
  if (path === undefined || path === null) return flat
  if (typeof path === 'number') {
    const i = path < 0 ? flat.length + path : path
    return [flat[i]].filter(Boolean)
  }
  const m = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(String(path).trim())
  if (!m) return [flat[Number(path)]].filter(Boolean)
  const a = Number(m[1]), b = Number(m[2])
  const toIdx = (n: number) => (n < 0 ? flat.length + n : n)
  return flat.slice(Math.min(toIdx(a), toIdx(b)), Math.max(toIdx(a), toIdx(b)) + 1)
}

/* ---------------- 变量三作用域（导出供自检直接测试） ---------------- */

export function thGetVariables(options?: {
  type?: 'message' | 'chat' | 'global'
  message_id?: number
}): Record<string, unknown> {
  const type = options?.type ?? 'chat'
  if (type === 'global') return {}
  const state = thState()
  if (type === 'message') {
    const flat = resolveMessageIds(flatMessages(), options?.message_id ?? -1)
    // 消息自己的快照优先；老消息没有就回退会话级（兼容升级前数据）
    return flat[0]?.variables ?? state.sessions.find((s) => s.id === state.currentId)?.variables ?? {}
  }
  return state.sessions.find((s) => s.id === state.currentId)?.variables ?? {}
}

export async function thInsertOrAssignVariables(options: {
  type?: 'message' | 'chat' | 'global'
  assigning?: Record<string, unknown>
  message_id?: number
}): Promise<void> {
  const assigning = options?.assigning ?? {}
  const type = options?.type ?? 'chat'
  const state = thState()
  if (type === 'global' || !state.currentId) return
  if (type === 'message') {
    const flat = resolveMessageIds(flatMessages(), options?.message_id ?? -1)
    const target = flat[0]
    if (!target || target.role !== 'assistant') return
    await updateMessageVariables(target.turnId, { ...(target.variables ?? {}), ...assigning })
    return
  }
  const sessionId = state.currentId
  const vars = { ...(state.sessions.find((s) => s.id === sessionId)?.variables ?? {}), ...assigning }
  void state.setSessionVariables(sessionId, vars)
}

export function thFlatMessages(): FlatMessage[] {
  return flatMessages()
}

/** 消息级变量写回：走真实 ChatTurn（类型安全），完成后刷新扁平视图 */
async function updateMessageVariables(turnId: string, vars: Record<string, unknown>): Promise<void> {
  const s = thState()
  if (!s.currentId) return
  const turns = await getRepo().listTurns(s.currentId)
  const turn = turns.find((t) => t.id === turnId)
  if (!turn) return
  const active = turn.active
  const updated: ChatTurn = {
    ...turn,
    variants: turn.variants.map((v, i) =>
      i === active && v.assistant ? { ...v, assistant: { ...v.assistant, variables: vars } } : v
    ),
  }
  await getRepo().updateTurn(updated)
  setTurns(await getRepo().listTurns(s.currentId))
}

/* ---------------- 世界书双向映射 ---------------- */

function toThEntry(entry: WorldEntry) {
  return {
    uid: entry.id,
    comment: entry.comment ?? entry.keys.join(', '),
    keys: entry.keys,
    content: entry.content,
    enabled: entry.enabled,
    constant: Boolean(entry.constant),
    order: entry.order ?? 100,
    position: 'before_char',
    selective: entry.selective !== false && (entry.secondaryKeys?.length ?? 0) > 0,
  }
}

/** TH 形状的条目回写：按 comment 匹配旧条目合并，保住 chat-lite 的扩展字段 */
function mergeThEntry(old: WorldEntry, th: Record<string, unknown>): WorldEntry {
  return {
    ...old,
    comment: typeof th.comment === 'string' ? th.comment : old.comment,
    keys: Array.isArray(th.keys) ? th.keys.map(String) : old.keys,
    content: typeof th.content === 'string' ? th.content : old.content,
    enabled: th.enabled !== false,
    constant: th.constant === true,
    ...(typeof th.order === 'number' ? { order: th.order } : {}),
  }
}

/* ---------------- 运行时挂载 ---------------- */

/** 定义全局 TH API + 注入卡的全局脚本；幂等，脚本按 id 只注入一次 */
export function mountThRuntime(docs: SettingDoc[]): void {
  mountedDocs = docs
  const w = window as unknown as Record<string, unknown>
  if (!w.__clThMounted) {
    w.__clThMounted = true
    defineThGlobals(w)
    defineMvuShim(w)
  }
  injectHelperScripts(docs)
}

/**
 * MVU shim：MagVarUpdate 框架的宿主面（卡自带的 MVUbeta 从 CDN import 真 bundle，
 * 加载成功会覆盖这里；CDN 不可达时由这层垫背——变量树来自消息级/会话级变量引擎）。
 * 默认作用域是 message（MVU 的 stat_data 挂在 AI 消息上）。
 */
function defineMvuShim(w: Record<string, unknown>): void {
  if (typeof w.Mvu !== 'undefined') return
  const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)))
  const readData = (type?: 'message' | 'chat' | 'global', message_id?: number): Record<string, unknown> => {
    const state = thState()
    if (type === 'global') return {}
    if (type === 'chat') return clone(state.sessions.find((s) => s.id === state.currentId)?.variables ?? {})
    const flat = resolveMessageIds(flatMessages(), message_id ?? -1)
    const msgVars = flat[0]?.variables
    // 消息自己的快照优先；老消息没有就回退会话级（兼容升级前数据）
    return clone(msgVars && Object.keys(msgVars).length > 0 ? msgVars : (state.sessions.find((s) => s.id === state.currentId)?.variables ?? {}))
  }
  const writeData = async (statData: Record<string, unknown>, type?: 'message' | 'chat' | 'global', message_id?: number) => {
    const data = clone(statData)
    if (type === 'chat') {
      const state = thState()
      const sessionId = state.currentId
      if (sessionId) void state.setSessionVariables(sessionId, data)
      return
    }
    // message 作用域：写进那条 AI 消息的 variables 并持久化
    const flat = resolveMessageIds(flatMessages(), message_id ?? -1)
    const target = flat[0]
    if (!target || target.role !== 'assistant') return
    await updateMessageVariables(target.turnId, clone(data))
  }
  w.Mvu = {
    getMvuData: (type?: 'message' | 'chat' | 'global', message_id?: number) => {
      const stat_data = readData(type, message_id)
      return { stat_data, display_stat_data: clone(stat_data) }
    },
    replaceMvuData: (data: { stat_data?: Record<string, unknown> }, type?: 'message' | 'chat' | 'global', message_id?: number) => {
      if (data?.stat_data) writeData(data.stat_data, type, message_id)
      return clone(data ?? {})
    },
    setMvuData: (data: { stat_data?: Record<string, unknown> }, type?: 'message' | 'chat' | 'global', message_id?: number) => {
      if (data?.stat_data) writeData(data.stat_data, type, message_id)
      return clone(data ?? {})
    },
    commitMvuData: (data: { stat_data?: Record<string, unknown> }, type?: 'message' | 'chat' | 'global', message_id?: number) => {
      if (data?.stat_data) writeData(data.stat_data, type, message_id)
      fireThEvent('VARIABLE_UPDATE_ENDED', { vars: data?.stat_data ?? {} })
      return clone(data ?? {})
    },
    parseMvuData: (message: string) => {
      const ops = extractUpdateVariables(String(message ?? ''))
      const { vars } = applyJsonPatch(readData('message'), ops)
      return { stat_data: vars, display_stat_data: clone(vars) }
    },
    events: {
      VARIABLE_UPDATE_STARTED: 'VARIABLE_UPDATE_STARTED',
      VARIABLE_UPDATE_ENDED: 'VARIABLE_UPDATE_ENDED',
      VARIABLES_UPDATED: 'VARIABLES_UPDATED',
      on: (name: string, fn: ThHandler) => thOn(String(name), fn),
      off: (name: string, fn: ThHandler) => thOff(String(name), fn),
      emit: (name: string, data?: unknown) => fireThEvent(String(name), data),
    },
    version: 'chat-lite-minimal',
  }
}

function defineThGlobals(w: Record<string, unknown>): void {
  w.tavern_events = { ...TH_EVENTS }

  w.eventOn = (name: string, fn: ThHandler) => thOn(String(name), fn)
  w.eventOnce = (name: string, fn: ThHandler) => {
    const wrapped: ThHandler = (data) => {
      thOff(name, wrapped)
      fn(data)
    }
    thOn(String(name), wrapped)
  }
  w.eventEmit = (name: string, data?: unknown) => fireThEvent(String(name), data)
  w.eventRemove = (name: string, fn: ThHandler) => thOff(String(name), fn)

  // 酒馆的变量 API 是同步的（数据就在本地）；卡脚本经常不带 await 直接取值
  w.getvar = (path: string) => {
    const state = thState()
    const vars = state.sessions.find((x) => x.id === state.currentId)?.variables ?? {}
    return readPointer(vars, path.startsWith('/') ? path : `/${path}`)
  }
  w.setvar = (path: string, value: unknown) => {
    const state = thState()
    const sessionId = state.currentId
    if (!sessionId) return
    const vars = state.sessions.find((s) => s.id === sessionId)?.variables ?? {}
    const { vars: next } = applyJsonPatch(vars, [
      { op: 'add', path: path.startsWith('/') ? path : `/${path}`, value },
    ])
    void state.setSessionVariables(sessionId, next as Record<string, unknown>)
  }
  w.getChatVariables = () => {
    const state = thState()
    return state.sessions.find((s) => s.id === state.currentId)?.variables ?? {}
  }
  w.setChatVariables = (vars: Record<string, unknown>) => {
    const state = thState()
    const sessionId = state.currentId
    if (sessionId) void state.setSessionVariables(sessionId, vars)
  }

  /** ST 形状的消息视图；message 字段是存储原文（协议标记原样在，脚本靠它找状态） */
  w.getChatMessages = async (range?: string | number) => {
    return resolveMessageIds(flatMessages(), range).map((m) => ({
      message_id: m.message_id,
      name: m.name,
      is_user: m.is_user,
      is_system: false,
      role: m.role,
      message: m.message,
      data: {},
    }))
  }

  w.triggerSlash = async (command: string) => {
    // 无会话也能跑：/send 会经 store.send 建会话并挂起始页预选的卡
    await executeStscript(String(command), stscriptApiFromStore())
  }

  /** TH 的 createChatMessages：追加消息但不触发生成 */
  w.createChatMessages = async (messages: Array<{ role?: string; message?: string }>) => {
    const state = thState()
    const sessionId = state.currentId
    if (!sessionId) return
    for (const msg of messages ?? []) {
      const text = msg?.message ?? ''
      if (!text) continue
      const turn: ChatTurn = {
        id: newId(),
        sessionId,
        idx: thState().turns.length,
        variants: [
          msg?.role === 'assistant'
            ? { user: { content: '' }, assistant: { content: text }, path: [] }
            : { user: { content: text }, path: [] },
        ],
        active: 0,
        createdAt: Date.now(),
      }
      await getRepo().appendTurn(turn)
      setTurns(await getRepo().listTurns(sessionId))
      fireThEvent(msg?.role === 'assistant' ? TH_EVENTS.MESSAGE_RECEIVED : TH_EVENTS.USER_MESSAGE_RENDERED, turn.idx)
    }
  }

  w.updateChatMessagesWith = async (
    path: string | number,
    updater: (messages: Array<Record<string, unknown>>) => unknown
  ) => {
    const flat = resolveMessageIds(flatMessages(), path)
    if (flat.length === 0) return
    const shaped = flat.map((m) => ({ message_id: m.message_id, role: m.role, name: m.name, message: m.message }))
    const result = (await updater(shaped)) as Array<Record<string, unknown>> | undefined
    const final = Array.isArray(result) ? result : shaped
    const state = thState()
    const edits = final
      .map((m) => {
        const meta = flat.find((f) => f.message_id === m.message_id)
        return meta ? { turnId: meta.turnId, role: meta.role, message: String(m.message ?? '') } : null
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
    if (edits.length === 0) return
    if (!state.currentId) return
    const full = await getRepo().listTurns(state.currentId)
    const turns: ChatTurn[] = full.map((t) => {
      const hit = edits.filter((e) => e.turnId === t.id)
      if (hit.length === 0) return t
      const active = t.active
      return {
        ...t,
        variants: t.variants.map((v, i) => {
          if (i !== active) return v
          const nv = { ...v, user: { ...v.user } }
          for (const e of hit) {
            if (e.role === 'user') nv.user = { ...nv.user, content: e.message }
            else if (nv.assistant) nv.assistant = { ...nv.assistant, content: e.message }
          }
          return nv
        }),
      }
    })
    for (const t of turns) {
      if (edits.some((e) => e.turnId === t.id)) await getRepo().updateTurn(t)
    }
    setTurns(turns)
    fireThEvent(TH_EVENTS.MESSAGE_UPDATED, edits[0]?.turnId)
  }

  /** v1 近似：删除 = 清空该消息内容（我们的轮次是用户/AI 配对模型，不做真删） */
  w.deleteChatMessages = async () => {
    console.warn('[TH] deleteChatMessages 暂未实现：配对轮次模型下不做真删')
    return false
  }

  /** 独立生成：不走会话，直接拿一段补全文本（脚本做小计算/翻译用） */
  w.generate = async (params?: { prompt?: string; user_input?: string; max_tokens?: number }) => {
    const { completeText } = await import('./client')
    const state = thState()
    const prompt = params?.prompt ?? params?.user_input ?? ''
    if (!prompt) return ''
    const config = { ...state.config, ...(params?.max_tokens ? { maxTokens: params.max_tokens } : {}) } as ChatConfig
    return await completeText([{ role: 'user', content: prompt }], config, new AbortController().signal)
  }

  w.getIframeName = () => ''
  w.getCurrentMessageId = () => {
    const flat = flatMessages()
    return flat.length ? flat[flat.length - 1].message_id : null
  }
  w.getMaxContextSize = () => thState().config.maxTokens ?? null
  w.saveChat = async () => true

  // 卡脚本同步取值（getCharWorldBookNames('current')?.primary），必须是同步返回
  w.getCharWorldbookNames = () => ({ primary: mountedDocs[0]?.name ?? '', extras: [] })
  w.getWorldbookNames = async () => ({ primary: mountedDocs[0]?.name ?? '', extras: [] })

  // 酒馆的变量 API：三作用域（message/chat/global），message 带 message_id（-1=最后一条）
  w.getVariables = (options?: { type?: 'message' | 'chat' | 'global'; message_id?: number }) => thGetVariables(options)
  w.insertOrAssignVariables = (options: {
    type?: 'message' | 'chat' | 'global'
    assigning?: Record<string, unknown>
    message_id?: number
  }) => thInsertOrAssignVariables(options)
  w.getWorldbook = async (name: string) => {
    const doc = mountedDocs.find((d) => d.name === name) ?? mountedDocs[0]
    if (!doc) throw new Error('会话没有挂载角色卡')
    return { name: doc.name, entries: doc.entries.map(toThEntry) }
  }
  w.updateWorldbookWith = async (name: string, updater: (entries: unknown) => unknown) => {
    const state = thState()
    const doc = mountedDocs.find((d) => d.name === name) ?? mountedDocs[0]
    if (!doc) throw new Error('未绑定角色卡世界书')
    // 酒助的真实契约：updater 直接收到「条目数组」并返回新数组（母系卡实测）
    const thEntriesIn = doc.entries.map(toThEntry)
    let returned: unknown
    try {
      returned = await updater(thEntriesIn)
    } catch (error) {
      ;(w as Record<string, unknown>).__clLastThError = `updater: ${String((error as Error)?.stack ?? error).slice(0, 600)}`
      throw error
    }
    // 兼容三种返回：新数组 / 带 entries 的对象 / undefined（就地改了入参数组）
    const thEntries = Array.isArray(returned)
      ? (returned as Array<Record<string, unknown>>)
      : returned && typeof returned === 'object' && Array.isArray((returned as { entries?: unknown }).entries)
        ? ((returned as { entries: unknown[] }).entries as Array<Record<string, unknown>>)
        : thEntriesIn
    const next: WorldEntry[] = thEntries.map((th) => {
      const comment = String(th.comment ?? '')
      const old =
        doc.entries.find((e) => (e.comment ?? e.keys.join(', ')) === comment) ??
        doc.entries.find((e) => e.content === th.content) ??
        doc.entries.find((e) => e.id === th.uid)
      if (old) return mergeThEntry(old, th)
      return {
        id: typeof th.uid === 'string' ? th.uid : crypto.randomUUID(),
        comment: comment || undefined,
        keys: Array.isArray(th.keys) ? th.keys.map(String) : comment ? [comment] : [],
        content: String(th.content ?? ''),
        enabled: th.enabled !== false,
        constant: th.constant === true,
        ...(typeof th.order === 'number' ? { order: th.order } : {}),
      }
    })
    if (next.length > 0) {
      state.importSetting({ ...doc, entries: next, updatedAt: Date.now() })
    }
    return { name: doc.name, entries: thEntries }
  }
  // 调试出口：卡脚本异常的堆栈落在这里（读 window.__clLastThError）
  ;(w as Record<string, unknown>).__clLastThError = ''
  defineThCompat(w)
}

/**
 * 生态兼容层：酒馆助手脚本约定俗成的宿主符号。
 * 卡的初始化普遍包在 `$(fn)` + `errorCatched` + `await waitGlobalInitialized('TavernHelper')`
 * 里，缺任何一个整个 init 静默不跑（母系卡实测）。
 */
function defineThCompat(w: Record<string, unknown>): void {
  // jQuery 微 shim：只覆盖生态脚本最常用的 ready 回调形态 $(fn)
  if (typeof w.$ === 'undefined') {
    w.$ = (fn: () => void) => {
      if (document.readyState !== 'loading') {
        try {
          fn()
        } catch (e) {
          console.error('[TH] ready 回调抛错', e)
        }
        return
      }
      document.addEventListener('DOMContentLoaded', () => {
        try {
          fn()
        } catch (e) {
          console.error('[TH] ready 回调抛错', e)
        }
      })
    }
  }
  if (typeof w.errorCatched === 'undefined') {
    w.errorCatched = async (fn: () => unknown) => {
      try {
        return await fn()
      } catch (error) {
        ;(w as Record<string, unknown>).__clLastThError = `init: ${String((error as Error)?.stack ?? error).slice(0, 600)}`
        console.error('[TH] 脚本初始化失败', error)
        return undefined
      }
    }
  }
  if (typeof w.waitGlobalInitialized === 'undefined') {
    w.waitGlobalInitialized = async (name: string, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (w[name] !== undefined) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return w[name] !== undefined
    }
  }
  if (typeof w.getButtonEvent === 'undefined') {
    // 脚本按钮的 UI 不渲染（宿主无按钮位），事件名照发但不触发——按钮功能优雅缺席
    w.getButtonEvent = (name: string) => `button:${name}`
  }
  // TavernHelper API 命名空间：生态脚本按 window.TavernHelper.xxx 引用
  if (typeof w.TavernHelper === 'undefined') {
    const api = [
      'eventOn', 'eventOnce', 'eventEmit', 'eventRemove', 'getButtonEvent',
      'getChatMessages', 'createChatMessages', 'updateChatMessagesWith', 'deleteChatMessages',
      'triggerSlash', 'generate',
      'getvar', 'setvar', 'getChatVariables', 'setChatVariables', 'getVariables', 'insertOrAssignVariables',
      'getCharWorldbookNames', 'getWorldbookNames', 'getWorldbook', 'updateWorldbookWith',
      'substitudeMacros', 'getIframeName', 'getCurrentMessageId', 'getMaxContextSize', 'saveChat',
      'waitGlobalInitialized', 'errorCatched',
    ]
    const th: Record<string, unknown> = {}
    for (const key of api) {
      if (typeof w[key] === 'function') th[key] = w[key]
    }
    w.TavernHelper = th
  }

  w.substitudeMacros = async (text: string) => {
    const state = thState()
    const doc = mountedDocs[0]
    const vars = state.sessions.find((s) => s.id === state.currentId)?.variables ?? {}
    return expandVarMacros(applyMacros(String(text ?? ''), doc?.name ?? '', state.config.userName ?? '你'), vars)
  }
}

/** 卡的全局脚本：module 方式进主窗口（CDN import 如 MVU 由此生效） */
function injectHelperScripts(docs: SettingDoc[]): void {
  for (const doc of docs) {
    for (const script of doc.helperScripts ?? []) {
      if (document.querySelector(`script[data-th-id="${script.id}"]`)) continue
      const el = document.createElement('script')
      el.type = 'module'
      el.dataset.thId = script.id
      el.dataset.thName = script.name
      el.textContent = script.content
      document.head.appendChild(el)
    }
  }
}

/** 导出给类型引用：脚本名列表（调试/展示用） */
export function helperScriptNames(docs: SettingDoc[]): string[] {
  return docs.flatMap((d) => (d.helperScripts ?? []).map((s: CardHelperScript) => s.name))
}
