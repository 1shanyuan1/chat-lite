/**
 * PDF → 文本。用 pdfjs 的 legacy 构建：老 WebView 与 node（selfcheck）都能跑，
 * 现代构建在 node 下直接不可用。主模块与 worker 都是动态加载——不传 PDF 就不下载。
 * cmaps / standard_fonts / wasm 由 scripts/pdfjs-assets.mjs 拷进 public/pdfjs/，
 * 浏览器里按需 fetch；node（selfcheck）不带这些，fixtures 不依赖它们。
 */
import { createPdfWorker } from '@/chat/pdf-worker'

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

// legacy 构建里到处在用 Promise.withResolvers（Chrome 119 才有），老 WebView 先补上
const PromiseCtor = Promise as unknown as {
  withResolvers?: <T>() => { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void }
}
if (!PromiseCtor.withResolvers) {
  PromiseCtor.withResolvers = function <T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null

const loadPdfjs = (): Promise<PdfjsModule> => {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
    if (typeof Worker === 'function') {
      try {
        const worker = createPdfWorker()
        if (worker) pdfjs.GlobalWorkerOptions.workerPort = worker
      } catch {
        // worker 起不来就让 pdfjs 走假 worker（主线程解析，慢一点但能出文本）
      }
    }
    return pdfjs
  })
  return pdfjsPromise
}

export interface PdfText {
  text: string
  /** 总页数，供调用方拼「第几页」之类的说明 */
  pages: number
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const pdfjs = await loadPdfjs()
  // cmaps 等资源只在浏览器里有；node（selfcheck）解析 fixtures 用不到它们
  const assets =
    typeof document === 'undefined'
      ? {}
      : {
          cMapUrl: 'pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'pdfjs/standard_fonts/',
          wasmUrl: 'pdfjs/wasm/',
        }
  // pdfjs 会把 data 的 ArrayBuffer transfer 走（原 buffer 直接 detach），
  // 先拷一份，调用方手里的 bytes 保持完好（selfcheck 里 File 构造还要用）
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, ...assets })
  try {
    const doc = await task.promise
    const parts: string[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      try {
        const content = await page.getTextContent()
        let pageText = ''
        for (const item of content.items) {
          if (!('str' in item)) continue
          pageText += item.str
          if (item.hasEOL) pageText += '\n'
        }
        const trimmed = pageText.replace(/[ \t]+$/gm, '').trim()
        if (trimmed) parts.push(trimmed)
      } finally {
        page.cleanup()
      }
    }
    return { text: parts.join('\n\n'), pages: doc.numPages }
  } catch (e) {
    throw new Error(`PDF 解析失败（${e instanceof Error ? e.message : String(e)}）`)
  } finally {
    void task.destroy()
  }
}
