import type { ReactNode } from 'react'

/** 底部弹出的面板：寄存区、导出等地方共用同一套边距和安全区处理 */
export default function Sheet({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative max-h-[88%] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">{title}</h3>
          <button className="text-xs text-neutral-400" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
