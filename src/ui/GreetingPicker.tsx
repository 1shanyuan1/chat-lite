import { CloseIcon } from './icons'

/**
 * 换开场：列出这张卡的全部开场，点一条就替换。
 *
 * 只在还没开口时可用——说过话之后换开场，后面几轮的上下文就对不上了。
 */
export default function GreetingPicker({
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
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">换一个开场</div>
            <div className="mt-0.5 text-[10px] text-neutral-400">
              同一张卡的不同切入点，换完从这一句重新开始
            </div>
          </div>
          <button className="rounded-full p-2 text-neutral-400 active:bg-neutral-100" onClick={onClose} aria-label="关闭">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="space-y-1.5">
          {list.map((text, i) => {
            const current = i === active
            return (
              <button
                key={i}
                className={`block w-full rounded-xl border px-3 py-2 text-left ${
                  current ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 bg-white active:bg-neutral-50'
                }`}
                onClick={() => onPick(i)}
              >
                <div className="mb-0.5 flex items-center gap-1.5">
                  <span className="text-[10px] tabular-nums text-neutral-400">第 {i + 1} 段</span>
                  {current && (
                    <span className="rounded bg-neutral-900 px-1.5 py-px text-[9px] text-white">当前</span>
                  )}
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
