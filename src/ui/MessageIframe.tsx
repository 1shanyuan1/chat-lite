import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/chat/store'
import { applyJsonPatch, readPointer } from '@/chat/variables'
import {
  BRIDGE_OK_RESULT,
  BRIDGE_VAR_RESULT,
  clampIframeHeight,
  injectBootstrap,
  parseBridgeMessage,
} from '@/chat/card-bridge'
import { executeStscript } from '@/chat/stscript'
import { stscriptApiFromStore } from '@/chat/th-runtime'

/**
 * 面板卡消息的 iframe 渲染器（P4）。
 *
 * 默认 sandbox="allow-scripts"（不给 same-origin）：脚本碰不到应用的 DOM/存储/密钥，
 * 与主应用的通信只有 postMessage 一条窄通道（协议见 card-bridge.ts）。
 * 卡带酒馆助手全局脚本时开同源（sameOrigin，对齐酒馆的信任模型）：
 * 面板脚本由此能调主窗口的宿主函数（如 mxSubmitSetup）。
 * 高度由 iframe 里的引导脚本经 ResizeObserver 自报，宿主夹取后落高度。
 */
export default function MessageIframe({ html, sameOrigin = false }: { html: string; sameOrigin?: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(80)

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // 只认自己发出的 iframe 传来的消息
      if (event.source !== frameRef.current?.contentWindow) return
      const command = parseBridgeMessage(event.data)
      if (!command) return
      const state = useApp.getState()
      const sessionId = state.currentId
      const session = state.sessions.find((s) => s.id === sessionId)
      const reply = (type: string, reqId: string, value: unknown) =>
        frameRef.current?.contentWindow?.postMessage({ type, reqId, value: safeClone(value) }, '*')
      switch (command.type) {
        case 'cl-height':
          setHeight(clampIframeHeight(command.height))
          break
        case 'cl-send': {
          // 无会话时 send 自建并挂起始页预选的卡——开场面板可以"填完直接开始"
          void state.send(command.text)
          break
        }
        case 'cl-slash': {
          void executeStscript(command.command, stscriptApiFromStore())
          break
        }
        case 'cl-getvar': {
          const path = command.path.startsWith('/') ? command.path : `/${command.path}`
          reply(BRIDGE_VAR_RESULT, command.reqId, readPointer(session?.variables ?? {}, path))
          break
        }
        case 'cl-setvar': {
          if (!sessionId) break
          const path = command.path.startsWith('/') ? command.path : `/${command.path}`
          const { vars } = applyJsonPatch(session?.variables ?? {}, [
            { op: 'add', path, value: safeClone(command.value) },
          ])
          void useApp.getState().setSessionVariables(sessionId, vars as Record<string, unknown>)
          reply(BRIDGE_OK_RESULT, command.reqId, true)
          break
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // srcDoc 变了（重渲染/切版本）就回到初始高度等引导脚本重报
  useEffect(() => {
    setHeight(80)
  }, [html])

  return (
    <iframe
      ref={frameRef}
      title="面板"
      sandbox={sameOrigin ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
      srcDoc={injectBootstrap(html)}
      style={{ width: '100%', height, border: 'none', display: 'block', background: 'transparent' }}
    />
  )
}

/** postMessage 只传可结构化克隆的数据；undefined/带函数的对象一律安全化 */
function safeClone(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}
