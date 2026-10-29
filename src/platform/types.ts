export interface HttpRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  text: string
}

/**
 * 整个 App 与「宿主」的唯一接缝。
 * 刻意保持极窄：Web / Capacitor 各自实现这几个方法，业务代码永不 import 平台 API。
 */
export interface Platform {
  readonly kind: 'web' | 'native'
  /** 流式请求：产出原始文本增量（SSE 解析在上层做） */
  stream(req: HttpRequest, signal?: AbortSignal): AsyncGenerator<string>
  /** 非流式请求 */
  request(req: HttpRequest): Promise<HttpResponse>
  openLink(url: string): Promise<void>
  /** 保存文本文件：Web 走下载，原生走「写入缓存 + 系统分享」 */
  exportTextFile(filename: string, content: string, mime?: string): Promise<void>
  /** 保存二进制文件（组合包等） */
  exportBinaryFile(filename: string, bytes: Uint8Array, mime?: string): Promise<void>
}

export async function* readResponseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) yield decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
}
