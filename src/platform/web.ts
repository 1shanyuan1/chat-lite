import { readResponseStream, type HttpRequest, type HttpResponse, type Platform } from './types'

export const webPlatform: Platform = {
  kind: 'web',

  async *stream(req: HttpRequest, signal?: AbortSignal) {
    const res = await fetch(req.url, {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.body,
      signal,
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`)
    }
    if (!res.body) throw new Error('当前环境不支持流式响应')
    yield* readResponseStream(res.body)
  },

  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(req.url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      body: req.body,
    })
    return { status: res.status, text: await res.text() }
  },

  async openLink(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async exportTextFile(filename: string, content: string, mime = 'text/markdown;charset=utf-8') {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
