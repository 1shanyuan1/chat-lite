import { platform } from '@/platform'
import type { ChatConfig } from './client'
import { buildModelsRequest, resolveProtocol, type Protocol } from './protocol'

export interface ModelInfo {
  id: string
  contextLength?: number
  inputPrice?: string
  outputPrice?: string
  vision?: boolean
  tools?: boolean
  /** 是否支持思考 */
  reasoning?: boolean
  /** 服务商声明的思考档位；没有就用协议默认 */
  reasoningLevels?: string[]
  label?: string
}

const CACHE_PREFIX = 'cl.models.'
const CACHE_TTL = 24 * 60 * 60 * 1000

function cacheKey(baseUrl: string, protocol: Protocol) {
  return `${CACHE_PREFIX}${protocol}.${baseUrl.replace(/\/+$/, '')}`
}

export function loadCachedModels(baseUrl: string, protocol: Protocol = 'openai'): ModelInfo[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(baseUrl, protocol))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; models: ModelInfo[] }
    if (Date.now() - parsed.at > CACHE_TTL) return null
    return parsed.models
  } catch {
    return null
  }
}

function saveCachedModels(baseUrl: string, protocol: Protocol, models: ModelInfo[]) {
  try {
    localStorage.setItem(cacheKey(baseUrl, protocol), JSON.stringify({ at: Date.now(), models }))
  } catch {
    /* 存储满了不影响主流程 */
  }
}

function pickNumber(source: unknown): number | undefined {
  return typeof source === 'number' && Number.isFinite(source) ? source : undefined
}

/** 各家字段名不一，挨个试一遍 */
function pickLevels(item: Record<string, unknown>): string[] | undefined {
  const candidates = [
    item.reasoning_effort_levels,
    item.reasoning_efforts,
    item.supported_reasoning_efforts,
    item.thinking_levels,
    item.thinking_efforts,
    (item.reasoning as Record<string, unknown> | undefined)?.levels,
    (item.capabilities as Record<string, unknown> | undefined)?.reasoning &&
      ((item.capabilities as Record<string, Record<string, unknown>>).reasoning?.efforts as unknown),
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate.map((v) => String(v)).filter(Boolean)
    }
  }
  return undefined
}

function pickString(source: unknown): string | undefined {
  if (typeof source === 'string' && source) return source
  if (typeof source === 'number') return String(source)
  return undefined
}

/**
 * 兼容多种 /models 返回形状：
 * - OpenAI / 基元律动: { object: 'list', data: [{ id, context_length, effective_pricing }] }
 * - Anthropic:        { data: [{ id, display_name }] }
 * - Gemini:           { models: [{ name: 'models/gemini-2.5-flash', inputTokenLimit, supportedGenerationMethods }] }
 * - 部分自建网关:      裸数组 / { result: { data: [] } }
 */
export function normalize(payload: unknown, protocol: Protocol = 'openai'): ModelInfo[] {
  const root = payload as Record<string, unknown> | unknown[] | null
  const list = Array.isArray(root)
    ? root
    : ((root?.data ?? root?.models ?? (root?.result as Record<string, unknown> | undefined)?.data ?? []) as unknown[])

  if (!Array.isArray(list)) return []

  const models: ModelInfo[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>

    // Gemini 会列出只支持 embedContent 的模型，过滤掉
    const methods = item.supportedGenerationMethods
    if (Array.isArray(methods) && methods.length > 0 && !methods.includes('generateContent')) continue

    const id = pickString(item.id) ?? pickString(item.name) ?? pickString(item.model)
    if (!id) continue

    const pricing = (item.effective_pricing ?? item.pricing ?? {}) as Record<string, unknown>
    models.push({
      id: id.replace(/^models\//, ''),
      label: pickString(item.display_name) ?? pickString(item.displayName),
      contextLength:
        pickNumber(item.context_length) ??
        pickNumber(item.context_window) ??
        pickNumber(item.max_context_length) ??
        pickNumber(item.inputTokenLimit),
      inputPrice: pickString(pricing.prompt),
      outputPrice: pickString(pricing.completion),
      vision: item.supports_vision === true,
      tools: item.supports_tools === true,
      reasoning: item.supports_reasoning === true || pickLevels(item) !== undefined,
      reasoningLevels: pickLevels(item),
    })
  }

  return models.sort((a, b) => a.id.localeCompare(b.id))
}

export async function fetchModels(config: ChatConfig): Promise<ModelInfo[]> {
  const protocol = resolveProtocol(config.protocol, config.baseUrl)
  const res = await platform().request(buildModelsRequest(protocol, config))

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status}${res.text ? `: ${res.text}` : ''}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(res.text)
  } catch {
    throw new Error('接口返回的不是 JSON，可能不是兼容地址')
  }

  const models = normalize(payload, protocol)
  if (models.length === 0) throw new Error('接口没有返回任何模型')
  saveCachedModels(config.baseUrl, protocol, models)
  return models
}
