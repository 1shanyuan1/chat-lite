import { Capacitor } from '@capacitor/core'
import type { Platform } from './types'

let instance: Platform | null = null

/** 在 App 启动时调用一次，把宿主实现确定下来 */
export async function initPlatform(): Promise<Platform> {
  if (instance) return instance
  instance = Capacitor.isNativePlatform()
    ? (await import('./native')).nativePlatform
    : (await import('./web')).webPlatform
  return instance
}

export function platform(): Platform {
  if (!instance) throw new Error('platform 尚未初始化，请先 await initPlatform()')
  return instance
}

export type { HttpRequest, HttpResponse, Platform } from './types'
