/**
 * 二进制文档 → 纯文本：PDF（走 pdfjs，见 pdf.ts）、docx / xlsx / pptx（zip + XML）、
 * 普通压缩包（把里面能转文本的文件都提出来）。与角色卡导入同一思路：类型按内容魔数
 * 识别，扩展名只做参考。Office 三件套本质都是 zip，认出包里的关键 XML 就能抽文本——
 * 不引 mammoth / SheetJS 这类大依赖，常见文档的文本抽取靠正则扫 XML 就够。
 */
import { unzipSync } from 'fflate'
import { findZipOffset, type BundleEntry } from '@/chat/bundle'

const textDecoder = new TextDecoder('utf-8')

/** 单个压缩包的体积上限：再大解压时 WebView 内存撑不住 */
export const MAX_ZIP_BYTES = 100 * 1024 * 1024
/** 解压护栏：单条解压后超过 20MB、或全包解压总量超过 64MB 的条目不解——
 *  zip 是放大器（压缩比可以很高），Android WebView 的堆有限，OOM 会整页闪退 */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024

export const extensionOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')

/* ---------------- 类型识别（按内容） ---------------- */

/** 浏览器能解的图：PNG / JPEG / GIF / BMP / WEBP / AVIF。HEIC 解不了，不认 */
export function looksLikeImage(b: Uint8Array): boolean {
  if (b.length < 12) return false
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true // PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // JPEG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true // GIF8
  if (b[0] === 0x42 && b[1] === 0x4d) return true // BM（BMP）
  if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' && String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP') return true
  if (String.fromCharCode(b[4], b[5], b[6], b[7]) === 'ftyp') {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    return brand === 'avif' || brand === 'avis'
  }
  return false
}

/** %PDF- */
export const looksLikePdf = (b: Uint8Array) =>
  b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46

export type DocKind = 'pdf' | 'zip'

/**
 * 能不能当「文档」解析。图片不在这里（走多模态），认不出来返回 null。
 * 纯文本类不做 zip 深扫——正文里凑巧出现 PK 字节不该改变判定；
 * 所以顺序是：图片魔数 → PDF 魔数 → 文本扩展名 → zip 深扫 → 扩展名兜底。
 */
export function sniffDocKind(file: { name: string; type?: string }, b: Uint8Array): DocKind | null {
  if (looksLikeImage(b)) return null
  if (looksLikePdf(b)) return 'pdf'
  if (isTextFile(file.name, file.type)) return null
  if (findZipOffset(b) >= 0) return 'zip'
  // 魔数被前缀破坏的极端情况，靠扩展名兜底
  const ext = extensionOf(file.name)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx' || ext === 'zip' || ext === 'charx' || ext === 'epub') return 'zip'
  return null
}

/* ---------------- 文本类判定（从 attachments 挪过来，extract 是文件类型的知识中心） ---------------- */

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm', 'xhtml',
  'css', 'js', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'java', 'kt', 'go', 'rs', 'c', 'h',
  'cpp', 'hpp', 'cs', 'php', 'rb', 'swift', 'lua', 'r', 'sh', 'bash', 'zsh', 'sql', 'log',
  'ini', 'toml', 'conf', 'env', 'gitignore', 'properties', 'gradle', 'svg', 'srt', 'vtt',
])

const TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/x-sh',
])

export function isTextFile(name: string, mime = ''): boolean {
  if (mime.startsWith('text/')) return true
  if (TEXT_MIMES.has(mime)) return true
  return TEXT_EXTENSIONS.has(extensionOf(name))
}

/* ---------------- XML 小工具 ---------------- */

/** 只解文档 XML 里实际会出现的实体；&amp; 放最后，避免二次解码 */
const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** 从一个开标签字符串里取属性值。XML 属性里的引号必转义，所以直接找 "..." 是安全的 */
const attrOf = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i').exec(tag)
  return m?.[1]
}

/* ---------------- docx：段落 = <w:p>，文本 = <w:t>，tab / 换行是独立标签 ---------------- */

export function docxText(entries: BundleEntry[]): string {
  const doc = entries.find((e) => e.path === 'word/document.xml') ?? entries.find((e) => e.path.endsWith('word/document.xml'))
  if (!doc) throw new Error('不是 Word 文档（zip 里没有 word/document.xml）')
  const xml = textDecoder.decode(doc.bytes)
  const paras: string[] = []
  for (const para of xml.matchAll(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    let line = ''
    for (const token of (para[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)\s*\/>/g)) {
      if (token[1] !== undefined) line += token[1]
      else line += token[0].startsWith('<w:tab') ? '\t' : '\n'
    }
    const text = decodeEntities(line).replace(/\s+$/, '')
    if (text.trim()) paras.push(text)
  }
  return paras.join('\n')
}

/* ---------------- xlsx：共享字符串 + 行列对齐 + 日期格式还原 ---------------- */

// 内建日期格式的 numFmtId（0x0E-0x16、0x1B-0x24、0x2D-0x2F、0x32-0x3A）
const DATE_BUILTIN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])

/** 自定义格式像不像日期：剥掉 [locale] / "字面量" 之后看有没有 y/d（或 h+s 配 m） */
const looksDateFmt = (code: string) => {
  const cleaned = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '').toLowerCase()
  return /[dy]/.test(cleaned) || (/[hs]/.test(cleaned) && /m/.test(cleaned))
}

/** Excel 序列号（1900 起算，epoch 差 25569 天）→ 文本。用 UTC 取值避开时区偏移 */
const excelSerialToText = (serial: number): string => {
  const d = new Date(Math.round((serial - 25569) * 86_400_000))
  const p = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  if (serial < 1) return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  const frac = serial % 1
  return frac >= 1 / 172_800 ? `${day} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` : day
}

const collectT = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>|<${tag}\\s*/>`, 'g'))].map((m) => m[1] ?? '').join('')

function xlsxSharedStrings(entries: BundleEntry[]): string[] {
  const entry = entries.find((e) => e.path === 'xl/sharedStrings.xml') ?? entries.find((e) => e.path.endsWith('xl/sharedStrings.xml'))
  if (!entry) return []
  const xml = textDecoder.decode(entry.bytes)
  // <si> 里可能是富文本多段 <r><t>，全部串起来
  return [...xml.matchAll(/<si\b[^>]*(?:\/>|>([\s\S]*?)<\/si>)/g)].map((si) => collectT(si[1] ?? '', 't'))
}

/** 单元格样式下标 → 是不是日期格式 */
function xlsxDateStyles(entries: BundleEntry[]): Set<number> {
  const dateStyles = new Set<number>()
  const styles = entries.find((e) => e.path === 'xl/styles.xml') ?? entries.find((e) => e.path.endsWith('xl/styles.xml'))
  if (!styles) return dateStyles
  const xml = textDecoder.decode(styles.bytes)
  const customFmt = new Map<number, string>()
  for (const fmt of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const id = Number(attrOf(fmt[1], 'numFmtId'))
    const code = attrOf(fmt[1], 'formatCode')
    if (Number.isFinite(id) && code) customFmt.set(id, code)
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  let idx = 0
  for (const xf of xfs.matchAll(/<xf\b([^>]*?)\/?>/g)) {
    const id = Number(attrOf(xf[1], 'numFmtId'))
    const custom = customFmt.get(id)
    if (DATE_BUILTIN.has(id) || (custom !== undefined && looksDateFmt(custom))) dateStyles.add(idx)
    idx += 1
  }
  return dateStyles
}

function xlsxSheetText(xml: string, shared: string[], dateStyles: Set<number>): string {
  const rows: string[] = []
  for (const row of xml.matchAll(/<row\b[^>]*(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const cells: string[] = []
    let cursor = 0
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]
      const ref = attrOf(attrs, 'r') ?? ''
      const letters = /^[A-Za-z]+/.exec(ref)?.[0]
      // 列号从引用（如 B3）算；没有引用就按出现顺序排
      const col = letters ? letters.toUpperCase().split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1 : cursor
      cursor = col + 1
      const body = cell[2] ?? ''
      const t = attrOf(attrs, 't')
      let text = ''
      if (t === 'inlineStr') {
        text = collectT(body, 't')
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1]
        if (v !== undefined) {
          if (t === 's') text = shared[Number(v)] ?? ''
          else if (t === 'b') text = v.trim() === '1' ? 'TRUE' : 'FALSE'
          else if (t === 'e') text = '' // 公式错误值不给模型看
          else {
            text = v
            if (dateStyles.has(Number(attrOf(attrs, 's') ?? '-1'))) {
              const serial = Number(v)
              if (Number.isFinite(serial) && serial > 0) text = excelSerialToText(serial)
            }
          }
        }
      }
      cells[col] = decodeEntities(text)
    }
    const line = cells.map((c) => (c ?? '').trimEnd()).join('\t').replace(/\s+$/, '')
    if (line.trim()) rows.push(line)
  }
  return rows.join('\n')
}

export function xlsxText(entries: BundleEntry[]): string {
  const wb = entries.find((e) => e.path === 'xl/workbook.xml') ?? entries.find((e) => e.path.endsWith('xl/workbook.xml'))
  if (!wb) throw new Error('不是 Excel 工作簿（zip 里没有 xl/workbook.xml）')
  const rels = entries.find((e) => e.path === 'xl/_rels/workbook.xml.rels') ?? entries.find((e) => e.path.endsWith('workbook.xml.rels'))
  const relTarget = new Map<string, string>()
  if (rels) {
    for (const rel of textDecoder.decode(rels.bytes).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const id = attrOf(rel[1], 'Id')
      const target = attrOf(rel[1], 'Target')
      if (id && target && attrOf(rel[1], 'TargetMode')?.toLowerCase() !== 'external') relTarget.set(id, target)
    }
  }
  const shared = xlsxSharedStrings(entries)
  const dateStyles = xlsxDateStyles(entries)
  const parts: string[] = []
  for (const sheet of textDecoder.decode(wb.bytes).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = decodeEntities(attrOf(sheet[1], 'name') ?? '工作表')
    const rid = attrOf(sheet[1], 'r:id') ?? attrOf(sheet[1], 'id') ?? ''
    const target = relTarget.get(rid)
    if (!target) continue
    // Target 相对 xl/ 目录；以 / 开头则是包内绝对路径
    const full = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const leaf = full.split('/').pop()!
    const entry = entries.find((e) => e.path === full) ?? entries.find((e) => e.path.endsWith(leaf))
    if (!entry) continue
    const text = xlsxSheetText(textDecoder.decode(entry.bytes), shared, dateStyles)
    if (text.trim()) parts.push(`【工作表：${name}】\n${text}`)
  }
  if (parts.length === 0) throw new Error('Excel 里没有可读的工作表')
  return parts.join('\n\n')
}

/* ---------------- pptx：幻灯片 = slideN.xml，段落 = <a:p>，文本 = <a:t> ---------------- */

const slideNo = (path: string) => Number(/slide(\d+)\.xml$/i.exec(path)?.[1] ?? 0)

export function pptxText(entries: BundleEntry[]): string {
  const slides = entries
    .filter((e) => /ppt\/slides\/slide\d+\.xml$/i.test(e.path))
    .sort((a, b) => slideNo(a.path) - slideNo(b.path))
  if (slides.length === 0) throw new Error('不是 PowerPoint 演示文稿（zip 里没有幻灯片）')
  const parts = slides.map((slide) => {
    const xml = textDecoder.decode(slide.bytes)
    const paras: string[] = []
    for (const p of xml.matchAll(/<a:p\b[^>]*\/>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const text = decodeEntities(collectT(p[1] ?? '', 'a:t')).replace(/\s+$/, '')
      if (text.trim()) paras.push(text)
    }
    return paras.join('\n')
  })
  return parts.filter(Boolean).join('\n\n')
}

/* ---------------- zip 家族总入口 ---------------- */

const unzipEntries = (bytes: Uint8Array): BundleEntry[] => {
  const offset = findZipOffset(bytes)
  // 解压护栏在中央目录阶段就生效：fflate 的 filter 能拿到解压后大小（originalSize），
  // 超限的条目根本不解，内存放大被挡在门外。被拦的条目不会出现在结果里，
  // 也不会计入「另有 N 个文件」的跳过计数——能抽出的文本照常返回。
  let total = 0
  const files = unzipSync(offset >= 0 ? bytes.subarray(offset) : bytes, {
    filter: (f) => {
      if (f.originalSize <= 0 || f.originalSize > MAX_ENTRY_BYTES) return false
      total += f.originalSize
      return total <= MAX_UNZIPPED_BYTES
    },
  })
  return Object.entries(files)
    .filter(([, data]) => data.length > 0)
    .map(([path, data]) => ({ path, bytes: data }))
}

/** Office 三件套的判据：包里有没有各自的关键 XML */
export function officeKindOf(entries: BundleEntry[]): 'docx' | 'xlsx' | 'pptx' | null {
  const has = (suffix: string) => entries.some((e) => e.path === suffix || e.path.endsWith(`/${suffix}`))
  if (has('word/document.xml')) return 'docx'
  if (has('xl/workbook.xml')) return 'xlsx'
  if (has('ppt/presentation.xml')) return 'pptx'
  return null
}

// 这些直接跳过：媒体/字体/二进制转不了文本，记个数就行
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff?|mp4|m4v|mov|mp3|wav|ogg|webm|flac|woff2?|ttf|otf|eot|exe|dll|so|dylib|dmg|apk|ipa|bin|ico|class|jar|war|7z|rar|gz|tar)$/i
const ZIP_SKIP = [/^__MACOSX\//, /(^|\/)\._/, /(^|\/)\.DS_Store$/i, /\/$/]
const MAX_ENTRY_BYTES = 20 * 1024 * 1024

/**
 * 普通压缩包 → 文本。文本文件直接读；嵌着的 docx / xlsx / pptx / zip / pdf 也解析
 * （嵌套只下钻一层，防套娃）；其余记数跳过。深度 1 用于 zip 内的 zip。
 */
export async function extractZipText(bytes: Uint8Array, depth = 0): Promise<string> {
  let entries: BundleEntry[]
  try {
    entries = unzipEntries(bytes)
  } catch (e) {
    throw new Error(`压缩包解析失败——文件损坏或不是有效 zip（${e instanceof Error ? e.message : String(e)}）`)
  }

  const office = officeKindOf(entries)
  if (office === 'docx') return docxText(entries)
  if (office === 'xlsx') return xlsxText(entries)
  if (office === 'pptx') return pptxText(entries)

  const blocks: string[] = []
  const skipped: string[] = []
  let skippedCount = 0
  const markSkipped = (path: string) => {
    skippedCount += 1
    if (skipped.length < 3) skipped.push(path)
  }

  for (const entry of entries.sort((a, b) => a.path.localeCompare(b.path))) {
    if (ZIP_SKIP.some((re) => re.test(entry.path))) continue
    if (entry.bytes.length > MAX_ENTRY_BYTES) {
      markSkipped(entry.path)
      continue
    }
    try {
      if (looksLikeImage(entry.bytes) || MEDIA_EXT.test(entry.path)) {
        markSkipped(entry.path)
      } else if (looksLikePdf(entry.bytes)) {
        if (depth >= 1) markSkipped(entry.path)
        // pdfjs 是懒加载的大模块，这里按需拉
        else blocks.push(`【文件：${entry.path}】\n${(await (await import('@/chat/pdf')).extractPdfText(entry.bytes)).text}`)
      } else if (entry.bytes[0] === 0x50 && entry.bytes[1] === 0x4b) {
        if (depth >= 1) markSkipped(entry.path)
        else blocks.push(`【文件：${entry.path}】\n${await extractZipText(entry.bytes, depth + 1)}`)
      } else if (isTextFile(entry.path)) {
        blocks.push(`【文件：${entry.path}】\n${textDecoder.decode(entry.bytes)}`)
      } else {
        markSkipped(entry.path)
      }
    } catch {
      markSkipped(entry.path)
    }
  }

  if (blocks.length === 0) {
    const shown = skipped
      .map((p) => p.split('/').pop())
      .filter(Boolean)
      .slice(0, 3)
      .join('、')
    throw new Error(`压缩包里没有能转成文本的文件（共 ${entries.length} 个${shown ? `，比如 ${shown}` : ''}）`)
  }
  if (skippedCount > 0) blocks.push(`（另有 ${skippedCount} 个文件不是文本，已跳过）`)
  return blocks.join('\n\n')
}
