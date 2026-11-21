/**
 * pdfjs 的 worker。用 vite 的 ?worker&inline 打成 blob 内联进主包——
 * Capacitor 的 WebView 从本地服务起页面，blob 方式不用担心资源路径。
 * selfcheck（node）没有 Worker，esbuild 会把本模块 alias 成
 * scripts/shims/pdf-worker-node.mjs（返回 null，pdfjs 自动退回假 worker）。
 */
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline'

export const createPdfWorker = (): Worker | null => {
  try {
    return new PdfWorker()
  } catch {
    return null
  }
}
