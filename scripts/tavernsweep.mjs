/**
 * 多卡巡检：一次跑若干张角色卡，检查导入 → 开场 → 两轮对话是否都成立。
 *
 * 用法：
 *   API_KEY=sk-xxx npm run tavernsweep
 *   默认跑 .cache/cards 下的卡；也可以用 CARDS=a.json,b.png 指定。
 *
 * 与 taverncheck 的区别：这个不追求把一张卡玩深，而是横向铺开，
 * 看不同来源（chub JSON / SillyTavern PNG / V3）的卡在解析和注入上有没有漏。
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

const fs = await import('node:fs')
const { initPlatform } = await import('@/platform')
const { initRepo } = await import('@/db/runtime')
const { useApp } = await import('@/chat/store')
const { normalizeCard, extractCardFromPng } = await import('@/chat/characters')
const { settingFromCard, greetingsOf, collectEntries } = await import('@/chat/settings')
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
  persona: '我是一名安卓开发者，正在做聊天客户端，说话直接，不喜欢铺垫。',
  temperature: 0.85,
  maxTokens: 450,
  longMemory: false,
})

const dir = 'D:/chat-lite/.cache/cards'
const files = process.env.CARDS
  ? process.env.CARDS.split(',').map((f) => f.trim()).filter(Boolean)
  : ['haena.json', 'seraphina.png', 'v3-probe.json'].map((f) => `${dir}/${f}`)

/** 从文件里读出卡片原始对象：PNG 走内嵌块，JSON 直接解析 */
function readCard(path) {
  const buf = fs.readFileSync(path)
  if (path.toLowerCase().endsWith('.png')) {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const raw = extractCardFromPng(ab)
    if (!raw) throw new Error('PNG 里没有角色卡')
    return raw
  }
  return JSON.parse(buf.toString('utf8'))
}

// 抓每次请求体：system 用来核对注入，messages 用来核对后置指令
let lastSystem = ''
let lastTailSystem = ''
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  if (init?.body) {
    try {
      const body = JSON.parse(String(init.body))
      const sys = body.system ?? body.messages?.find?.((m) => m.role === 'system')?.content
      if (typeof sys === 'string') lastSystem = sys
      const msgs = Array.isArray(body.messages) ? body.messages : []
      // 末尾的 system 就是 post_history（OpenAI 协议下不会并进顶层 system）
      const tail = [...msgs].reverse().find((m) => m.role === 'system')
      lastTailSystem = typeof tail?.content === 'string' ? tail.content : ''
    } catch {
      /* 忽略 */
    }
  }
  return realFetch(input, init)
}

const results = []
const imported = []

for (const path of files) {
  const name = path.split('/').pop()
  console.log(`\n${'='.repeat(56)}\n${name}\n${'='.repeat(56)}`)
  const row = { name, problems: [], notes: [] }

  try {
    const raw = readCard(path)
    const data = raw.data ?? raw
    const card = normalizeCard(raw)
    const doc = settingFromCard(card)
    st().importSetting(doc)
    imported.push({ doc, card })

    row.name = `${card.name}（${path.endsWith('.png') ? 'PNG' : raw.spec?.replace('chara_card_', '') ?? 'JSON'}）`
    console.log(`名字      ${card.name}`)
    console.log(`正文      ${doc.body.length} 字`)
    console.log(`世界书    ${doc.entries.length} 条${doc.entries.length ? `（keys: ${doc.entries.flatMap((e) => e.keys).slice(0, 6).join('/')}）` : ''}`)
    console.log(`开场      ${doc.firstMessage ? `${doc.firstMessage.length} 字` : '（无）'}`)
    console.log(`备选开场  ${(doc.greetings ?? []).length} 段`)
    console.log(`system    ${data.system_prompt ? `${data.system_prompt.length} 字` : '（空）'}`)
    console.log(`post_hist ${data.post_history_instructions ? `${data.post_history_instructions.length} 字` : '（空）'}`)

    if (!doc.body.trim()) row.problems.push('设定正文为空')

    await st().startWithSettings([doc.id])
    const list = greetingsOf(doc, userName)
    const greeting = activeVariant(st().turns[0]).assistant?.content ?? ''
    console.log(`开场白    ${greeting.replace(/\s+/g, ' ').slice(0, 80)}…`)
    if (!greeting) row.problems.push('开场白为空')
    if (/\{\{(char|user)\}\}/i.test(greeting)) row.problems.push('开场白有未替换宏')

    // 多段开场时切一次再切回来
    if (list.length > 1) {
      await st().switchGreeting(st().turns[0].id, 1)
      const second = activeVariant(st().turns[0]).assistant?.content ?? ''
      const okSwitch = second === list[1]
      console.log(`换开场    ${okSwitch ? '成功' : '失败'}`)
      if (!okSwitch) row.problems.push('换开场没生效')
      await st().switchGreeting(st().turns[0].id, 0)
    }

    // 第一句把每条世界书的主关键词都带上，一次把匹配、排序、预算全走一遍
    const probeKeys = doc.entries.map((e) => e.keys[0]).filter(Boolean)
    const turns = [
      probeKeys.length > 0
        ? `我这边遇到点情况，${probeKeys.join('、')} 这些你都知道吧？跟我说说。`
        : '你在做什么？',
      '用一句话总结我们现在的情况。',
    ]
    // 有二级关键词的条目，补一轮把两个键都带上，验证 AND 逻辑
    const andEntry = doc.entries.find((e) => e.secondaryKeys?.length)
    if (andEntry) turns.push(`那 ${andEntry.keys[0]} 安排在 ${andEntry.secondaryKeys[0]} 行不行？`)

    const replies = []
    for (const [i, text] of turns.entries()) {
      await st().send(text)
      const last = st().turns[st().turns.length - 1]
      const reply = activeVariant(last).assistant?.content ?? ''
      const usage = activeVariant(last).assistant?.usage
      console.log(`\n--- 第 ${i + 1} 轮（入 ${usage?.input ?? '?'} 出 ${usage?.output ?? '?'}）---`)
      replies.push(reply)
      console.log(reply.replace(/\s+/g, ' ').slice(0, 220))
      if (!reply.trim()) row.problems.push(`第 ${i + 1} 轮回复为空`)
      if (/\{\{(char|user)\}\}/i.test(reply)) row.problems.push(`第 ${i + 1} 轮回复有未替换宏`)
    }

    // system 注入核对
    if (!lastSystem.includes(card.name)) row.problems.push('system 里没有角色名')
    if (!lastSystem.includes('安卓开发者')) row.problems.push('我的设定没进 system')
    const injectedCount = activeVariant(st().turns[st().turns.length - 1]).assistant?.worldEntries?.length ?? 0
    console.log(`本轮注入条目  ${injectedCount} 条`)
    if (/\{\{(char|user)\}\}/i.test(lastSystem)) row.problems.push('system 里有未替换宏')
    if (probeKeys.length > 0) {
      // 要比对替换过宏的条目——原卡里写的是 {{user}}/{{char}}，system 里已经是真名
      const expanded = collectEntries([doc], userName)
      const hit = expanded.filter(
        (e) => e.keys.some((k) => probeKeys.includes(k)) && lastSystem.includes(e.content.slice(0, 24))
      ).length
      console.log(`\n世界书触发  ${hit} 条已注入`)
      if (hit === 0) row.problems.push('关键词没触发任何世界书条目')
    }

    // 二级关键词：AND 逻辑端到端
    if (andEntry) {
      const tail = activeVariant(st().turns[st().turns.length - 1]).assistant?.worldEntries ?? []
      const fired = tail.some((t) => t.includes(andEntry.content.slice(0, 12)))
      console.log(`二级关键词  ${fired ? '两键齐全后触发' : '未触发'}`)
      if (!fired) row.problems.push('secondary_keys 的 AND 逻辑没生效')
    }
    if (data.system_prompt) {
      const inSystem = lastSystem.includes(data.system_prompt.slice(0, 12))
      console.log(`system_prompt  ${inSystem ? '已注入' : '未注入'}`)
      if (!inSystem) row.problems.push('卡自带 system_prompt 没进 system')
    }
    if (data.post_history_instructions) {
      const probe = data.post_history_instructions.slice(0, 10)
      const injected = lastTailSystem.includes(probe) || lastSystem.includes(probe)
      console.log(`post_history   ${injected ? '已注入（消息末尾）' : '未注入'}`)
      if (!injected) row.problems.push('post_history_instructions 没注入')
      // 追加指令要求「每次回答结尾加【PHI 已生效】」，看模型有没有照做
      const obeyed = replies.join('').includes('PHI 已生效')
      console.log(`后置指令生效   ${obeyed ? '是' : '否（模型没照做，不一定是 bug）'}`)
      if (!obeyed) row.notes.push('后置指令已发送但模型未遵守')
    }
    row.ok = row.problems.length === 0
  } catch (e) {
    row.ok = false
    row.problems.push(`异常：${e.message}`)
    console.log('异常：', e.message)
  }

  if (st().error) row.problems.push(`store 报错：${st().error}`)
  results.push(row)
}

/* ---------------- 群聊：两张卡同场 ---------------- */
if (imported.length >= 2) {
  console.log(`\n${'='.repeat(56)}\n群聊（${imported[0].card.name} + ${imported[1].card.name}）\n${'='.repeat(56)}`)
  const groupRow = { name: '群聊', problems: [], notes: [] }
  try {
    await st().startWithSettings([imported[0].doc.id, imported[1].doc.id])
    const opener = activeVariant(st().turns[0]).assistant?.content ?? ''
    console.log(`开场      ${opener.replace(/\s+/g, ' ').slice(0, 140)}…`)
    const bothNamed = opener.includes(imported[0].card.name) && opener.includes(imported[1].card.name)
    console.log(`两角色都出场  ${bothNamed ? '是' : '否'}`)
    if (!bothNamed) groupRow.problems.push('群聊开场没有同时出现两个角色')

    await st().send('你们俩都在啊，我有点事想问问。')
    const reply = activeVariant(st().turns[st().turns.length - 1]).assistant?.content ?? ''
    console.log(`\n--- 回复 ---\n${reply.replace(/\s+/g, ' ').slice(0, 240)}`)

    if (!lastSystem.includes('场上角色')) groupRow.problems.push('群戏提示没进 system')
    if (!reply.trim()) groupRow.problems.push('群聊回复为空')
    if (/\{\{(char|user)\}\}/i.test(reply)) groupRow.problems.push('群聊回复有未替换宏')
    const spoke = imported.some(({ card }) => reply.includes(card.name))
    console.log(`\n点名单个角色  ${spoke ? '是' : '否（可能没用名字开头）'}`)
    if (!spoke) groupRow.notes.push('回复里没有出现角色名，可能没用「名字：」格式')
    groupRow.ok = groupRow.problems.length === 0
  } catch (e) {
    groupRow.ok = false
    groupRow.problems.push(`异常：${e.message}`)
  }
  results.push(groupRow)
}

globalThis.fetch = realFetch

console.log(`\n${'='.repeat(56)}\n汇总\n${'='.repeat(56)}`)
for (const r of results) {
  console.log(`${r.ok ? '通过' : '失败'}  ${r.name}`)
  for (const p of r.problems) console.log(`      · ${p}`)
  for (const n of r.notes) console.log(`      - ${n}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length} 张卡，通过 ${results.length - failed.length}，失败 ${failed.length}`)
process.exit(failed.length === 0 ? 0 : 1)
