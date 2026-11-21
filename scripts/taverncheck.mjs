/**
 * 酒馆模式联调：把一张角色卡从头玩一遍，验证导入 → 开场白 → 多轮对话是否真的成立。
 *
 * 用法：
 *   CARD=path/to/card.json API_KEY=sk-xxx npm run taverncheck
 *   BASE_URL=https://api.siliconflow.cn/v1 MODEL=deepseek-ai/DeepSeek-V4.1-Flash 可覆盖
 *
 * 检查点：
 *   1. 卡片能被 normalizeCard 认出来，字段落到 SettingDoc 上
 *   2. 开场白被 pickGreeting 选中，且 {{char}} / {{user}} 已替换
 *   3. 实际发出的 system prompt 里有角色设定，且不含未替换的宏
 *   4. 连续三轮不报错，回复里不出现 {{char}} 这类占位符
 *   5. 第二轮能接住第一轮的内容（上下文确实带上了）
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
const { settingFromCard, renderSetting, greetingsOf } = await import('@/chat/settings')
const { activeVariant } = await import('@/db')

await initPlatform()
await initRepo()
const st = () => useApp.getState()
await st().init()

const baseUrl = process.env.BASE_URL ?? 'https://api.siliconflow.cn/v1'
const modelId = process.env.MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash'
const userName = '小林'

st().saveConfig({
  baseUrl,
  apiKey,
  model: modelId,
  protocol: 'auto',
  packId: 'tavern',
  userName,
  temperature: 0.85,
  maxTokens: 600,
  longMemory: false,
})

/* ---------------- 1. 导入 ---------------- */
const raw = JSON.parse(fs.readFileSync(cardPath, 'utf8'))
const card = normalizeCard(raw)
const doc = settingFromCard(card)
st().importSetting(doc)

const data = raw.data ?? raw
const pad = (s, n = 46) => String(s).padEnd(n)
const line = (k, v) => console.log(`  ${pad(k)}${v}`)

console.log('\n=== 1. 导入 ===')
line('名字', doc.name)
line('设定正文', `${doc.body.length} 字`)
line('世界书条目', `${doc.entries.length} 条`)
line('开场白', doc.firstMessage ? `${doc.firstMessage.length} 字` : '（无）')
line('头像', doc.avatar ? '有' : '无')
line('原卡 avatar', data.avatar ? String(data.avatar).slice(0, 40) + '…' : '（无）')
line('备选开场', `${(data.alternate_greetings ?? []).length} 个`)
line('system_prompt', data.system_prompt ? '有' : '（空）')
line('post_history', data.post_history_instructions ? '有' : '（空）')

// 设定块的原文，用来核对宏替换
const block = renderSetting(doc, userName)
console.log('\n--- 注入的设定块（前 400 字）---')
console.log(block.slice(0, 400))

/* ---------------- 2. 开场白 ---------------- */
console.log('\n=== 2. 开场 ===')
await st().startWithSettings([doc.id])
const first = st().turns[0]
const greeting = first ? activeVariant(first).assistant?.content ?? '' : ''
console.log(greeting.slice(0, 300))
line('\n开场白已替换宏', greeting.includes('{{') ? `否（仍有 ${greeting.match(/\{\{\w+\}\}/g)?.join(', ')}）` : '是')
line('会话已建立', st().currentId ? '是' : '否')
line('当前 packId', st().config.packId)

// 换开场：切到第 2 段再切回第 1 段
const allGreetings = greetingsOf(doc, userName)
line('全部开场', `${allGreetings.length} 段`)
let greetingSwitchOk = true
if (allGreetings.length > 1) {
  const turnId = st().turns[0].id
  await st().switchGreeting(turnId, 1)
  const second = activeVariant(st().turns[0]).assistant?.content ?? ''
  console.log('\n--- 换到第 2 段 ---')
  console.log(second.slice(0, 200))
  greetingSwitchOk = second === allGreetings[1]
  line('切换结果', greetingSwitchOk ? '与列表一致' : '不一致（有问题）')
  // 切回第 1 段，后面继续正常对话
  await st().switchGreeting(turnId, 0)
}

/* ---------------- 3. 真实对话 ---------------- */
// 抓一次真实请求体，确认 system 里确实带上了设定
let captured = null
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  if (!captured && init?.body) {
    try {
      captured = JSON.parse(String(init.body))
    } catch {
      /* 忽略 */
    }
  }
  return realFetch(input, init)
}

const lines = [
  '（她好像有点担心我，我该说点什么让她放心？）今天在学校一切都好，就是有点想你。',
  '你还记得我刚才说学校怎么样了吗？说一句话就好。',
  '那你现在会怎么称呼我？用你平时叫我的方式。',
]

console.log('\n=== 3. 对话 ===')
const replies = []
const inputs = []
for (const [i, text] of lines.entries()) {
  const before = Date.now()
  await st().send(text)
  const ms = Date.now() - before
  const last = st().turns[st().turns.length - 1]
  const reply = last ? activeVariant(last).assistant?.content ?? '' : ''
  replies.push(reply)
  const usage = last ? activeVariant(last).assistant?.usage : null
  if (usage) inputs.push(usage.input)
  console.log(`\n--- 第 ${i + 1} 轮（${ms}ms${usage ? `，入 ${usage.input} 出 ${usage.output}` : ''}）---`)
  console.log(reply.slice(0, 500))
}

globalThis.fetch = realFetch

/* ---------------- 4. 断言 ---------------- */
console.log('\n=== 4. 检查 ===')
const problems = []

if (!st().currentId) problems.push('会话没建立')
if (!greeting) problems.push('开场白为空')
if (!greetingSwitchOk) problems.push('换开场没生效')
if (allGreetings.length <= 1 && (data.alternate_greetings ?? []).length > 0) {
  problems.push(`原卡有 ${data.alternate_greetings.length} 个备选开场，但只导入到 ${allGreetings.length} 段`)
}
if (/\{\{(char|user)\}\}/i.test(greeting)) problems.push('开场白里有未替换的宏')

if (captured) {
  const sys = String(captured.system ?? captured.messages?.find?.((m) => m.role === 'system')?.content ?? '')
  line('请求里的 system', `${sys.length} 字`)
  line('含角色设定', sys.includes(doc.name) ? '是' : '否')
  line('含未替换宏', /\{\{(char|user)\}\}/i.test(sys) ? '是（有问题）' : '否')
  line('消息条数', String(captured.messages?.length ?? 0))
  if (!sys.includes(doc.name)) problems.push('system 里没有角色名')
  if (/\{\{(char|user)\}\}/i.test(sys)) problems.push('system 里有未替换的宏')
} else {
  problems.push('没抓到请求体')
}

const joined = replies.join('\n')
if (/\{\{(char|user)\}\}/i.test(joined)) problems.push('回复里有未替换的宏')
if (replies.some((r) => !r.trim())) problems.push('有空的回复')
if (st().error) problems.push(`store 报错：${st().error}`)

// 上下文是否真的带上了：第三轮输入 token 必须比第一轮多
// （角色卡是英文的，用关键词判断会误报——第一版就栽在这）
if (inputs.length >= 2 && !(inputs[inputs.length - 1] > inputs[0])) {
  problems.push(`输入 token 没有增长（${inputs.join(' → ')}），历史可能没带上`)
}
line('各轮输入 token', inputs.join(' → '))

// 接住上文的软检查：中英文都认，认不出只提示不判失败
if (replies[1] && !/school|学校|上课|lonely|miss|想我/i.test(replies[1])) {
  console.log('  注意：第二轮没有明显的承接词，需人工确认')
}

console.log('\n' + '-'.repeat(48))
if (problems.length === 0) {
  console.log('酒馆模式全流程正常')
} else {
  console.log(`发现 ${problems.length} 个问题：`)
  for (const p of problems) console.log(`  · ${p}`)
}
process.exit(problems.length === 0 ? 0 : 1)
