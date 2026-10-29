/**
 * 离线自检：只跑纯逻辑（存储、搜索、命中定位、用量换算、导出），不发起任何网络请求。
 * 用法：npm run selfcheck
 */

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

const { createLocalRepo, newId, activeVariant } = await import('@/db')
const { matchSessions, snippetOf } = await import('@/chat/session-search')
const { findTurnHits, hitElementId } = await import('@/chat/hit-nav')
const {
  estimateTokens,
  mergeUsage,
  sumUsage,
  hitRate,
  missTokens,
  emptyUsage,
  estimateCacheHit,
  isCacheEstimated,
  readOpenAIUsage,
  readAnthropicUsage,
  readGeminiUsage,
} = await import('@/chat/tokens')
const { sessionToMarkdown, exportFilename } = await import('@/chat/export')
const { BUILTIN_PACKS, DEFAULT_PACK_ID, findPack, renderTemplate, composeSystemPrompt } = await import('@/chat/packs')
const { normalizeCard, applyMacros, renderCard, extractCardFromPng } = await import('@/chat/characters')
const { matchWorldEntries, renderWorldEntries, contextWindow } = await import('@/chat/lore')
const { detectKind, toWorldItem, toPresetItem, toPromptItem, VAULT_KINDS } = await import('@/chat/vault')
const { settingFromCard, settingFromWorld, settingFromText, renderSettings, collectEntries, pickGreeting } = await import('@/chat/settings')

let passed = 0
let failed = 0
const ok = (condition, message) => {
  if (condition) {
    passed++
    console.log('  PASS ' + message)
  } else {
    failed++
    console.log('  FAIL ' + message)
  }
}
const section = (name) => console.log('\n' + name)

/* ---------------- 存储与搜索 ---------------- */
section('存储 / 搜索')

const repo = createLocalRepo()
const rust = await repo.createSession('Rust 部署优化')
const trip = await repo.createSession('周末去哪玩')

const t1 = {
  id: newId(),
  sessionId: rust.id,
  idx: 0,
  active: 0,
  createdAt: 1,
  variants: [{ user: { content: '镜像构建太慢怎么办' }, assistant: { content: '用多阶段构建，把依赖层缓存起来' } }],
}
const t2 = {
  id: newId(),
  sessionId: rust.id,
  idx: 1,
  active: 0,
  createdAt: 2,
  variants: [{ user: { content: '那部署日志呢' }, assistant: { content: '先看镜像层耗时' } }],
}
const t3 = {
  id: newId(),
  sessionId: trip.id,
  idx: 0,
  active: 0,
  createdAt: 3,
  variants: [{ user: { content: '推荐几个适合带孩子的公园' }, assistant: { content: '朝阳公园不错' } }],
}
for (const turn of [t1, t2, t3]) await repo.appendTurn(turn)

const sessions = await repo.listSessions()
ok(sessions.length === 2, `两个会话已保存（${sessions.length}）`)
ok((await repo.listTurns(rust.id)).length === 2, '轮次按 idx 读取正确')

const hitsImage = await repo.search('镜像')
ok(hitsImage.length === 2, `内容搜索命中 2 条消息（${hitsImage.length}）`)
ok(hitsImage.every((h) => h.field === 'user' || h.field === 'assistant'), '每条命中都带消息字段标记')
ok(hitsImage.some((h) => h.field === 'user') && hitsImage.some((h) => h.field === 'assistant'), '用户与助手两侧都能命中')
ok((await repo.search('镜像不存在')).length === 0, '无结果返回空')
ok((await repo.search('   ')).length === 0, '空查询返回空')

const merged = matchSessions(sessions, hitsImage, '镜像')
ok(merged.byContent.length === 1 && merged.byContent[0].session.id === rust.id, '内容命中归到正确会话')
ok(!merged.byContent[0].snippet?.includes('\n'), '片段压平成单行')

const titleMerged = matchSessions(sessions, [], '周末')
ok(titleMerged.byTitle.length === 1 && titleMerged.byTitle[0].id === trip.id, '标题搜索独立生效')

const bothMerged = matchSessions(sessions, hitsImage, '部署')
ok(bothMerged.byTitle.length === 1, '标题还命中「Rust 部署优化」')
ok(bothMerged.byContent.every((x) => x.session.id !== rust.id), '同一个会话不在两个区里重复出现')

ok(snippetOf('x'.repeat(50) + '关键' + 'y'.repeat(50), '关键', 5).startsWith('…'), '长文本片段带前置省略号')
ok(!snippetOf('没命中', 'zzz').includes('…'), '未命中不带省略号')

/* ---------------- 命中定位 ---------------- */
section('命中定位 / 浏览')

const turns = await repo.listTurns(rust.id)
const navHits = findTurnHits(turns, '镜像')
ok(navHits.length === hitsImage.filter((h) => h.sessionId === rust.id).length, '搜索计数与定位计数一致')
ok(navHits.every((h) => h.turnId && (h.field === 'user' || h.field === 'assistant')), '每个定位点都有轮次与字段')
ok(findTurnHits(turns, '镜像')[0].turnId === t1.id, '按轮次顺序返回')
ok(findTurnHits(turns, '  ').length === 0, '空查询无定位点')
ok(findTurnHits(turns, '镜像').length === findTurnHits(turns, '  镜像  ').length, '忽略首尾空格')
ok(hitElementId(navHits[0]) === `hit-${navHits[0].turnId}-${navHits[0].field}`, 'DOM id 生成规则稳定')

const dupTurn = {
  id: 'dup',
  sessionId: 's',
  idx: 0,
  active: 0,
  createdAt: 1,
  variants: [{ user: { content: '镜像镜像镜像' }, assistant: { content: 'x' } }],
}
ok(findTurnHits([dupTurn], '镜像').length === 1, '同一条消息多次出现只算一个定位点')

/* ---------------- 版本与索引 ---------------- */
section('版本 / 索引')

const withVariant = {
  ...t3,
  variants: [...t3.variants, { user: { content: '那海边呢' }, assistant: { content: '北戴河' } }],
  active: 0,
}
await repo.updateTurn(withVariant)
ok((await repo.search('海边')).length === 0, '非激活版本内容不参与检索')

await repo.updateTurn({ ...withVariant, active: 1 })
const afterSwitch = await repo.search('海边')
ok(afterSwitch.length === 1, '切换激活版本后旧版本内容退出、新版本进入索引')
ok(findTurnHits(await repo.listTurns(trip.id), '海边').length === afterSwitch.length, '切换后定位计数同步')
ok(activeVariant(withVariant).user.content === '推荐几个适合带孩子的公园', 'activeVariant 返回激活版本')

/* ---------------- 用量换算 ---------------- */
section('用量换算')

const u = mergeUsage(emptyUsage(), { input: 100, output: 20, cacheRead: 40 })
ok(u.input === 100 && u.cacheRead === 40, '合并 usage')
ok(missTokens(u) === 60, `未命中 = 输入 - 命中（${missTokens(u)}）`)
ok(Math.abs(hitRate(u) - 0.4) < 1e-9, '命中率 = 命中 / 输入')
ok(mergeUsage(u, { input: 300, output: 50, cacheRead: 120 }).input === 300, '多帧 usage 取较大值')
ok(mergeUsage(u, { input: 10 }).input === 100, '后续帧不会把已有数值改小')

const total = sumUsage([u, { input: 50, output: 10, cacheRead: 0 }])
ok(total.input === 150 && total.output === 30, '汇总多轮用量')

ok(estimateTokens('') === 0, '空文本估算为 0')
ok(estimateTokens('这是一段中文') === Math.max(1, Math.round(6 * 1.05)), '中文按 1 token/字估算')
ok(estimateTokens('hello world!') === Math.round(12 / 3.6), '拉丁文按 3.6 字符/token 估算')

/* ---------------- 命中来源识别 ---------------- */
section('命中来源 / 本地估算')

const oaWithCache = readOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } })
ok(oaWithCache.cacheRead === 800 && oaWithCache.cacheSource === 'api', 'OpenAI 有 cached_tokens → 接口数据')

const oaNoCache = readOpenAIUsage({ prompt_tokens: 1000, completion_tokens: 50 })
ok(oaNoCache.cacheRead === 0 && oaNoCache.cacheSource === 'estimated', 'OpenAI 无缓存字段 → 标记为估算（不是「命中 0」）')

const oaDeepseek = readOpenAIUsage({ prompt_tokens: 900, completion_tokens: 20, prompt_cache_hit_tokens: 640 })
ok(oaDeepseek.cacheRead === 640 && oaDeepseek.cacheSource === 'api', 'DeepSeek 的 prompt_cache_hit_tokens 也能识别')

ok(readAnthropicUsage({ input_tokens: 500, output_tokens: 30, cache_read_input_tokens: 400 }).cacheSource === 'api', 'Anthropic 恒为接口数据')

const gemNoCache = readGeminiUsage({ promptTokenCount: 700, candidatesTokenCount: 40 })
ok(gemNoCache.cacheSource === 'estimated', 'Gemini 无 cachedContentTokenCount → 估算')
ok(readGeminiUsage({ promptTokenCount: 700, cachedContentTokenCount: 500 }).cacheSource === 'api', 'Gemini 有缓存字段 → 接口数据')

const mergedUsage = mergeUsage(
  { input: 100, output: 10, cacheRead: 0, cacheSource: 'estimated' },
  { cacheRead: 60, cacheSource: 'api' }
)
ok(mergedUsage.cacheSource === 'api', '合并时接口数据优先于估算')
ok(isCacheEstimated({ input: 1, output: 1, cacheRead: 0, cacheSource: 'estimated' }), 'isCacheEstimated 判定估算')
ok(!isCacheEstimated({ input: 1, output: 1, cacheRead: 0, cacheSource: 'api' }), '接口回报 0 命中不算估算')

// 前缀估算：短前缀不计、长前缀按已有内容折算
ok(estimateCacheHit(['短句']) === 0, '只有一条消息时命中估算为 0')
ok(estimateCacheHit(['短句', '短句']) === 0, '前缀不足 512 token 时不计入')
const longPrefix = '这是一段用于测试前缀缓存估算的长文本。'.repeat(80)
const estHit = estimateCacheHit([longPrefix, '新问题'])
ok(estHit > 512, `长前缀估算出 ${estHit} token 命中`)
ok(estimateCacheHit([longPrefix, 'a', 'b']) > estHit / 2, '多轮之后前缀继续累积')

// 系统提示词也要计入前缀
const longSystem = '你是一个严谨的助手，回答要给出依据。'.repeat(60)
ok(estimateCacheHit([longSystem, '用户问题']) > 512, '只有系统提示词也能估出前缀命中')
ok(estimateCacheHit(['', '短问题']) === 0, '空系统提示 + 首轮不计命中')

const sumEstimated = sumUsage([
  { input: 100, output: 10, cacheRead: 0, cacheSource: 'estimated' },
  { input: 100, output: 10, cacheRead: 50, cacheSource: 'api' },
])
ok(sumEstimated.cacheSource === 'estimated', '汇总时只要有一轮是估算就整体标估算')
ok(sumUsage([{ input: 100, output: 10, cacheRead: 50, cacheSource: 'api' }]).cacheSource === 'api', '全部来自接口时标接口')

/* ---------------- 导出 ---------------- */
section('导出')

const md = sessionToMarkdown(sessions.find((s) => s.id === trip.id), await repo.listTurns(trip.id))
ok(md.startsWith('# 周末去哪玩'), '标题正确')
ok(md.includes('Token：输入') && md.includes('命中率'), '含用量摘要')
ok(/## 1\. 用户/.test(md) && md.includes('## 助手'), '含对话分节（轮次编号 + 角色）')
ok(/\.md$/.test(exportFilename('测试标题')), '导出文件名以 .md 结尾')
ok(!/[\\/:*?"<>|]/.test(exportFilename('测试/标题:带*字符')), '文件名过滤非法字符')

/* ---------------- 删除 ---------------- */
section('删除')

await repo.deleteSession(trip.id)
ok((await repo.listSessions()).length === 1, '会话删除后列表减少')
ok((await repo.listTurns(trip.id)).length === 0, '级联删除该会话的轮次')
ok((await repo.search('公园')).length === 0, '被删会话不再出现在搜索里')

/* ---------------- 提示词包 ---------------- */
section('提示词包')

ok(BUILTIN_PACKS.length === 3, `三种模式（${BUILTIN_PACKS.map((p) => p.name).join('/')}）`)
ok(new Set(BUILTIN_PACKS.map((p) => p.id)).size === 3, '模式 id 不重复')
ok(BUILTIN_PACKS.every((p) => p.name && p.hint), '每套包都有名称与说明')
ok(findPack(DEFAULT_PACK_ID).id === 'minimal', '默认落到极简包')
ok(findPack('writing').name === '写作' && findPack('tavern').name === '酒馆', '按 id 取模式')
ok(findPack('不存在').id === 'minimal', '未知 id 回退到极简')
ok(findPack(undefined).id === 'minimal', '未设置时回退到极简')

const writing = findPack('writing')
const tavern = findPack('tavern')
ok(writing.systemPrompt.includes('设定文件'), '写作模式要求遵循设定文件')
ok(writing.systemPrompt.includes('修改意见'), '写作模式接受修改意见式的指令')
ok(writing.actions.length >= 3, `写作模式 ${writing.actions.length} 个动作`)
ok(writing.actions.every((a) => a.label && a.template.includes('{{input}}')), '写作动作都支持 {{input}}')
ok(tavern.systemPrompt.includes('角色扮演'), '酒馆模式是扮演向')
ok(tavern.actions.length === 0, '酒馆模式不带按钮')
ok(findPack('minimal').actions.length === 0, '极简模式没有动作，不占界面')
ok(findPack('minimal').systemPrompt === '', '极简模式不注入任何提示词')

ok(renderTemplate('润色这段：\n{{input}}', '原文') === '润色这段：\n原文', '占位符被输入替换')
ok(renderTemplate('{{input}} 和 {{input}}', 'A') === 'A 和 A', '多处占位符全部替换')
ok(renderTemplate('直接给结论', '') === '直接给结论', '空输入时只留指令，不留空行')
ok(renderTemplate('直接给结论', '内容') === '直接给结论\n\n内容', '无占位符时把输入接在后面')
ok(renderTemplate('润色：{{input}}', '  前后有空格  ') === '润色：前后有空格', '输入两端空白被裁掉')

ok(composeSystemPrompt('包规范', '摘要', '用户设定') === '包规范\n\n摘要\n\n用户设定', '三段提示词按 包 → 会话 → 用户 顺序拼接')
ok(composeSystemPrompt('包规范') === '包规范', '只有包提示词时不加空行')
ok(composeSystemPrompt('', '摘要', '') === '摘要', '空段被跳过')
ok(composeSystemPrompt('', '', '') === '', '全空得到空串')
ok(composeSystemPrompt('包', '   ', '用户') === '包\n\n用户', '纯空白段被跳过')

/* ---------------- 角色卡 ---------------- */
section('角色卡')

const v2 = normalizeCard({
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: '林深',
    description: '{{char}} 是一名夜间电台主播，说话很慢。',
    personality: '温和、话少',
    scenario: '凌晨两点的直播间',
    first_mes: '「喂，{{user}}，今晚想听什么？」',
    mes_example: '<START>\n{{user}}: 随便\n{{char}}: 那就放首慢的。',
    system_prompt: '保持电台主播的语气。',
    character_book: {
      entries: [
        { keys: ['电台', '节目'], content: '节目名叫《夜航》，每周三停播。', enabled: true },
        { keys: ['猫'], content: '他养了一只叫豆子的猫。' },
        { keys: ['隐藏'], content: '不该出现', enabled: false },
      ],
    },
  },
})

ok(v2.name === '林深', 'V2 卡解析出名字')
ok(v2.firstMessage.includes('{{user}}'), '开场白保留原始宏（渲染时才替换）')
ok(v2.systemPrompt === '保持电台主播的语气。', 'V2 system_prompt 被读取')
ok(v2.worldInfo.length === 3, `世界书解析出 ${v2.worldInfo.length} 条`)
ok(v2.worldInfo[0].keys.join('/') === '电台/节目', '世界书关键词解析正确')

const v1 = normalizeCard({ name: '阿岚', first_mes: '「来了？」', description: '一个旅人' })
ok(v1.name === '阿岚' && v1.firstMessage === '「来了？」', '旧版扁平结构也能解析')
ok(normalizeCard({}).name === '未命名角色', '空对象回退到默认名')
ok(normalizeCard({ data: null }).name === '未命名角色', '结构异常不抛错')

ok(applyMacros('{{char}}对{{user}}说：<USER>你好', '林深', '旅人') === '林深对旅人说：旅人你好', '宏替换（含大小写变体）')
ok(applyMacros('', 'A', 'B') === '', '空文本不炸')

const rendered = renderCard(v2, '旅人')
ok(rendered.includes('林深') && rendered.includes('夜间电台主播'), '角色卡渲染包含名字与设定')
ok(rendered.includes('温和、话少') && rendered.includes('凌晨两点'), '性格与情境都进提示词')
ok(rendered.includes('不要跳出角色'), '角色卡强制限定口吻')
ok(!renderCard(normalizeCard({ name: '空' }), '你').includes('性格：'), '空字段不生成空标题')

// 世界书
const entries = v2.worldInfo
ok(matchWorldEntries(entries, '今天电台放什么').length === 1, '关键词命中注入')
ok(matchWorldEntries(entries, '今天天气不错').length === 0, '未命中不注入')
ok(matchWorldEntries(entries, '不该出现的词').every((e) => !e.content.includes('不该出现')), '禁用条目不注入')
ok(matchWorldEntries([{ id: 'c', keys: [], content: '常驻设定', enabled: true, constant: true }], '随便').length === 1, '常驻条目无条件注入')
ok(matchWorldEntries(entries, '电台 猫 节目 隐藏', 1).length === 1, '命中数量有上限')
ok(renderWorldEntries([{ id: 'x', keys: ['a'], content: '设定内容', enabled: true }]).includes('设定内容'), '世界书渲染成文本')
ok(contextWindow(['1', '2', '3', '4', '5'], 3) === '3\n4\n5', '扫描窗口只取最近几条')

// PNG 内嵌卡（SillyTavern 主流格式）
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
}
const cardJson = { spec: 'chara_card_v2', data: { name: '铁匠', description: '镇上的铁匠', first_mes: '「要打点什么？」' } }
const b64 = Buffer.from(JSON.stringify(cardJson)).toString('base64')
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', Buffer.alloc(13)),
  chunk('tEXt', Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(b64, 'latin1')])),
  chunk('IEND', Buffer.alloc(0)),
])
const pngBuffer = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
const fromPng = normalizeCard(extractCardFromPng(pngBuffer))
ok(fromPng.name === '铁匠' && fromPng.firstMessage === '「要打点什么？」', '从 PNG 的 tEXt 块读出角色卡')

const noCardPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IEND', Buffer.alloc(0)),
])
ok(extractCardFromPng(noCardPng.buffer.slice(noCardPng.byteOffset, noCardPng.byteOffset + noCardPng.byteLength)) === null, '没有 chara 块的 PNG 返回 null')
ok(extractCardFromPng(new Uint8Array([1, 2, 3]).buffer) === null, '非 PNG 文件返回 null')

/* ---------------- 寄存区 ---------------- */
section('寄存区 / 文件识别')

ok(VAULT_KINDS.length === 4, `寄存区分四类（${VAULT_KINDS.map((k) => k.label).join('/')}）`)

ok(detectKind({ spec: 'chara_card_v2', data: { name: 'A', first_mes: 'hi' } }) === 'character', '识别角色卡（V2）')
ok(detectKind({ name: 'A', description: 'desc' }) === 'character', '识别角色卡（扁平）')
ok(detectKind({ entries: { 0: { keys: ['a'], content: 'b' } } }) === 'world', '识别世界书（entries 对象）')
ok(detectKind([{ keys: ['a'], content: 'b' }]) === 'world', '识别世界书（条目数组）')
ok(detectKind({ temperature: 0.8, max_tokens: 300 }) === 'preset', '识别生成预设（温度仍可作识别线索）')
ok(detectKind({ top_p: 0.9, max_tokens: 300 }) === 'preset', '只靠 top_p/长度也能识别预设')
ok(detectKind({ max_response_length: 256 }) === 'preset', '识别用旧字段名的预设')
ok(detectKind({ prompt: '你是助手' }) === 'prompt', '识别提示词对象')
ok(detectKind('你是一个严谨的编辑') === 'prompt', '纯文本识别为提示词')
ok(detectKind({}) === null, '认不出时返回 null')
ok(detectKind(null) === null, '非对象返回 null')

const stWorld = toWorldItem(
  { name: '夜航设定', entries: { 0: { keys: ['电台', '节目'], content: '节目叫《夜航》' }, 1: { key: '猫', content: '有只猫叫豆子', disable: true } } },
  '文件名'
)
ok(stWorld.name === '夜航设定', '世界书保留原名')
ok(stWorld.entries.length === 2, `世界书解析 ${stWorld.entries.length} 条（含被禁用的）`)
ok(stWorld.entries[1].enabled === false, 'disable 字段映射成未启用')
ok(stWorld.entries[1].keys[0] === '猫', '单数 key 也能解析')

const stPreset = toPresetItem({ name: 'Marinara', temperature: '0.85', top_p: 0.9, max_tokens: 600 }, 'x')
ok(stPreset.topP === 0.9 && stPreset.maxTokens === 600, '预设的 top_p 与长度被读取')
ok(!('temperature' in stPreset), '预设不再保存温度（即使文件里有）')
ok(toPresetItem({}, '备用名').name === '备用名', '预设无名时用文件名')

ok(toPromptItem({ name: '编辑器', prompt: '不要用形容词' }, 'x').text === '不要用形容词', '提示词取 prompt 字段')
ok(toPromptItem('直接是文本', 'x').text === '直接是文本', '纯文本提示词')
ok(toPromptItem({ system_prompt: '系统' }, 'x').text === '系统', 'system_prompt 字段也能取')

/* ---------------- 设定文件 ---------------- */
section('设定文件（角色卡 + 世界书合一）')

const fromCard = settingFromCard(v2)
ok(fromCard.name === '林深', '卡转设定保留名字')
ok(fromCard.body.includes('夜间电台主播'), '设定正文包含原 description')
ok(fromCard.body.includes('性格：温和'), '性格并进正文且带标题')
ok(fromCard.body.includes('情境：凌晨两点'), '情境并进正文')
ok(fromCard.entries.length === 3, `卡内世界书转成 ${fromCard.entries.length} 条条目`)
ok(fromCard.firstMessage?.includes('{{user}}'), '开场白原样保留（渲染时才替换）')

const fromWorld = settingFromWorld({ name: '夜航世界观', entries: fromCard.entries })
ok(fromWorld.name === '夜航世界观' && fromWorld.entries.length === 3, '世界书可直接转设定')
ok(fromWorld.body === '', '转过来时正文为空，等用户补')

const fromText = settingFromText('写作风格', '不要形容词')
ok(fromText.body === '不要形容词' && fromText.entries.length === 0, '纯文本转设定')

const two = [fromCard, fromWorld]
ok(renderSettings(two, '旅人').includes('## 林深'), '多份设定各自成节')
ok(renderSettings(two, '旅人').includes('夜间电台主播'), '第一份内容在')
ok(renderSettings([fromText], '你') === '## 写作风格\n不要形容词', '单份设定的渲染格式')
ok(renderSettings([], '你') === '', '没挂设定时返回空串')
ok(collectEntries(two).length === 6, `合并多份设定的条目（${collectEntries(two).length}）`)

ok(pickGreeting([fromWorld, fromCard], '旅人')?.text.includes('旅人'), '多份里挑带开场白的那份并替换宏')
ok(pickGreeting([fromWorld], '旅人') === null, '都没有开场白时返回 null')

/* ---------------- 请求体装配（拦截平台层，不联网） ---------------- */
section('请求装配')

const { initPlatform, platform } = await import('@/platform')
const { initRepo } = await import('@/db/runtime')
const { useApp } = await import('@/chat/store')
const { emptySetting } = await import('@/chat/settings')
const { presetOverrides } = await import('@/chat/vault')

await initPlatform()
await initRepo()

// 用假的流替换真实网络：记录请求体，回一段极简 SSE
let captured = null
platform().stream = async function* (req) {
  captured = JSON.parse(req.body)
  captured.__headers = req.headers
  yield 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n'
  yield 'data: [DONE]\n\n'
}

const st = () => useApp.getState()
await st().init()
st().saveConfig({
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  systemPrompt: '',
  protocol: 'openai',
  userName: '旅人',
  topP: 0.95,
  maxTokens: 999,
})

ok(presetOverrides(undefined).topP === undefined, '没有预设时不覆盖任何字段')
ok(presetOverrides({ id: 'p', name: 'x', topP: 0.8, createdAt: 0, updatedAt: 0 }).topP === 0.8, '预设覆盖 top_p')

const doc = emptySetting()
doc.name = '林深'
doc.body = '深夜电台主播，今晚的听众只有{{user}}一个人'
doc.entries = [{ id: 'e', keys: ['节目'], content: '节目叫《夜航》', enabled: true }]

const preset = { id: 'preset-1', name: '严谨', topP: 0.7, maxTokens: 123, createdAt: 0, updatedAt: 0 }
st().importSetting(doc)
st().savePreset(preset)

await st().startWithSettings([doc.id], preset.id)
const created = st().sessions[0]
ok(created.settingIds?.[0] === doc.id, '会话记录了设定文件')
ok(created.presetId === preset.id, '会话记录了预设')

await st().send('节目叫什么')
const body = captured
ok(Boolean(body), '捕获到请求体')
ok(body.temperature === undefined, '请求里不再出现 temperature')
ok(body.top_p === 0.7, `会话预设覆盖了全局 top_p（${body.top_p}）`)
ok(body.max_tokens === 123, `预设的长度进了请求（${body.max_tokens}）`)
const sys = body.messages[0].role === 'system' ? body.messages[0].content : ''
ok(sys.includes('林深') && sys.includes('深夜电台主播'), '设定正文进了 system prompt')
ok(sys.includes('节目叫《夜航》'), '关键词条目命中后进了 system prompt')
ok(sys.includes('旅人') && !sys.includes('{{user}}'), '设定里的 {{user}} 被替换成用户名')
ok(body.messages.some((m) => m.content === '节目叫什么'), '用户消息在')

// 换个不挂预设的会话，应回落到全局参数
await st().startWithSettings([doc.id])
await st().send('再说一次')
ok(captured.top_p === 0.95 && captured.max_tokens === 999, `没有预设时回落到全局参数（top_p ${captured.top_p} / ${captured.max_tokens}）`)

/* ---------------- 思考强度 ---------------- */
section('思考强度')

const { reasoningControl, reasoningPayload, usesEnableThinking, canDisableExplicitly } = await import('@/chat/reasoning')
const { inferReasoning } = await import('@/chat/models')
const { buildChatRequest } = await import('@/chat/protocol')
const { normalize } = await import('@/chat/models')

// 三种控制形态
ok(reasoningControl('openai', undefined).kind === 'none', '没有模型信息时不显示控制')
ok(reasoningControl('openai', { reasoning: false }).kind === 'none', '不支持思考的模型不显示控制')
ok(reasoningControl('openai', { reasoning: true }).kind === 'toggle', '只声明支持思考 → 给开关')
const levelsControl = reasoningControl('openai', { reasoning: true, reasoningLevels: ['none', 'low', 'high'] })
ok(levelsControl.kind === 'levels' && levelsControl.levels.join(',') === 'none,low,high', '服务商声明档位 → 原样给出')

// 载荷映射：默认不干预
ok(Object.keys(reasoningPayload('openai', undefined)).length === 0, '默认不干预：不发任何参数')
ok(reasoningPayload('openai', 'off').effort === 'none', 'OpenAI 关闭用 reasoning_effort=none')
ok(reasoningPayload('anthropic', 'off').disabled === true, 'Anthropic 关闭用 thinking.type=disabled')
ok(reasoningPayload('gemini', 'off').thinkingBudget === 0, 'Gemini 关闭用 thinkingBudget=0')
ok(Object.keys(reasoningPayload('openai', 'on')).length === 0, 'OpenAI 开启不额外发参数（默认即开）')
ok(reasoningPayload('anthropic', 'on').budgetTokens === 4096, 'Anthropic 开启用默认预算')
ok(reasoningPayload('gemini', 'on').thinkingBudget === -1, 'Gemini 开启用动态预算 -1')
ok(reasoningPayload('openai', 'high').effort === 'high', '档位直传 OpenAI')
ok(reasoningPayload('anthropic', 'high').budgetTokens === 8192, '档位换算成 Anthropic 预算')
ok(reasoningPayload('gemini', 'low').thinkingBudget === 1024, '档位换算成 Gemini 预算（low=1024）')

// 国内网关走 enable_thinking（实测硅基流动：qwen3/deepseek 认它，reasoning_effort 被忽略）
ok(usesEnableThinking('https://api.siliconflow.cn/v1'), '硅基流动识别为 enable_thinking 网关')
ok(usesEnableThinking('https://dashscope.aliyuncs.com/compatible-mode/v1'), '百炼识别为网关')
ok(!usesEnableThinking('https://api.openai.com/v1'), 'OpenAI 官方不是网关')
ok(!usesEnableThinking(undefined), '没有地址时不判定为网关')
const sf = { baseUrl: 'https://api.siliconflow.cn/v1', modelId: 'Qwen/Qwen3-8B' }
ok(reasoningPayload('openai', 'off', sf).enableThinking === false, '网关关闭用 enable_thinking=false')
ok(reasoningPayload('openai', 'on', sf).enableThinking === true, '网关开启用 enable_thinking=true')
ok(reasoningPayload('openai', 'high', sf).gatewayBudget === 8192, '网关档位带 thinking_budget')
ok(reasoningPayload('openai', 'off', { baseUrl: 'https://api.openai.com/v1' }).effort === 'none', '官方仍然用 reasoning_effort=none')

// 借鉴 Chatbox：不能关的模型，off 退化成「不干预」
ok(!canDisableExplicitly('o3'), 'o 系列不能关')
ok(!canDisableExplicitly('gemini-2.5-pro'), 'Gemini 2.5 Pro 不能关')
ok(canDisableExplicitly('Qwen/Qwen3-8B'), 'qwen3 可以关')
ok(Object.keys(reasoningPayload('openai', 'off', { modelId: 'o3' })).length === 0, 'o3 选关闭时实际不发参数')
ok(reasoningPayload('gemini', 'off', { modelId: 'gemini-2.5-pro' }).thinkingBudget === undefined, 'Gemini Pro 关闭不写 0')

// 各家预算不同
ok(reasoningPayload('gemini', 'high', { modelId: 'gemini-2.5-flash' }).thinkingBudget === 24576, 'Gemini high 用 24576')
ok(reasoningPayload('gemini', 'medium', { modelId: 'gemini-2.5-flash' }).thinkingBudget === 8192, 'Gemini medium 用 8192')
ok(reasoningPayload('gemini', 'high', { modelId: 'gemini-3-pro' }).thinkingLevel === 'high', 'Gemini 3 用 thinkingLevel')
ok(reasoningPayload('anthropic', 'high').budgetTokens === 8192, 'Anthropic high 用 8192')

// 模型名推断（网关普遍只给 id）
ok(inferReasoning('Qwen/Qwen3-8B'), 'qwen3 推断为支持思考')
ok(inferReasoning('deepseek-ai/DeepSeek-V4-Flash'), 'deepseek-v4 推断为支持思考')
ok(inferReasoning('zai-org/GLM-5.3-Flash'), 'glm-5 推断为支持思考')
ok(inferReasoning('openai/gpt-5'), 'gpt-5 推断为支持思考')
ok(!inferReasoning('Qwen/Qwen2.5-7B-Instruct'), 'qwen2.5 不误判')
ok(!inferReasoning('baai/bge-m3'), '向量模型不误判')

// 请求体
const msgs = [{ role: 'user', content: 'hi' }]
const auth = { baseUrl: 'https://example.com/v1', apiKey: 'k' }
const bodyOf = (protocol, opts) => JSON.parse(buildChatRequest(protocol, auth, { model: 'm', messages: msgs, stream: true, ...opts }).body)

ok(bodyOf('openai', { reasoningLevel: 'high' }).reasoning_effort === 'high', 'OpenAI 请求体带 reasoning_effort')
ok(bodyOf('openai', { reasoningLevel: 'off' }).reasoning_effort === 'none', 'OpenAI 关闭时发 none')
ok(!('reasoning_effort' in bodyOf('openai', {})), '默认不带 reasoning_effort')

const gatewayBody = JSON.parse(
  buildChatRequest(
    'openai',
    { baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'k' },
    { model: 'm', messages: msgs, stream: true, reasoningLevel: 'off' }
  ).body
)
ok(gatewayBody.enable_thinking === false, '网关请求体带 enable_thinking=false')
ok(!('reasoning_effort' in gatewayBody), '网关请求体不带 reasoning_effort')

const anthOn = bodyOf('anthropic', { reasoningLevel: 'medium', maxTokens: 512 })
ok(anthOn.thinking?.type === 'enabled' && anthOn.thinking.budget_tokens === 4096, 'Anthropic 开启带 budget_tokens')
ok(anthOn.max_tokens > anthOn.thinking.budget_tokens, `max_tokens 自动大于预算（${anthOn.max_tokens} > 4096）`)
ok(bodyOf('anthropic', { reasoningLevel: 'off' }).thinking?.type === 'disabled', 'Anthropic 关闭带 disabled')

ok(bodyOf('gemini', { reasoningLevel: 'low' }).generationConfig?.thinkingConfig?.thinkingBudget === 1024, 'Gemini 带 thinkingConfig')
ok(bodyOf('gemini', { reasoningLevel: 'off' }).generationConfig?.thinkingConfig?.thinkingBudget === 0, 'Gemini 关闭写 0')

// 元数据解析
const parsedModels = normalize(
  { data: [{ id: 'x', supports_reasoning: true, reasoning_efforts: ['low', 'medium'] }] },
  'openai'
)
ok(parsedModels[0].reasoning === true && parsedModels[0].reasoningLevels?.join(',') === 'low,medium', '从模型元数据解析档位')

// 端到端
st().saveConfig({ reasoningLevel: 'high' })
await st().startWithSettings([doc.id])
await st().send('测试档位')
ok(captured.reasoning_effort === 'high', `配置的档位进了请求（${captured.reasoning_effort}）`)

/* ---------------- 汇总 ---------------- */
console.log('\n' + '-'.repeat(48))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
