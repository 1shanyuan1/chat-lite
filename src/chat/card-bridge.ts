/**
 * P4 桥：沙箱 iframe（面板卡）⇄ 主应用 的消息协议。
 *
 * iframe 用 sandbox="allow-scripts"（不给 same-origin）：面板脚本跑在自己的
 * 不透明源里，碰不到应用的 DOM/存储/密钥，通信只有 postMessage 一条窄通道。
 * bootstrap 脚本随 srcDoc 注入，往 iframe 的 window 上挂桥面函数——命名对齐
 * 酒馆助手系常用子集（getvar/setvar/send/triggerSlash），真实卡跑通后再校准。
 */

export const BRIDGE_HEIGHT = 'cl-height'
export const BRIDGE_SEND = 'cl-send'
export const BRIDGE_SLASH = 'cl-slash'
export const BRIDGE_GETVAR = 'cl-getvar'
export const BRIDGE_SETVAR = 'cl-setvar'
export const BRIDGE_VAR_RESULT = 'cl-var-result'
export const BRIDGE_OK_RESULT = 'cl-ok-result'

export interface BridgeHeight {
  type: typeof BRIDGE_HEIGHT
  height: number
}
export interface BridgeSend {
  type: typeof BRIDGE_SEND
  text: string
}
export interface BridgeSlash {
  type: typeof BRIDGE_SLASH
  command: string
}
export interface BridgeGetVar {
  type: typeof BRIDGE_GETVAR
  reqId: string
  path: string
}
export interface BridgeSetVar {
  type: typeof BRIDGE_SETVAR
  reqId: string
  path: string
  value: unknown
}
export type BridgeCommand = BridgeHeight | BridgeSend | BridgeSlash | BridgeGetVar | BridgeSetVar

/** 只认协议内且字段形状正确的消息；其余噪声一律 null */
export function parseBridgeMessage(data: unknown): BridgeCommand | null {
  if (!data || typeof data !== 'object') return null
  const msg = data as Record<string, unknown>
  switch (msg.type) {
    case BRIDGE_HEIGHT:
      return typeof msg.height === 'number' && Number.isFinite(msg.height)
        ? { type: BRIDGE_HEIGHT, height: msg.height }
        : null
    case BRIDGE_SEND:
      return typeof msg.text === 'string' ? { type: BRIDGE_SEND, text: msg.text } : null
    case BRIDGE_SLASH:
      return typeof msg.command === 'string' ? { type: BRIDGE_SLASH, command: msg.command } : null
    case BRIDGE_GETVAR:
      return typeof msg.reqId === 'string' && typeof msg.path === 'string'
        ? { type: BRIDGE_GETVAR, reqId: msg.reqId, path: msg.path }
        : null
    case BRIDGE_SETVAR:
      return typeof msg.reqId === 'string' && typeof msg.path === 'string'
        ? { type: BRIDGE_SETVAR, reqId: msg.reqId, path: msg.path, value: msg.value }
        : null
    default:
      return null
  }
}

/** iframe 高度夹取：太矮保可点，太高防失控盖屏 */
export const clampIframeHeight = (height: number): number => Math.min(Math.max(Math.round(height), 60), 4000)

/**
 * 注进每个面板 iframe 的引导脚本：高度上报 + 桥面函数。
 * 必须跑在卡脚本之前（卡脚本可能在解析时就调 getvar）。
 */
export const BRIDGE_BOOTSTRAP = `<script>(function(){
function post(msg){try{window.parent.postMessage(msg,'*')}catch(e){}}
function reportHeight(){post({type:'cl-height',height:Math.ceil(document.documentElement.getBoundingClientRect().height)})}
document.addEventListener('DOMContentLoaded',reportHeight)
window.addEventListener('load',function(){
  reportHeight()
  if(window.ResizeObserver){new ResizeObserver(reportHeight).observe(document.documentElement)}
})
var seq=0,pending={}
function rpc(type,payload){return new Promise(function(resolve){var id='r'+(++seq);pending[id]=resolve;var msg={type:type,reqId:id};for(var k in payload){msg[k]=payload[k]}post(msg)})}
window.addEventListener('message',function(e){
  var data=e.data||{}
  if((data.type==='cl-var-result'||data.type==='cl-ok-result')&&pending[data.reqId]){pending[data.reqId](data.value);delete pending[data.reqId]}
})
window.getvar=function(path){return rpc('cl-getvar',{path:path})}
window.setvar=function(path,value){return rpc('cl-setvar',{path:path,value:value}).then(function(){return true})}
window.send=function(text){post({type:'cl-send',text:String(text==null?'':text)})}
window.triggerSlash=function(command){post({type:'cl-slash',command:String(command==null?'':command)})}
})()</script>`

/** 引导脚本优先进 <head>，没有就贴在 doctype 之后或整体最前（避免破坏 quirks/标准模式判定） */
export function injectBootstrap(html: string, bootstrap: string = BRIDGE_BOOTSTRAP): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + bootstrap)
  const doctype = /^\s*<!DOCTYPE[^>]*>/i.exec(html)
  if (doctype) return html.slice(0, doctype[0].length) + bootstrap + html.slice(doctype[0].length)
  return bootstrap + html
}
