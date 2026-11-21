/**
 * 分支：一版回答的「来路」。
 *
 * 每个 TurnVariant 在生成时记下 path——前面每一轮当时用的是第几版。
 * 有了它，才能：
 * 1. 从任意一版回答还原它真正依赖的单回复链（不是现在碰巧选中的那条）；
 * 2. 在分支图里画真实的父子连线，而不是「当前父节点连到下一层所有版本」。
 *
 * 老记录没有 path。所有读取 path 的地方都要能退回当前激活链，并明确标记
 * 「来源未记录」——不能假装那条链是历史链。
 */
import type { ChatTurn, TurnVariant } from '@/db'

/** 生成 beforeIdx 这一轮的新版本时，快照前面每一轮当时选中的版本 */
export function pathOf(turns: ChatTurn[], beforeIdx: number): number[] {
  return turns
    .filter((turn) => turn.idx < beforeIdx)
    .sort((a, b) => a.idx - b.idx)
    .map((turn) => turn.active)
}

export interface ChainStep {
  turn: ChatTurn
  /** 这一轮用的是第几版 */
  variant: number
}

export interface Chain {
  steps: ChainStep[]
  /**
   * true：完全按记录的 path 还原；
   * false：目标版本没有 path（或 path 越界），前序轮次退回当前选择。
   */
  exact: boolean
}

const usablePath = (turns: ChatTurn[], target: ChatTurn, variant: TurnVariant): number[] | null => {
  const path = variant.path
  if (!Array.isArray(path)) return null
  const prior = turns.filter((turn) => turn.idx < target.idx).sort((a, b) => a.idx - b.idx)
  if (path.length !== target.idx || prior.length !== target.idx) return null
  for (let i = 0; i < path.length; i++) {
    const index = path[i]
    if (!Number.isInteger(index) || index < 0 || index >= prior[i].variants.length) return null
  }
  return path
}

/**
 * 从「某一轮的某一版回答」往前还原一条单回复链。
 *
 * 优先用这一版记录的 path；没有 path 就按当前每一轮的 active 拼一条，
 * 并把 exact 标成 false，调用方要在导出文件里写明这是拼接链。
 */
export function resolveChain(turns: ChatTurn[], turnId: string, variantIndex: number): Chain | null {
  const target = turns.find((turn) => turn.id === turnId)
  if (!target) return null

  const index = Math.min(Math.max(Math.trunc(variantIndex), 0), target.variants.length - 1)
  const variant = target.variants[index]
  if (!variant) return null

  const prior = turns.filter((turn) => turn.idx < target.idx).sort((a, b) => a.idx - b.idx)
  const recorded = usablePath(turns, target, variant)
  // 第 0 轮没有前序；另外，如果前面每一轮都只有一个版本，
  // 即使老记录没存 path，这条链也没有歧义，仍然是精确的。
  const unambiguous = prior.every((turn) => turn.variants.length === 1)
  const exact = target.idx === 0 || recorded !== null || unambiguous

  const steps: ChainStep[] = prior.map((turn, i) => ({
    turn,
    variant: exact && recorded ? recorded[i] : turn.active,
  }))
  steps.push({ turn: target, variant: index })
  return { steps, exact }
}

export interface VariantNode {
  key: string
  turn: ChatTurn
  /** 在 turn.variants 里的下标 */
  index: number
  parentKey: string | null
  /** 父边是否来自记录的 path；false = 按当前选择推断的虚线 */
  exact: boolean
  children: VariantNode[]
}

export interface VariantForest {
  roots: VariantNode[]
  nodes: VariantNode[]
}

/**
 * 把逐轮的 variants 组成真正的树。
 *
 * 每一版最多一个父节点：path 里上一轮的下标；没有 path 时连到上一轮当前激活版。
 * 第 0 轮的所有版本都是根。返回的节点顺序按轮次、版本顺序。
 */
export function buildForest(turns: ChatTurn[]): VariantForest {
  const ordered = [...turns].sort((a, b) => a.idx - b.idx)
  const byIdx = new Map(ordered.map((turn) => [turn.idx, turn]))
  const nodes: VariantNode[] = []
  const map = new Map<string, VariantNode>()
  const roots: VariantNode[] = []

  for (const turn of ordered) {
    const prev = byIdx.get(turn.idx - 1)
    // 前序每轮都只有一个版本时，即使没有 path 也没有歧义
    const unambiguous = ordered
      .filter((item) => item.idx < turn.idx)
      .every((item) => item.variants.length === 1)
    for (let i = 0; i < turn.variants.length; i++) {
      const variant = turn.variants[i]
      let parentKey: string | null = null
      let exact = turn.idx === 0
      if (prev) {
        const pathOk = Array.isArray(variant.path) && variant.path.length === turn.idx
        const parentIndex = pathOk ? variant.path![prev.idx] : undefined
        const valid =
          pathOk &&
          Number.isInteger(parentIndex) &&
          (parentIndex as number) >= 0 &&
          (parentIndex as number) < prev.variants.length
        const use = valid ? (parentIndex as number) : prev.active
        parentKey = `${prev.id}-${use}`
        exact = valid || unambiguous
      }
      const node: VariantNode = {
        key: `${turn.id}-${i}`,
        turn,
        index: i,
        parentKey,
        exact,
        children: [],
      }
      nodes.push(node)
      map.set(node.key, node)
      const parent = parentKey ? map.get(parentKey) : undefined
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
  }

  return { roots, nodes }
}
