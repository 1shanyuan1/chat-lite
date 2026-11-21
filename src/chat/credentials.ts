import type { ChatConfig } from './client'
import { findProvider, PROVIDER_LABEL_CUSTOM } from './providers'

/** 一个「已经添加过」的服务商：只要填过 Key 就算 */
export interface ProviderRef {
  baseUrl: string
  label: string
  apiKey: string
  /** 是不是当前对话正在用的那个 */
  current: boolean
}

const normalize = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, '')

const sameBase = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase()

/**
 * 列出可用的服务商。
 * 当前对话的服务商永远在列表里；其余来自「填过 Key」的历史记录。
 */
export function listProviders(config: ChatConfig): ProviderRef[] {
  const currentBase = normalize(config.baseUrl ?? '')
  const seen = new Map<string, ProviderRef>()

  const add = (baseUrl: string, apiKey: string) => {
    const base = normalize(baseUrl)
    if (!base || !apiKey) return
    const key = base.toLowerCase()
    if (seen.has(key)) return
    seen.set(key, {
      baseUrl: base,
      label: findProvider(base)?.label ?? PROVIDER_LABEL_CUSTOM,
      apiKey,
      current: sameBase(base, currentBase),
    })
  }

  add(currentBase, config.apiKey)
  for (const [baseUrl, apiKey] of Object.entries(config.credentials ?? {})) add(baseUrl, apiKey)

  return [...seen.values()].sort((a, b) => Number(b.current) - Number(a.current))
}

/** 取某个服务商的 Key；找不到就用当前 Key 兜底 */
export function keyForProvider(config: ChatConfig, baseUrl?: string): string | undefined {
  const base = normalize(baseUrl ?? '')
  if (!base) return config.apiKey || undefined
  if (sameBase(base, config.baseUrl ?? '')) return config.apiKey || undefined

  for (const [savedBase, apiKey] of Object.entries(config.credentials ?? {})) {
    if (sameBase(savedBase, base)) return apiKey || undefined
  }
  return config.apiKey || undefined
}

/** 记住用过的 Key，供辅助模型挑选 */
export function withCredential(config: ChatConfig): ChatConfig {
  const base = normalize(config.baseUrl ?? '')
  if (!base || !config.apiKey) return config
  const credentials = { ...config.credentials }
  for (const saved of Object.keys(credentials)) {
    if (sameBase(saved, base)) delete credentials[saved]
  }
  credentials[base] = config.apiKey
  return { ...config, credentials }
}
