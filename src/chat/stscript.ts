/**
 * STscript 子集（P5）。
 *
 * 只做「| 分隔的顺序命令」——面板卡和 QR 里九成的用法就是 /send /setvar /gen 三件套。
 * 不做管道传值（{{pipe}}）、不做闭包/嵌套/宏层，那是要背兼容矩阵的深水区。
 * 命令的执行环境由调用方接线到 store（组件层），这里保持纯逻辑。
 */

export interface StscriptStep {
  /** 小写命令名；空串表示这一段不是命令（纯文本，同样按发送处理） */
  command: string
  args: string
}

export function parseStscript(input: string): StscriptStep[] {
  return input
    .split('|')
    .map((step) => step.trim())
    .filter(Boolean)
    .map((step) => {
      const match = /^\/([a-z_]+)\s*([\s\S]*)$/i.exec(step)
      if (match) return { command: match[1].toLowerCase(), args: match[2].trim() }
      // 以 / 开头但命令名不合法：标记成必被丢弃的命令，而不是当纯文本发出去
      return step.startsWith('/') ? { command: '(unknown)', args: step } : { command: '', args: step }
    })
}

/** 执行环境：由调用方（组件层）接线到 store */
export interface StscriptApi {
  send: (text: string) => Promise<void>
  regenerateLast: () => Promise<void>
  setVar: (path: string, value: unknown) => Promise<void>
}

export async function executeStscript(input: string, api: StscriptApi): Promise<void> {
  // 酒馆的 /send 只发不生成、/trigger 才生成；我们的 api.send 是发送即生成。
  // 卡的经典组合「/send x|/trigger」会变成「生成一次 + 再触发一次」——
  // 用本轮已发送标记让 /trigger 跳过，语义对齐酒馆的最终效果。
  let sentThisRun = false
  for (const step of parseStscript(input)) {
    switch (step.command) {
      case 'send':
      case 'gen':
      case '':
        // /gen 在 ST 里是「生成并等待」，这里等价于直接发送一条用户消息
        await api.send(step.args)
        sentThisRun = true
        break
      case 'trigger':
        if (sentThisRun) break
        await api.regenerateLast()
        break
      case 'setvar': {
        const [path, ...rest] = step.args.split(/\s+/)
        const rawValue = rest.join(' ')
        const value = /^-?\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : rawValue
        if (path) await api.setVar(path, value)
        break
      }
      default:
        // 不认识的命令丢弃，不炸整条脚本
        break
    }
  }
}
