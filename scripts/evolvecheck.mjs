/**
 * 设定发展模式联调：写作时 AI 会不会自己把新设定补进副本。
 *
 * 用法：API_KEY=sk-xxx npm run evolvecheck
 *
 * 检查点：发展稿是否创建、AI 有没有调 update_setting、副本是否真的变了、
 * changelog 有没有记、原卡是否没被动过。
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
const { settingFromText } = await import('@/chat/settings')
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
  packId: 'writing',
  settingEvolution: true,
  temperature: 0.9,
  maxTokens: 500,
})

const original = settingFromText(
  '雾港',
  [
    '故事发生在雾港，一座常年被海雾笼罩的港口城市。',
    '主角是守灯人陆行舟，独自住在北岬灯塔。',
    '城里只有一条主街，叫铁锚街。',
  ].join('\n')
)
st().importSetting(original)

// 抓请求体，确认工具和说明真的发出去了
let lastReq = null
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  try {
    lastReq = JSON.parse(String(init.body))
  } catch {
    /* 忽略 */
  }
  return realFetch(input, init)
}

console.log('=== 1. 开新会话（应自动生成发展稿） ===')
await st().startWithSettings([original.id])
const session = st().sessions.find((s) => s.id === st().currentId)
const attachedId = session?.settingIds?.[0]
const attached = st().settings.find((d) => d.id === attachedId)
console.log('挂载的是        ', attached?.name)
console.log('指向原卡        ', attached?.derivedFrom === original.id ? '是' : '否')
console.log('原卡未被替换    ', attachedId !== original.id ? '是' : '否')

console.log('\n=== 2. 写一段，故意引入新设定 ===')
await st().send(
  '接着写：陆行舟在灯塔下捡到一个昏迷的女孩，她手腕上有一枚刻着"潮汐会"三个字的铜牌。他把她抱回塔里，发现她醒来后不记得自己是谁，只说得出"第七号浮标"这个词。'
)
const reply = activeVariant(st().turns[st().turns.length - 1]).assistant?.content ?? ''
console.log(reply.replace(/\s+/g, ' ').slice(0, 260))

console.log('\n--- 请求核对 ---')
const sys = lastReq?.system ?? lastReq?.messages?.find((m) => m.role === 'system')?.content ?? ''
console.log('工具          ', (lastReq?.tools ?? []).map((t) => t.function?.name ?? t.name).join(', ') || '（无）')
console.log('system 含说明 ', String(sys).includes('设定发展') ? '是' : '否')
console.log('system 含条目 ', String(sys).includes('当前设定条目') ? '是' : '否')

console.log('\n=== 3. 检查副本 ===')
const evolved = st().settings.find((d) => d.id === attachedId)
console.log('正文长度        ', evolved?.body.length, '（原', original.body.length, '）')
console.log('条目数          ', evolved?.entries.length)
console.log('变更次数        ', evolved?.changelog?.length ?? 0)
for (const item of evolved?.changelog ?? []) {
  console.log(`  第 ${item.turn + 1} 轮 · ${item.note}`)
  for (const c of item.changes) console.log(`    - ${c}`)
}
console.log('\n--- 副本正文 ---')
console.log(evolved?.body)
console.log('\n--- 副本条目 ---')
for (const e of evolved?.entries ?? []) console.log(`[${e.keys.join(',')}] ${e.content}`)

const problems = []
if (!attached?.derivedFrom) problems.push('没有创建发展稿')
if (attachedId === original.id) problems.push('会话挂的还是原卡')
if (!evolved?.changelog?.length) problems.push('AI 一次都没调用 update_setting')
if (evolved?.body === original.body && evolved?.entries.length === original.entries.length)
  problems.push('副本内容和原卡一样，等于没改')
const mentioned = /潮汐会|浮标|女孩/.test(evolved?.body ?? '') || (evolved?.entries ?? []).some((e) => /潮汐会|浮标/.test(e.content))
if (!mentioned) problems.push('正文里出现的新设定没被记进副本')
if (original.body !== st().settings.find((d) => d.id === original.id)?.body) problems.push('原卡被改动了')

console.log('\n' + '-'.repeat(48))
if (problems.length === 0) console.log('设定发展模式生效')
else {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log(`  · ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)
