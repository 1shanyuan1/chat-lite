/**
 * 压缩续接的连续性测试：验证「手动压缩 + 开新对话」之后，新会话能不能接上。
 *
 * 用法：CARD=路径 API_KEY=sk-xxx npm run continuitycheck
 *
 * 思路：在第 1 轮埋一个细节（手腕受伤），压缩掉它，再在新会话里问起——
 * 如果摘要真的接上了，模型应该还记得。同时检查角色卡、世界书、提示词是否继承。
 */
const apiKey = process.env.API_KEY
if (!apiKey) {
  console.log('跳过：未设置 API_KEY')
  process.exit(0)
}
const cardPath = process.env.CARD
if (!cardPath) {
  console.log('跳过：未设置 CARD')
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

const fs = await import('node:fs')
const { initPlatform } = await import('@/platform')
const { initRepo } = await import('@/db/runtime')
const { useApp } = await import('@/chat/store')
const { normalizeCard } = await import('@/chat/characters')
const { settingFromCard } = await import('@/chat/settings')
const { activeVariant } = await import('@/db')

await initPlatform()
await initRepo()
const st = () => useApp.getState()
await st().init()

st().saveConfig({
  baseUrl: process.env.BASE_URL ?? 'https://api.siliconflow.cn/v1',
  apiKey,
  model: process.env.MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash',
  protocol: 'auto',
  packId: 'tavern',
  userName: '小林',
  persona: '我是一名安卓开发者，左手腕最近扭伤了。',
  temperature: 0.8,
  maxTokens: 400,
})

const card = normalizeCard(JSON.parse(fs.readFileSync(cardPath, 'utf8')))
const doc = settingFromCard(card)
st().importSetting(doc)

console.log('=== 1. 建立上下文 ===')
await st().startWithSettings([doc.id])
const before = st().currentId
const turns = [
  '我左手腕扭伤了，这几天不能提重物，你帮我记着。',
  '日志在哪个目录？',
  '部署要注意什么？',
  '还有别的吗？',
]
for (const [i, text] of turns.entries()) {
  await st().send(text)
  const last = st().turns[st().turns.length - 1]
  console.log(`第 ${i + 1} 轮：${(activeVariant(last).assistant?.content ?? '').replace(/\s+/g, ' ').slice(0, 90)}`)
}

console.log('\n=== 2. 压缩（保留最近两轮） ===')
const from = st().turns[Math.max(0, st().turns.length - 2)]
await st().branchFrom(from.id, { compress: true })

const after = st().currentId
const session = st().sessions.find((s) => s.id === after)
console.log('新会话标题     ', session?.title)
console.log('角色卡继承     ', session?.settingIds?.[0] === doc.id ? '是' : `否（${session?.settingIds}）`)
console.log('packId 继承   ', session?.packId)
console.log('原文轮数       ', st().turns.length)
console.log('\n--- 摘要 ---')
console.log(session?.recap ?? '（没有摘要）')

console.log('\n=== 3. 新会话里追问旧细节 ===')
await st().send('我刚才说我身上哪里不方便来着？')
const reply = activeVariant(st().turns[st().turns.length - 1]).assistant?.content ?? ''
console.log(reply.replace(/\s+/g, ' ').slice(0, 300))

const problems = []
if (!session?.recap) problems.push('没有生成摘要')
if (session?.settingIds?.[0] !== doc.id) problems.push('角色卡没继承')
if (session?.packId !== 'tavern') problems.push('packId 没继承')
if (before === after) problems.push('没有创建新会话')
if (!/手腕|手|伤/i.test(reply)) problems.push('新会话没记住「手腕受伤」这个细节')
if (!/手腕|伤/i.test(session?.recap ?? '')) problems.push('摘要里没写「手腕受伤」')

console.log('\n' + '-'.repeat(48))
if (problems.length === 0) console.log('压缩续接接得上')
else {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log(`  · ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)
