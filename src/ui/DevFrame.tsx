import { useEffect, useRef, useState, type ReactNode } from 'react'
import { applyDemo, DEMO_CASES, restoreDemo } from '@/dev/demo'

/**
 * 桌面上的尺寸预览壳（只在 dev 生效）。
 *
 * 三条规矩，都是为了「看得准」：
 * 1. 宽度默认 1:1。缩放过的字宽行高不可信，判断字号必须切 100%。
 * 2. 高度不裁。放不下就整体缩小（自动模式），而不是把机器截断——
 *    截断会让两台机器看起来一样高，把比例差抹掉。
 * 3. 并排时两框共用一个缩放比，否则比较本身就没意义。
 *
 * 对比模式用 iframe 而不是把 <App /> 渲染两次：两棵树共享同一个 store，
 * 打开设置面板会同时弹两个；iframe 各自独立文档，互不干扰。
 * iframe 里的 DevFrame 靠 window.self !== window.top 自动退化成纯渲染。
 *
 * 测不出的：安全区（env 恒 0）、软键盘挤压、系统字体回退、真机触控。
 */
interface Preset {
  id: string
  label: string
  /** 屏幕宽（dp） */
  w: number
  /** 屏幕高（dp） */
  screen: number
  /** 状态栏 + 导航栏占掉的高度（dp），app 实际能用的只有 screen - bars */
  bars: number
  note: string
}

/**
 * 旧机与新机的关键差别不是宽度，是比例：
 * 旧机 16:9 且上下有边框，可用高度只有 568dp；新机 6.7 吋接近 20:9，可用 863dp。
 * 同样的内容，旧机上少显示将近一半，这才是要看的。
 */
const PRESETS: Preset[] = [
  { id: '360', label: '旧机', w: 360, screen: 640, bars: 72, note: '5.5 吋 16:9 · 带上下边框' },
  { id: '412', label: '新机', w: 412, screen: 915, bars: 52, note: '6.7 吋 19.5:9 · 全面屏' },
  { id: '800', label: '平板', w: 800, screen: 1280, bars: 48, note: '10 吋 16:10' },
]

const usableH = (p: Preset) => p.screen - p.bars

/** 外壳的最大宽度，超过它以后渲染结果与桌面窗口完全一致 */
const SHELL_MAX = 720
/** 并排两档需要的总宽度，不够就禁用对比 */
const COMPARE_MIN = 360 + 412 + 120

function Frame({
  preset,
  scale,
  demo,
  children,
}: {
  preset: Preset
  scale: number
  demo?: string
  children?: ReactNode
}) {
  const h = usableH(preset)
  const src = demo && demo !== 'none' ? `/?demo=${demo}` : '/'
  return (
    <div className="flex shrink-0 flex-col">
      <div className="mb-1 text-center text-[11px] tabular-nums text-neutral-500">
        {preset.label} {preset.w}×{h}
      </div>
      <div className="relative shrink-0" style={{ width: Math.round(preset.w * scale), height: Math.round(h * scale) }}>
        <div
          className="overflow-hidden rounded-[14px] bg-white shadow-[0_6px_28px_rgba(0,0,0,0.12)] ring-1 ring-black/10"
          style={{
            width: preset.w,
            height: h,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children ?? <iframe src={src} title={preset.label} className="h-full w-full border-0" />}
        </div>
      </div>
    </div>
  )
}

export default function DevFrame({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'single' | 'compare'>('single')
  const [zoom, setZoom] = useState<'auto' | '100' | '75' | '50'>('auto')
  const [active, setActive] = useState<string>('412')
  const [demo, setDemo] = useState<string>('none')
  const [box, setBox] = useState({ w: 0, h: 0 })
  const boxRef = useRef<HTMLDivElement>(null)

  // iframe 里不再套一层工具条，否则会无限嵌套
  const nested = typeof window !== 'undefined' && window.self !== window.top

  useEffect(() => {
    if (nested) return
    const el = boxRef.current
    if (!el) return
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [nested])

  // 并排预览的 iframe 各自是独立文档，演示数据只能靠 URL 带进去。
  // 这段放在 DevFrame 里而不是 main.tsx，是为了让整条演示链路一起被摇掉——
  // 放在 main 里即使 if(false) 也保不住动态 import，会往生产包里漏 7KB。
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('demo')
    if (id) {
      applyDemo(id)
      setDemo(id)
    }
  }, [])

  if (nested) return <>{children}</>

  const preset = PRESETS.find((p) => p.id === active) ?? PRESETS[1]
  const compareReady = box.w >= COMPARE_MIN
  const comparing = mode === 'compare' && compareReady

  // p-4 内边距 + 标签行约 52px
  const availH = Math.max(320, box.h - 52)

  const [oldPhone, newPhone] = [PRESETS[0], PRESETS[1]]

  // 并排时两框必须同一个缩放比，否则「谁更高」就不可比了
  const tallest = comparing ? Math.max(usableH(oldPhone), usableH(newPhone)) : usableH(preset)
  const autoScale = Math.min(1, availH / tallest)
  const scale = zoom === 'auto' ? autoScale : Number(zoom) / 100

  const capped = preset.w >= SHELL_MAX

  return (
    <div className="flex h-full flex-col bg-neutral-200">
      <div
        ref={boxRef}
        className="flex min-h-0 flex-1 items-start justify-center gap-4 overflow-auto p-4"
      >
        {comparing ? (
          <>
            <Frame preset={oldPhone} scale={scale} demo={demo} />
            <Frame preset={newPhone} scale={scale} demo={demo} />
          </>
        ) : (
          <Frame preset={preset} scale={scale}>
            {children}
          </Frame>
        )}
      </div>

      {/* 演示数据：只写进 store 内存，不落库 */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-t border-neutral-300 bg-neutral-50 px-3 py-1.5">
        <span className="shrink-0 text-[10px] font-medium text-neutral-400">演示</span>
        <button
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${
            demo === 'none' ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
          }`}
          onClick={() => {
            setDemo('none')
            restoreDemo()
            location.reload()
          }}
          title="重新加载，回到真实数据"
        >
          真实数据
        </button>
        {DEMO_CASES.map((item) => (
          <button
            key={item.id}
            className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${
              demo === item.id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600'
            }`}
            onClick={() => {
              setDemo(item.id)
              applyDemo(item.id)
            }}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-neutral-300 bg-white px-3 py-2">
        <span className="text-[10px] font-medium text-neutral-400">尺寸</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={`rounded-md px-2 py-0.5 text-[11px] ${
              !comparing && active === p.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
            }`}
            onClick={() => {
              setMode('single')
              setActive(p.id)
            }}
            title={p.note}
          >
            {p.label} {p.w}
          </button>
        ))}
        <button
          className={`rounded-md px-2 py-0.5 text-[11px] ${
            comparing ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 disabled:opacity-40'
          }`}
          disabled={!compareReady}
          onClick={() => setMode('compare')}
          title={compareReady ? '旧机与新机并排，同一缩放比' : `窗口再宽些才能并排（需要 ${COMPARE_MIN}px）`}
        >
          并排对比
        </button>

        <span className="ml-1 text-[10px] text-neutral-300">|</span>
        {(
          [
            ['auto', '自动'],
            ['100', '100%'],
            ['75', '75%'],
            ['50', '50%'],
          ] as Array<['auto' | '100' | '75' | '50', string]>
        ).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-md px-2 py-0.5 text-[11px] ${
              zoom === value ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600'
            }`}
            onClick={() => setZoom(value)}
          >
            {label}
          </button>
        ))}

        <span className="ml-auto text-[10px] tabular-nums text-neutral-400">
          {Math.round(scale * 100)}% · 可用 {Math.round(box.w)}×{Math.round(box.h)}
        </span>

        {scale < 0.999 && (
          <span className="w-full text-[10px] leading-relaxed text-amber-600">
            当前 {Math.round(scale * 100)}%：看排布用，字号行高不可信。判断文字大小请切 100%。
          </span>
        )}
        {comparing && (
          <span className="w-full text-[10px] leading-relaxed text-neutral-500">
            两机可用高度差 {usableH(newPhone) - usableH(oldPhone)}dp（{usableH(oldPhone)} vs {usableH(newPhone)}
            ），同样的内容旧机少显示近一半
          </span>
        )}
        {capped && (
          <span className="w-full text-[10px] leading-relaxed text-amber-600">
            宽度 ≥ {SHELL_MAX}px，渲染结果与桌面窗口完全相同——外壳写死 max-w-[{SHELL_MAX}px]，这个尺寸看不出新东西。
          </span>
        )}
      </div>
    </div>
  )
}
