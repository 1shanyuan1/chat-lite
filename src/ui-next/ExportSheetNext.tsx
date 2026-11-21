import { useMemo, useState } from 'react'
import { platform } from '@/platform'
import { humanizeError } from '@/chat/errors'
import { findPack } from '@/chat/packs'
import { resolveChain } from '@/chat/branches'
import { chainExportFilename, chainToMarkdown } from '@/chat/chain-export'
import type { SettingDoc } from '@/chat/settings'
import { useApp } from '@/chat/store'

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
 * 导出某一条回答之上的单回复链（实验版）。
 * 逻辑与正式版 ExportSheet 一致；面板统一 2xl、按钮统一胶囊。
 */
export default function ExportSheetNext({
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
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative max-h-[88%] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14px] font-medium text-neutral-800">导出这条线</h3>
          <button className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] text-neutral-600 active:bg-neutral-200" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="mb-3 rounded-2xl bg-neutral-50 px-4 py-3">
          <div className="text-[14px] text-neutral-800">
            第 1–{round} 轮
            {versions > 1 && target ? ` · 第 ${round} 轮第 ${target.variant + 1}/${versions} 版` : ''}
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-neutral-500">
            {chain.exact
              ? '真实历史链：前序轮次没有分叉，或已记录来源；包含这一版当时真正依赖的前序版本。'
              : '按当前选择拼接：部分早期版本没有来源记录，前序轮次用的是你现在选中的版本。'}
          </div>
          <div className="mt-1 text-[12px] tabular-nums text-neutral-500">
            {chain.steps.length} 轮 · 约 {chars} 字
          </div>
        </div>

        {!chain.exact && (
          <p className="mb-3 rounded-2xl bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
            这条链里有早期版本没记下来源。如果要精确的历史链，可以从目标版本重新生成一次——新生成的版本会记下来路。
          </p>
        )}

        <label className="mb-4 flex items-center gap-2 text-[14px] text-neutral-600">
          <input type="checkbox" checked={includeReasoning} onChange={(e) => setIncludeReasoning(e.target.checked)} />
          包含思考过程
        </label>

        <div className="flex gap-2">
          <button
            className="h-11 flex-1 rounded-full bg-neutral-100 text-[14px] text-neutral-700 active:bg-neutral-200"
            onClick={() => void copy()}
          >
            {copied ? '已复制' : '复制全文'}
          </button>
          <button className="h-11 flex-1 rounded-full bg-neutral-900 text-[14px] text-white active:bg-neutral-700" onClick={() => void exportFile()}>
            导出 .md
          </button>
        </div>
      </div>
    </div>
  )
}
