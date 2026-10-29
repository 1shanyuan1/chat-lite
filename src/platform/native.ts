import { CapacitorHttp } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { StreamHttp } from 'capacitor-stream-http'
import { readResponseStream, type HttpRequest, type HttpResponse, type Platform } from './types'

interface StreamEvent {
  id: string
  chunk?: string
  error?: string
}

/**
 * 用原生插件建立 SSE 流。
 * WebView 里 fetch 读不到响应体增量，iOS 上会「憋到结束一次性蹦出来」，所以必须走原生。
 * 关键点：chunk 事件可能在 startStream 返回 id 之前就到达，先排队再回放。
 */
function nativeStream(req: HttpRequest, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const queue: Array<{ name: 'chunk' | 'end' | 'error'; data: StreamEvent }> = []
  const removers: Array<() => void | Promise<void>> = []
  let id: string | null = null
  let closed = false

  const cleanup = () => {
    if (closed) return
    closed = true
    for (const remove of removers.splice(0)) void remove()
    if (id) void StreamHttp.cancelStream({ id }).catch(() => undefined)
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      signal?.addEventListener(
        'abort',
        () => {
          if (closed) return
          cleanup()
          controller.error(new DOMException('已取消', 'AbortError'))
        },
        { once: true }
      )

      const dispatch = (name: 'chunk' | 'end' | 'error', data: StreamEvent) => {
        if (closed) return
        if (!id) {
          queue.push({ name, data })
          return
        }
        if (data.id !== id) return
        if (name === 'chunk') {
          controller.enqueue(encoder.encode(data.chunk ?? ''))
        } else if (name === 'end') {
          cleanup()
          controller.close()
        } else {
          cleanup()
          controller.error(new Error(data.error || '原生流式请求失败'))
        }
      }

      try {
        const handles = await Promise.all([
          StreamHttp.addListener('chunk', (data: StreamEvent) => dispatch('chunk', data)),
          StreamHttp.addListener('end', (data: StreamEvent) => dispatch('end', data)),
          StreamHttp.addListener('error', (data: StreamEvent) => dispatch('error', data)),
        ])
        for (const handle of handles) removers.push(handle.remove)

        const started = await StreamHttp.startStream({
          url: req.url,
          method: req.method ?? 'POST',
          headers: { ...(req.headers ?? {}), Accept: 'text/event-stream' },
          body: req.body,
        })
        id = started.id
        for (const pending of queue.splice(0)) dispatch(pending.name, pending.data)
      } catch (error) {
        cleanup()
        controller.error(error instanceof Error ? error : new Error('无法启动原生流式请求'))
      }
    },
    cancel() {
      cleanup()
    },
  })
}

export const nativePlatform: Platform = {
  kind: 'native',

  async *stream(req: HttpRequest, signal?: AbortSignal) {
    yield* readResponseStream(nativeStream(req, signal))
  },

  async request(req: HttpRequest): Promise<HttpResponse> {
    const res = await CapacitorHttp.request({
      url: req.url,
      method: req.method ?? 'GET',
      headers: req.headers,
      data: req.body,
      responseType: 'text',
    })
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    return { status: res.status, text }
  },

  async openLink(url: string) {
    await Browser.open({ url })
  },

  async exportTextFile(filename: string, content: string) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const written = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    await Share.share({ title: filename, url: written.uri })
  },
}
