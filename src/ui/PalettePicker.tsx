import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PALETTE_HUES,
  applyPalette,
  paletteAnchors,
  paletteRamp,
  resolveSet,
  type PaletteDef,
  type PaletteSet,
} from './palette'

/**
 * 色组即外观：浅色/深色不再是独立按钮，而是并入色组——
 * 每个推荐项是一套完整外观（色相 × 浅/深，两套锚点各自独立），
 * 叠块按该外观的真实配色渲染，深色组的叠块自己就是深色的。
 * 自定义 = 当前主题下的 底 / 中 / 墨 + 字体颜色（正文/次级/辅助）全部自由取色，
 * 显式选择的颜色原样生效（不做明度夹取），明暗切换时编辑的是那一套的锚点。
 */
export interface AppearanceChoice {
  theme: 'light' | 'dark'
  palette: PaletteDef
}

/** 推荐色组：色相预设两套锚点按主题各自生成 + 纯色强对比预设（显式双套） */
const ALL_PRESETS: Array<{ id: string; name: string; theme: 'light' | 'dark'; def: PaletteDef }> = [
  ...PALETTE_HUES.flatMap((p) => [
    {
      id: `${p.id}-light`,
      name: `${p.name}浅`,
      theme: 'light' as const,
      def: { light: paletteAnchors(p.h, p.s, 'light'), dark: paletteAnchors(p.h, p.s, 'dark') },
    },
    {
      id: `${p.id}-dark`,
      name: `${p.name}深`,
      theme: 'dark' as const,
      def: { light: paletteAnchors(p.h, p.s, 'light'), dark: paletteAnchors(p.h, p.s, 'dark') },
    },
  ]),
  {
    id: 'obsidian', name: '曜黑', theme: 'dark',
    def: {
      dark: { bg: '#0d0d0d', mid: '#8b8b8b', ink: '#ffffff', text: '#ffffff', sub: '#d4d4d4', aux: '#9e9e9e' },
      light: { bg: '#fdfdfd', mid: '#d5d5d5', ink: '#0d0d0d', text: '#1a1a1a', sub: '#555555', aux: '#8a8a8a' },
    },
  },
  {
    id: 'navy', name: '藏青', theme: 'dark',
    def: {
      dark: { bg: '#16244a', mid: '#4f74d6', ink: '#eef2ff', text: '#eef2ff', sub: '#b8c6ee', aux: '#8fa2d4' },
      light: { bg: '#eef1fb', mid: '#9db4ea', ink: '#12214a', text: '#1a2c5e', sub: '#4a5f96', aux: '#6d7fb0' },
    },
  },
  {
    id: 'pine-deep', name: '墨松', theme: 'dark',
    def: {
      dark: { bg: '#0f2b20', mid: '#35b07c', ink: '#eafff5', text: '#eafff5', sub: '#b3ddcd', aux: '#83b8a3' },
      light: { bg: '#eaf6f0', mid: '#93d6b9', ink: '#0f2b20', text: '#143528', sub: '#3c6b55', aux: '#5c8f78' },
    },
  },
  {
    id: 'wine', name: '酒红', theme: 'dark',
    def: {
      dark: { bg: '#3a0f1d', mid: '#e05c7e', ink: '#ffecf1', text: '#ffecf1', sub: '#e6b7c3', aux: '#c98ba0' },
      light: { bg: '#fdeef2', mid: '#eba4b6', ink: '#3a0f1d', text: '#451424', sub: '#7e3a4f', aux: '#a05f72' },
    },
  },
  {
    id: 'kraft', name: '牛皮纸', theme: 'light',
    def: {
      light: { bg: '#f6ecd7', mid: '#a56a2a', ink: '#17100a', text: '#17100a', sub: '#5c452b', aux: '#7d6549' },
      dark: { bg: '#221a10', mid: '#5c4426', ink: '#f6ecd7', text: '#f2e7d2', sub: '#c9b391', aux: '#a08a67' },
    },
  },
]

/** 三个偏移层叠的颜色块：中 / 墨 / 底三层就是自定义里可配置的三个基础颜色 */
function SwatchStack({ set, theme }: { set: PaletteSet; theme: 'light' | 'dark' }) {
  const ramp = paletteRamp(set, theme)
  return (
    <span className="relative inline-block h-11 w-14">
      {/* 从右往左错开叠放：墨色在最后，底色在最前 */}
      <span className="absolute right-0 top-0 h-8 w-10 rounded-lg" style={{ background: ramp.steps['900'] }} />
      <span className="absolute right-2 top-1.5 h-8 w-10 rounded-lg" style={{ background: set.mid }} />
      <span className="absolute right-4 top-3 h-8 w-10 rounded-lg ring-1 ring-black/10" style={{ background: ramp.bg }} />
    </span>
  )
}

/** 取色器显示「实际生效色」：缺省的文字色按当前主题推演补齐 */
function withDerivedText(set: PaletteSet, theme: 'light' | 'dark'): PaletteSet {
  if (set.text && set.sub && set.aux) return set
  const ramp = paletteRamp(set, theme)
  return {
    ...set,
    text: set.text ?? ramp.steps['800'],
    sub: set.sub ?? ramp.steps['600'],
    aux: set.aux ?? ramp.steps['500'],
  }
}

const sameSet = (a: PaletteSet, b: PaletteSet) =>
  a.bg.toLowerCase() === b.bg.toLowerCase() &&
  a.mid.toLowerCase() === b.mid.toLowerCase() &&
  a.ink.toLowerCase() === b.ink.toLowerCase()

/**
 * 色组选择器。
 * 预设点一下立即生效并落库（同时写入浅/深两套锚点）；
 * 自定义取色器拖动时直接写 <html>（立即预览），取色器关闭（原生 change）才落库。
 * 显式选择的颜色原样生效——不做明度夹取，所见即所得。
 */
export default function PalettePicker({
  theme,
  palette,
  onChange,
}: {
  theme: 'light' | 'dark'
  palette: PaletteDef | undefined
  onChange: (next: AppearanceChoice) => void
}) {
  // 当前主题的锚点：优先显式那套，否则由另一套按角色反转推演，再否则石墨
  const currentSet: PaletteSet = useMemo(() => resolveSet(palette, theme), [palette, theme])

  const active = ALL_PRESETS.find((r) => r.theme === theme && sameSet(r.def[theme] as PaletteSet, currentSet))
  const isCustom = !active

  const [draft, setDraft] = useState<PaletteSet>(() => withDerivedText(currentSet, theme))
  const [customMode, setCustomMode] = useState(isCustom)

  const setKey = `${currentSet.bg}|${currentSet.mid}|${currentSet.ink}|${currentSet.text}|${currentSet.sub}|${currentSet.aux}`
  useEffect(() => {
    setDraft(withDerivedText(currentSet, theme))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setKey])

  const openCustom = () => {
    setDraft(withDerivedText(currentSet, theme))
    setCustomMode(true)
  }

  /** 拖动中：更新 draft + 直接改 <html>（含 data-theme，语义色一起预览），不落库 */
  const preview = (p: PaletteSet) => {
    setDraft(p)
    applyPalette(document.documentElement, withSet(palette, theme, p), theme)
  }
  /** 松手/点选：落库，交给 AppNext 的统一 effect 接管 */
  const commit = (p: PaletteSet) => {
    onChange({ theme, palette: withSet(palette, theme, p) })
  }

  // 原生 <input type=color> 的 change 在取色器关闭时触发——用它提交，input 期间只预览
  const bgRef = useRef<HTMLInputElement>(null)
  const midRef = useRef<HTMLInputElement>(null)
  const inkRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLInputElement>(null)
  const subRef = useRef<HTMLInputElement>(null)
  const auxRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const els = [bgRef.current, midRef.current, inkRef.current, textRef.current, subRef.current, auxRef.current]
    const offs = els.map((el) => {
      if (!el) return
      const handler = () => commit(draft)
      el.addEventListener('change', handler)
      return () => el.removeEventListener('change', handler)
    })
    return () => offs.forEach((off) => off?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  const BASE_ROWS = [
    { label: '主色', key: 'bg' as const, ref: bgRef },
    { label: '中间色', key: 'mid' as const, ref: midRef },
    { label: '墨色', key: 'ink' as const, ref: inkRef },
  ]
  const TEXT_ROWS = [
    { label: '正文', key: 'text' as const, ref: textRef },
    { label: '次级文字', key: 'sub' as const, ref: subRef },
    { label: '辅助文字', key: 'aux' as const, ref: auxRef },
  ]

  return (
    <div>
      <div className="flex items-end gap-2.5 overflow-x-auto pb-1">
        {ALL_PRESETS.map((r) => {
          const isActive = active?.id === r.id
          return (
            <button
              key={r.id}
              className="flex shrink-0 flex-col items-center gap-1"
              onClick={() => {
                setCustomMode(false)
                onChange({ theme: r.theme, palette: r.def })
              }}
              aria-label={`色组：${r.name}`}
            >
              <span className={isActive ? 'rounded-lg ring-2 ring-neutral-900 ring-offset-2' : ''}>
                <SwatchStack set={r.def[r.theme] as PaletteSet} theme={r.theme} />
              </span>
              <span className={`text-[12px] ${isActive ? 'font-medium text-neutral-800' : 'text-neutral-500'}`}>
                {r.name}
              </span>
            </button>
          )
        })}

        {/* 自定义入口：叠块显示当前草稿的配色 */}
        <button className="flex shrink-0 flex-col items-center gap-1" onClick={openCustom} aria-label="自定义色组">
          <span className={customMode ? 'rounded-lg ring-2 ring-neutral-900 ring-offset-2' : ''}>
            <SwatchStack set={draft} theme={theme} />
          </span>
          <span className={`text-[12px] ${customMode ? 'font-medium text-neutral-800' : 'text-neutral-500'}`}>
            自定义
          </span>
        </button>
      </div>

      {customMode && (
        <div className="mt-3 space-y-2.5 rounded-2xl bg-neutral-50 p-3">
          {/* 明暗切换：改的是「编辑哪一套锚点」，两套各自独立存储 */}
          <div className="flex rounded-full bg-neutral-100 p-1">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                className={`flex-1 rounded-full py-1 text-[12px] transition-colors ${
                  theme === m ? 'bg-white font-medium text-neutral-900 shadow-sm' : 'text-neutral-500'
                }`}
                onClick={() => onChange({ theme: m, palette: palette ?? {} })}
              >
                {m === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>

          {BASE_ROWS.map(({ label, key, ref }) => (
            <label key={key} className="flex items-center gap-2.5">
              <span className="w-12 shrink-0 text-[12px] text-neutral-500">{label}</span>
              <input
                ref={ref}
                type="color"
                value={draft[key]}
                onChange={(e) => preview({ ...draft, [key]: e.target.value })}
                className="h-9 w-14 rounded-lg border border-neutral-200 bg-white p-0.5"
                aria-label={`${label}取色器`}
              />
              <span className="text-[12px] tabular-nums text-neutral-500">{draft[key].toUpperCase()}</span>
            </label>
          ))}

          {/* 字体颜色（高级）：正文 / 次级 / 辅助三路独立覆盖，原样生效 */}
          <div className="border-t border-neutral-200 pt-2.5">
            <div className="mb-2 text-[12px] font-medium text-neutral-600">字体颜色</div>
            {TEXT_ROWS.map(({ label, key, ref }) => (
              <label key={key} className="mb-2 flex items-center gap-2.5 last:mb-0">
                <span className="w-12 shrink-0 text-[12px] text-neutral-500">{label}</span>
                <input
                  ref={ref}
                  type="color"
                  value={draft[key]}
                  onChange={(e) => preview({ ...draft, [key]: e.target.value })}
                  className="h-9 w-14 rounded-lg border border-neutral-200 bg-white p-0.5"
                  aria-label={`${label}取色器`}
                />
                <span className="text-[12px] tabular-nums text-neutral-500">{(draft[key] ?? '').toUpperCase()}</span>
              </label>
            ))}
          </div>

          <p className="text-[12px] leading-relaxed text-neutral-500">
            三层各管各的，互不干扰：主色刷页面等大块面积，中间色刷气泡和输入框等中层表面，墨色刷按钮等小部件；正文/次级/辅助覆盖对应文字。浅色和深色各自记一套，切换明暗编辑的是那一套。拖动即时预览。
          </p>
        </div>
      )}
    </div>
  )
}

/** 复制色组配置，并把某个主题的锚点替换成给定值（另一套原样保留） */
function withSet(def: PaletteDef | undefined, theme: 'light' | 'dark', set: PaletteSet): PaletteDef {
  return { ...(def ?? {}), [theme]: set }
}
