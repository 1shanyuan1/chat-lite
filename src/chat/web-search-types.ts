/** 搜索来源，UI 与模型输出共用 */
export interface WebSource {
  url: string
  title?: string
  snippet?: string
  summary?: string
  publishedAt?: string
}

export interface WebSearchResult {
  sources: WebSource[]
  /** 合并后超过上限被截断 */
  truncated: boolean
}
