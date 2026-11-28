import { useEffect, useMemo, useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { applyDisplayRegex } from '@/chat/card-regex'
import { cleanCardHtml, scopeCss, cardSanitizeSchema, markdownToHtml } from '@/chat/card-html'
import type { SettingDoc } from '@/chat/settings'
import MessageIframe from '@/ui/MessageIframe'

/**
 * 两套 UI 共用的消息渲染器（App 与 AppNext 原本各有一份逐字重复的定义）。
 *
 * docs 传入时进入「卡内容渲染」路径：
 * 1. applyDisplayRegex：先过显示侧卡正则（[开场] 面板、[隐藏] 清理都发生在这里）；
 * 2. 内容带 <script> → MessageIframe 渲染；卡带酒馆助手全局脚本时 iframe 开同源
 *    （面板脚本由此能调主窗口的宿主函数，和酒馆的信任模型一致）；
 * 3. 酒馆助手卡（thMode）的消息用静态 HTML + ST 类名锚点（mes_block/mes_text）：
 *    全局脚本接管这块 DOM，React 不再参与；
 * 4. 普通卡：cleanCardHtml 剥脚本/提样式，<style> 块按 useId 作用域重写后注入，
 *    rehype-raw + rehype-sanitize 白名单渲染。
 * 存储的原文不动，变换全部发生在渲染时。
 */
export default function Markdown({
  content,
  className = 'md text-[16px] leading-[1.75]',
  docs,
  userName = '你',
}: {
  content: string
  className?: string
  docs?: SettingDoc[]
  userName?: string
}) {
  const isCard = Boolean(docs && docs.length > 0)
  const thMode = isCard && (docs ?? []).some((d) => (d.helperScripts?.length ?? 0) > 0)
  const scopeClass = useId().replace(/[^a-zA-Z0-9]/g, '')

  const prepared = useMemo(() => {
    const display = isCard ? applyDisplayRegex(content, docs ?? [], userName, thMode) : content
    if (!isCard) return { display, mode: 'plain' as const, body: display, scopedCss: '' }
    const cleaned = cleanCardHtml(display)
    return {
      display,
      mode: cleaned.hasScript ? ('iframe' as const) : ('card' as const),
      body: cleaned.body,
      scopedCss: cleaned.css ? scopeCss(cleaned.css, scopeClass) : '',
    }
  }, [content, isCard, thMode, docs, userName, scopeClass])

  // 酒馆助手卡：渲染成静态 HTML（免 sanitize——协议标记留给全局脚本），后续 DOM 由脚本接管
  const [thHtml, setThHtml] = useState('')
  useEffect(() => {
    if (!thMode) return
    let alive = true
    void (async () => {
      try {
        const html = await markdownToHtml(prepared.body, { sanitize: false, escapeProtocolTags: true })
        if (alive) setThHtml(html)
      } catch {
        if (alive) setThHtml('')
      }
    })()
    return () => {
      alive = false
    }
  }, [thMode, prepared.body])

  // 面板脚本消息走 iframe：整段原文进 srcDoc；同源与否由 thMode 决定
  if (prepared.mode === 'iframe') return <MessageIframe html={prepared.display} sameOrigin={thMode} />

  // 酒馆助手卡：静态 HTML + ST 类名锚点（全局脚本按 .mes_text 定位消息）
  if (thMode) {
    return (
      <div className={`${className} mes_block`}>
        <div className="mes_text" dangerouslySetInnerHTML={{ __html: thHtml }} />
      </div>
    )
  }

  return (
    <div className={prepared.scopedCss ? `${className} ${scopeClass}` : className}>
      {prepared.scopedCss && <style>{prepared.scopedCss}</style>}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={isCard ? [rehypeRaw, [rehypeSanitize, cardSanitizeSchema]] : []}
        components={{
          /* 超宽表格（长英文表头/单元格）在表内横滚，不撑破消息区 */
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {prepared.body}
      </ReactMarkdown>
    </div>
  )
}
