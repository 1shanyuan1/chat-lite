/*
 * 色组（实验版）：三层表面模型——每个颜色管一层界面，互不干扰。
 *
 * 六个颜色的管辖域（浅色主题；深色主题方向相反）：
 *   主色   bg  → 大块面积：页面底(white)、50（浅面板）、气泡底/气泡字
 *   中间色 mid → 中层表面：100（气泡、输入框、未激活控件）、200/300（边框）
 *   墨色   ink → 小部件：900（主按钮、激活态、发送键）
 *   正文   text → 800（聊天正文、标题）
 *   次级文字 sub → 600（界面文字）、700（加重）
 *   辅助文字 aux → 500（辅助说明）、400（占位/禁用）
 *
 * 每个颜色只管自己的一层：主色=大面积的底，中间色=叠在上面的一层表面
 * （气泡/输入框都在这层），墨色=最小最重的小部件。段内相邻级用同色相
 * 明度微移补齐，不做跨锚点插值——改任何一个颜色，其它层一个像素都不会变。
 *
 * 生效原则：显式选择的颜色原样生效（所见即所得）；只有缺省推演的文字色
 * （用户没自己配时）才从墨色按可读性明度域生成。
 *
 * 浅 / 深两套锚点各自独立存储：明暗切换切换的是「编辑哪一套」；
 * 只配过一套时另一套按角色明度反转推演。
 *
 * 老 WebView 不支持 color-mix()，全部换算在 JS 里完成，以内联变量写在 <html> 上。
 * 石墨（等于默认锚点）清掉内联变量，交还样式表原值——外观与改前完全一致。
 */

/** 一套锚点（某个主题下的完整配色） */
export interface PaletteSet {
  /** 主色：大块面积——页面底 */
  bg: string
  /** 中间色：中层表面——气泡、输入框 */
  mid: string
  /** 墨色：小部件——主按钮、激活态 */
  ink: string
  /** 正文字色（可选；缺省由墨色推演） */
  text?: string
  /** 次级文字色（可选；缺省由墨色推演） */
  sub?: string
  /** 辅助文字色（可选；缺省由墨色推演） */
  aux?: string
}

/** 色组配置：浅 / 深两套锚点各自独立 */
export interface PaletteDef {
  light?: PaletteSet
  dark?: PaletteSet
}

/** 石墨 = 默认皮肤（两套锚点与样式表完全一致）。命中时清掉内联变量，原值生效 */
export const GRAPHITE: Record<'light' | 'dark', PaletteSet> = {
  light: { bg: '#ffffff', mid: '#f5f5f5', ink: '#171717', text: '#262626', sub: '#525252', aux: '#737373' },
  dark: { bg: '#0e0e11', mid: '#212126', ink: '#f4f4f7', text: '#e6e6ea', sub: '#b6b6bf', aux: '#9a9aa4' },
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const to = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0')
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l: l * 100 }
  const d = max - min
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) h = 60 * (((g - b) / d) % 6)
  else if (max === g) h = 60 * ((b - r) / d + 2)
  else h = 60 * ((r - g) / d + 4)
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

export function hexMix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/** 保留色相与浓度，明度移到目标值 */
function withL(hex: string, l: number): string {
  const { h, s } = hexToHsl(hex)
  return hslToHex(h, s, clamp(l, 0, 100))
}

/** 同色相同浓度的明度微移——段内补齐相邻级，绝不跨域 */
function shift(hex: string, delta: number): string {
  const { h, s, l } = hexToHsl(hex)
  return hslToHex(h, s, clamp(l + delta, 0, 100))
}

/** 由色相 + 浓度生成某主题的一整套锚点（预设用）；s=0 即该主题的石墨 */
export function paletteAnchors(h: number, s: number, theme: 'light' | 'dark'): PaletteSet {
  if (s <= 0) return { ...GRAPHITE[theme] }
  const L =
    theme === 'light'
      ? { bg: 99, mid: 96, ink: 10, text: 22, sub: 36, aux: 48 }
      : { bg: 6, mid: 13, ink: 94, text: 88, sub: 72, aux: 58 }
  return {
    bg: hslToHex(h, Math.round(s * 0.5), L.bg),
    mid: hslToHex(h, Math.round(s * 0.5), L.mid),
    ink: hslToHex(h, Math.round(s * 0.9), L.ink),
    text: hslToHex(h, s, L.text),
    sub: hslToHex(h, Math.round(s * 0.9), L.sub),
    aux: hslToHex(h, Math.round(s * 0.9), L.aux),
  }
}

/** 角色明度域：跨主题反转推演时，各锚点在目标主题里的落点 */
const ROLE_L = {
  light: { bg: 99, mid: 65, ink: 10, text: 22, sub: 36, aux: 48 },
  dark: { bg: 6, mid: 28, ink: 94, text: 88, sub: 72, aux: 58 },
}

/** 推荐色组的色相与浓度：从纯中性到激进高饱和，拉开变化幅度 */
export const PALETTE_HUES: Array<{ id: string; name: string; h: number; s: number }> = [
  { id: 'graphite', name: '石墨', h: 240, s: 0 },
  { id: 'indigo', name: '靛蓝', h: 222, s: 35 },
  { id: 'pine', name: '松柏', h: 158, s: 30 },
  { id: 'rouge', name: '胭脂', h: 350, s: 42 },
  { id: 'amber', name: '琥珀', h: 38, s: 55 },
  { id: 'vivid', name: '鲜艳', h: 258, s: 65 },
]

/** 从另一套锚点按角色明度反转推演出目标主题的一套 */
export function invertSet(a: PaletteSet, target: 'light' | 'dark'): PaletteSet {
  const L = ROLE_L[target]
  return {
    bg: withL(a.bg, L.bg),
    mid: withL(a.mid, L.mid),
    ink: withL(a.ink, L.ink),
    text: a.text ? withL(a.text, L.text) : undefined,
    sub: a.sub ? withL(a.sub, L.sub) : undefined,
    aux: a.aux ? withL(a.aux, L.aux) : undefined,
  }
}

/** 当前主题应使用哪套锚点：优先显式那套，否则由另一套反转推演，再否则石墨 */
export function resolveSet(def: PaletteDef | undefined, theme: 'light' | 'dark'): PaletteSet {
  const own = def?.[theme]
  if (own) return own
  const other = def?.[theme === 'light' ? 'dark' : 'light']
  if (other) return invertSet(other, theme)
  return { ...GRAPHITE[theme] }
}

export interface RampColors {
  /** 页面底色（--color-white） */
  bg: string
  steps: Record<Step, string>
  bubbleBg: string
  bubbleFg: string
}

type Step = (typeof STEPS)[number]
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const

/** 缺省文字色的推演明度（仅用于用户没有显式配置的字段） */
const DERIVED_L = {
  light: { text: 22, sub: 36, aux: 48 },
  dark: { text: 88, sub: 72, aux: 58 },
}

/** 段内明度微移档位（浅色向深补，深色向亮补） */
const BAND_SHIFT = {
  light: { band1: -2, border: -8, disabled: 14, subStep: -8 },
  dark: { band1: 3, border: 8, disabled: -14, subStep: 8 },
}
/** 用户气泡落在中间色一层的明度（气泡归中间色管辖） */
const BUBBLE_L = { light: 12, dark: 30, fg: 92 }

/** 分层直管：每个锚点只管自己的一层；显式颜色原样生效，缺省文字色由墨色推演 */
export function paletteRamp(set: PaletteSet, theme: 'light' | 'dark'): RampColors {
  const d = BAND_SHIFT[theme]
  const steps = {} as RampColors['steps']
  const text = set.text ?? withL(set.ink, DERIVED_L[theme].text)
  const sub = set.sub ?? withL(set.ink, DERIVED_L[theme].sub)
  const aux = set.aux ?? withL(set.ink, DERIVED_L[theme].aux)
  steps['50'] = shift(set.bg, d.band1)
  steps['100'] = set.mid
  steps['200'] = shift(set.mid, d.border)
  steps['300'] = shift(set.mid, d.border * 1.75)
  steps['400'] = shift(aux, d.disabled)
  steps['500'] = aux
  steps['600'] = sub
  steps['700'] = shift(sub, d.subStep)
  steps['800'] = text
  steps['900'] = set.ink
  if (theme === 'light') {
    return { bg: set.bg, steps, bubbleBg: withL(set.mid, BUBBLE_L.light), bubbleFg: '#ffffff' }
  }
  return {
    bg: set.bg,
    steps,
    bubbleBg: withL(set.mid, BUBBLE_L.dark),
    bubbleFg: withL(set.mid, BUBBLE_L.fg),
  }
}

const VARS = [
  '--color-white',
  ...STEPS.map((step) => `--color-neutral-${step}`),
  '--bubble-bg',
  '--bubble-fg',
]

function isGraphiteSet(set: PaletteSet, theme: 'light' | 'dark'): boolean {
  const g = GRAPHITE[theme]
  return (
    set.bg.toLowerCase() === g.bg &&
    set.mid.toLowerCase() === g.mid &&
    set.ink.toLowerCase() === g.ink &&
    set.text?.toLowerCase() === g.text &&
    set.sub?.toLowerCase() === g.sub &&
    set.aux?.toLowerCase() === g.aux
  )
}

/**
 * 把色组写进 <html> 内联变量（对两种主题、所有组件全局生效）。
 * 当前主题的锚点与石墨完全一致时清掉内联，交还样式表默认值。
 */
export function applyPalette(root: HTMLElement, def: PaletteDef | undefined, theme: 'light' | 'dark'): void {
  const set = resolveSet(def, theme)
  if (!def || isGraphiteSet(set, theme)) {
    VARS.forEach((v) => root.style.removeProperty(v))
    return
  }
  const ramp = paletteRamp(set, theme)
  root.style.setProperty('--color-white', ramp.bg)
  STEPS.forEach((step) => {
    root.style.setProperty(`--color-neutral-${step}`, ramp.steps[step])
  })
  root.style.setProperty('--bubble-bg', ramp.bubbleBg)
  root.style.setProperty('--bubble-fg', ramp.bubbleFg)
}

/**
 * 兼容各种历史存储格式，归一成 { light?, dark? }：
 * - { light, dark } 直接用
 * - 上一版扁平锚点 { bg, mid, ink, ... } → 浅色用原值，深色按角色反转推演
 * - 更旧的 { h, s } → 两套都由色相/浓度按主题生成（s=0 即石墨）
 * - 其它/缺失 → undefined（石墨）
 */
export function normalizePalette(raw: unknown): PaletteDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const readSet = (v: unknown): PaletteSet | undefined => {
    if (!v || typeof v !== 'object') return undefined
    const s = v as Record<string, unknown>
    if (typeof s.bg !== 'string' || typeof s.mid !== 'string' || typeof s.ink !== 'string') return undefined
    const out: PaletteSet = { bg: s.bg, mid: s.mid, ink: s.ink }
    if (typeof s.text === 'string') out.text = s.text
    if (typeof s.sub === 'string') out.sub = s.sub
    if (typeof s.aux === 'string') out.aux = s.aux
    return out
  }
  const light = readSet(r.light)
  const dark = readSet(r.dark)
  if (light || dark) {
    const out: PaletteDef = {}
    if (light) out.light = light
    if (dark) out.dark = dark
    return out
  }
  const flat = readSet(r)
  if (flat) {
    return { light: flat, dark: invertSet(flat, 'dark') }
  }
  if (typeof r.h === 'number' && typeof r.s === 'number') {
    const s = clamp(r.s, 0, 60)
    return { light: paletteAnchors(r.h, s, 'light'), dark: paletteAnchors(r.h, s, 'dark') }
  }
  return undefined
}
