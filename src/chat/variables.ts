/**
 * 卡变量引擎（P3）。
 *
 * 面板卡的协议：模型在回复里输出 <UpdateVariable> 块（内装 JSONPatch 操作数组），
 * 前端把它应用到会话级变量树上；提示词侧用 {{getvar::path}} 一类宏把当前状态
 * 注回给模型。这是酒馆助手变量体系的最小等价物——没有执行环境，全是数据变换。
 *
 * 与完整实现的差异（有意为之的简化）：
 * - 变量是会话级一棵树，不做 per-message 变量；{{get_message_variable}} /
 *   {{format_message_variable}} 按 getvar 语义读取同一棵树；
 * - patch 应用取宽容策略：能用的 op 都用，失败的（坏指针、test 不过）跳过不炸；
 * - {{setvar}} 这类「展开即写入」的宏不做，写入走 P5 的 /setvar 命令。
 */

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove' | 'copy' | 'move' | 'test'
  path: string
  value?: unknown
  from?: string
}

/* ---------------- JSON Pointer（RFC 6901） ---------------- */

const unescapeToken = (token: string): string => token.replace(/~1/g, '/').replace(/~0/g, '~')
const escapeToken = (token: string): string => token.replace(/~/g, '~0').replace(/\//g, '~1')

/** 按指针读；'' 读整棵树；'/a/b' 逐层下钻，数组用数字段；越界返回 undefined */
export function readPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root
  const tokens = pointer.split('/').slice(1).map(unescapeToken)
  let current: unknown = root
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else {
      current = (current as Record<string, unknown>)[token]
    }
  }
  return current
}

/** 逐层走到 path 的父容器，缺的中间层补全；下一层是数组语义（'-' 或数字）时建数组 */
function parentOf(work: unknown, pointer: string): { parent: Record<string, unknown> | unknown[]; token: string } | null {
  const tokens = pointer.split('/').slice(1).map(unescapeToken)
  if (tokens.length === 0) return null
  const last = tokens.pop()!
  let current: unknown = work
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (current === null || typeof current !== 'object') return null
    if (Array.isArray(current)) {
      const index = Number(token)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return null
      current = current[index]
    } else {
      const container = current as Record<string, unknown>
      if (container[token] === undefined || container[token] === null || typeof container[token] !== 'object') {
        // 下一层（可能是 pop 出去的最后一段）是数组语义时，缺的中间层要建成数组
        const next = i + 1 < tokens.length ? tokens[i + 1] : last
        container[token] = next === '-' || /^\d+$/.test(next) ? [] : {}
      }
      current = container[token]
    }
  }
  if (current === null || typeof current !== 'object') return null
  return { parent: current as Record<string, unknown> | unknown[], token: last }
}

/** 写指针（add/replace 语义）；数组 token 为 '-' 时追加 */
function writePointer(work: unknown, pointer: string, value: unknown): boolean {
  const target = parentOf(work, pointer)
  if (!target) return false
  if (Array.isArray(target.parent)) {
    if (target.token === '-') {
      target.parent.push(value)
      return true
    }
    const index = Number(target.token)
    if (!Number.isInteger(index) || index < 0) return false
    target.parent[index] = value
    return true
  }
  ;(target.parent as Record<string, unknown>)[target.token] = value
  return true
}

function removePointer(work: unknown, pointer: string): unknown | undefined {
  const target = parentOf(work, pointer)
  if (!target) return undefined
  if (Array.isArray(target.parent)) {
    const index = Number(target.token)
    if (!Number.isInteger(index) || index < 0 || index >= target.parent.length) return undefined
    return target.parent.splice(index, 1)[0]
  }
  const container = target.parent as Record<string, unknown>
  const removed = container[target.token]
  delete container[target.token]
  return removed
}

const deepClone = <T,>(value: T): T =>
  typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T)

/** 宽容版 JSON Patch：合法的 op 都应用，失败的跳过；返回应用条数 */
export function applyJsonPatch(root: unknown, ops: JsonPatchOp[]): { vars: unknown; applied: number } {
  const work = deepClone(root ?? {})
  let applied = 0
  for (const op of ops) {
    try {
      switch (op.op) {
        case 'add':
        case 'replace': {
          if (op.value === undefined) break
          if (writePointer(work, op.path, op.value)) applied++
          break
        }
        case 'remove': {
          if (removePointer(work, op.path) !== undefined) applied++
          break
        }
        case 'copy': {
          const value = readPointer(work, op.from ?? '')
          if (value !== undefined && writePointer(work, op.path, deepClone(value))) applied++
          break
        }
        case 'move': {
          const value = removePointer(work, op.from ?? '')
          if (value !== undefined && writePointer(work, op.path, value)) applied++
          break
        }
        case 'test': {
          // 卡作者常拿 test 做条件保护；不过就跳过整条，不炸整个 patch
          if (JSON.stringify(readPointer(work, op.path)) === JSON.stringify(op.value)) applied++
          break
        }
      }
    } catch {
      // 单条失败不影响其余
    }
  }
  return { vars: work, applied }
}

/* ---------------- UpdateVariable 提取 ---------------- */

const UPDATE_BLOCK_RE = /<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/gi
const JSONPATCH_INNER_RE = /<JSONPatch>([\s\S]*?)<\/JSONPatch>/gi
const STAT_DATA_RE = /<stat_data>([\s\S]*?)<\/stat_data>/gi

/** 把一块文本解析成 patch 操作；对象按根级键合并 */
function opsFromParsed(parsed: unknown): JsonPatchOp[] {
  if (Array.isArray(parsed)) {
    const ops: JsonPatchOp[] = []
    for (const item of parsed) {
      if (item && typeof item === 'object' && typeof (item as JsonPatchOp).op === 'string' && typeof (item as JsonPatchOp).path === 'string') {
        ops.push(item as JsonPatchOp)
      }
    }
    return ops
  }
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    if (typeof record.op === 'string' && typeof record.path === 'string') {
      return [record as unknown as JsonPatchOp]
    }
    return Object.entries(record).map(([key, value]) => ({ op: 'add', path: `/${escapeToken(key)}`, value }))
  }
  return []
}

/**
 * 从模型回复里提取全部 <UpdateVariable> 块，解析成顺序的 patch 操作。
 * 兼容四种写法：裸 JSONPatch 操作数组 / 单操作对象 / 普通对象（根级键合并）/
 * 酒馆 MVU 协议——块内再包 <JSONPatch>[ops]</JSONPatch> 或 <stat_data>{树}</stat_data>。
 */
export function extractUpdateVariables(reply: string): JsonPatchOp[] {
  const ops: JsonPatchOp[] = []
  for (const match of reply.matchAll(UPDATE_BLOCK_RE)) {
    const block = match[1].trim()
    // MVU 协议：<JSONPatch> 子块（可能多个）
    let handled = false
    for (const inner of block.matchAll(JSONPATCH_INNER_RE)) {
      try {
        const parsed = JSON.parse(inner[1].trim())
        const fromInner = opsFromParsed(parsed)
        if (fromInner.length > 0) {
          ops.push(...fromInner)
          handled = true
        }
      } catch {
        /* 坏子块跳过 */
      }
    }
    // MVU 协议：<stat_data> 子块——整棵变量树快照，按根级键整体替换
    for (const inner of block.matchAll(STAT_DATA_RE)) {
      try {
        const parsed = JSON.parse(inner[1].trim())
        const fromInner = opsFromParsed(parsed)
        if (fromInner.length > 0) {
          ops.push(...fromInner)
          handled = true
        }
      } catch {
        /* 坏子块跳过 */
      }
    }
    if (handled) continue
    // 裸 JSON（chat-lite 合成卡的简单写法）
    try {
      const parsed = JSON.parse(block)
      ops.push(...opsFromParsed(parsed))
    } catch {
      continue
    }
  }
  return ops
}

/** 会话级变量树的读侧入口：reply 带变量块就应用，没有就原样返回 */
export function applyUpdateVariables(current: unknown, reply: string): { vars: unknown; changed: boolean } {
  const ops = extractUpdateVariables(reply)
  if (ops.length === 0) return { vars: current, changed: false }
  const { vars, applied } = applyJsonPatch(current, ops)
  return { vars, changed: applied > 0 }
}

/* ---------------- 变量宏 ---------------- */

/** getvar 系宏：不写 / 前缀的按根级键处理（对齐 ST 习惯），写了的按 JSON Pointer 下钻 */
const VAR_MACRO_RE = /\{\{\s*(getvar|get_message_variable|format_message_variable)\s*::\s*([\s\S]*?)\s*\}\}/gi

export function expandVarMacros(text: string, vars: unknown): string {
  if (!text || !text.includes('{{')) return text
  return text.replace(VAR_MACRO_RE, (_match, _name: string, rawPath: string) => {
    const path = String(rawPath).trim()
    const value = readPointer(vars ?? {}, path.startsWith('/') ? path : `/${path}`)
    if (value === undefined) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  })
}
