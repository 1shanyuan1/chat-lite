import { useEffect, useMemo, useRef, useState } from 'react'
import { hitElementId } from '@/chat/hit-nav'
import { buildForest, type VariantNode } from '@/chat/branches'
import { useApp } from '@/chat/store'
import { CloseIcon, SearchIcon } from '@/ui/icons'

/*
 * 分支图（实验版）。布局算法与画布滚动逻辑与正式版 TreeView 完全一致（双轴 overflow-auto
 * 在 main 之外，横向拖动不受消息区修复影响），只换视觉层：
 * 标题 17px、检索框胶囊、节点卡片文字 12px（正式版是 8/9/11px）、底部操作统一胶囊。
 */
const CARD_W = 132
const CARD_H = 58
const GAP_X = 14
const GAP_Y = 30

const clamp = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

export default function TreeViewNext({
  onClose,
  onExport,
  evolutionMode = false,
}: {
  onClose: () => void
  onExport: (turnId: string, variant: number) => void
  /** 设定发展模式：设定副本单向生长，禁止回溯和从旧链分叉 */
  evolutionMode?: boolean
}) {
  const { turns, switchVariant, forkFromChain } = useApp()
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState(336)
  const [selected, setSelected] = useState<{ turnId: string; variant: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    // clientWidth 含左右 px-3（各 12），要扣掉才是可用宽度，否则会多出横向滚动
    const read = () => setWidth(Math.max(240, el.clientWidth - 24))
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const q = query.trim().toLowerCase()
  const forkCount = turns.filter((turn) => turn.variants.length > 1).length

  const layout = useMemo(() => {
    const forest = buildForest(turns)
    const widths = new Map<string, number>()
    const childWidths = new Map<string, number>()

    const measure = (node: VariantNode): number => {
      if (node.children.length === 0) {
        widths.set(node.key, CARD_W)
        childWidths.set(node.key, 0)
        return CARD_W
      }
      let sum = 0
      node.children.forEach((child, i) => {
        sum += measure(child) + (i > 0 ? GAP_X : 0)
      })
      childWidths.set(node.key, sum)
      const w = Math.max(CARD_W, sum)
      widths.set(node.key, w)
      return w
    }
    forest.roots.forEach(measure)

    const idxs = [...new Set(turns.map((turn) => turn.idx))].sort((a, b) => a - b)
    const rowOf = new Map(idxs.map((idx, row) => [idx, row]))
    const positions = new Map<string, { x: number; y: number }>()

    const place = (node: VariantNode, left: number) => {
      const w = widths.get(node.key) ?? CARD_W
      positions.set(node.key, {
        x: left + (w - CARD_W) / 2,
        y: (rowOf.get(node.turn.idx) ?? 0) * (CARD_H + GAP_Y),
      })
      let cursor = left + (w - (childWidths.get(node.key) ?? 0)) / 2
      for (const child of node.children) {
        place(child, cursor)
        cursor += (widths.get(child.key) ?? CARD_W) + GAP_X
      }
    }

    let cursor = 0
    for (const root of forest.roots) {
      place(root, cursor)
      cursor += (widths.get(root.key) ?? CARD_W) + GAP_X
    }

    const totalWidth = Math.max(0, cursor - GAP_X)
    const totalHeight = idxs.length > 0 ? idxs.length * (CARD_H + GAP_Y) - GAP_Y : 0
    return { forest, positions, totalWidth, totalHeight }
  }, [turns])

  const nodeByKey = useMemo(() => new Map(layout.forest.nodes.map((node) => [node.key, node])), [layout])

  const hitKeys = useMemo(() => {
    if (!q) return null
    const set = new Set<string>()
    for (const node of layout.forest.nodes) {
      const variant = node.turn.variants[node.index]
      const text = `${variant.user.content}\n${variant.assistant?.content ?? ''}`.toLowerCase()
      if (text.includes(q)) set.add(node.key)
    }
    return set
  }, [layout, q])

  const hitRounds = useMemo(
    () => new Set(layout.forest.nodes.filter((node) => hitKeys?.has(node.key)).map((node) => node.turn.id)).size,
    [layout, hitKeys]
  )

  const selectedNode = useMemo(
    () =>
      selected
        ? (layout.forest.nodes.find(
            (node) => node.turn.id === selected.turnId && node.index === selected.variant
          ) ?? null)
        : null,
    [selected, layout]
  )

  useEffect(() => {
    if (!selected) return
    const exists = turns.some(
      (turn) => turn.id === selected.turnId && selected.variant < turn.variants.length
    )
    if (!exists) setSelected(null)
  }, [turns, selected])

  const offsetX = Math.max(0, (width - layout.totalWidth) / 2)
  const canvasWidth = Math.max(width, layout.totalWidth)

  const previewOf = (node: VariantNode) => {
    const variant = node.turn.variants[node.index]
    const user = variant.user.content.trim()
    // 同一轮多个版本且问的是同一句话（重新生成）时，用户内容完全一样；
    // 这时卡片要显示回答的开头，不然分叉在图上看起来一模一样
    const sameQuestion =
      node.turn.variants.length > 1 &&
      node.turn.variants.every((item) => item.user.content.trim() === user)
    const text = sameQuestion ? variant.assistant?.content || user : user || variant.assistant?.content || ''
    return clamp(text, 34)
  }

  const jumpTo = (turnId: string) => {
    onClose()
    requestAnimationFrame(() => {
      const el =
        document.getElementById(hitElementId({ turnId, field: 'user' })) ??
        document.getElementById(hitElementId({ turnId, field: 'assistant' }))
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const mark = (text: string) => {
    if (!q) return text
    const at = text.toLowerCase().indexOf(q)
    if (at < 0) return text
    return (
      <>
        {text.slice(0, at)}
        <mark className="rounded bg-amber-200/70 px-0.5">{text.slice(at, at + q.length)}</mark>
        {text.slice(at + q.length)}
      </>
    )
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-neutral-50">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-1.5">
          <span className="text-[17px] font-medium text-neutral-800">分支图</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] text-amber-700">测试</span>
        </div>
        <button className="rounded-full p-2 text-neutral-500 active:bg-neutral-100" onClick={onClose} aria-label="关闭">
          <CloseIcon size={16} />
        </button>
      </header>

      {evolutionMode && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
          设定发展模式：设定副本已经随剧情推进，不能切回旧版本或原地分叉。导出和从此链开新对话不受影响。
        </div>
      )}

      <div className="border-b border-neutral-200 bg-white px-3 py-2">
        <div className="flex h-9 items-center gap-2 rounded-full bg-neutral-100 px-3">
          <span className="text-neutral-400">
            <SearchIcon size={14} />
          </span>
          <input
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-neutral-400"
            placeholder="检索这段对话里的任何一句"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="shrink-0 text-[12px] text-neutral-500" onClick={() => setQuery('')}>
              清空
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-neutral-500">
          <span>
            {q ? `命中 ${hitKeys?.size ?? 0} 个版本 · ${hitRounds} 轮` : `${turns.length} 轮 · ${forkCount} 处分叉`}
          </span>
          <span>点卡片选择，可切换或导出</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-neutral-500">
          <span>实线：记录的来源</span>
          <span>虚线：按当前选择推断</span>
        </div>
      </div>

      <div ref={boxRef} className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {turns.length === 0 && <p className="py-12 text-center text-[12px] text-neutral-400">这段对话还没有内容</p>}
        {turns.length > 0 && hitKeys && hitKeys.size === 0 && (
          <p className="py-12 text-center text-[12px] text-neutral-400">没有匹配的轮次</p>
        )}

        {turns.length > 0 && (!hitKeys || hitKeys.size > 0) && (
          <div className="relative" style={{ height: layout.totalHeight, width: canvasWidth }}>
            <svg
              className="pointer-events-none absolute left-0 top-0"
              width={canvasWidth}
              height={layout.totalHeight}
              aria-hidden="true"
            >
              {layout.forest.nodes.map((node) => {
                if (!node.parentKey) return null
                const parent = layout.positions.get(node.parentKey)
                const pos = layout.positions.get(node.key)
                if (!parent || !pos) return null
                const parentNode = nodeByKey.get(node.parentKey)
                const px = parent.x + offsetX + CARD_W / 2
                const py = parent.y + CARD_H
                const cx = pos.x + offsetX + CARD_W / 2
                const cy = pos.y
                const mid = py + GAP_Y / 2
                const strong =
                  parentNode?.turn.active === parentNode?.index && node.turn.active === node.index
                return (
                  <path
                    key={node.key}
                    d={`M ${px} ${py} C ${px} ${mid}, ${cx} ${mid}, ${cx} ${cy}`}
                    stroke={node.exact ? 'var(--color-neutral-400)' : 'var(--color-neutral-300)'}
                    strokeWidth={strong ? 2.5 : 2}
                    strokeDasharray={node.exact ? undefined : '4 3'}
                    fill="none"
                  />
                )
              })}
            </svg>

            {layout.forest.nodes.map((node) => {
              const pos = layout.positions.get(node.key)
              if (!pos) return null
              const active = node.turn.active === node.index
              const isSelected = selected?.turnId === node.turn.id && selected.variant === node.index
              const dim = hitKeys !== null && !hitKeys.has(node.key)
              return (
                <button
                  key={node.key}
                  className={`absolute overflow-hidden rounded-lg px-2 py-1.5 text-left transition-opacity ${
                    active
                      ? 'border-2 border-neutral-900 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                      : 'border border-neutral-300 bg-white'
                  } ${isSelected ? 'ring-2 ring-amber-400 ring-offset-1' : ''} ${dim ? 'opacity-30' : ''}`}
                  style={{
                    left: pos.x + offsetX,
                    top: pos.y,
                    width: CARD_W,
                    height: CARD_H,
                  }}
                  onClick={() => setSelected({ turnId: node.turn.id, variant: node.index })}
                  title={node.exact ? '点一下选择；可切换或导出' : '来源未记录，连线按当前选择推断'}
                >
                  <div className="mb-0.5 flex items-center gap-1">
                    <span
                      className={`text-[12px] font-medium tabular-nums ${active ? 'text-neutral-600' : 'text-neutral-400'}`}
                    >
                      {node.turn.idx + 1}
                      {node.turn.variants.length > 1 ? `·${node.index + 1}` : ''}
                    </span>
                    {!node.exact && <span className="text-[12px] text-neutral-400">?</span>}
                  </div>
                  <div
                    className={`line-clamp-2 text-[12px] leading-[1.3] ${active ? 'text-neutral-800' : 'text-neutral-500'}`}
                  >
                    {mark(previewOf(node)) || '（空消息）'}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selectedNode && (
        <div className="border-t border-neutral-200 bg-white px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] text-neutral-500">
              第 {selectedNode.turn.idx + 1} 轮 · 第 {selectedNode.index + 1}/{selectedNode.turn.variants.length} 版
            </span>
            <button className="text-[12px] text-neutral-500" onClick={() => setSelected(null)}>
              取消选择
            </button>
          </div>
          <div className="mb-2 line-clamp-1 text-[12px] text-neutral-600">{previewOf(selectedNode) || '（空消息）'}</div>
          <div className="flex gap-2">
            {selectedNode.turn.active === selectedNode.index ? (
              <button
                className="h-10 flex-1 rounded-full border border-neutral-200 text-[14px] text-neutral-700"
                onClick={() => jumpTo(selectedNode.turn.id)}
              >
                跳到这一轮
              </button>
            ) : (
              <button
                className="h-10 flex-1 rounded-full border border-neutral-200 text-[14px] text-neutral-700 disabled:opacity-40"
                disabled={evolutionMode}
                title={evolutionMode ? '设定发展模式下不能切回旧版本' : undefined}
                onClick={() => void switchVariant(selectedNode.turn.id, selectedNode.index)}
              >
                {evolutionMode ? '不可切回旧版' : '切到这一版'}
              </button>
            )}
            <button
              className="h-10 flex-1 rounded-full bg-neutral-900 text-[14px] text-white"
              onClick={() => onExport(selectedNode.turn.id, selectedNode.index)}
            >
              导出这条线
            </button>
          </div>
          <button
            className="mt-2 h-10 w-full rounded-full border border-neutral-200 text-[14px] text-neutral-700"
            onClick={() => {
              if (!confirm('从这条链开一个新对话？会把这条链原样搬过去作为前情，原对话和设定副本都不动。')) return
              void forkFromChain(selectedNode.turn.id, selectedNode.index)
              onClose()
            }}
          >
            从此链开新对话
          </button>
          {evolutionMode && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-amber-700">
              发展稿不回溯：不能切回旧版本，但可以导出，也可以从这条链开新对话（新会话沿用当前的发展稿）。
            </p>
          )}
        </div>
      )}
    </div>
  )
}
