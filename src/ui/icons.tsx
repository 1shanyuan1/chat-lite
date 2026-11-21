interface IconProps {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export function MenuIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L20 20" />
    </svg>
  )
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function PlusIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function SlidersIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5 7h9M18 7h1M5 17h1M10 17h9" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M14 6l-6 6 6 6" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M10 6l6 6-6 6" />
    </svg>
  )
}

export function ChevronUpIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 14l6-6 6 6" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 10l6 6 6-6" />
    </svg>
  )
}

export function CopyIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

export function RefreshIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </svg>
  )
}

export function DownloadIcon({ size = 15, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 4v10" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  )
}

export function PaperclipIcon({ size = 17, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M20 11.5l-7.6 7.6a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.3-7.3" />
    </svg>
  )
}

/** 蓝图：一条主线分叉成两支 */
export function TreeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 12h4a2 2 0 0 0 2-2V8a2 2 0 0 1 2-2h2" />
      <path d="M7 12h4a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

/** 发送：向上的箭头，实心圆底由外层容器给 */
export function SendIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true" strokeWidth={2}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

/** 停止：方点，和发送同尺寸同位置 */
export function StopIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="2.2" fill="currentColor" stroke="none" />
    </svg>
  )
}
