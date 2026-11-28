import { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize'

/**
 * 卡 HTML 的显示层安全管线（P2）。
 *
 * 面板卡把结构写在 HTML 里、样式写在 <style> 块和 style 属性里、行为写在 <script> 里。
 * 内联渲染只该要「结构与样式」，执行环境是 P4 沙箱 iframe 的专属——所以在字符串层：
 * 1. 剥 <script> 与事件属性（内联路径永远不带行为）；
 * 2. 中和危险 CSS（外链 url()、@import、position:fixed、expression）；
 * 3. 提取 <style> 块，把选择器重写进当前消息容器的作用域，避免污染全局 UI。
 *
 * 之后再走 rehype-raw + rehype-sanitize（元素/属性白名单）双保险。
 */

/** CSS 值层过滤：外链请求、定位劫持、动态表达式一律中和（浏览器会忽略无效值，不会破语法） */
function cssValueFilter(css: string): string {
  return css
    .replace(/@import[^;{}]*(;|$)/gi, '')
    .replace(/@charset[^;{}]*(;|$)/gi, '')
    .replace(/expression\s*\(/gi, 'x(')
    .replace(/(behavior|-moz-binding)\s*:[^;}]*;?/gi, '')
    .replace(/position\s*:\s*fixed/gi, 'position: static')
    // 外链/协议相对地址一律指向无效地址；卡内 data:image（表情差分等）放行
    .replace(/url\(\s*(['"]?)\s*(?!data:image\/)[^)]*?\1\s*\)/gi, 'url(about:invalid)')
}

/** 给每条规则的选择器加前缀；html/body/:root 直接映射到容器本身（面板卡常给 body 设底色） */
function prefixSelectors(header: string, prefix: string): string {
  return header
    .split(',')
    .map((raw) => {
      const sel = raw.trim()
      if (!sel) return sel
      if (/^(html|body|:root)$/i.test(sel)) return `.${prefix}`
      return `.${prefix} ${sel}`
    })
    .join(', ')
}

/** 递归下钻 @media/@supports，@keyframes 等原样保留 */
function scopeRules(css: string, prefix: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const braceStart = css.indexOf('{', i)
    if (braceStart < 0) {
      out += css.slice(i)
      break
    }
    let depth = 1
    let j = braceStart + 1
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++
      else if (css[j] === '}') depth--
      j++
    }
    const header = css.slice(i, braceStart)
    const body = css.slice(braceStart + 1, j - 1)
    const at = header.trim()
    if (at.startsWith('@media') || at.startsWith('@supports')) {
      out += `${header}{${scopeRules(body, prefix)}}`
    } else if (at.startsWith('@')) {
      out += `${header}{${body}}`
    } else {
      out += `${prefixSelectors(header, prefix)}{${body}}`
    }
    i = j
  }
  return out
}

/** 把卡内 CSS 重写进 `.<scope>` 作用域，跟值过滤一套做完整 */
export function scopeCss(css: string, scope: string): string {
  if (!css.trim()) return ''
  return scopeRules(cssValueFilter(css), scope)
}

export interface CleanedHtml {
  /** 剥完脚本/样式块/事件属性后的正文，交给 markdown + rehype 渲染 */
  body: string
  /** 从 <style> 块收集到的 CSS（已做值过滤，未做作用域重写） */
  css: string
  /** 原文是否带 <script>（供 iframe 分支判断） */
  hasScript: boolean
}

/** 字符串层清洗：内联渲染路径的第一道网 */
export function cleanCardHtml(html: string): CleanedHtml {
  const hasScript = /<script[\s>]/i.test(html)
  let body = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<\/?script\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  const cssParts: string[] = []
  body = body.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_match, cssText: string) => {
    cssParts.push(cssValueFilter(String(cssText)))
    return ''
  })
  // 内联 style 属性值过同一套过滤；引号内的双引号转回实体，避免破坏属性
  body = body.replace(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_match, dq?: string, sq?: string) => {
    const value = cssValueFilter(dq ?? sq ?? '').replace(/"/g, '&quot;')
    return `style="${value}"`
  })
  return { body, css: cssParts.join('\n'), hasScript }
}

/**
 * rehype-sanitize 的卡内容白名单：结构/文本/表格/折叠/表单件/受控 img 与 a。
 * <script>/<style>/<iframe> 不在表上；脚本进不来（字符串层已剥），样式块单独走作用域注入。
 */
export const cardSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    'div', 'span', 'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'b', 'i', 'em', 'strong', 'u', 's', 'small', 'sub', 'sup', 'mark', 'font',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'col', 'colgroup',
    'details', 'summary', 'figure', 'figcaption',
    // 面板卡的表单件：没有脚本时它们是惰性摆设，P4 iframe 化后才真正可交互
    'button', 'label', 'input', 'select', 'option', 'textarea', 'fieldset', 'legend',
    'img', 'a',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'style', 'class', 'title', 'align', 'width', 'height', 'data-*'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'width', 'height'],
    a: [...(defaultSchema.attributes?.a ?? []), 'href', 'target', 'rel'],
    input: ['type', 'value', 'placeholder', 'checked', 'disabled', 'min', 'max', 'step'],
    select: ['name', 'multiple', 'disabled'],
    option: ['value', 'selected', 'disabled'],
    textarea: ['name', 'rows', 'placeholder', 'disabled'],
    button: ['type', 'name', 'value', 'disabled'],
    font: ['color', 'size', 'face'],
    td: [...(defaultSchema.attributes?.td ?? []), 'colspan', 'rowspan', 'bgcolor'],
    th: [...(defaultSchema.attributes?.th ?? []), 'colspan', 'rowspan', 'bgcolor'],
  },
  protocols: {
    ...defaultSchema.protocols,
    // 表情差分等卡内资源常走 data:image；img 的 data:text/html 无害（不执行）
    src: ['http', 'https', 'data'],
  },
}

/* ---------------- markdown → HTML 字符串（酒馆助手卡的消息渲染） ---------------- */

let htmlProc: { run: (md: string) => string } | null = null

async function getHtmlProc() {
  if (htmlProc) return htmlProc
  const { unified } = await import('unified')
  const remarkParse = (await import('remark-parse')).default
  const remarkRehype = (await import('remark-rehype')).default
  const rehypeRawPlugin = (await import('rehype-raw')).default
  const rehypeSanitizePlugin = (await import('rehype-sanitize')).default
  const toHtml = (await import('hast-util-to-html')).toHtml
  const proc = unified()
    .use(remarkParse)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRawPlugin)
    .use(rehypeSanitizePlugin, cardSanitizeSchema)
  htmlProc = { run: (md: string) => toHtml(proc.runSync(proc.parse(md))) }
  return htmlProc
}

/**
 * 酒馆助手卡的消息渲染成静态 HTML：全局脚本会接管这个 DOM（.mes_text），
 * 所以一次性出字符串交给 dangerouslySetInnerHTML，React 之后不再碰它。
 * sanitize 可关：TH 卡的协议标记要留给脚本处理，且这类卡本身已在同源信任模型下运行。
 * escapeProtocolTags：把协议占位符转成文本实体——HTML 解析会把无连字符自定义标签
 * 小写化，而脚本按原始驼峰大小写 grep innerHTML，必须以文本形态保住。
 */
export async function markdownToHtml(
  md: string,
  opts?: { sanitize?: boolean; escapeProtocolTags?: boolean }
): Promise<string> {
  const source = opts?.escapeProtocolTags
    ? md.replace(/<(\/?)StatusPlaceHolderImpl(\s*\/?)?>/gi, '&lt;$1StatusPlaceHolderImpl$2&gt;')
    : md
  const proc = await getHtmlProc()
  if (opts?.sanitize === false) {
    const { unified } = await import('unified')
    const remarkParse = (await import('remark-parse')).default
    const remarkRehype = (await import('remark-rehype')).default
    const rehypeRawPlugin = (await import('rehype-raw')).default
    const toHtml = (await import('hast-util-to-html')).toHtml
    const rawProc = unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRawPlugin)
    return toHtml(rawProc.runSync(rawProc.parse(source)))
  }
  return proc.run(source)
}
