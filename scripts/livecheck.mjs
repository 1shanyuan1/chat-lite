/**
 * 联网联调：真实打一次接口，验证 流式解析 / usage / 命中来源 / 上下文接续。
 * 用法：
 *   API_KEY=sk-xxx npm run livecheck
 *   API_KEY=sk-xxx BASE_URL=https://api.deepseek.com/v1 MODEL=deepseek-chat npm run livecheck
 * 不设 API_KEY 时脚本直接退出，不消耗额度。
 */

const apiKey = process.env.API_KEY
if (!apiKey) {
  console.log('跳过：未设置 API_KEY')
  process.exit(0)
}

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

const { initPlatform } = await import('@/platform')
const { initRepo } = await import('@/db/runtime')
const { useApp } = await import('@/chat/store')
const { activeVariant } = await import('@/db')
const { isCacheEstimated, hitRate, missTokens } = await import('@/chat/tokens')

await initPlatform()
await initRepo()
const st = () => useApp.getState()
await st().init()
st().saveConfig({
  baseUrl: process.env.BASE_URL ?? 'https://tokenrhythm.studio/v1',
  apiKey,
  model: process.env.MODEL ?? 'qwen3.8-flash',
  systemPrompt: process.env.SYSTEM_PROMPT ?? '回答尽量简短',
  protocol: 'auto',
})

let failed = 0
const ok = (condition, message) => {
  if (condition) console.log('  PASS ' + message)
  else {
    failed++
    console.log('  FAIL ' + message)
  }
}
const lastUsage = () => {
  const turns = st().turns
  return activeVariant(turns[turns.length - 1]).assistant?.usage
}

console.log(`\n服务商 ${st().config.baseUrl} · 模型 ${st().config.model}\n`)

const t0 = Date.now()
await st().send('记住数字 4271，只回复「好」')
const firstAt = Date.now() - t0
const first = activeVariant(st().turns[0]).assistant
ok(Boolean(first?.content), `首轮有回复（${firstAt}ms）→ "${first?.content?.slice(0, 24)}"`)

const u1 = first?.usage
ok(Boolean(u1 && u1.input > 0 && u1.output > 0), `首轮 usage：入 ${u1?.input} / 出 ${u1?.output}`)
ok(u1?.cacheRead === 0, '首轮不应有缓存命中')
console.log(`  命中来源：${isCacheEstimated(u1) ? '本地估算' : '接口返回'}`)

await st().send('刚才的数字是多少？只回答数字')
const u2 = lastUsage()
const answer = activeVariant(st().turns[st().turns.length - 1]).assistant?.content ?? ''
ok(/4271/.test(answer), `上下文接续正确 → "${answer.slice(0, 24)}"`)
ok(Boolean(u2 && u2.input > (u1?.input ?? 0)), `第二轮输入变大：${u1?.input} → ${u2?.input}`)
ok(u2?.cacheRead >= 0, `第二轮命中 ${u2?.cacheRead}（${isCacheEstimated(u2) ? '本地估算' : '接口返回'}）`)

if (u2 && u2.input > 0) {
  console.log(
    `  命中率 ${(hitRate(u2) * 100).toFixed(1)}% · 未命中 ${missTokens(u2)} token`
  )
}
if (u2?.cacheRead === 0 && !isCacheEstimated(u2)) {
  console.log('  提示：接口明确回报 0 命中，说明该模型/平台这次没走缓存（不是未提供数据）')
}
if (isCacheEstimated(u2 ?? {})) {
  console.log('  提示：接口未返回缓存字段，此处为本地按前缀推算')
}

console.log('\n' + '-'.repeat(48))
console.log(failed === 0 ? '联调通过' : `联调失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
