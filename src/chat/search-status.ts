import type { ChatConfig } from './client'
import type { Protocol } from './protocol'
import { nativeSearchSupported } from './native-search'
import { localSearchReady, resolveSearchSource, type SearchMode } from './web-search'

/**
 * 联网开关的可用性判定集中在这里。
 * 借鉴 Chatbox 的做法：把「为什么不可用」和「怎么搜」分开，UI 只消费结果。
 */

export interface SearchModeStatus {
  id: SearchMode
  label: string
  available: boolean
  /** 不可用时给用户看的原因 */
  reason?: string
  /** 当前服务商支持上游搜索时，推荐用它 */
  recommended?: boolean
}

export function searchModeStatuses(
  config: ChatConfig,
  protocol: Protocol,
  providerId?: string
): SearchModeStatus[] {
  const nativeReady = nativeSearchSupported(protocol, providerId)
  const localReady = localSearchReady(config)

  return [
    { id: 'off', label: '关', available: true },
    {
      id: 'native',
      label: nativeReady ? '模型内 · 推荐' : '模型内',
      available: nativeReady,
      recommended: nativeReady,
      reason: nativeReady ? undefined : '当前服务商不支持上游搜索',
    },
    {
      id: 'local',
      label: '本地源',
      available: localReady,
      reason: localReady ? undefined : '需要先填搜索 Key 或自定义接口',
    },
    { id: 'bing', label: 'Bing 兜底', available: true },
  ]
}

/** 当前模式的一句话说明，不可用时直接说原因 */
export function searchModeHint(status: SearchModeStatus, sourceLabel: string): string {
  switch (status.id) {
    case 'native':
      return status.available
        ? '由模型厂商自己搜，来源随回答返回'
        : (status.reason ?? '当前模型不支持')
    case 'local':
      return status.available ? `走 ${sourceLabel}，由模型自己决定搜什么` : (status.reason ?? '还没配置')
    case 'bing':
      return '免配置，抓 Bing 页面，质量一般但永远能用'
    default:
      return '不联网，模型只靠自己的知识回答'
  }
}

/** 配置里存的模式可能指向一个已经不可用的选项，这里给出实际会生效的那个 */
export function effectiveSearchMode(config: ChatConfig, statuses: SearchModeStatus[]): SearchMode {
  const mode = config.searchMode ?? 'off'
  const status = statuses.find((item) => item.id === mode)
  return status?.available ? mode : 'off'
}

export { resolveSearchSource }
