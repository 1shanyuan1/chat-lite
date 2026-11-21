import { Capacitor } from '@capacitor/core'

/**
 * 把应用高度锁到 visualViewport 上（只在原生端生效）。
 *
 * 软键盘弹出时，Android WebView 不一定会缩 layout viewport：页面以为高度没变，
 * 浏览器为了露出输入框会把可视区整体平移——顶部栏和起始页那几个方块就这样被顶出屏幕。
 * 这里直接读可视高度写进 CSS 变量，布局自己收缩，不依赖系统的 resize 行为，
 * 也不依赖 Android 15 之后 edge-to-edge 下的 insets 处理。
 */
export function installViewportHeight(): void {
  if (!Capacitor.isNativePlatform()) return
  const vv = window.visualViewport
  if (!vv) return

  let frame = 0
  const apply = () => {
    frame = 0
    // 取整：小数像素会让每帧都触发一次重排
    document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`)
    // 已经被系统平移过就拉回来——高度是我们自己算的，不需要它再帮忙
    if (window.scrollY !== 0) window.scrollTo(0, 0)
  }
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(apply)
  }

  vv.addEventListener('resize', schedule)
  vv.addEventListener('scroll', schedule)
  window.addEventListener('orientationchange', schedule)
  apply()
}
