// 把 pdfjs 运行时按需加载的资源（CMap / 标准字体 / wasm）拷进 public/pdfjs/，
// 浏览器里 extractPdfText 通过相对 URL fetch；用不到这些资源的 PDF 一个请求都不会发生。
// 由 npm 的 postinstall 与 build 调用；pdfjs 升级后重跑一次即可。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const from = (...p) => join(root, 'node_modules', 'pdfjs-dist', ...p)
const to = (...p) => join(root, 'public', 'pdfjs', ...p)

// cmaps 只要压缩版（.bcmap），体积减半
const groups = [
  ['cmaps', (name) => name.endsWith('.bcmap')],
  ['standard_fonts', () => true],
  ['wasm', () => true],
]

let count = 0
for (const [dir, keep] of groups) {
  if (!existsSync(from(dir))) continue
  mkdirSync(to(dir), { recursive: true })
  for (const name of readdirSync(from(dir))) {
    if (!keep(name)) continue
    copyFileSync(from(dir, name), to(dir, name))
    count += 1
  }
}
console.log(`pdfjs-assets: ${count} 个文件已拷到 public/pdfjs/`)
