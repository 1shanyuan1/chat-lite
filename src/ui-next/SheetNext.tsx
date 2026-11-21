import type { ReactNode } from 'react'

/** 底部弹层（实验版）：容器一律 2xl，标题 14px，关闭钮胶囊。 */
export default function SheetNext({
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
          <h3 className="text-[14px] font-medium text-neutral-800">{title}</h3>
          <button
            className="rounded-full bg-neutral-100 px-3 py-1.5 text-[12px] text-neutral-600 active:bg-neutral-200"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
