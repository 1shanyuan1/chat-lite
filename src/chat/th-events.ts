/**
 * 酒馆生态事件总线：独立于 store/th-runtime，任何一方都能安全导入（避免循环导入）。
 * store 在生命周期钩子上 fireThEvent；th-runtime 把 eventOn 暴露给卡脚本。
 */

export type ThHandler = (data: unknown) => void

const handlers = new Map<string, Set<ThHandler>>()

export function thOn(name: string, fn: ThHandler): void {
  const set = handlers.get(name) ?? new Set()
  set.add(fn)
  handlers.set(name, set)
}

export function thOff(name: string, fn: ThHandler): void {
  handlers.get(name)?.delete(fn)
}

/** 宿主事件出口：store 在收发/切会话/变量落库时调用 */
export function fireThEvent(name: string, data?: unknown): void {
  const set = handlers.get(name)
  if (!set) return
  for (const fn of [...set]) {
    try {
      fn(data)
    } catch (error) {
      // 卡脚本出错不能拖垮宿主
      console.warn(`[TH] 事件 ${name} 的订阅者抛错:`, error)
    }
  }
}

/** 与 tavern_events 常量同值路由 */
export const TH_EVENTS = {
  GENERATION_STARTED: 'GENERATION_STARTED',
  GENERATION_AFTER_COMMANDS: 'GENERATION_AFTER_COMMANDS',
  GENERATION_ENDED: 'GENERATION_ENDED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
  MESSAGE_UPDATED: 'MESSAGE_UPDATED',
  MESSAGE_DELETED: 'MESSAGE_DELETED',
  MESSAGE_SWIPED: 'MESSAGE_SWIPED',
  CHAT_CHANGED: 'CHAT_CHANGED',
  USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
  CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
  VARIABLE_UPDATE_STARTED: 'VARIABLE_UPDATE_STARTED',
  VARIABLE_UPDATE_ENDED: 'VARIABLE_UPDATE_ENDED',
  VARIABLES_UPDATED: 'VARIABLES_UPDATED',
} as const
