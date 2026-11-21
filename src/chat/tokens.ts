export interface Usage {
  /** 输入 token（含缓存命中部分） */
  input: number
  /** 输出 token */
  output: number
  /** 命中缓存的输入 token */
  cacheRead: number
  /** 写入缓存（Anthropic 专属，其他平台为 0） */
  cacheWrite?: number
  /** 整条 usage 是否为本地估算（接口完全没返回 usage） */
  estimated?: boolean
  /**
   * 命中数据的来源：
   * - api：接口确实返回了缓存字段
   * - estimated：接口没给（或没这个字段），由本地按前缀重叠推算
   */
  cacheSource?: 'api' | 'estimated'
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheSource: 'estimated' })

export function mergeUsage(a: Usage | undefined, b: Partial<Usage> | undefined): Usage {
  const base = a ?? emptyUsage()
  if (!b) return base
  return {
    input: Math.max(base.input, b.input ?? 0),
    output: Math.max(base.output, b.output ?? 0),
    cacheRead: Math.max(base.cacheRead, b.cacheRead ?? 0),
    cacheWrite: Math.max(base.cacheWrite ?? 0, b.cacheWrite ?? 0),
    estimated: base.estimated || b.estimated,
    // 只要有一帧来自接口，就按接口算
    cacheSource:
      base.cacheSource === 'api' || b.cacheSource === 'api' ? 'api' : (b.cacheSource ?? base.cacheSource),
  }
}

/** 无 usage 时的粗略估算：汉字约 1 token/字，拉丁文约 3.6 字符/token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) ?? []).length
  const rest = text.length - cjk
  return Math.max(1, Math.round(cjk * 1.05 + rest / 3.6))
}

export function estimateUsage(prompt: string, answer: string, reasoning?: string): Usage {
  return {
    input: estimateTokens(prompt),
    output: estimateTokens(answer) + (reasoning ? estimateTokens(reasoning) : 0),
    cacheRead: 0,
    estimated: true,
    cacheSource: 'estimated',
  }
}

/**
 * 本地推算缓存命中：按前缀缓存（prompt caching）的通例，
 * 本次请求里「除最后一条用户消息之外」的部分在上一轮已经出现过，大概率命中。
 * 少于 512 token 的前缀不值得计入——多数平台的缓存最小粒度在 1k 上下。
 */
export function estimateCacheHit(promptTexts: string[]): number {
  if (promptTexts.length <= 1) return 0
  const shared = promptTexts.slice(0, -1).join('\n')
  const tokens = estimateTokens(shared)
  return tokens >= 512 ? tokens : 0
}

export const hitRate = (usage: Usage) => (usage.input > 0 ? usage.cacheRead / usage.input : 0)
export const missTokens = (usage: Usage) => Math.max(0, usage.input - usage.cacheRead)

export function sumUsage(list: Array<Usage | undefined>): Usage {
  const total = emptyUsage()
  let estimated = false
  let anyEstimatedCache = false
  for (const u of list) {
    if (!u) continue
    total.input += u.input
    total.output += u.output
    total.cacheRead += u.cacheRead
    total.cacheWrite = (total.cacheWrite ?? 0) + (u.cacheWrite ?? 0)
    estimated = estimated || Boolean(u.estimated)
    if (u.cacheSource !== 'api') anyEstimatedCache = true
  }
  return { ...total, estimated, cacheSource: anyEstimatedCache ? 'estimated' : 'api' }
}

/** 命中数据是否是本地推算的（UI 据此加「估算」标记） */
export const isCacheEstimated = (usage: Usage) => usage.cacheSource !== 'api'

/* ---------------- 各协议 usage 归一化 ---------------- */

export function readOpenAIUsage(raw: unknown): Partial<Usage> | null {
  const u = raw as
    | {
        prompt_tokens?: number
        completion_tokens?: number
        prompt_tokens_details?: { cached_tokens?: number }
        prompt_cache_hit_tokens?: number
      }
    | null
  if (!u || typeof u !== 'object') return null
  // DeepSeek 用 prompt_cache_hit_tokens，OpenAI 用 prompt_tokens_details.cached_tokens
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens
  return {
    input: u.prompt_tokens ?? 0,
    output: u.completion_tokens ?? 0,
    cacheRead: cached ?? 0,
    cacheSource: cached === undefined ? 'estimated' : 'api',
  }
}

export function readAnthropicUsage(raw: unknown): Partial<Usage> | null {
  const u = raw as
    | {
        input_tokens?: number
        output_tokens?: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
      }
    | null
  if (!u || typeof u !== 'object') return null
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    // Anthropic 一定会回报缓存字段，没值就是真没命中
    cacheSource: 'api',
  }
}

export function readGeminiUsage(raw: unknown): Partial<Usage> | null {
  const u = raw as
    | { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number }
    | null
  if (!u || typeof u !== 'object') return null
  return {
    input: u.promptTokenCount ?? 0,
    output: u.candidatesTokenCount ?? 0,
    cacheRead: u.cachedContentTokenCount ?? 0,
    cacheSource: u.cachedContentTokenCount === undefined ? 'estimated' : 'api',
  }
}

export const formatTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
export const formatPercent = (r: number) => `${(r * 100).toFixed(r >= 0.1 ? 0 : 1)}%`

/**
 * 压缩预警水位（百分比）。
 *
 * 默认 80；夹在 50–95 之间——太低会一直弹提醒，太高（99）几乎等于没有预警，
 * 而上下文真的打满时压缩这一步本身就是一次模型调用，已经没有余量了。
 */
export function compressThreshold(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 80
  return Math.min(95, Math.max(50, Math.round(value)))
}
