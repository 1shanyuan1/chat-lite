/**
 * 新版本检查（只在安卓端跑）：GitHub Releases 的最新 tag 与 APK 版本名比对。
 * tag 形如 v2026.11.22.1，与 versionName 同一套路（日期 + 当日序号），
 * 按数字段逐段比，tag 更新才算有新版。
 * 节流：12 小时内不重复请求，最近一次结果缓存在 localStorage。
 */
import packageInfo from '../../package.json'
import { platform } from '../platform'

export interface UpdateInfo {
  tag: string
  url: string
}

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
    const res = await fetch('https://api.github.com/repos/1shanyuan1/chat-lite/releases/latest')
    if (!res.ok) return readCache()
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const tag = (data.tag_name ?? '').replace(/^v/, '')
    const found =
      tag && newerThan(tag, info.version || packageInfo.version)
        ? { tag, url: data.html_url ?? 'https://github.com/1shanyuan1/chat-lite/releases/latest' }
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
