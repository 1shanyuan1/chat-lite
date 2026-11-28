/**
 * 新版本检查（只在安卓端跑）：读取官网的 version.json，与 APK 版本名比对。
 * version.json 形如 { version: "2026.11.28.2", download: "https://ifno.fun/dl/chat-lite-latest.apk" }。
 * 升级入口一律走官网，不依赖 GitHub（网络可达性更好）。
 * 节流：12 小时内不重复请求，最近一次结果缓存在 localStorage。
 */
import packageInfo from '../../package.json'
import { platform } from '../platform'

export interface UpdateInfo {
  tag: string
  url: string
}

const VERSION_URL = 'https://ifno.fun/chat-lite/version.json'
const FALLBACK_URL = 'https://ifno.fun/chat-lite/'
const CHECK_KEY = 'chatlite_update_check_at'
const CACHE_KEY = 'chatlite_update_info'
const THROTTLE_MS = 12 * 3600_000

export async function checkUpdate(force = false): Promise<UpdateInfo | null> {
  if (platform().kind !== 'native') return null
  if (!force && Date.now() - Number(localStorage.getItem(CHECK_KEY) ?? 0) < THROTTLE_MS) return readCache()
  localStorage.setItem(CHECK_KEY, String(Date.now()))
  try {
    // 版本名从 APK 里拿（四段），package.json 只有日期三段
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return readCache()
    const data = (await res.json()) as { version?: string; download?: string; page?: string }
    const version = String(data.version ?? '').replace(/^v/, '')
    const found =
      version && newerThan(version, info.version || packageInfo.version)
        ? { tag: version, url: data.download || data.page || FALLBACK_URL }
        : null
    localStorage.setItem(CACHE_KEY, JSON.stringify(found))
    return found
  } catch {
    return readCache()
  }
}

function readCache(): UpdateInfo | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as UpdateInfo | null
  } catch {
    return null
  }
}

function newerThan(tag: string, current: string): boolean {
  const a = tag.split('.').map(Number)
  const b = current.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}