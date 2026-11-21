import { useMemo, useState } from 'react'
import { platform } from '@/platform'
import { humanizeError } from '@/chat/errors'
import { findPack } from '@/chat/packs'
import { resolveChain } from '@/chat/branches'
import { chainExportFilename, chainToMarkdown } from '@/chat/chain-export'
import type { SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'
import Sheet from './Sheet'

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

/**
 * 导出某一条回答之上的单回复链。
 *
 * 只做「读/分享」：不带用量、模型、系统提示词。
 * 链路优先按每一版记录的 path 还原；老记录没有 path 时退回当前选择，并在面板上写明。
 */
export default function ExportSheet({
  turnId,
  variant,
  onClose,
}: {
  turnId: string
  variant: number
  onClose: () => void
}) {
  const { turns, sessions, currentId, settings, config } = useApp()
  const [includeReasoning, setIncludeReasoning] = useState(false)
  const [copied, setCopied] = useState(false)

  const session = sessions.find((item) => item.id === currentId)
  const chain = useMemo(() => resolveChain(turns, turnId, variant), [turns, turnId, variant])

  const labels = useMemo(() => {
    if (!session) return { userLabel: '你', assistantLabel: '助手' }
    const pack = findPack(session.packId ?? config.packId).id
    const docs = (session.settingIds ?? [])
      .map((id) => settings.find((doc) => doc.id === id))
      .filter((doc): doc is SettingDoc => Boolean(doc))
    const character = docs.find((doc) => doc.kind === 'character')
    const characters = docs.filter((doc) => doc.kind === 'character')
    return {
      userLabel: config.userName?.trim() || '你',
      assistantLabel:
        pack === 'tavern'
          ? characters.length > 1
            ? '角色'
            : character?.name || '助手'
          : pack === 'writing'
            ? '叙述'
            : '助手',
    }
  }, [session, settings, config.packId, config.userName])

  const markdown = useMemo(
    () =>
      session && chain
        ? chainToMarkdown(session, chain, {
            includeReasoning,
            userLabel: labels.userLabel,
            assistantLabel: labels.assistantLabel,
          })
        : '',
    [session, chain, includeReasoning, labels]
  )

  if (!session || !chain) return null

  const target = chain.steps[chain.steps.length - 1]
  const round = target ? target.turn.idx + 1 : 1
  const versions = target ? target.turn.variants.length : 1
  const chars = chain.steps.reduce((sum, step) => {
    const item = step.turn.variants[step.variant]
    return sum + (item?.user.content.length ?? 0) + (item?.assistant?.content.length ?? 0)
  }, 0)

  const exportFile = async () => {
    try {
      await platform().exportTextFile(chainExportFilename(session, chain), markdown, 'text/markdown;charset=utf-8')
      onClose()
    } catch (error) {
      alert(humanizeError(error))
    }
  }

  const copy = async () => {
    if (!(await copyText(markdown))) {
      alert('复制失败，可以改用「导出 .md」')
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Sheet title="导出这条线" onClose={onClose}>
      <div className="mb-3 rounded-lg bg-neutral-50 px-3 py-2">
        <div className="text-[12px] text-neutral-700">
          第 1–{round} 轮
          {versions > 1 && target ? ` · 第 ${round} 轮第 ${target.variant + 1}/${versions} 版` : ''}
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-neutral-500">
          {chain.exact
            ? '真实历史链：每一步都是当时真正依赖的前序版本。'
            : '按当前选择拼接：部分早期版本没记下来源。'}
        </div>
        <div className="mt-1 text-[10px] tabular-nums text-neutral-400">
          {chain.steps.length} 轮 · 约 {chars} 字
        </div>
      </div>

      {!chain.exact && (
        <p className="mb-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-700">
          想要精确的历史链，从目标版本重新生成一次即可——新生成的版本会记下来路。
        </p>
      )}

      <label className="mb-3 flex items-center gap-2 text-[12px] text-neutral-600">
        <input type="checkbox" checked={includeReasoning} onChange={(e) => setIncludeReasoning(e.target.checked)} />
        包含思考过程
      </label>

      <div className="flex gap-1.5">
        <button
          className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm text-neutral-700"
          onClick={() => void copy()}
        >
          {copied ? '已复制' : '复制全文'}
        </button>
        <button className="flex-1 rounded-xl bg-neutral-900 py-2.5 text-sm text-white" onClick={() => void exportFile()}>
          导出 .md
        </button>
      </div>
    </Sheet>
  )
}
