import { CloseIcon } from '@/ui/icons'

/**
 * 换开场（实验版）：列出这张卡的全部开场，点一条就替换。
 * 逻辑与正式版 GreetingPicker 一致；面板与列表行统一 2xl。
 */
export default function GreetingPickerNext({
  list,
  active,
  onPick,
  onClose,
}: {
  list: string[]
  active: number
  onPick: (index: number) => void
  onClose: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} />
      <div className="relative max-h-[80%] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[14px] font-medium text-neutral-800">换一个开场</div>
            <div className="mt-0.5 text-[12px] text-neutral-500">同一张卡的不同切入点，换完从这一句重新开始</div>
          </div>
          <button className="rounded-full p-2 text-neutral-400 active:bg-neutral-100" onClick={onClose} aria-label="关闭">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="space-y-2">
          {list.map((text, i) => {
            const current = i === active
            return (
              <button
                key={i}
                className={`block w-full rounded-2xl border px-4 py-3 text-left ${
                  current ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white active:bg-neutral-50'
                }`}
                onClick={() => onPick(i)}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="text-[12px] tabular-nums text-neutral-500">第 {i + 1} 段</span>
                  {current && <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-[12px] text-white">当前</span>}
                </div>
                <div className="line-clamp-3 text-[12px] leading-relaxed text-neutral-600">{text}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
