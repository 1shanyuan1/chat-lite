import { platform } from '@/platform'
import type { ChatConfig } from './client'
import { anthropicSourcesFromBlocks, geminiSourcesFromCandidate } from './native-citations'
import { resolveNativeSearchTarget } from './native-search'
import { buildChatRequest } from './protocol'
import type { SearchSource } from './web-search'
import type { WebSource } from './web-search-types'

/**
 * 把「模型自带的搜索」当成一个搜索后端来用（借鉴 DeepSeek Harness 的做法）：
 * 另开一次不流式的模型调用，带上厂商的搜索工具，只取回结构化的来源。
 *
 * 配了 searchModel 时，这次调用打给独立的搜索模型——主对话用 A、搜索借 B 的能力。
 */
export function createNativeSearchSource(config: ChatConfig): SearchSource {
  return {
    id: 'native',
    label: config.searchModel?.model ? '模型内（独立模型）' : '模型内（辅助调用）',
    async search(query) {
      const target = resolveNativeSearchTarget(config)
      if (!target) throw new Error('没有可用的搜索模型：需要一个支持上游搜索的服务商')

      const request = buildChatRequest(
        target.protocol,
        { baseUrl: target.baseUrl, apiKey: target.apiKey },
        {
          model: target.model + (target.payload.modelSuffix ?? ''),
          messages: [{ role: 'user', content: query }],
          stream: false,
          nativeSearch: target.payload,
          // 只取来源，不需要长输出
          maxTokens: 2048,
        }
      )

      const res = await platform().request({
        url: request.url,
        method: 'POST',
        headers: request.headers,
        body: request.body,
      })
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`上游搜索失败（HTTP ${res.status}）${res.text.slice(0, 120).replace(/\s+/g, ' ')}`)
      }

      let payload: unknown
      try {
        payload = JSON.parse(res.text)
      } catch {
        throw new Error('上游返回的不是 JSON')
      }

      const sources: WebSource[] =
        target.protocol === 'anthropic'
          ? anthropicSourcesFromBlocks((payload as { content?: unknown }).content)
          : target.protocol === 'gemini'
            ? geminiSourcesFromCandidate((payload as { candidates?: unknown[] }).candidates?.[0])
            : []

      if (sources.length === 0) throw new Error('上游没有返回搜索结果')
      return sources
    },
  }
}
