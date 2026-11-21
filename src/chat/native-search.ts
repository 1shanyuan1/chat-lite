import type { ChatConfig } from './client'
import { keyForProvider } from './credentials'
import { resolveProtocol, type Protocol } from './protocol'
import { findProvider } from './providers'

/**
 * 上游自带的搜索：把参数发给模型厂商，由它自己搜。
 * 各家形态完全不同，所以按协议 + 服务商分派。
 */

export interface NativeSearchPayload {
  /** 合并进 OpenAI 兼容请求体顶层 */
  openai?: Record<string, unknown>
  /** 合并进 Anthropic 请求体顶层 */
  anthropic?: Record<string, unknown>
  /** 合并进 Gemini 请求体顶层（tools 在这一层） */
  gemini?: Record<string, unknown>
  /** 追加到模型名后面，如 OpenRouter 的 :online */
  modelSuffix?: string
}

/** 用 Anthropic 的服务端搜索工具，最多搜 5 次 */
const anthropicSearch = (): NativeSearchPayload => ({
  anthropic: { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] },
})

/** Gemini 的 Google 搜索接地 */
const geminiSearch = (): NativeSearchPayload => ({
  gemini: { tools: [{ google_search: {} }] },
})

/** 阿里百炼 / 硅基流动：顶层布尔开关 */
const qwenSearch = (): NativeSearchPayload => ({ openai: { enable_search: true } })

/** 智谱：tools 里塞一个 web_search 工具 */
const glmSearch = (): NativeSearchPayload => ({
  openai: { tools: [{ type: 'web_search', web_search: { enable: 'True' } }] },
})

/** OpenRouter：模型名加 :online */
const openrouterSearch = (): NativeSearchPayload => ({ modelSuffix: ':online' })

/**
 * 当前协议 + 服务商有没有可用的上游搜索。
 * 认不出返回 null —— 宁可让用户落到本地搜索，也不要发一个必然报错的参数。
 */
export function nativeSearchPayload(protocol: Protocol, providerId?: string): NativeSearchPayload | null {
  if (protocol === 'anthropic') return anthropicSearch()
  if (protocol === 'gemini') return geminiSearch()

  switch (providerId) {
    case 'dashscope':
    case 'siliconflow':
      return qwenSearch()
    case 'zhipu':
      return glmSearch()
    case 'openrouter':
      return openrouterSearch()
    // OpenAI 的 web_search 只在 Responses API 里有，Chat Completions 用不了；
    // xAI 的实时搜索也走 Responses，这里都不算支持
    default:
      return null
  }
}

export const nativeSearchSupported = (protocol: Protocol, providerId?: string) =>
  nativeSearchPayload(protocol, providerId) !== null

/** 一次辅助搜索要打给谁 */
export interface NativeSearchTarget {
  protocol: Protocol
  providerId?: string
  baseUrl: string
  apiKey: string
  model: string
  payload: NativeSearchPayload
}

/**
 * 解析辅助搜索的目标。
 * 配了 searchModel 就用它（主对话用 A、搜索借 B），否则退回当前对话模型。
 * 目标不支持搜索时返回 null。
 */
export function resolveNativeSearchTarget(config: ChatConfig): NativeSearchTarget | null {
  const aux = config.searchModel
  // 只有显式开启并且选了服务商+模型，才算「借别的模型来搜」
  const dedicated = aux?.enabled && aux.baseUrl?.trim() && aux.model?.trim() ? aux : undefined

  const baseUrl = dedicated?.baseUrl?.trim() || config.baseUrl
  const model = dedicated?.model?.trim() || config.model
  const apiKey = keyForProvider(config, baseUrl)
  if (!apiKey || !model) return null

  // 独立的搜索模型按地址猜协议，避免被主对话的协议设置带偏
  const protocol = resolveProtocol(dedicated ? 'auto' : config.protocol, baseUrl)
  const providerId = findProvider(baseUrl)?.id
  const payload = nativeSearchPayload(protocol, providerId)
  if (!payload) return null

  return { protocol, providerId, baseUrl, apiKey, model, payload }
}

/** 辅助搜索这条路能不能走通 */
export const nativeSearchReady = (config: ChatConfig) => resolveNativeSearchTarget(config) !== null
