import { useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
// 版本号与 package.json 保持一致，和 App.tsx 同款做法
import packageInfo from '../../package.json'
import { platform } from '@/platform'
import { useApp } from '@/chat/store'
import { checkUpdate } from '@/chat/update'
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons'
import { ABOUT_INTRO, ABOUT_CREDITS } from './about-text'
import { SUPPORT_MD } from './support-text'
import { MANUAL_SECTIONS } from './manual-text'
import { CHANGELOG } from './changelog-text'

type View = 'main' | 'manual' | 'changelog' | 'support'

/** 作者联系方式:copy 项点了复制号码,url 项直接跳转 */
const MEDIA: Array<{ label: string; copy?: string; url?: string }> = [
  { label: '邮箱', copy: '813890848@qq.com' },
  { label: '小红书', copy: '1387625111' },
  { label: '抖音', copy: '382003849' },
  { label: '哔哩哔哩', url: 'https://space.bilibili.com/382003849' },
  { label: 'GitHub', url: 'https://github.com/1shanyuan1/chat-lite' },
]

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** 关于页里的外链统一走平台打开（安卓系统浏览器，网页新标签） */
const mdComponents = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      className="underline underline-offset-2"
      onClick={(e) => {
        e.preventDefault()
        if (href) void platform().openLink(href)
      }}
    >
      {children}
    </a>
  ),
}

/**
 * 关于页：设置页底部的 Logo 区点进来，全屏盖在设置面板上。
 * 主页面只留定位和三个入口；正文分流到说明书（manual-text.ts）与
 * 更新日志（changelog-text.ts），文案都集中在这两个文件里改。
 */
export default function AboutSheet({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>('main')
  const title =
    view === 'main' ? '关于'
    : view === 'manual' ? '使用说明书'
    : view === 'changelog' ? '更新日志'
    : '入门与支持'

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-1">
          {view !== 'main' && (
            <button className="-ml-1 p-1 text-neutral-400" onClick={() => setView('main')}>
              <ChevronLeftIcon size={16} />
            </button>
          )}
          <h2 className="text-base font-medium">{title}</h2>
        </div>
        <button className="text-neutral-400" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pb-[max(28px,env(safe-area-inset-bottom))]">
        {view === 'main' && <AboutMain onOpen={setView} />}
        {view === 'manual' && <Manual />}
        {view === 'changelog' && <Changelog />}
        {view === 'support' && <Support />}
      </div>
    </div>
  )
}

/** 主页面：定位一句话 + 入口 + 作者联系方式 */
function AboutMain({ onOpen }: { onOpen: (view: View) => void }) {
  const [note, setNote] = useState('')
  const { updateInfo } = useApp()
  return (
    <div className="px-1">
      {updateInfo && (
        <button
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left"
          onClick={() => platform().openLink(updateInfo.url)}
        >
          <span className="flex-1 text-xs leading-relaxed text-amber-800">
            新版本 {updateInfo.tag} 已发布，点此下载
          </span>
          <ChevronRightIcon size={14} className="text-amber-500" />
        </button>
      )}
      <div className="mt-8 text-center">
        <img src="/logo.svg" alt="Chat Lite logo" className="mx-auto h-20 w-20 rounded-2xl" />
        <div className="mt-3 text-lg font-medium text-neutral-800">Chat Lite</div>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          v{packageInfo.version} · 本地优先的 AI 聊天客户端
        </p>
      </div>

      <div className="md mt-5 text-[13px] leading-relaxed text-neutral-600">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{ABOUT_INTRO}</ReactMarkdown>
      </div>

      <div className="mt-6 space-y-2">
        <EntryRow title="使用说明书" sub="各功能怎么用" onClick={() => onOpen('manual')} />
        <EntryRow title="入门与支持" sub="0 元上手 · 创建 KEY 教程" onClick={() => onOpen('support')} />
        <EntryRow title="更新日志" sub="随版本记录" onClick={() => onOpen('changelog')} />
        <EntryRow
          title="反馈与调研"
          sub="在网页填写，直达作者"
          onClick={() => platform().openLink('https://ifno.fun/chat-lite/')}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {MEDIA.map((m) => (
          <button
            key={m.label}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 active:bg-neutral-100"
            onClick={async () => {
              if (m.url) {
                platform().openLink(m.url)
                return
              }
              const ok = await copyText(m.copy ?? '')
              setNote(ok ? `已复制${m.label} ${m.copy}，去对应平台搜索` : `复制失败，手动记一下：${m.copy}`)
              setTimeout(() => setNote(''), 3000)
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      {note && <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">{note}</p>}

      <div className="md mt-6 text-[11px] leading-relaxed text-neutral-400">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {ABOUT_CREDITS}
        </ReactMarkdown>
      </div>
    </div>
  )
}

/** 入口行：与设置页「关于 Chat Lite」同一套样式；muted 为不可点的占位 */
function EntryRow({
  title,
  sub,
  muted = false,
  onClick,
}: {
  title: string
  sub: string
  muted?: boolean
  onClick?: () => void
}) {
  const base =
    'flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5 text-left'
  const inner = (
    <>
      <span className="flex-1">
        <span className="block text-sm font-medium text-neutral-700">{title}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-neutral-400">{sub}</span>
      </span>
      {!muted && <ChevronRightIcon size={14} className="text-neutral-300" />}
    </>
  )
  if (muted) return <div className={`${base} opacity-60`}>{inner}</div>
  return (
    <button className={base} onClick={onClick}>
      {inner}
    </button>
  )
}

/** 使用说明书：目录 + 分节正文，目录点击滚动到对应节 */
function Manual() {
  const jump = (id: string) =>
    document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="text-[13px] leading-relaxed text-neutral-600">
      <nav className="mt-4 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
        <div className="text-xs font-medium text-neutral-500">目录</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-neutral-500">
          {MANUAL_SECTIONS.map((s) => (
            <button key={s.id} className="text-left" onClick={() => jump(s.id)}>
              {s.title}
            </button>
          ))}
        </div>
      </nav>

      {MANUAL_SECTIONS.map((s) => (
        <section key={s.id}>
          <h2 id={`manual-${s.id}`} className="mt-7 text-sm font-semibold text-neutral-800">
            {s.title}
          </h2>
          <div className="md mt-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {s.md}
            </ReactMarkdown>
          </div>
        </section>
      ))}
    </div>
  )
}

/** 更新日志：没有条目时给一个空态；底部带手动检查更新 */
function Changelog() {
  const [note, setNote] = useState('')
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true)
    const info = await checkUpdate(true)
    setNote(info ? `新版本 ${info.tag} 可用，去关于页下载` : '已是最新版本')
    setChecking(false)
  }
  return (
    <div className="text-[13px] leading-relaxed text-neutral-600">
      {CHANGELOG.length === 0 ? (
        <p className="mt-12 text-center text-xs text-neutral-400">还没有更新记录。</p>
      ) : (
        CHANGELOG.map((entry) => (
          <section key={`${entry.version}-${entry.date}`} className="mt-6">
            <h2 className="text-sm font-semibold text-neutral-800">
              v{entry.version} · {entry.date}
            </h2>
            <div className="md mt-1.5">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {entry.items.join('\n')}
              </ReactMarkdown>
            </div>
          </section>
        ))
      )}
      <div className="mt-10 text-center">
        <button
          className="rounded-lg border border-neutral-200 px-4 py-1.5 text-xs text-neutral-500 disabled:opacity-50"
          disabled={checking}
          onClick={() => void check()}
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
        {note && <p className="mt-2 text-[11px] text-neutral-400">{note}</p>}
      </div>
    </div>
  )
}

/** 入门与支持：推荐官计划 + 创建/使用 KEY 教程 */
function Support() {
  return (
    <div className="md mt-4 pb-[max(28px,env(safe-area-inset-bottom))] text-[13px] leading-relaxed text-neutral-600">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {SUPPORT_MD}
      </ReactMarkdown>
    </div>
  )
}
