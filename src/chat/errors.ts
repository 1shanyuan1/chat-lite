/**
 * 把网关返回的原始错误翻译成人能看懂的一句话。
 * 各家网关的报错格式不一，优先取 JSON 里的 message 字段。
 */
export function humanizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  const status = raw.match(/HTTP\s+(\d{3})/)?.[1]
  const jsonMessage = raw.match(/"message"\s*:\s*"([^"]+)"/)?.[1]

  if (jsonMessage) return jsonMessage

  switch (status) {
    case '400':
      return '请求被拒绝，检查模型名是否正确'
    case '401':
      return 'API Key 无效或已过期'
    case '403':
      return '没有权限访问该模型'
    case '404':
      return '接口地址不对，检查 Base URL 是否以 /v1 结尾'
    case '413':
      return '上下文太长，请新建会话'
    case '429':
      return '请求太频繁或额度不足'
  }

  if (status && status.startsWith('5')) return `服务端错误（${status}），稍后重试`

  if (/Failed to fetch|NetworkError|Network request failed|Load failed/i.test(raw)) {
    return '网络请求失败，检查网络连接'
  }
  if (/abort/i.test(raw)) return '已取消'

  return raw || '未知错误'
}
