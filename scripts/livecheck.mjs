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

/** 可选：设 EFFORT=low|medium|high|off 时额外验证思考档位 */
const effort = process.env.EFFORT || ''

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
const baseUrl = process.env.BASE_URL ?? 'https://tokenrhythm.studio/v1'
const modelId = process.env.MODEL ?? 'qwen3.8-flash'

st().saveConfig({
  baseUrl,
  apiKey,
  model: modelId,
  systemPrompt: process.env.SYSTEM_PROMPT ?? '回答尽量简短',
  protocol: 'auto',
  ...(effort ? { reasoningLevel: effort } : {}),
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

if (effort) {
  const { reasoningPayload, pickAdapter } = await import('@/chat/reasoning')
  const adapter = pickAdapter('openai', baseUrl, modelId)
  console.log(`\n思考档位 ${effort} · 方言 ${adapter.id}`)
  console.log(`  将发送 ${JSON.stringify(reasoningPayload('openai', effort, { baseUrl, modelId }))}`)

  await st().send('鸡兔同笼：共 35 个头、94 只脚，鸡和兔各几只？只回答数字')
  const last = activeVariant(st().turns[st().turns.length - 1]).assistant
  ok(Boolean(last?.content), '带档位的请求成功')
  console.log(`  思考内容：${last?.reasoning ? `${last.reasoning.length} 字` : '（接口未返回）'}`)
  if (effort === 'off') ok(!last?.reasoning, '关闭后确实不再思考')
  else ok(Boolean(last?.reasoning), '接口返回了思考内容')
}

if (process.env.SEARCH) {
  const { resolveSearchKey, resolveSearchMode, resolveSearchSource } = await import('@/chat/web-search')
  if (process.env.SEARCH_SOURCE) st().saveConfig({ searchSource: process.env.SEARCH_SOURCE })
  st().saveConfig({ searchMode: process.env.SEARCH_MODE || 'local' })
  const source = resolveSearchSource(st().config)
  console.log(
    `\n联网搜索 · 模式 ${resolveSearchMode(st().config)} · 源 ${source.label} · key ${resolveSearchKey(st().config) ? '有' : '无'}`
  )

  await st().send('DeepSeek V4.1 Flash 是哪天发布的？只回答日期，并给出处')
  const last = activeVariant(st().turns[st().turns.length - 1]).assistant
  const calls = last?.toolCalls ?? []
  const sources = calls.flatMap((call) => call.sources ?? [])
  ok(calls.length > 0, `模型调用了 web_search（${calls.length} 次）`)
  ok(sources.length > 0, `拿到 ${sources.length} 条来源`)
  ok(Boolean(last?.content), '最终回答有内容')
  if (last?.content) console.log(`  回答：${last.content.replace(/\s+/g, ' ').slice(0, 120)}`)
  if (sources[0]) console.log(`  首条来源：${sources[0].title ?? sources[0].url}`)
  if (calls[0]?.result) console.log(`  工具输出：${calls[0].result.replace(/\s+/g, ' ').slice(0, 260)}`)
  if (calls[0]?.error) console.log(`  工具报错：${calls[0].error}`)
}

if (process.env.VISION) {
  const fs = await import('node:fs')
  const file = process.env.VISION_FILE || 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'
  const bytes = fs.readFileSync(file)
  const attachment = {
    id: 'v1',
    kind: 'image',
    name: file.split('/').pop(),
    mime: 'image/png',
    size: bytes.length,
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
  }

  st().saveConfig({
    visionModel: { enabled: true, baseUrl, model: process.env.VISION_MODEL || modelId },
  })

  const { describeAttachments } = await import('@/chat/vision')
  console.log(`\n辅助识图 · ${attachment.name} · ${(bytes.length / 1024).toFixed(1)} KB`)
  const out = await describeAttachments([attachment], st().config, (msg) => console.log(`  ${msg}`))
  const description = out[0]?.description ?? ''
  ok(Boolean(description) && !description.startsWith('（'), '识图返回了描述')
  console.log(`  描述：${description.replace(/\s+/g, ' ').slice(0, 160)}`)
}

console.log('\n' + '-'.repeat(48))
console.log(failed === 0 ? '联调通过' : `联调失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
