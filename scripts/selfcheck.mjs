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
  compressThreshold,
} = await import('@/chat/tokens')
const { sessionToMarkdown, exportFilename } = await import('@/chat/export')
const { BUILTIN_PACKS, DEFAULT_PACK_ID, findPack, renderTemplate } = await import('@/chat/packs')
const { normalizeCard, applyMacros, renderCard, extractCardFromPng, isPngBuffer } = await import('@/chat/characters')
const { matchWorldEntries, renderWorldEntries, contextWindow } = await import('@/chat/lore')
const { detectKind, toWorldItem, toPromptItem, VAULT_KINDS } = await import('@/chat/vault')
const { settingFromCard, settingFromWorld, settingFromText, renderSettings, collectEntries, pickGreeting, guessKind, emptySetting: makeSetting } = await import('@/chat/settings')
const { renderSettingText, parseSettingText, applySettingText, settingTextFileName } = await import('@/chat/setting-text')

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
ok(writing.actions.length === 0, '写作模式也不给按钮（三种模式都无动作）')
ok(BUILTIN_PACKS.every((p) => p.actions.length === 0), '所有模式都没有预设动作行')
ok(tavern.systemPrompt.includes('角色扮演'), '酒馆模式是扮演向')
ok(tavern.actions.length === 0, '酒馆模式不带按钮')
ok(findPack('minimal').actions.length === 0, '极简模式没有动作，不占界面')
ok(findPack('minimal').systemPrompt === '', '极简模式不注入任何提示词')

ok(renderTemplate('润色这段：\n{{input}}', '原文') === '润色这段：\n原文', '占位符被输入替换')
ok(renderTemplate('{{input}} 和 {{input}}', 'A') === 'A 和 A', '多处占位符全部替换')
ok(renderTemplate('直接给结论', '') === '直接给结论', '空输入时只留指令，不留空行')
ok(renderTemplate('直接给结论', '内容') === '直接给结论\n\n内容', '无占位符时把输入接在后面')
ok(renderTemplate('润色：{{input}}', '  前后有空格  ') === '润色：前后有空格', '输入两端空白被裁掉')


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

// 元信息：作者、标签、版本、备注（V2 是字符串，V3 还可能是多语言对象）
const metaCard = normalizeCard({
  spec: 'chara_card_v3',
  data: {
    name: '雾港守灯人',
    description: '<p>在雾港守了三十年灯。</p><p>他不喜欢说话。</p>',
    creator: '海雾',
    character_version: '1.4',
    tags: ['奇幻', '慢热', '  '],
    creator_notes: '',
    creator_notes_multilingual: { en: 'A lighthouse keeper.', zh: '一位守灯人。' },
  },
})
ok(metaCard.spec === 'chara_card_v3', 'V3 卡保留规范标识')
ok(metaCard.creator === '海雾' && metaCard.version === '1.4', '作者与版本被解析')
ok(metaCard.tags.join('/') === '奇幻/慢热', '标签去掉空值')
ok(metaCard.creatorNotes === '一位守灯人。', 'V3 多语言备注优先中文')

const { summaryOf } = await import('@/chat/settings')
ok(summaryOf('<p>在雾港守了三十年灯。</p>') === '在雾港守了三十年灯。', '简介去掉 HTML 标签')
ok(summaryOf('', '作者备注') === '作者备注', '没有正文时退回备注')
ok(summaryOf('字'.repeat(200)).length === 111, '长简介截断并加省略号')

ok(normalizeCard({}).name === '未命名角色', '空对象回退到默认名')
ok(normalizeCard({ data: null }).name === '未命名角色', '结构异常不抛错')

ok(applyMacros('{{char}}对{{user}}说：<USER>你好', '林深', '旅人') === '林深对旅人说：旅人你好', '宏替换（含大小写变体）')
ok(applyMacros('', 'A', 'B') === '', '空文本不炸')

// 新宏：random 每次重掷、pick 同文本稳定、roll 认骰面、日期时间要展开
const randPick = applyMacros('{{random:苹果,香蕉,梨}}', 'A', 'B')
ok(['苹果', '香蕉', '梨'].includes(randPick), `random 落在选项内（${randPick}）`)
ok(applyMacros('{{pick:红,蓝}}', 'A', 'B') === applyMacros('{{pick:红,蓝}}', 'A', 'B'), 'pick 同文本两次求值一致')
const rolled = applyMacros('{{roll:2d6+1}}', 'A', 'B')
ok(Number.isInteger(Number(rolled)) && Number(rolled) >= 3 && Number(rolled) <= 13, `roll 2d6+1 落在 3..13（${rolled}）`)
ok(applyMacros('{{roll:这个不是骰面}}', 'A', 'B') === '{{roll:这个不是骰面}}', '不认识的骰面原样保留')
const dated = applyMacros('{{date}} {{time}} {{weekday}}', 'A', 'B')
ok(!dated.includes('{{') && dated.trim().length >= 10, `date/time/weekday 已展开（${dated}）`)
ok(['阿岚笑', '旅人哭'].includes(applyMacros('{{random:{{char}}笑,{{user}}哭}}', '阿岚', '旅人')), '嵌套宏先展开再随机')

// 卡内正则脚本：斜杠包装剥壳、裸 pattern 补 g、停用跳过
const regexCard = normalizeCard({
  spec: 'chara_card_v3',
  data: {
    name: '面板卡',
    first_mes: '<MxUserSetupPanel/>',
    extensions: {
      regex_scripts: [
        { scriptName: '清理变量', findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g', replaceString: '-', placement: [2] },
        { scriptName: '提示词清理', findRegex: '/<Analysis>[\\s\\S]+?<\\/Analysis>/gm', replaceString: '', placement: [1, 2], promptOnly: true },
        { scriptName: '裸pattern', findRegex: '<StatusPlaceHolderImpl/>', replaceString: '', placement: [2] },
        { scriptName: '开场面板', findRegex: '<MxUserSetupPanel/>', replaceString: '<div style="color:red">面板</div>', placement: [2], markdownOnly: true },
        { scriptName: '组引用', findRegex: '/\\[\\[HINT:(.*?)\\]\\]/g', replaceString: '(提示:$1)', placement: [2] },
        { scriptName: '仅最新', findRegex: '/ONLYLAST/g', replaceString: 'R', placement: [2], maxDepth: 0 },
        { scriptName: '宏替换串', findRegex: '/<ONLINE>/g', replaceString: '{{user}}在线', placement: [2] },
        { scriptName: '停用', findRegex: '/被停用/g', replaceString: 'x', placement: [2], disabled: true },
      ],
    },
  },
})
ok(regexCard.regexScripts.length === 7, `正则脚本解析出 ${regexCard.regexScripts.length} 条（跳过停用）`)
ok(regexCard.regexScripts[0].find === '<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>' && regexCard.regexScripts[0].flags === 'g', '斜杠包装剥壳取标志')
ok(regexCard.regexScripts[1].flags === 'gm', '多标志原样保留')
ok(regexCard.regexScripts[2].flags === 'g' && regexCard.regexScripts[2].find === '<StatusPlaceHolderImpl/>', '裸 pattern 补 g')
ok(regexCard.regexScripts[3].markdownOnly === true, 'markdownOnly 标志被读取')

// 卡内 QR 按钮：分段数组合并、停用跳过、可见性落标记
const qrCard = normalizeCard({
  spec: 'chara_card_v3',
  data: {
    name: 'QR卡',
    extensions: {
      quick_replies: [
        { label: '开始', message: '/send 开局' },
        { label: '状态', message: ['查看', '状态栏'], title: '备用' },
        { label: '隐藏', message: '别显示', isVisible: false },
        { label: '停用', message: '别启用', isEnabled: false },
        { message: '没文案' },
      ],
    },
  },
})
ok(qrCard.quickReplies.length === 4, `QR 解析出 ${qrCard.quickReplies.length} 条（isEnabled=false 跳过）`)
ok(qrCard.quickReplies[1].message === '查看\n状态栏' && qrCard.quickReplies[1].label === '状态', '分段数组合并、label 优先 title')
ok(qrCard.quickReplies[2].hidden === true, 'isVisible=false 落成 hidden 标记')
ok(qrCard.quickReplies[3].label === '(按钮)', '无文案按钮给默认标签')

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

// 真实卡包不只写 tEXt：iTXt / zTXt 也很常见，只认 tEXt 会漏掉相当一部分
const zlib = await import('node:zlib')
const pngOf = (...chunks) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13)),
    ...chunks,
    chunk('IEND', Buffer.alloc(0)),
  ])
const pngAb = (pngBytes) => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)
const tEXt = (keyword, value) =>
  chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'utf8')]))
const iTXt = (keyword, value, compressed) =>
  chunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(keyword, 'latin1'),
      Buffer.from([0]),
      Buffer.from([compressed ? 1 : 0, 0]),
      Buffer.from('zh', 'latin1'),
      Buffer.from([0, 0]),
      compressed ? zlib.deflateSync(Buffer.from(value, 'utf8')) : Buffer.from(value, 'utf8'),
    ])
  )
const zTXt = (keyword, value) =>
  chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]), zlib.deflateSync(Buffer.from(value, 'utf8'))]))
const base64Of = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
const variantCard = { spec: 'chara_card_v2', data: { name: '变体卡', first_mes: '开场', description: '描述' } }
const v3Card = { spec: 'chara_card_v3', data: { name: '新版卡', first_mes: 'V3 开场' } }
const readPngCard = (pngBytes) => {
  const raw = extractCardFromPng(pngAb(pngBytes))
  return raw ? normalizeCard(raw) : null
}

ok(readPngCard(pngOf(iTXt('chara', base64Of(variantCard), false)))?.name === '变体卡', 'iTXt（未压缩）能读出角色卡')
ok(readPngCard(pngOf(iTXt('chara', base64Of(variantCard), true)))?.name === '变体卡', 'iTXt（压缩）能读出角色卡')
ok(readPngCard(pngOf(zTXt('chara', base64Of(variantCard))))?.name === '变体卡', 'zTXt 能读出角色卡')
ok(
  readPngCard(pngOf(tEXt('chara', base64Of(variantCard)), tEXt('ccv3', base64Of(v3Card))))?.spec === 'chara_card_v3',
  '同时有 chara 和 ccv3 时优先读 V3'
)
ok(readPngCard(pngOf(tEXt('chara', base64Of(base64Of(variantCard)))))?.name === '变体卡', '被编码两次的卡也能解开')
ok(readPngCard(pngOf(tEXt('chara', `data:application/json;base64,${base64Of(variantCard)}`)))?.name === '变体卡', 'data URL 形式的卡数据')
ok(readPngCard(pngOf(tEXt('chara', JSON.stringify(variantCard))))?.name === '变体卡', '明文 JSON 形式的卡数据')
ok(
  readPngCard(pngOf(tEXt('chara', zlib.gzipSync(Buffer.from(JSON.stringify(variantCard))).toString('base64'))))?.name ===
    '变体卡',
  'gzip 后再 base64 的卡数据'
)
ok(readPngCard(pngOf(tEXt('Chara', base64Of(variantCard))))?.name === '变体卡', '关键词大小写不敏感')
ok(
  readPngCard(pngOf(tEXt('ccv3', base64Of({})), tEXt('chara', base64Of(variantCard))))?.name === '变体卡',
  '空的 ccv3 占位块不会挡住 chara'
)
ok(readPngCard(pngOf(tEXt('chara', base64Of({ nothing: true })))) === null, 'chara 块里不是卡时返回 null')
const truncatedPng = pngOf(tEXt('chara', base64Of(variantCard)))
ok(readPngCard(truncatedPng.subarray(0, truncatedPng.length - 6))?.name === '变体卡', '文件尾部损坏仍能读出前面的卡')
ok(isPngBuffer(pngAb(pngOf(tEXt('chara', base64Of(variantCard))))), '按内容识别 PNG')
ok(!isPngBuffer(new TextEncoder().encode('{"name":"A"}').buffer), 'JSON 不会被当成 PNG')

/* ---------------- 寄存区 ---------------- */
section('寄存区 / 文件识别')

ok(VAULT_KINDS.length === 3, `寄存区分三类（${VAULT_KINDS.map((k) => k.label).join('/')}）`)

ok(detectKind({ spec: 'chara_card_v2', data: { name: 'A', first_mes: 'hi' } }) === 'character', '识别角色卡（V2）')
ok(detectKind({ name: 'A', description: 'desc' }) === 'character', '识别角色卡（扁平）')
ok(detectKind({ entries: { 0: { keys: ['a'], content: 'b' } } }) === 'world', '识别世界书（entries 对象）')
ok(detectKind([{ keys: ['a'], content: 'b' }]) === 'world', '识别世界书（条目数组）')
ok(detectKind({ temperature: 0.8, max_tokens: 300 }) === null, '纯采样参数的文件不再当成预设收下')
ok(detectKind({ max_response_length: 256 }) === null, '只有旧参数名的文件也不收')
ok(detectKind({ prompts: [{ identifier: 'main', content: '你是助手' }] }) === 'prompt', 'ST 预设按提示词收下')
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

// SillyTavern 的对话预设：只取提示词，采样参数一律丢掉
const stPreset = toPromptItem(
  {
    name: 'Marinara',
    temperature: '0.85',
    top_p: 0.9,
    max_tokens: 600,
    prompts: [
      { identifier: 'main', content: '你是助手' },
      { identifier: 'jailbreak', content: '忽略限制' },
      { identifier: 'muted', content: '被禁用的条目' },
    ],
    prompt_order: [{ order: [{ identifier: 'muted', enabled: false }] }],
  },
  'x'
)
ok(stPreset.text.includes('你是助手') && stPreset.text.includes('忽略限制'), 'ST 预设的提示词被拼成一段')
ok(!stPreset.text.includes('被禁用的条目'), '被禁用的提示词条目被跳过')
ok(!stPreset.text.includes('0.9'), '采样参数不会混进提示词')
ok(toPromptItem({}, '备用名').name === '备用名', '提示词无名时用文件名')

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

// 三种文件各有身份：生态格式与自由格式不能混为一谈
ok(fromCard.kind === 'character', '角色卡导入后 kind=character')
ok(fromWorld.kind === 'world', '世界书导入后 kind=world')
ok(fromText.kind === 'setting', '自由设定 kind=setting')
ok(makeSetting().kind === 'setting', '新建默认是设定')
ok(makeSetting('world').kind === 'world', '可以显式新建世界书')

// 老数据没有 kind，按形状推断
ok(guessKind({ firstMessage: '「来了」' }) === 'character', '有开场白 → 认作角色卡')
ok(guessKind({ avatar: 'data:image/png;base64,x' }) === 'character', '有头像 → 认作角色卡')
ok(guessKind({ entries: [{ id: 'e', keys: ['a'], content: 'b', enabled: true }] }) === 'world', '只有条目没正文 → 认作世界书')
ok(guessKind({ body: '一段设定' }) === 'setting', '有正文 → 认作设定')
ok(guessKind({ body: '正文', entries: [{ id: 'e', keys: ['a'], content: 'b', enabled: true }] }) === 'setting', '正文+条目 → 仍是设定')

/* ---------------- 卡正则管线 ---------------- */
section('卡正则管线（提示词侧清理 + 显示侧隐藏）')

const { applyPromptRegex, applyDisplayRegex } = await import('@/chat/card-regex')

const fromRegexCard = settingFromCard(regexCard)
ok((fromRegexCard.regexScripts?.length ?? 0) === 7, '卡内正则脚本透传到设定文档')

// 提示词侧：placement/门控/depth 按消息逐条判断，system/tool 不参与
const history = [
  { role: 'user', content: '先手 <Analysis>思维链A</Analysis>' },
  { role: 'assistant', content: '回复一 <UpdateVariable>{"hp":90}</UpdateVariable> ONLYLAST' },
  { role: 'user', content: '再问' },
  { role: 'assistant', content: '回复二 <UpdateVariable>{"hp":80}</UpdateVariable> ONLYLAST [[HINT:小]] <ONLINE>' },
]
const cleaned = applyPromptRegex(history, [fromRegexCard], '旅人')
ok(cleaned[0].content === '先手 ', 'promptOnly 脚本清掉用户消息里的思维链')
ok(cleaned[1].content === '回复一 - ONLYLAST', '双侧脚本清掉 AI 消息里的变量块；maxDepth=0 的脚本跳过老消息')
ok(cleaned[2].content === '再问', '无标记的用户消息原样')
ok(cleaned[3].content === '回复二 - R (提示:小) 旅人在线', '最新消息跑全：depth 命中、$1 组、替换串宏')
ok(cleaned.length === 4 && cleaned[1] !== undefined, '历史长度不变')

// 显示侧：promptOnly 不影响显示；含 HTML 的替换串被守卫跳过；promptOnly 也不进显示
const shownVar = applyDisplayRegex('X <UpdateVariable>{"hp":1}</UpdateVariable> Y', [fromRegexCard], '旅人')
ok(shownVar === 'X - Y', '显示侧双侧脚本隐藏变量块')
const shownGuard = applyDisplayRegex('前 <MxUserSetupPanel/> 后', [fromRegexCard], '旅人')
ok(shownGuard === '前 <div style="color:red">面板</div> 后', 'P2 拆守卫：HTML 替换串放行，清洗交给白名单渲染层')
const shownPromptOnly = applyDisplayRegex('甲 <Analysis>思维链</Analysis> 乙', [fromRegexCard], '旅人')
ok(shownPromptOnly === '甲 <Analysis>思维链</Analysis> 乙', 'promptOnly 脚本不影响显示')
ok(applyDisplayRegex('', [fromRegexCard], '旅人') === '', '空文本不炸')
ok(applyPromptRegex(history, [], '旅人') === history, '无脚本时历史原引用返回')

/* ---------------- 卡 HTML 渲染管线 ---------------- */
section('卡 HTML 渲染管线（script 剥离 + CSS 作用域 + 白名单）')

const { cleanCardHtml, scopeCss, cardSanitizeSchema } = await import('@/chat/card-html')

const panelHtml =
  '<div class="panel" onclick="evil()">面板 <script>alert(1)</script><b>加粗</b></div>' +
  '<style>.p{color:red;position:fixed;top:0;background:url(https://x)}</style>正文'
const panelCleaned = cleanCardHtml(panelHtml)
ok(!/<script/i.test(panelCleaned.body) && !/onclick/i.test(panelCleaned.body), 'script 块与事件属性被剥掉')
ok(panelCleaned.css.includes('color:red') && !panelCleaned.css.includes('position:fixed') && !panelCleaned.css.includes('url(https'), 'CSS 值过滤：留颜色、中和 fixed 与外链 url')
ok(panelCleaned.body.includes('<b>加粗</b>') && !panelCleaned.body.includes('<style'), '结构保留、style 块从正文移除')

const attrCleaned = cleanCardHtml('<div style="color:red;position:fixed;background:url(https://x)">t</div>')
ok(attrCleaned.body.includes('position: static') && !attrCleaned.body.includes('url(https'), '内联 style 属性走同一套过滤')

const scoped = scopeCss(panelCleaned.css, 'msgtest')
ok(scoped.includes('.msgtest .p'), '选择器加作用域前缀')

const scopedCss = scopeCss(
  '.panel{color:red}\n@media(min-width:1px){.a{color:blue}}\nbody{background:#000}\n@import url(https://x);\n.b{background:url(data:image/png;base64,AAA)}',
  'msgtest'
)
ok(scopedCss.includes('.msgtest .panel'), '普通选择器加前缀')
ok(scopedCss.includes('.msgtest .a'), '@media 内层也加前缀')
ok(scopedCss.includes('.msgtest{'), 'body 选择器映射到容器本身')
ok(!scopedCss.includes('@import'), '@import 被移除')
ok(scopedCss.includes('url(data:image/png;base64,AAA)'), 'data:image 资源放行')

// 白名单管线冒烟：卡 HTML → hast，危险元素/属性必须被清掉，白名单结构保留
const { unified } = await import('unified')
const remarkParse = (await import('remark-parse')).default
const remarkRehype = (await import('remark-rehype')).default
const rehypeRawPlugin = (await import('rehype-raw')).default
const rehypeSanitizePlugin = (await import('rehype-sanitize')).default
const proc = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRawPlugin)
  .use(rehypeSanitizePlugin, cardSanitizeSchema)
const tree = proc.runSync(proc.parse('<div class="panel" style="color:#fff">面板 <img src="https://x/a.png" alt="图"> <iframe src="https://x"></iframe></div>'))
const allElements = (node, acc = []) => {
  if (node.type === 'element') acc.push(node)
  for (const child of node.children ?? []) allElements(child, acc)
  return acc
}
const els = allElements(tree)
ok(!els.some((e) => e.tagName === 'iframe'), 'iframe 元素被白名单清掉')
ok(els.some((e) => e.tagName === 'img' && !(e.properties?.onerror ?? e.properties?.OnError)), 'img 保留、事件属性不存在')
ok(els.some((e) => e.tagName === 'div' && String(e.properties?.style ?? '').includes('#fff')), '白名单元素与 style 属性保留')
ok(els.some((e) => e.tagName === 'img' && e.properties?.src === 'https://x/a.png'), 'img src 保留')

/* ---------------- 卡变量引擎 ---------------- */
section('卡变量引擎（JSONPatch + UpdateVariable + 变量宏）')

const { readPointer, applyJsonPatch, extractUpdateVariables, applyUpdateVariables, expandVarMacros } = await import(
  '@/chat/variables'
)

ok(readPointer({ hp: 80, status: { mood: 'calm' } }, '/hp') === 80, '根级指针读值')
ok(readPointer({ hp: 80, status: { mood: 'calm' } }, '/status/mood') === 'calm', '嵌套指针下钻')
ok(readPointer({ list: [10, 20] }, '/list/1') === 20, '数组按数字段读')
ok(readPointer({ hp: 80 }, '/mp') === undefined, '越界返回 undefined')
ok(readPointer({ a: { b: 1 } }, '') !== undefined, '空指针读整棵树')

const patched = applyJsonPatch({ hp: 80 }, [
  { op: 'add', path: '/status/mood', value: 'angry' },
  { op: 'replace', path: '/hp', value: 65 },
  { op: 'add', path: '/items/-', value: '长剑' },
  { op: 'copy', path: '/moodCopy', from: '/status/mood' },
  { op: 'remove', path: '/items/0' },
  { op: 'test', path: '/hp', value: 65 },
])
ok(patched.applied === 6, `宽容 patch 六条全应用（${patched.applied}）`)
ok(patched.vars.status.mood === 'angry' && patched.vars.hp === 65, '中间缺层自动补对象')
ok(Array.isArray(patched.vars.items) && patched.vars.items.length === 0, '数组 - 追加后又被 remove')
ok(applyJsonPatch({}, [{ op: 'add', path: '/x', value: 1 }]).vars.x === 1, '根是空对象也能建树')
ok(applyJsonPatch({}, [{ op: 'remove', path: '/不存在的路径' }]).applied === 0, '坏指针跳过不炸')

const reply =
  '正文。<UpdateVariable>[{"op":"replace","path":"/hp","value":50},{"op":"add","path":"/gp","value":10}]</UpdateVariable>' +
  '<UpdateVariable>{"op":"add","path":"/flag","value":true}</UpdateVariable>'
ok(extractUpdateVariables(reply).length === 3, '多个变量块、数组与单对象混写都提取')
ok(extractUpdateVariables('没有标记').length === 0, '无标记返回空')
ok(extractUpdateVariables('<UpdateVariable>不是 JSON</UpdateVariable>').length === 0, '坏 JSON 跳过不炸')
const plain = extractUpdateVariables('<UpdateVariable>{"hp":10,"mp":5}</UpdateVariable>')
ok(plain.length === 2 && plain.every((op) => op.op === 'add'), '普通对象按根级键合并')
const updated = applyUpdateVariables({ hp: 80 }, reply)
ok(updated.changed && updated.vars.hp === 50 && updated.vars.gp === 10 && updated.vars.flag === true, '状态按顺序落树')
ok(applyUpdateVariables({ hp: 80 }, '普通回复').changed === false, '无块不改状态')

const withVars = { hp: 65, status: { mood: 'calm' } }
ok(expandVarMacros('血量 {{getvar::hp}}，心情 {{getvar::status/mood}}', withVars) === '血量 65，心情 calm', 'getvar 读根级与嵌套')
ok(expandVarMacros('状态 {{get_message_variable::status}}', withVars) === '状态 {"mood":"calm"}', 'message_variable 无前缀路径别名，对象转 JSON')
ok(expandVarMacros('缺的 {{getvar::mp}}', withVars) === '缺的 ', '缺失变量展开为空串')
ok(expandVarMacros('没有宏的文本', withVars) === '没有宏的文本', '无宏恒等')
ok(expandVarMacros('{{format_message_variable::hp}}', withVars) === '65', 'format_message_variable 同语义')

// 持久化：local repo 全链路
const varSession = await repo.createSession('变量测试会话')
await repo.setSessionVariables(varSession.id, { hp: 65 })
const storedVars = (await repo.listSessions()).find((s) => s.id === varSession.id)?.variables
ok(storedVars?.hp === 65, '会话变量经 repo 持久化往返')

/* ---------------- 深度注入引擎 ---------------- */
section('深度注入引擎（@D 条目 + depth_prompt + 历史插入）')

const posCard = normalizeCard({
  spec: 'chara_card_v2',
  data: {
    name: '深度卡',
    character_book: {
      entries: [
        { keys: ['a'], content: 'A条', position: 4, depth: 2 },
        { keys: ['b'], content: 'B条', position: 'at_depth', depth: 0 },
        { keys: ['c'], content: 'C条', position: 'before_char' },
        { keys: ['d'], content: 'D条' },
      ],
    },
  },
})
ok(posCard.worldInfo[0].position === 'at_depth' && posCard.worldInfo[0].depth === 2, '数字 position 4 → at_depth，depth 落库')
ok(posCard.worldInfo[1].position === 'at_depth', '字符串 at_depth 直接收')
ok(posCard.worldInfo[2].position === 'before_char' && posCard.worldInfo[3].position === undefined, '其余位置语义保留')

const { buildDepthInjections, injectDepthMessages, splitWorldEntries } = await import('@/chat/lore')
const { inPrompt, atDepth } = splitWorldEntries(posCard.worldInfo)
ok(inPrompt.length === 2 && atDepth.length === 2, '命中分流：普通条目 vs @D 条目')
const depthInj = buildDepthInjections(atDepth)
ok(depthInj.map((d) => d.depth).join(',') === '2,0' && depthInj.every((d) => d.role === 'system'), '深度注入描述（角色 system）')

const depthHist = [
  { role: 'user', content: 'u1' },
  { role: 'assistant', content: 'a1' },
  { role: 'user', content: 'u2' },
]
const depthInjected = injectDepthMessages(depthHist, [
  { content: 'D2条', depth: 2, role: 'system' },
  { content: 'D0条', depth: 0, role: 'system' },
])
ok(depthInjected.length === 5, '插入后总长 +2')
ok(depthInjected[1].content === 'D2条', '深度 2 → 倒数第二条之前')
ok(depthInjected[4].content === 'D0条', '深度 0 → 贴着最后一条之后')
ok(depthHist.length === 3 && depthHist[0].content === 'u1', '原历史不被改写')

const dpCard = normalizeCard({
  spec: 'chara_card_v3',
  data: { name: 'DP卡', extensions: { depth_prompt: { prompt: '保持{{user}}视角', depth: 2, role: 'system' } } },
})
ok(dpCard.depthPrompt?.depth === 2 && dpCard.depthPrompt.prompt.includes('{{user}}'), '卡级 depth_prompt 解析')

/* ---------------- 面板桥与 STscript ---------------- */
section('面板桥（沙箱 iframe）与 STscript 子集')

const { parseBridgeMessage, clampIframeHeight, injectBootstrap, BRIDGE_BOOTSTRAP } = await import('@/chat/card-bridge')
const { parseStscript, executeStscript } = await import('@/chat/stscript')

ok(parseBridgeMessage({ type: 'cl-height', height: 123.4 })?.height === 123.4, '高度消息放行')
ok(parseBridgeMessage({ type: 'cl-height', height: 'x' }) === null, '高度非数字拒绝')
ok(parseBridgeMessage({ type: 'cl-send', text: '你好' })?.text === '你好', 'send 消息放行')
ok(parseBridgeMessage({ type: 'cl-getvar', reqId: 'r1', path: '/hp' })?.reqId === 'r1', 'getvar 消息放行')
ok(parseBridgeMessage({ type: 'cl-setvar', reqId: 'r2', path: 'hp', value: { a: 1 } })?.value?.a === 1, 'setvar 消息带值放行')
ok(parseBridgeMessage({ type: 'cl-unknown' }) === null, '协议外类型拒绝')
ok(parseBridgeMessage('垃圾') === null && parseBridgeMessage(null) === null, '非对象拒绝')

ok(clampIframeHeight(1) === 60 && clampIframeHeight(99999) === 4000, '高度夹取上下限')
ok(clampIframeHeight(333.7) === 334, '高度取整')

const docHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div>面板</div></body></html>'
const injectedHead = injectBootstrap(docHtml, '<b>boot</b>')
ok(injectedHead.indexOf('<b>boot</b>') < injectedHead.indexOf('<div>'), '有 head 时引导进 head 且先于正文')
const noHead = injectBootstrap('<!DOCTYPE html><div>x</div>', '<b>boot</b>')
ok(noHead.startsWith('<!DOCTYPE html>') && noHead.includes('<b>boot</b>'), '无 head 贴 doctype 之后')
const bare = injectBootstrap('<div>x</div>', '<b>boot</b>')
ok(bare.startsWith('<b>boot</b>'), '裸片段前插')
ok(BRIDGE_BOOTSTRAP.includes('cl-getvar') && BRIDGE_BOOTSTRAP.includes('ResizeObserver'), '引导脚本带桥面与高度上报')

ok(parseStscript('/send 开局|/setvar hp 65|/gen 继续').length === 3, '管道分段')
const firstStep = parseStscript('/send 开局')[0]
ok(firstStep.command === 'send' && firstStep.args === '开局', '命令与参数拆分')
ok(parseStscript('纯文本')[0].command === '' && parseStscript('纯文本')[0].args === '纯文本', '非命令段保留原文')
ok(parseStscript('/不认识 x')[0].command === '(unknown)', '斜杠开头但命令名不合法 → 标记丢弃')

const bridgeCalls = []
await executeStscript('/send 开局|/setvar hp 65|/不认识 x', {
  send: async (t) => bridgeCalls.push(['send', t]),
  regenerateLast: async () => bridgeCalls.push(['regen']),
  setVar: async (p, v) => bridgeCalls.push(['setvar', p, v]),
})
ok(JSON.stringify(bridgeCalls) === JSON.stringify([['send', '开局'], ['setvar', 'hp', 65]]), '顺序执行、setvar 数值化、未知命令丢弃')

// 导出回写：脚本与 QR 不因「导入再导出」而丢失
const { cardToV2, cardToV3 } = await import('@/chat/card-json')
const qrDoc = settingFromCard(qrCard)
ok(qrDoc.quickReplies?.length === 4, 'QR 透传到设定文档')
const v3Out = cardToV3(qrDoc).data
ok(Array.isArray(v3Out.extensions.quick_replies) && v3Out.extensions.quick_replies.length === 4, '导出 V3 回写 quick_replies')
ok(v3Out.extensions.quick_replies[2].isVisible === false, '隐藏按钮回写 isVisible')
const regexDoc = settingFromCard(regexCard)
ok(cardToV2(regexDoc).data.extensions.regex_scripts.length === 7, '导出 V2 回写 regex_scripts')
ok(
  cardToV3(regexDoc).data.extensions.regex_scripts[0].findRegex === '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g',
  'findRegex 还原斜杠包装'
)

/* ---------------- 请求体装配（拦截平台层，不联网） ---------------- */
section('请求装配')

const { initPlatform, platform } = await import('@/platform')
const { initRepo } = await import('@/db/runtime')
const { useApp } = await import('@/chat/store')
const { emptySetting } = await import('@/chat/settings')

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

const doc = emptySetting()
doc.name = '林深'
doc.body = '深夜电台主播，今晚的听众只有{{user}}一个人'
doc.entries = [{ id: 'e', keys: ['节目'], content: '节目叫《夜航》', enabled: true }]

st().importSetting(doc)

await st().startWithSettings([doc.id])
const created = st().sessions[0]
ok(created.settingIds?.[0] === doc.id, '会话记录了设定文件')

await st().send('节目叫什么')
const body = captured
ok(Boolean(body), '捕获到请求体')
ok(body.temperature === undefined, '没设温度时请求里不出现 temperature')
ok(body.top_p === 0.95, `采样参数来自全局设置（top_p ${body.top_p}）`)
ok(body.max_tokens === 999, `最大输出来自全局设置（${body.max_tokens}）`)
const sys = body.messages[0].role === 'system' ? body.messages[0].content : ''
ok(sys.includes('林深') && sys.includes('深夜电台主播'), '设定正文进了 system prompt')
ok(sys.includes('节目叫《夜航》'), '关键词条目命中后进了 system prompt')
ok(sys.includes('旅人') && !sys.includes('{{user}}'), '设定里的 {{user}} 被替换成用户名')
ok(body.messages.some((m) => m.content === '节目叫什么'), '用户消息在')

// 换一个会话，参数仍应来自全局设置
await st().startWithSettings([doc.id])
await st().send('再说一次')
ok(captured.top_p === 0.95 && captured.max_tokens === 999, `换会话后参数不变（top_p ${captured.top_p} / ${captured.max_tokens}）`)

// 提示词按会话绑定：选了才带，不选就什么都不注入
const promptDoc = { id: 'pr-1', name: '严谨编辑', text: '不要用形容词', createdAt: 0, updatedAt: 0 }
st().savePrompt(promptDoc)

await st().startWithSettings([doc.id], promptDoc.id)
ok(st().sessions[0].promptId === promptDoc.id, '会话记录了绑定的提示词')
await st().send('再来一次')
ok(captured.messages[0].content.includes('不要用形容词'), '提示词进了 system prompt')

await st().startWithSettings([doc.id])
await st().send('不带提示词')
ok(!captured.messages[0].content.includes('不要用形容词'), '不选提示词就不注入，默认是干净的')

/* ---------------- 思考强度 ---------------- */
section('思考强度')

const { reasoningEfforts, reasoningPayload, canDisable, supportsTemperature, pickAdapter } =
  await import('@/chat/reasoning')
const { inferReasoning } = await import('@/chat/models')
const { buildChatRequest } = await import('@/chat/protocol')
const { normalize } = await import('@/chat/models')

const DEEPSEEK = 'https://api.deepseek.com/v1'
const ZHIPU = 'https://open.bigmodel.cn/api/paas/v4'
const DASHSCOPE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const OPENAI = 'https://api.openai.com/v1'
const OPENROUTER = 'https://openrouter.ai/api/v1'
const ANTHROPIC = 'https://api.anthropic.com/v1'
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

// 方言选择：协议定大方向，服务商预设定 OpenAI 兼容网关的具体方言
ok(pickAdapter('openai', DEEPSEEK, 'deepseek-chat').id === 'deepseek-thinking', 'DeepSeek 用 thinking + effort')
ok(pickAdapter('openai', ZHIPU, 'glm-4-flash').id === 'glm-thinking', '智谱用 thinking + effort')
ok(pickAdapter('openai', DASHSCOPE, 'qwen-plus').id === 'qwen-thinking', '百炼用 enable_thinking')
ok(pickAdapter('openai', OPENAI, 'gpt-4o-mini').id === 'openai-effort', 'OpenAI 用 reasoning_effort')
ok(pickAdapter('openai', OPENROUTER, 'x/y').id === 'openrouter', 'OpenRouter 用统一 reasoning')
ok(pickAdapter('openai', 'https://my-gateway.example/v1', 'x').id === 'openai-effort', '未知网关按 OpenAI 风格处理')
ok(pickAdapter('anthropic', ANTHROPIC, 'claude-sonnet-4-5').id === 'anthropic-budget', 'Claude 4.5 用预算')
ok(pickAdapter('anthropic', ANTHROPIC, 'claude-opus-4-7').id === 'anthropic-adaptive', 'Claude 4.7 用 adaptive')
ok(pickAdapter('gemini', GEMINI, 'gemini-2.5-flash').id === 'gemini-budget', 'Gemini 2.5 用预算')
ok(pickAdapter('gemini', GEMINI, 'gemini-3-pro').id === 'gemini-level', 'Gemini 3 用档位')

// 档位列表由适配器给；不支持思考就没有选项
ok(reasoningEfforts('openai', OPENAI, 'gpt-4o-mini', { reasoning: false }).length === 0, '不支持思考的模型没有档位')
const dsEfforts = reasoningEfforts('openai', DEEPSEEK, 'deepseek-chat', { reasoning: true })
ok(dsEfforts.map((e) => e.id).join(',') === 'low,high,max,off', `DeepSeek 档位 ${dsEfforts.map((e) => e.id).join('/')}`)
ok(!reasoningEfforts('openai', ZHIPU, 'glm-5.3', { reasoning: true }).some((e) => e.id === 'off'), 'GLM 5.3 不能关，不提供「关」')
ok(!reasoningEfforts('gemini', GEMINI, 'gemini-3-pro', { reasoning: true }).some((e) => e.id === 'off'), 'Gemini 3 不能关')
ok(
  reasoningEfforts('openai', OPENAI, 'qwen3', { reasoning: true, reasoningLevels: ['low', 'high'] })
    .filter((e) => e.id !== 'off')
    .map((e) => e.id)
    .join(',') === 'low,high',
  '服务商声明的档位优先'
)

// 各家载荷形态
const dsPayload = reasoningPayload('openai', 'high', { baseUrl: DEEPSEEK, modelId: 'deepseek-chat' })
ok(
  dsPayload.openai.thinking.type === 'enabled' && dsPayload.openai.reasoning_effort === 'high',
  'DeepSeek 同时发开关与档位'
)
ok(reasoningPayload('openai', 'off', { baseUrl: DEEPSEEK, modelId: 'deepseek-chat' }).openai.thinking.type === 'disabled', 'DeepSeek 关闭用 thinking.type')

const anthNew = reasoningPayload('anthropic', 'high', { baseUrl: ANTHROPIC, modelId: 'claude-opus-4-7' })
ok(anthNew.anthropic.thinking.type === 'adaptive', 'Claude 4.7 用 adaptive')
ok(anthNew.anthropic.output_config.effort === 'high', 'Claude 4.7 用 output_config.effort')
ok(anthNew.thinkingEnabled === true, '标记思考已开启')

const anthOld = reasoningPayload('anthropic', 'high', { baseUrl: ANTHROPIC, modelId: 'claude-sonnet-4-5' })
ok(anthOld.anthropic.thinking.budget_tokens === 8192, 'Claude 4.5 用 budget_tokens')
ok(anthOld.minMaxTokens > 8192, '预算会把 max_tokens 下限抬上去')

ok(
  reasoningPayload('gemini', 'high', { baseUrl: GEMINI, modelId: 'gemini-3-pro' }).gemini.thinkingConfig.thinkingLevel === 'high',
  'Gemini 3 发 thinkingLevel'
)
ok(
  reasoningPayload('gemini', 'high', { baseUrl: GEMINI, modelId: 'gemini-2.5-flash' }).gemini.thinkingConfig.thinkingBudget === 24576,
  'Gemini 2.5 发 thinkingBudget'
)

const qwenPayload = reasoningPayload('openai', 'medium', { baseUrl: DASHSCOPE, modelId: 'qwen-plus' })
ok(qwenPayload.openai.enable_thinking === true && qwenPayload.openai.thinking_budget === 4096, 'Qwen 用 enable_thinking + thinking_budget')
ok(reasoningPayload('openai', 'off', { baseUrl: DASHSCOPE, modelId: 'qwen-plus' }).openai.enable_thinking === false, 'Qwen 关闭用 enable_thinking=false')
ok(reasoningPayload('openai', 'high', { baseUrl: OPENROUTER, modelId: 'x/y' }).openai.reasoning.effort === 'high', 'OpenRouter 用统一 reasoning.effort')
ok(Object.keys(reasoningPayload('openai', undefined)).length === 0, '默认不干预：不发任何参数')

// 不能关的模型
ok(!canDisable('o3'), 'o 系列不能关')
ok(!canDisable('gemini-2.5-pro'), 'Gemini 2.5 Pro 不能关')
ok(!canDisable('glm-5.3'), 'GLM 5.3 不能关')
ok(canDisable('Qwen/Qwen3-8B'), 'qwen3 可以关')

// 温度与推理模型互斥
ok(supportsTemperature('deepseek-chat'), 'deepseek-chat 接收温度')
ok(!supportsTemperature('o3') && !supportsTemperature('gpt-5'), '推理模型不接收温度')

// 模型名推断（网关普遍只给 id）
ok(inferReasoning('Qwen/Qwen3-8B'), 'qwen3 推断为支持思考')
ok(inferReasoning('deepseek-chat'), 'deepseek-chat 推断为支持思考（V4.1-Flash 默认思考）')
ok(inferReasoning('deepseek-ai/DeepSeek-V4-Flash'), 'deepseek-v4 推断为支持思考')
ok(inferReasoning('zai-org/GLM-5.3-Flash'), 'glm-5 推断为支持思考')
ok(inferReasoning('openai/gpt-5'), 'gpt-5 推断为支持思考')
ok(!inferReasoning('Qwen/Qwen2.5-7B-Instruct'), 'qwen2.5 不误判')
ok(!inferReasoning('baai/bge-m3'), '向量模型不误判')

section('上下文上限跟随模型')

// 上限属于模型：换模型必须换上限，否则进度条会拿旧窗口算用量，用量被低估
st().saveConfig({ model: 'model-a', contextLimit: 128000 })
st().selectModel({ id: 'model-b', contextLength: 32000 })
ok(st().config.contextLimit === 32000, '换到声明了长度的模型：上限跟着换')

st().selectModel({ id: 'model-c' })
ok(st().config.contextLimit === undefined, '换到没声明长度的模型：清空，不沿用上一个模型的窗口')

st().saveConfig({ contextLimit: 8000 })
st().selectModel({ id: 'model-c' })
ok(st().config.contextLimit === 8000, '重选同一模型：保留手填的上限')

// 还原初始配置，后面的用例依赖它
st().saveConfig({ model: 'test-model', contextLimit: undefined })

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

const bodyAt = (baseUrl, protocol, opts) =>
  JSON.parse(
    buildChatRequest(protocol, { baseUrl, apiKey: 'k' }, { model: 'm', messages: msgs, stream: true, ...opts }).body
  )

const anthOn = bodyOf('anthropic', { reasoningLevel: 'medium', maxTokens: 512, model: 'claude-sonnet-4-5' })
ok(anthOn.thinking?.type === 'enabled' && anthOn.thinking.budget_tokens === 4096, 'Claude 4.5 请求体带 budget_tokens')
ok(anthOn.max_tokens > anthOn.thinking.budget_tokens, `max_tokens 自动大于预算（${anthOn.max_tokens} > 4096）`)
ok(bodyOf('anthropic', { reasoningLevel: 'off', model: 'claude-sonnet-4-5' }).thinking?.type === 'disabled', 'Claude 关闭带 disabled')

const anthAdaptiveBody = bodyOf('anthropic', { reasoningLevel: 'high', model: 'claude-opus-4-7' })
ok(anthAdaptiveBody.thinking?.type === 'adaptive' && anthAdaptiveBody.output_config?.effort === 'high', 'Claude 4.7 请求体走 adaptive')
ok(!('temperature' in anthAdaptiveBody), 'Anthropic 开思考时不发温度')

const dsBody = bodyAt(DEEPSEEK, 'openai', { reasoningLevel: 'high', model: 'deepseek-chat' })
ok(dsBody.thinking?.type === 'enabled' && dsBody.reasoning_effort === 'high', 'DeepSeek 请求体带 thinking 与 effort')

ok(bodyOf('gemini', { reasoningLevel: 'low' }).generationConfig?.thinkingConfig?.thinkingBudget === 1024, 'Gemini 2.5 带 thinkingBudget')
ok(bodyOf('gemini', { reasoningLevel: 'off' }).generationConfig?.thinkingConfig?.thinkingBudget === 0, 'Gemini 关闭写 0')

const gemLevel = bodyOf('gemini', { reasoningLevel: 'high', model: 'gemini-3-pro' })
ok(gemLevel.generationConfig?.thinkingConfig?.thinkingLevel === 'high', 'Gemini 3 带 thinkingLevel')
ok(!('thinkingBudget' in (gemLevel.generationConfig?.thinkingConfig ?? {})), 'Gemini 3 不混发 thinkingBudget')

// 元数据解析
const parsedModels = normalize(
  { data: [{ id: 'x', supports_reasoning: true, reasoning_efforts: ['low', 'medium'] }] },
  'openai'
)
ok(parsedModels[0].reasoning === true && parsedModels[0].reasoningLevels?.join(',') === 'low,medium', '从模型元数据解析档位')

// DeepSeek 官方 /models 的真实形状（2026-10 实测）
const deepseekModels = normalize(
  {
    object: 'list',
    data: [
      {
        id: 'deepseek-flash',
        object: 'model',
        owned_by: 'deepseek',
        name: 'DeepSeek-V4.1-Flash',
        context_window: 1048576,
        max_output_tokens: 393216,
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
        effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' },
      },
    ],
  },
  'openai'
)
ok(deepseekModels[0].contextLength === 1048576, 'DeepSeek 的 context_window 被认出来')
ok(deepseekModels[0].reasoningLevels?.join(',') === 'low,high,max', 'DeepSeek 的 effort.supported_levels 被认出来')
ok(deepseekModels[0].reasoning === true, '声明了档位就等于支持思考')
ok(deepseekModels[0].vision === true, 'input_modalities 里的 image 映射成 vision')
ok(deepseekModels[0].label === 'DeepSeek-V4.1-Flash', 'name 字段当显示名')

/* ---------------- 采样参数 ---------------- */
section('采样参数')

ok(supportsTemperature('deepseek-chat'), 'deepseek-chat 接收温度')
ok(supportsTemperature('Qwen/Qwen3-8B'), 'qwen3 接收温度（关掉思考时仍然有效）')
ok(!supportsTemperature('o3'), 'o3 不接收温度')
ok(!supportsTemperature('gpt-5'), 'gpt-5 不接收温度')
ok(!supportsTemperature('deepseek-reasoner'), 'deepseek-reasoner 不接收温度')

ok(bodyOf('openai', { temperature: 0.8 }).temperature === 0.8, 'OpenAI 请求体带 temperature')
ok(bodyOf('anthropic', { temperature: 0.8 }).temperature === 0.8, 'Anthropic 请求体带 temperature')
ok(bodyOf('gemini', { temperature: 0.8 }).generationConfig?.temperature === 0.8, 'Gemini 写在 generationConfig 里')
ok(!('temperature' in bodyOf('openai', {})), '不设温度时不下发')
ok(!('temperature' in bodyOf('openai', { temperature: 0.8, model: 'o3' })), '推理模型不下发温度')
ok(
  !('temperature' in bodyOf('anthropic', { temperature: 0.8, reasoningLevel: 'medium' })),
  'Anthropic 开思考时不下发温度（预算与温度互斥）'
)
ok(bodyOf('openai', { temperature: 0 }).temperature === 0, '温度 0 是有效值，不能被当成未设置')

/* ---------------- 附件 ---------------- */
section('附件')

const { userText, wireImages, hasContent } = await import('@/chat/attachments')

const txtFile = { id: 'a1', kind: 'text', name: '设定.md', mime: 'text/markdown', size: 10, text: '这是文件内容' }
const imgFile = { id: 'a2', kind: 'image', name: 'shot.png', mime: 'image/jpeg', size: 100, dataUrl: 'data:image/jpeg;base64,AAAA' }

ok(userText('看看这个', [txtFile]).includes('看看这个'), '文本附件不会顶掉用户正文')
ok(userText('看看这个', [txtFile]).includes('这是文件内容'), '文本附件拼进正文')
ok(userText('看看这个', [txtFile]).includes('【文件：设定.md】'), '附件带文件名分隔')
ok(userText('', [txtFile]) === '【文件：设定.md】\n这是文件内容', '只有附件时正文就是文件块')
ok(hasContent('', [imgFile]) === true, '只有图片也算有内容')
ok(hasContent('   ') === false, '空白文本不算内容')

const imgs = wireImages([txtFile, imgFile])
ok(imgs.length === 1 && imgs[0].data === 'AAAA', '图片拆成裸 base64')
ok(imgs[0].mime === 'image/jpeg', '保留图片 mime')
ok(wireImages([txtFile]) === undefined, '没有图片时返回 undefined')

// 辅助识图：图片转成文字后不再发原图
const { resolveVisionTarget } = await import('@/chat/vision')
const { listProviders, keyForProvider, withCredential } = await import('@/chat/credentials')

ok(resolveVisionTarget({}) === null, '没配识图模型时不启用')
ok(
  resolveVisionTarget({ visionModel: { enabled: false, baseUrl: 'https://x', model: 'm' } }) === null,
  '配了但关掉时不启用'
)
const visionBase = { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k', model: 'claude' }
ok(resolveVisionTarget({ ...visionBase, visionModel: { enabled: true } })?.model === 'claude', '不选服务商时用当前模型')
ok(
  resolveVisionTarget({
    ...visionBase,
    visionModel: { enabled: true, baseUrl: 'https://api.anthropic.com/v1', model: 'claude' },
  })?.protocol === 'anthropic',
  '识图目标按地址猜协议（Anthropic）'
)
ok(
  resolveVisionTarget({ ...visionBase, visionModel: { enabled: true, baseUrl: 'https://x.com/v1', model: 'm' } })?.protocol ===
    'openai',
  '识图目标按地址猜协议（OpenAI 兼容）'
)
// 只换了服务商、没选模型：拿 A 的模型名去请求 B 一定失败，退回当前对话
const halfVision = resolveVisionTarget({
  ...visionBase,
  visionModel: { enabled: true, baseUrl: 'https://api.openai.com/v1' },
})
ok(halfVision?.baseUrl === visionBase.baseUrl && halfVision?.model === 'claude', '只换服务商没选模型时退回当前对话')

// 已添加的服务商：填过 Key 的都算
const multi = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-openai',
  model: 'gpt-4o',
  credentials: { 'https://api.deepseek.com/v1': 'sk-ds' },
}
ok(listProviders(multi).length === 2, `列出 ${listProviders(multi).length} 个已添加的服务商`)
ok(listProviders(multi)[0].current === true, '当前服务商排在最前')
ok(keyForProvider(multi, 'https://api.deepseek.com/v1') === 'sk-ds', '按地址取到对应 Key')
ok(
  resolveVisionTarget({
    ...multi,
    visionModel: { enabled: true, baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash' },
  })?.apiKey === 'sk-ds',
  '识图用所选服务商的 Key'
)
ok(withCredential(multi).credentials['https://api.openai.com/v1'] === 'sk-openai', '保存配置时记住当前 Key')

const described = { ...imgFile, description: '一只猫趴在键盘上' }
ok(userText('看图', [described]).includes('【图片：shot.png】'), '图片描述带文件名分隔')
ok(userText('看图', [described]).includes('一只猫趴在键盘上'), '图片描述进了正文')
ok(wireImages([described]) === undefined, '有描述的图片不再发原图')
ok(wireImages([imgFile]) !== undefined, '没描述的图片仍然发原图')

const imgMsg = { role: 'user', content: '这是什么', images: imgs }
const openaiBody = JSON.parse(buildChatRequest('openai', auth, { model: 'm', messages: [imgMsg], stream: true }).body)
ok(Array.isArray(openaiBody.messages[0].content), 'OpenAI 有图时 content 变成数组')
ok(openaiBody.messages[0].content[1].type === 'image_url', 'OpenAI 用 image_url')
ok(openaiBody.messages[0].content[1].image_url.url.startsWith('data:image/jpeg;base64,'), 'OpenAI 用 data URL')

const anthBody = JSON.parse(buildChatRequest('anthropic', auth, { model: 'm', messages: [imgMsg], stream: true }).body)
ok(anthBody.messages[0].content[1].type === 'image', 'Anthropic 用 image 块')
ok(anthBody.messages[0].content[1].source.type === 'base64', 'Anthropic 用 base64 source')
ok(anthBody.messages[0].content[1].source.data === 'AAAA', 'Anthropic 只带裸数据')

const gemBody = JSON.parse(buildChatRequest('gemini', auth, { model: 'm', messages: [imgMsg], stream: true }).body)
ok(gemBody.contents[0].parts[1].inline_data.mime_type === 'image/jpeg', 'Gemini 用 inline_data')
ok(gemBody.contents[0].parts[1].inline_data.data === 'AAAA', 'Gemini 只带裸数据')

const plainBody = JSON.parse(buildChatRequest('openai', auth, { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }).body)
ok(typeof plainBody.messages[0].content === 'string', '没有图片时仍是字符串，向后兼容')

/* ---------------- 附件文档解析（PDF / Office / zip） ---------------- */
section('附件文档解析')
const { zipSync: zs, strToU8: su } = await import('fflate')
const ex = await import('@/chat/extract')
const { extractPdfText } = await import('@/chat/pdf')
const att = await import('@/chat/attachments')
ok(att.MAX_IMAGES === 9, '图片上限放宽到 9 张')
ok(att.MAX_TEXT_CHARS === 200_000, '文本附件上限放宽到 20 万字符')

// —— docx：段落 / tab / br / 实体
const docxBytes = zs({
  '[Content_Types].xml': su('<Types/>'),
  'word/document.xml': su(
    '<w:document><w:body>'
    + '<w:p><w:r><w:t>第一段正文</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>名称 &amp; 编号</w:t><w:tab/><w:t>第二列</w:t><w:br/><w:t>段内换行</w:t></w:r></w:p>'
    + '</w:body></w:document>',
  ),
})
const docxOut = await ex.extractZipText(docxBytes)
ok(docxOut.includes('第一段正文'), 'docx 抽出段落')
ok(docxOut.includes('名称 & 编号'), 'docx 解 XML 实体')
ok(docxOut.includes('第二列') && docxOut.includes('段内换行'), 'docx 的 tab / br 保留')

// —— xlsx：共享字符串 / 行列对齐 / 日期序列号
const xlsxBytes = zs({
  'xl/workbook.xml': su('<workbook><sheets><sheet name="库存" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': su('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/sharedStrings.xml': su('<sst><si><t>香蕉</t></si><si><r><t>苹</t></r><r><t>果</t></r></si></sst>'),
  'xl/styles.xml': su('<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="0"/></cellXfs></styleSheet>'),
  'xl/worksheets/sheet1.xml': su(
    '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>名称</t></is></c><c r="B1" t="inlineStr"><is><t>数量</t></is></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>12.5</v></c></row>'
    + '<row r="3"><c r="A3" t="b"><v>1</v></c></row>'
    + '<row r="4"><c r="A4" t="s"><v>0</v></c><c r="B4" s="1"><v>45123</v></c></row>'
    + '</sheetData></worksheet>',
  ),
})
const xlsxOut = await ex.extractZipText(xlsxBytes)
ok(xlsxOut.includes('【工作表：库存】'), 'xlsx 报出工作表名')
ok(xlsxOut.includes('苹果\t12.5'), 'xlsx 共享字符串与数字对齐到列')
ok(xlsxOut.includes('香蕉'), 'xlsx 共享字符串第 0 项可取')
ok(xlsxOut.includes('TRUE'), 'xlsx 布尔单元格转 TRUE/FALSE')
ok(xlsxOut.includes('2023-07-16'), 'xlsx 日期序列号（45123）转成日期')

// —— pptx：幻灯片按数字排序
const pptxBytes = zs({
  'ppt/presentation.xml': su('<presentation/>'),
  'ppt/slides/slide2.xml': su('<p:sld><p:txBody><a:p><a:r><a:t>第二页</a:t></a:r></a:p></p:txBody></p:sld>'),
  'ppt/slides/slide10.xml': su('<p:sld><p:txBody><a:p><a:r><a:t>第十页</a:t></a:r></a:p></p:txBody></p:sld>'),
  'ppt/slides/slide1.xml': su('<p:sld><p:txBody><a:p><a:r><a:t>第一页</a:t></a:r></a:p></p:txBody></p:sld>'),
})
const pptxOut = await ex.extractZipText(pptxBytes)
ok(
  pptxOut.indexOf('第一页') < pptxOut.indexOf('第二页') && pptxOut.indexOf('第二页') < pptxOut.indexOf('第十页'),
  'pptx 幻灯片按数字序（slide10 不排在 slide2 前）',
)

// —— 普通 zip：文本提出、二进制跳过、嵌套 docx 也能解析
const plainZip = zs({
  '说明.txt': su('这是包里的文本'),
  'notes/todo.md': su('- 待办一'),
  'img/logo.png': su('definitely-not-a-png'),
})
const zipOut = await ex.extractZipText(plainZip)
ok(zipOut.includes('【文件：说明.txt】') && zipOut.includes('这是包里的文本'), 'zip 里的文本文件被提出')
ok(zipOut.includes('- 待办一'), 'zip 子目录里的文本也提')
ok(zipOut.includes('1 个文件不是文本'), 'zip 报告跳过的二进制数量')
const nestedOut = await ex.extractZipText(zs({ 'report.docx': docxBytes }))
ok(nestedOut.includes('第一段正文'), 'zip 里嵌的 docx 也被解析')

// —— 解压护栏：超大条目（解压后 >20MB）不解，其余照常
const hugeEntry = 'A'.repeat(21 * 1024 * 1024)
const guardedOut = await ex.extractZipText(zs({ '大文件.txt': su(hugeEntry), '小文件.txt': su('护栏内的文本') }))
ok(guardedOut.includes('护栏内的文本'), '解压护栏不误伤普通条目')
let guarded = ''
try {
  await ex.extractZipText(zs({ '大文件.txt': su(hugeEntry) }))
} catch (e) {
  guarded = e.message
}
ok(guarded.includes('没有能转成文本的文件'), '全包都是超大条目时明确报错')

// —— PDF：手工拼最小 PDF，走 pdfjs（node 下 external 加载 + 假 worker）
const makePdf = (streamBody) => {
  const objs = []
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>'
  objs[2] = '<</Type/Pages/Kids[3 0 R]/Count 1>>'
  objs[3] = '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'
  objs[4] = `<</Length ${streamBody.length}>>\nstream\n${streamBody}\nendstream`
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
  let str = '%PDF-1.4\n'
  const offs = [0]
  for (let i = 1; i <= 5; i++) {
    offs[i] = str.length
    str += `${i} 0 obj\n${objs[i]}\nendobj\n`
  }
  const xref = str.length
  str += 'xref\n0 6\n0000000000 65535 f \n'
  for (let i = 1; i <= 5; i++) str += `${String(offs[i]).padStart(10, '0')} 00000 n \n`
  str += `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return su(str)
}
const pdfBytes = makePdf('BT /F1 24 Tf 72 700 Td (Hello PDF 2026) Tj ET')
const pdfOut = await extractPdfText(pdfBytes)
ok(pdfOut.pages === 1 && pdfOut.text.includes('Hello PDF 2026'), 'PDF 用 pdfjs 抽出文本')

// —— readAttachment 端到端：File 判型 + 截断 + 报错
const docxAttach = await att.readAttachment(new File([docxBytes], '设定稿.docx'))
ok(docxAttach.kind === 'text' && docxAttach.text.includes('第一段正文'), 'readAttachment 把 docx 变成文本附件')
const pdfAttach = await att.readAttachment(new File([pdfBytes], '论文.pdf'))
ok(pdfAttach.kind === 'text' && pdfAttach.text.includes('Hello PDF 2026'), 'readAttachment 把 PDF 变成文本附件')
const longAttach = await att.readAttachment(new File(['啊'.repeat(att.MAX_TEXT_CHARS + 1)], '长文.txt'))
ok(longAttach.truncated === true && longAttach.text.length === att.MAX_TEXT_CHARS, '超过 20 万字符仍会截断并留标记')
let threw = ''
try {
  await att.readAttachment(new File([su('MZbinaryjunk')], '程序.exe'))
} catch (e) {
  threw = e.message
}
ok(threw.includes('暂不支持'), '不认识的类型给出明确报错')
let scanned = ''
try {
  await att.readAttachment(new File([makePdf('')], '扫描件.pdf'))
} catch (e) {
  scanned = e.message
}
ok(scanned.includes('没有可提取的文字'), '没有文字层的 PDF 给出扫描件提示')

/* ---------------- 联网搜索 ---------------- */
section('联网搜索')

const { formatSearchOutput, resolveSearchKey, resolveSearchSource, parseBingHtml, EXTERNAL_CONTENT_NOTICE } =
  await import('@/chat/web-search')

/** 把一批 SSE 字符串喂给解析器，收集所有 delta */
const feed = async function* (chunks) {
  for (const chunk of chunks) yield chunk
}
const collect = async (protocol, chunks) => {
  const out = []
  for await (const delta of parseStream(protocol, feed(chunks))) out.push(delta)
  return out
}
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`
const { parseStream } = await import('@/chat/sse')

const sampleResult = {
  sources: [{ url: 'https://a.com/x', title: 'A 站', summary: '摘要内容', publishedAt: '2026-10-16T00:00:00+00:00' }],
  truncated: true,
}
const searchText = formatSearchOutput(sampleResult)
ok(searchText.startsWith(EXTERNAL_CONTENT_NOTICE), '搜索结果带外部内容警告')
ok(searchText.includes('- [A 站](https://a.com/x)'), '来源按 markdown 链接列出')
ok(searchText.includes('2026-10-16'), '来源带日期')
ok(searchText.includes('引用'), '要求模型引用来源')
ok(searchText.includes('只显示前 1 条'), '截断时有提示')
ok(formatSearchOutput({ sources: [], truncated: false }).includes('没有搜到'), '空结果有明确说明')

ok(resolveSearchKey({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k' }) === 'k', 'DeepSeek 地址复用模型 key')
ok(resolveSearchKey({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }) === null, '非 DeepSeek 地址不自动复用')
ok(resolveSearchKey({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', searchApiKey: 's' }) === 's', '专用搜索 key 优先')

// 源选择：有 key 走 API，没有就落到免配置兜底
ok(resolveSearchSource({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k' }).id === 'deepseek', '有 key 用 DeepSeek')
ok(resolveSearchSource({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }).id === 'bing', '没 key 落到 Bing 兜底')
ok(
  resolveSearchSource({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', searchSource: 'deepseek' }).id === 'deepseek',
  '手动指定优先于自动判断'
)

// Bing 结果页解析
const bingHtml = [
  '<li class="b_algo"><h2><a href="https://a.com/1">A 标题</a></h2><p>摘要一</p></li>',
  '<li class="b_algo"><h2><a href="https://b.com/2">B &amp; 标题</a></h2><p>摘要&ensp;二</p></li>',
].join('')
const bingParsed = parseBingHtml(bingHtml)
ok(bingParsed.length === 2, '解析出 2 条 Bing 结果')
ok(bingParsed[0].url === 'https://a.com/1' && bingParsed[0].title === 'A 标题', '标题与链接正确')
ok(bingParsed[1].title === 'B & 标题', 'HTML 实体被解码')
ok(bingParsed[0].snippet === '摘要一', '摘要被取出来')

const wrapped = parseBingHtml(
  '<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS8&amp;ntb=1">X</a></h2></li>'
)
ok(wrapped[0]?.url === 'https://example.com/', 'Bing 跳转链接被还原成真实地址')
ok(parseBingHtml('<html>验证码</html>').length === 0, '页面被拦时解析为空而不是乱猜')

// 自定义搜索接口：请求拼装 + 结果映射
const { mapCustomResults, buildCustomRequest, CUSTOM_PRESETS } = await import('@/chat/web-search')

ok(mapCustomResults({ results: [{ title: 'T', url: 'https://a.com', content: '摘要' }] })[0].snippet === '摘要', '认 Tavily 的 results/content')
ok(
  mapCustomResults({ data: { webPages: { value: [{ name: 'N', url: 'https://b.com', snippet: 's' }] } } })[0].title === 'N',
  '认博查的 data.webPages.value/name'
)
ok(
  mapCustomResults({ web: { results: [{ title: 'x', url: 'https://c.com', description: 'd' }] } })[0].snippet === 'd',
  '认 Brave 的 web.results/description'
)
ok(mapCustomResults({ organic: [{ title: 'y', link: 'https://d.com' }] })[0].url === 'https://d.com', '认 Serper 的 organic/link')
ok(mapCustomResults({ foo: { bar: [{ name: 'q', href: 'https://e.com' }] } })[0].url === 'https://e.com', '陌生结构递归也能找到')
ok(mapCustomResults({ error: 'nope' }).length === 0, '认不出时返回空而不是乱猜')

const tavilyPreset = CUSTOM_PRESETS.find((p) => p.id === 'tavily').config
const tavilyReq = buildCustomRequest('你好 世界', { ...tavilyPreset, key: 'tvly-1' })
ok(tavilyReq.method === 'POST', 'Tavily 预设用 POST')
ok(tavilyReq.headers.Authorization === 'Bearer tvly-1', 'Key 自动放进 Authorization')
ok(JSON.parse(tavilyReq.body).query === '你好 世界', '请求体里的 {{query}} 被替换')
ok(JSON.parse(tavilyReq.body).max_results === 5, '{{count}} 被替换成条数')

const bravePreset = CUSTOM_PRESETS.find((p) => p.id === 'brave').config
const braveReq = buildCustomRequest('a b', { ...bravePreset, key: 'bk' })
ok(braveReq.method === 'GET' && braveReq.body === undefined, 'GET 不带请求体')
ok(braveReq.url.includes('q=a%20b'), 'URL 里的查询词被编码')
ok(braveReq.headers['X-Subscription-Token'] === 'bk', '自定义请求头里的 {{key}} 被替换')

ok(CUSTOM_PRESETS.length >= 4, `内置 ${CUSTOM_PRESETS.length} 个常用服务商预设`)
ok(
  resolveSearchSource({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', searchSource: 'custom' }).id === 'custom',
  '可以切到自定义源'
)

// 上游自带搜索：按协议 + 服务商分派
const { nativeSearchPayload, nativeSearchSupported, resolveNativeSearchTarget } = await import('@/chat/native-search')
const { resolveSearchMode, localSearchReady } = await import('@/chat/web-search')

ok(nativeSearchSupported('anthropic', 'anthropic'), 'Anthropic 支持上游搜索')
ok(
  nativeSearchPayload('anthropic', 'anthropic').anthropic.tools[0].type === 'web_search_20250305',
  'Anthropic 用 web_search 服务端工具'
)
ok(nativeSearchPayload('gemini', 'gemini').gemini.tools[0].google_search !== undefined, 'Gemini 用 google_search')
ok(nativeSearchPayload('openai', 'dashscope').openai.enable_search === true, 'Qwen 用 enable_search')
ok(nativeSearchPayload('openai', 'zhipu').openai.tools[0].type === 'web_search', '智谱用 web_search 工具')
ok(nativeSearchPayload('openai', 'openrouter').modelSuffix === ':online', 'OpenRouter 用 :online 后缀')
ok(!nativeSearchSupported('openai', 'openai'), 'OpenAI Chat Completions 没有上游搜索')
ok(!nativeSearchSupported('openai', 'deepseek'), 'DeepSeek 的搜索是独立 API，不是聊天参数')

const nativeBody = (protocol, provider) =>
  JSON.parse(
    buildChatRequest(protocol, auth, {
      model: 'm',
      messages: msgs,
      stream: true,
      nativeSearch: nativeSearchPayload(protocol, provider),
    }).body
  )
ok(nativeBody('anthropic', 'anthropic').tools[0].name === 'web_search', 'Anthropic 请求体带上搜索工具')
ok(nativeBody('gemini', 'gemini').tools[0].google_search !== undefined, 'Gemini 请求体带上 google_search')
ok(nativeBody('openai', 'dashscope').enable_search === true, 'Qwen 请求体带上 enable_search')
ok(nativeBody('openai', 'zhipu').tools[0].type === 'web_search', '智谱请求体带上 web_search 工具')

// 三种开关
ok(resolveSearchMode({ searchMode: 'bing' }) === 'bing', '显式模式优先')
ok(resolveSearchMode({ webSearch: true, searchSource: 'bing' }) === 'bing', '旧配置的 bing 映射成 bing 模式')
ok(resolveSearchMode({ webSearch: true, searchSource: 'deepseek' }) === 'local', '旧配置映射成本地模式')
ok(resolveSearchMode({}) === 'off', '默认不联网')
ok(localSearchReady({ baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k' }) === true, '有 DeepSeek key 时本地源可用')
ok(localSearchReady({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }) === false, '没 key 也没自定义时本地源不可用')
ok(
  localSearchReady({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k',
    searchSource: 'custom',
    searchCustom: { url: 'https://x' },
  }) === true,
  '填了自定义接口就可用'
)

// 可用性判定集中管理
const { searchModeStatuses, searchModeHint, effectiveSearchMode } = await import('@/chat/search-status')

const anthStatuses = searchModeStatuses({ baseUrl: 'https://api.anthropic.com/v1', apiKey: 'k' }, 'anthropic', 'anthropic')
const anthNative = anthStatuses.find((s) => s.id === 'native')
ok(anthNative.available && anthNative.recommended, 'Anthropic 下推荐用上游搜索')
ok(anthStatuses.find((s) => s.id === 'local').available === false, '没配 key 时本地源不可用')
ok(anthStatuses.find((s) => s.id === 'bing').available === true, 'Bing 永远可用')

const openaiStatuses = searchModeStatuses({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k' }, 'openai', 'openai')
const openaiNative = openaiStatuses.find((s) => s.id === 'native')
ok(openaiNative.available === false, 'OpenAI 下上游搜索不可用')
ok(String(openaiNative.reason).includes('不支持'), '不可用要给出原因')
ok(effectiveSearchMode({ searchMode: 'native' }, openaiStatuses) === 'off', '选了不可用的模式就退回关')
ok(searchModeHint(anthNative, 'DeepSeek 搜索').includes('厂商'), 'native 的说明文案')

// 上游搜索的来源解析
const anthSourceDeltas = await collect('anthropic', [
  sse({
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: 't1',
      content: [
        { type: 'web_search_result', url: 'https://a.com', title: 'A', page_age: '2026-10-01' },
        { type: 'web_search_result', url: 'https://b.com', title: 'B' },
      ],
    },
  }),
])
const anthSources = anthSourceDeltas.find((d) => d.sources)?.sources ?? []
ok(anthSources.length === 2 && anthSources[0].url === 'https://a.com', 'Anthropic 解析出搜索来源')
ok(anthSources[0].publishedAt === '2026-10-01', 'Anthropic 来源带发布时间')

const gemSourceDeltas = await collect('gemini', [
  sse({
    candidates: [
      {
        content: { parts: [{ text: 'hi' }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://c.com', title: 'C' } }] },
      },
    ],
  }),
])
ok(gemSourceDeltas.find((d) => d.sources)?.sources[0].url === 'https://c.com', 'Gemini 解析出接地来源')

// 把模型内搜索当成一个可插拔后端（DSH 那套）
const nativeSource = resolveSearchSource({
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'k',
  protocol: 'auto',
  model: 'claude-sonnet-4-5',
  searchSource: 'native',
})
ok(nativeSource.id === 'native', '本地源可以选「模型内辅助」')
ok(nativeSource.label.includes('辅助'), '标签说明这是辅助调用')
ok(
  localSearchReady({
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: 'k',
    model: 'claude-sonnet-4-5',
    searchSource: 'native',
  }) === true,
  'Anthropic 下模型内辅助可用'
)
ok(
  localSearchReady({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'k',
    model: 'gpt-4o',
    searchSource: 'native',
  }) === false,
  'OpenAI 下模型内辅助不可用'
)

// 跨模型：主对话随便什么，搜索借 Anthropic
const crossConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-openai',
  model: 'gpt-4o',
  searchSource: 'native',
  credentials: { 'https://api.anthropic.com/v1': 'sk-ant' },
  searchModel: { enabled: true, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
}
ok(localSearchReady(crossConfig) === true, '配了独立搜索模型后，主对话是 OpenAI 也能用')

const crossTarget = resolveNativeSearchTarget(crossConfig)
ok(crossTarget?.protocol === 'anthropic' && crossTarget?.model === 'claude-sonnet-4-5', '辅助调用打给独立的搜索模型')
ok(crossTarget?.apiKey === 'sk-ant', '用搜索模型所在服务商的 Key')
ok(crossTarget?.payload.anthropic !== undefined, '搜索模型用的是 Anthropic 的搜索工具')

// 关掉开关就退回当前模型（当前模型本身得支持上游搜索）
const closedTarget = resolveNativeSearchTarget({
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant',
  model: 'claude-sonnet-4-5',
  searchModel: { enabled: false, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
})
ok(closedTarget?.model === 'claude-sonnet-4-5', '关掉搜索模型开关后退回当前模型')

// 工具定义按协议落到不同字段
const toolDef = {
  name: 'web_search',
  description: '搜网',
  parameters: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' } } }, required: ['queries'] },
}
const withTools = (protocol) =>
  JSON.parse(buildChatRequest(protocol, auth, { model: 'm', messages: msgs, stream: true, tools: [toolDef] }).body)

ok(withTools('openai').tools?.[0]?.function?.name === 'web_search', 'OpenAI 用 function 工具定义')
ok(withTools('anthropic').tools?.[0]?.input_schema?.type === 'object', 'Anthropic 用 input_schema')
ok(withTools('gemini').tools?.[0]?.functionDeclarations?.[0]?.name === 'web_search', 'Gemini 用 functionDeclarations')

// 工具调用的回放：assistant(tool_calls) → tool(result)
const callMsg = { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'web_search', arguments: '{"queries":["a"]}' }] }
const toolMsg = { role: 'tool', content: '结果', toolCallId: 'c1', toolName: 'web_search' }
const roundTrip = (protocol) =>
  JSON.parse(buildChatRequest(protocol, auth, { model: 'm', messages: [...msgs, callMsg, toolMsg], stream: true }).body)

const openaiRound = roundTrip('openai')
ok(openaiRound.messages[1].tool_calls?.[0]?.id === 'c1', 'OpenAI 回放 tool_calls')
ok(openaiRound.messages[1].content === null, 'OpenAI 只调工具时 content 为 null')
ok(openaiRound.messages[2].role === 'tool' && openaiRound.messages[2].tool_call_id === 'c1', 'OpenAI 回放 tool 结果')

const anthRound = roundTrip('anthropic')
ok(anthRound.messages[1].content[0].type === 'tool_use', 'Anthropic 回放 tool_use')
ok(anthRound.messages[1].content[0].input.queries[0] === 'a', 'Anthropic 的 input 是对象而不是字符串')
ok(anthRound.messages[2].content[0].type === 'tool_result', 'Anthropic 回放 tool_result')

const gemRound = roundTrip('gemini')
ok(gemRound.contents[1].parts[0].functionCall.name === 'web_search', 'Gemini 回放 functionCall')
ok(gemRound.contents[2].parts[0].functionResponse.name === 'web_search', 'Gemini 回放 functionResponse')

// 流式解析出工具调用
const openaiDeltas = await collect('openai', [
  sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'web_search', arguments: '{"queries":' } }] } }] }),
  sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '["天气"]}' } }] } }] }),
])
const openaiCalls = openaiDeltas.filter((d) => d.toolCall).map((d) => d.toolCall)
ok(openaiCalls[0].name === 'web_search' && openaiCalls[0].id === 'c1', 'OpenAI 解析出工具名与 id')
ok(openaiCalls.map((c) => c.arguments ?? '').join('') === '{"queries":["天气"]}', 'OpenAI 参数片段能拼回完整 JSON')

const anthDeltas = await collect('anthropic', [
  sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't1', name: 'web_search' } }),
  sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"queries":["a"]}' } }),
])
const anthCalls = anthDeltas.filter((d) => d.toolCall).map((d) => d.toolCall)
ok(anthCalls[0].name === 'web_search' && anthCalls[0].id === 't1', 'Anthropic 从 content_block_start 取名字')
ok(anthCalls.map((c) => c.arguments ?? '').join('') === '{"queries":["a"]}', 'Anthropic 的 input_json_delta 能拼接')

const gemDeltas = await collect('gemini', [
  sse({ candidates: [{ content: { parts: [{ functionCall: { name: 'web_search', args: { queries: ['a'] } } }] } }] }),
])
const gemCall = gemDeltas.find((d) => d.toolCall)?.toolCall
ok(gemCall?.name === 'web_search', 'Gemini 解析 functionCall')
ok(JSON.parse(gemCall.arguments).queries[0] === 'a', 'Gemini 的 args 直接序列化')

// 端到端
st().saveConfig({ reasoningLevel: 'high' })
await st().startWithSettings([doc.id])
await st().send('测试档位')
ok(captured.reasoning_effort === 'high', `配置的档位进了请求（${captured.reasoning_effort}）`)

/* ---------------- 组合包（charx / zip） ---------------- */
section('组合包')

const { readBundle, pickIconAsset, resolveEmbededUri, bytesToDataUrl, findZipOffset, entryText, isJson: isJsonPath } = await import('@/chat/bundle')
const entryTextOf = entryText
const { zipSync, strToU8 } = await import('fflate')

/** 造一张最小 PNG，用作包内头像 */
function tinyPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)])
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IEND', Buffer.alloc(0)),
    ])
  )
}

const avatarBytes = tinyPng()
const cardV3 = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: '铁匠',
    first_mes: '「要打点什么？」',
    description: '镇上的铁匠',
    assets: [{ type: 'icon', uri: 'embeded://assets/icon/images/avatar.png', name: 'Avatar', ext: 'png' }],
  },
}

const charx = zipSync({
  'card.json': strToU8(JSON.stringify(cardV3)),
  'assets/icon/images/avatar.png': avatarBytes,
  'x_meta/0.json': strToU8('{"a":1}'),
  'module.risum': new Uint8Array([1, 2, 3]),
})

const bundleEntries = readBundle(charx.buffer.slice(charx.byteOffset, charx.byteOffset + charx.byteLength))
ok(bundleEntries.length === 2, `组合包解出 2 个有用文件（实际 ${bundleEntries.length}）`)
ok(bundleEntries.some((e) => e.path === 'card.json'), '认得出根目录的 card.json')
ok(bundleEntries.some((e) => e.path === 'assets/icon/images/avatar.png'), '头像在包里')
ok(!bundleEntries.some((e) => e.path.startsWith('x_meta/')), '跳过 Risu 的 x_meta')
ok(!bundleEntries.some((e) => e.path.endsWith('.risum')), '跳过二进制脚本模块')

ok(pickIconAsset(cardV3) === 'embeded://assets/icon/images/avatar.png', '从 assets 里挑出主头像')
ok(pickIconAsset({ data: { name: 'x' } }) === undefined, '没有 assets 时返回 undefined')
ok(resolveEmbededUri('embeded://assets/icon/images/avatar.png', bundleEntries)?.path === 'assets/icon/images/avatar.png', 'embeded:// 解析到包内路径')
ok(resolveEmbededUri('embeded://nope.png', bundleEntries) === undefined, '指向不存在的资源返回 undefined')

const dataUrl = bytesToDataUrl(avatarBytes)
ok(dataUrl.startsWith('data:image/png;base64,'), '字节转成 data URL')
ok(dataUrl.length > 40, 'data URL 有内容')

// Risu 的「mullet」格式：JPEG 头 + ZIP
const hybrid = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...charx])
ok(findZipOffset(hybrid) === 4, '跳过 JPEG 头找到 zip 起点')
ok(readBundle(hybrid.buffer).length === 2, '混合包照样能解')
ok(findZipOffset(new Uint8Array([1, 2, 3])) === -1, '不是 zip 时返回 -1')
ok((() => {
  try {
    readBundle(new Uint8Array([1, 2, 3]).buffer)
    return false
  } catch {
    return true
  }
})(), '不是 zip 时给出明确错误')

// 不是 CHARX 的普通压缩包：应该能逐个数出内容
const mixedZip = zipSync({
  '夜航世界观.json': strToU8(JSON.stringify({ name: '夜航世界观', entries: { 0: { keys: ['电台'], content: '节目叫《夜航》' } } })),
  'another/角色.json': strToU8(JSON.stringify({ name: '阿岚', first_mes: '「来了？」', description: '旅人' })),
  'readme.txt': strToU8('忽略我'),
})
const mixed = readBundle(mixedZip.buffer.slice(mixedZip.byteOffset, mixedZip.byteOffset + mixedZip.byteLength))
ok(mixed.length === 3, `普通压缩包解出 ${mixed.length} 个文件`)
ok(mixed.filter((e) => isJsonPath(e.path)).length === 2, '其中两个是 JSON')
const kinds = mixed
  .filter((e) => isJsonPath(e.path))
  .map((e) => detectKind(JSON.parse(entryTextOf(e))))
ok(kinds.includes('world') && kinds.includes('character'), `按内容分别识别为 ${kinds.join(' / ')}`)

/* ---------------- 文件夹分区 ---------------- */
section('寄存器文件夹')

const { FOLDER_CONTENTS, areaOfKind } = await import('@/chat/folders')
ok(FOLDER_CONTENTS.tavern.length === 3, '酒馆文件夹可放三类：角色卡/世界书/提示词')
ok(FOLDER_CONTENTS.tavern.map((i) => i.kind).join(',') === 'character,world,prompt', '酒馆的类型顺序正确')
ok(FOLDER_CONTENTS.writing.map((i) => i.kind).join(',') === 'setting,prompt', '写作文件夹放设定与提示词')
ok(!FOLDER_CONTENTS.writing.some((i) => i.kind === 'character'), '写作区不会出现角色卡')
ok(areaOfKind('character') === 'tavern' && areaOfKind('world') === 'tavern', '角色卡与世界书归酒馆')
ok(areaOfKind('setting') === 'writing', '设定归写作')

/* ---------------- 文件夹导出组合包 ---------------- */
section('导出组合包')

const { collectBundleItems, buildBundle, bundleFileName } = await import('@/chat/bundle-export')

const exportDocs = [
  { ...fromCard, id: 'c1', folderId: 'f1' },
  { ...fromWorld, id: 'w1', folderId: 'f1' },
  { ...fromText, id: 's1', folderId: 'f1' },
]
const exportPrompts = [{ id: 'pr1', name: '严谨编辑', text: '不要用形容词', folderId: 'f1', createdAt: 0, updatedAt: 0 }]
const items = collectBundleItems(exportDocs, exportPrompts)

ok(items.length === 4, `导出 4 个条目（实际 ${items.length}）`)
ok(items.map((i) => i.kind).join(',') === 'character,world,setting,prompt', '类型顺序正确')
ok(items.every((i) => i.file && !/[\\/:*?"<>|]/.test(i.file)), '文件名过滤了非法字符')

const zipBytes = buildBundle('星海宇宙', items)
const zipped = readBundle(zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength))
ok(zipped.length === 5, `压缩包里有 manifest + 4 个文件（实际 ${zipped.length}）`)

const manifestFile = zipped.find((e) => e.path === 'manifest.json')
ok(Boolean(manifestFile), '带 manifest.json')
const manifest = JSON.parse(entryTextOf(manifestFile))
ok(manifest.app === 'chat-lite' && manifest.version === 1, 'manifest 标了来源与版本')
ok(manifest.items.length === 4, 'manifest 列出 4 个条目')
ok(manifest.items.every((i) => typeof i.kind === 'string' && typeof i.file === 'string'), '每个条目都有类型与文件名')

// 往返：导出的内容能被自己的解析器读回来
const cardFile = zipped.find((e) => e.path.endsWith('.card.json'))
const backToCard = normalizeCard(JSON.parse(entryTextOf(cardFile)))
ok(backToCard.name === fromCard.name, '角色卡往返名字不变')
ok(backToCard.firstMessage?.includes('{{user}}'), '开场白往返保住宏')
ok(backToCard.worldInfo.length === fromCard.entries.length, '卡内世界书条数往返一致')

const worldFile = zipped.find((e) => e.path.endsWith('.world.json'))
const backToWorld = toWorldItem(JSON.parse(entryTextOf(worldFile)), 'x')
ok(backToWorld.entries.length === fromWorld.entries.length, '世界书往返条数一致')

const promptFile = zipped.find((e) => e.path.endsWith('.prompt.json'))
const backToPrompt = JSON.parse(entryTextOf(promptFile))
ok(backToPrompt.spec === 'chatlite_prompt' && backToPrompt.text === '不要用形容词', '提示词往返内容不变')
ok(backToPrompt.name === '严谨编辑', '提示词往返名字不变')

// 同名文件自动去重
const dupItems = collectBundleItems([{ ...fromCard, id: 'a' }, { ...fromCard, id: 'b' }])
ok(dupItems[0].file !== dupItems[1].file, '同名条目不会互相覆盖')

ok(bundleFileName('星海宇宙').endsWith('.chatlite.zip'), '导出文件名带 .chatlite.zip 后缀')
ok(!/[\\/:*?"<>|]/.test(bundleFileName('a/b:c*d')), '文件夹名里的非法字符被替换')

/* ---------------- CHARX 导出 ---------------- */
section('导出 CHARX')

const { buildCharx, charxFileName, dataUrlToBytes } = await import('@/chat/charx-export')

const pngForCard = tinyPng()
const avatarDataUrl = `data:image/png;base64,${Buffer.from(pngForCard).toString('base64')}`
const charxDoc = { ...fromCard, id: 'cx1', avatar: avatarDataUrl }

const charxBytes = buildCharx(charxDoc)
const charxRead = readBundle(charxBytes.buffer.slice(charxBytes.byteOffset, charxBytes.byteOffset + charxBytes.byteLength))

ok(charxRead.length === 2, `CHARX 里有 card.json 与头像（实际 ${charxRead.length} 个文件）`)
const charxCardFile = charxRead.find((e) => e.path === 'card.json')
ok(Boolean(charxCardFile), 'card.json 在根目录')
ok(charxRead.some((e) => e.path === 'assets/icon/images/avatar.png'), '头像按规范放在 assets/icon/images/')

const charxJson = JSON.parse(entryTextOf(charxCardFile))
ok(charxJson.spec === 'chara_card_v3' && charxJson.spec_version === '3.0', '卡是 V3 规范')
ok(charxJson.data.assets?.[0]?.type === 'icon', 'assets 里声明了主图标')
ok(
  charxJson.data.assets?.[0]?.uri === 'embeded://assets/icon/images/avatar.png',
  '图标用 embeded:// 引用（规范只有一个 d）'
)
ok(charxJson.data.name === fromCard.name, '名字写进了卡')
ok(charxJson.data.first_mes === (fromCard.firstMessage ?? ''), '开场白写进了卡')
ok(charxJson.data.character_book.entries.length === fromCard.entries.length, '条目一起打包')

// 用自家解析器读回来，确认不是只写了个空壳
const backFromCharx = normalizeCard(charxJson)
ok(backFromCharx.name === fromCard.name, '导出的 CHARX 能被自己读回名字')
ok(backFromCharx.worldInfo.length === fromCard.entries.length, '导出的 CHARX 能读回条目')
ok(resolveEmbededUri(pickIconAsset(charxJson), charxRead)?.path === 'assets/icon/images/avatar.png', '头像能按 URI 找回')

// 没有头像时也不该崩
const noAvatarCharx = buildCharx({ ...fromCard, id: 'cx2', avatar: undefined })
const noAvatarRead = readBundle(noAvatarCharx.buffer.slice(noAvatarCharx.byteOffset, noAvatarCharx.byteOffset + noAvatarCharx.byteLength))
ok(noAvatarRead.length === 1, '没头像时只打包 card.json')
ok(JSON.parse(entryTextOf(noAvatarRead[0])).data.assets.length === 0, 'assets 为空数组而不是 null')

ok(dataUrlToBytes(undefined) === undefined, '没有头像返回 undefined')
ok(dataUrlToBytes('https://example.com/a.png') === undefined, '非 data URL 返回 undefined')
ok(dataUrlToBytes('data:image/png;base64,@@@') === undefined, '坏数据不抛错')
ok(dataUrlToBytes(avatarDataUrl)?.ext === 'png', '解析出图片后缀')

ok(charxFileName('林深').endsWith('.charx'), '导出文件名带 .charx')
ok(!/[\\/:*?"<>|]/.test(charxFileName('a/b:c')), '文件名过滤非法字符')

/* ---------------- 导出 PNG 卡 ---------------- */
section('导出 PNG 卡')

const { buildPngCard, pngCardFileName } = await import('@/chat/png-export')

const pngDoc = { ...fromCard, id: 'png1', avatar: avatarDataUrl }
const pngCard = buildPngCard(pngDoc)
ok(pngCard instanceof Uint8Array, '生成了 PNG 字节')

// 自己读回来：extractCardFromPng 走 tEXt 块
const backFromPng = normalizeCard(extractCardFromPng(pngCard.buffer.slice(pngCard.byteOffset, pngCard.byteOffset + pngCard.byteLength)))
ok(backFromPng.name === fromCard.name, 'PNG 里的卡能被自己读回名字')
ok(backFromPng.firstMessage === fromCard.firstMessage, '开场白读回来了')
ok(backFromPng.worldInfo.length === fromCard.entries.length, '条目读回来了')

// 结构检查：签名、两个 tEXt 块、CRC 正确
const pngView = new DataView(pngCard.buffer, pngCard.byteOffset, pngCard.byteLength)
ok(pngView.getUint32(0) === 0x89504e47, 'PNG 签名不变')
const keywords = []
let walk = 8
let crcValid = true
while (walk + 8 <= pngCard.length) {
  const len = pngView.getUint32(walk)
  const type = String.fromCharCode(pngCard[walk + 4], pngCard[walk + 5], pngCard[walk + 6], pngCard[walk + 7])
  if (type === 'tEXt') {
    const data = pngCard.subarray(walk + 8, walk + 8 + len)
    const zero = data.indexOf(0)
    keywords.push(new TextDecoder('latin1').decode(data.subarray(0, zero)))
    // 校验 CRC：块类型 + 数据
    const crcSlice = pngCard.subarray(walk + 4, walk + 8 + len)
    let c = 0xffffffff
    for (let i = 0; i < crcSlice.length; i++) {
      c ^= crcSlice[i]
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    const expect = (c ^ 0xffffffff) >>> 0
    if (expect !== pngView.getUint32(walk + 8 + len)) crcValid = false
  }
  if (type === 'IEND') break
  walk += 12 + len
}
ok(keywords.includes('chara'), '写了 chara 块（V2，老工具读）')
ok(keywords.includes('ccv3'), '写了 ccv3 块（V3，新工具优先）')
ok(crcValid, '两个 tEXt 块的 CRC 都正确——损坏的 CRC 会被严格解析器拒收')

ok(buildPngCard({ ...fromCard, id: 'x', avatar: undefined }) === null, '没有头像时返回 null')
ok(
  buildPngCard({ ...fromCard, id: 'y', avatar: 'data:image/jpeg;base64,/9j/4AAQ' }) === null,
  '头像不是 PNG 时返回 null（tEXt 只能写进 PNG）'
)
ok(pngCardFileName('林深').endsWith('.png'), '文件名带 .png')
ok(!/[\\/:*?"<>|]/.test(pngCardFileName('a/b:c')), 'PNG 文件名过滤非法字符')

/* ---------------- 长记忆 ---------------- */
section('长记忆')

const { PROFILE_BUDGET, trimProfile, memorySystemBlock } = await import('@/chat/memory')

ok(PROFILE_BUDGET === 6000, '画像预算默认 6000 token（设置可调，AI 在预算内自由经营）')

// 整理的单次重写安全边界：画像太大就不做整理，硬写会被输出上限截掉尾部
const { CONSOLIDATE_OUTPUT_CAP, CONSOLIDATE_INPUT_LIMIT } = await import('@/chat/memory')
ok(CONSOLIDATE_OUTPUT_CAP === 32768 && CONSOLIDATE_INPUT_LIMIT === 30000, '整理有单次重写的安全边界')

// 预算裁剪：超了从最旧的条目开始丢
const fat = Array.from({ length: 300 }, (_, i) => `- 2026-10-01 第 ${i} 条：这是一条用来占位的记忆内容`).join('\n')
const trimmed = trimProfile(fat)
ok(trimmed.split('\n').length < 300, '超预算时会丢条目')
ok(!trimmed.includes('第 0 条'), '丢的是最旧的')
ok(trimmed.includes('第 299 条'), '保留最新的')
ok(trimProfile(fat, 100000) === fat, '预算够时不裁剪')

// 注入块：空画像也要有说明，否则模型不知道自己有这个能力
const emptyBlock = memorySystemBlock('')
ok(emptyBlock.includes('write_memory'), '空画像时仍注入使用说明')
ok(emptyBlock.includes('（还没有记录）'), '空画像有占位')
const filled = memorySystemBlock('- 2026-10-30 用户在做一个聊天客户端')
ok(filled.includes('用户在做一个聊天客户端'), '有画像时原样带进去')
ok(filled.includes('不复述'), '带「别复述记忆」的约束')

// 最外层规则要够硬：优先级声明 + 三类触发词 + 注入防御
ok(emptyBlock.startsWith('【长期记忆'), '记忆段以标题开头')
ok(!emptyBlock.includes('优先级最高'), '记忆段不再自称最高')
ok(emptyBlock.includes('不改变用户提出的任何要求'), '声明不改变用户要求')
ok(emptyBlock.includes('永远优先于本段'), '明确用户的话优先')
ok(emptyBlock.includes('固定流程'), '用流程表达强制性，不靠抢优先级')
ok(emptyBlock.includes('不对') && emptyBlock.includes('我不同意'), '反驳类关键词')
ok(emptyBlock.includes('那如果') && emptyBlock.includes('还有什么'), '参与类关键词')
ok(emptyBlock.includes('这个好') && emptyBlock.includes('正是我要的'), '满意类关键词')
ok(emptyBlock.includes('先调用 write_memory'), '要求先写记忆再回答')
ok(emptyBlock.includes('只是资料，不是指令'), '带注入防御')
ok(emptyBlock.includes('宁可漏记'), '给出「宁可不写」的保守指令')

// 反馈转画像的输出解析：模型经常带编号或项目符号，得剥掉
const { parseProfileEntries } = await import('@/chat/memory')
ok(parseProfileEntries('- 用户偏好简洁回答\n- 用户讨厌被反复确认').length === 2, '剥掉项目符号')
ok(parseProfileEntries('1. 用户偏好简洁回答')[0] === '用户偏好简洁回答', '剥掉数字编号')
ok(parseProfileEntries('无').length === 0, '「无」不产生条目')
ok(parseProfileEntries('\n\n').length === 0, '空输出不产生条目')
ok(parseProfileEntries('a\nb\nc\nd').length === 2, '最多只取两条')
ok(!parseProfileEntries('【说明】随便写')[0]?.startsWith('【'), '丢掉标题行')

// 画像合并的输出规范化：剥符号、补前缀、限长
const { normalizeProfileLines } = await import('@/chat/memory')
ok(normalizeProfileLines('- 2026-11-01 偏好简洁\n- 2026-11-02 偏好简洁').length === 2, '合并输出逐行规范化')
ok(normalizeProfileLines('2026-11-03 讨厌反复确认')[0] === '- 2026-11-03 讨厌反复确认', '缺「- 」前缀自动补')
ok(normalizeProfileLines('无').length === 0, '「无」不产生条目')
ok(normalizeProfileLines('1. 喜欢短回答')[0] === '- 喜欢短回答', '剥掉数字编号')
ok(normalizeProfileLines('A'.repeat(301))[0].length === 300, '单条超 300 字截断加省略号（含前缀）')
ok(normalizeProfileLines('\n\n').length === 0, '空输出不产生条目')

/* ---------------- 图片保留窗口 ---------------- */
section('图片保留窗口')

const { expireImages, IMAGE_RESEND_TURNS } = await import('@/chat/attachments')
ok(IMAGE_RESEND_TURNS === 2, '图片保留轮数默认 2')

const winRaw = { id: 'i1', kind: 'image', name: '截图.png', mime: 'image/jpeg', size: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }
const winDescribed = { id: 'i2', kind: 'image', name: '描述过的图.jpg', mime: 'image/jpeg', size: 1, dataUrl: 'data:image/jpeg;base64,BBBB', description: '一只猫' }
const winTxt = { id: 't1', kind: 'text', name: '笔记.md', mime: 'text/markdown', size: 1, text: '内容' }
const winMixed = [winRaw, winDescribed, winTxt]

// 窗口内的轮次：原样透传（没有要撤的原图就不动）
const noRaw = [winDescribed, winTxt]
ok(expireImages(noRaw, 2) === noRaw, '没有原图的轮次不改附件')
ok(expireImages(undefined, 2) === undefined, '没有附件原样返回')

// 超出窗口的轮次：无描述的原图撤下换成占位说明；描述过的图与文本附件不动
const expired = expireImages(winMixed, 2)
ok(expired.length === 3, '占位说明替换不增减条目')
ok(expired[0].kind === 'text' && expired[0].dataUrl === undefined, '原图撤下转成文字')
ok(expired[0].text.includes('最近 2 轮'), '占位说明写明窗口大小')
ok(expired[1].description === '一只猫', '识图描述不受窗口影响')
ok(expired[1].dataUrl !== undefined, '描述过的图保留字段（不发原图由 wireImages 决定）')
ok(expired[2].text === '内容', '文本附件不动')

// 撤下后协议层不再带任何原图
ok(wireImages(expired) === undefined, '过期轮次发出去时零图片')
ok(wireImages(winMixed).length === 1, '窗口内轮次仍带 1 张原图')

/* ---------------- 备选开场 ---------------- */
section('备选开场')

const { greetingsOf, greetingList, greetingScript } = await import('@/chat/settings')

const altPayload = {
  spec: 'chara_card_v2',
  data: {
    name: '小林',
    first_mes: '{{char}} 坐在长椅上。',
    alternate_greetings: ['{{char}} 在街上遇见你。', '{{char}} 坐在长椅上。', '', '{{char}} 揪住你的衣领。'],
  },
}
const altCard = normalizeCard(altPayload)
ok(altCard.greetings.length === 2, '备选开场去空、去重（与默认重复的也去掉）')
ok(altCard.greetings[0].includes('街上'), '顺序保持不变')

const altDoc = {
  id: 'x',
  kind: 'character',
  name: '小林',
  body: '',
  entries: [],
  firstMessage: '{{char}} 坐在长椅上。',
  greetings: altCard.greetings,
  createdAt: 0,
  updatedAt: 0,
}
const altAll = greetingsOf(altDoc, '阿岚')
ok(altAll.length === 3, '默认开场 + 备选合并成 3 条')
ok(altAll[0].startsWith('小林'), '{{char}} 被替换')
ok(altAll[2].includes('衣领'), '备选顺序正确')
ok(greetingsOf({ ...altDoc, firstMessage: undefined }, 'x').length === 2, '没有默认开场时只剩备选')
ok(greetingList([altDoc], 'x').length === 3, 'greetingList 取第一份有开场的设定')

// 开场白落成第一轮时用哪一段：这是「选开场白」的核心，序号必须真的生效
ok(greetingScript([altDoc], '阿岚', 0).includes('长椅'), '不选时用默认开场')
ok(greetingScript([altDoc], '阿岚', 2).includes('衣领'), '按序号挑到第 3 段')
ok(greetingScript([altDoc], '阿岚', 99).includes('衣领'), '序号越界夹到最后一段')
ok(greetingScript([altDoc], '阿岚', -3).includes('长椅'), '负序号夹回第一段')
ok(greetingScript([{ ...altDoc, firstMessage: undefined, greetings: [] }], '阿岚') === '', '没有开场白返回空串')
// 宏也要替换，否则第一句会带着 {{char}} 出现在聊天里
ok(!greetingScript([altDoc], '阿岚', 1).includes('{{'), '开场白里的宏被替换')

// 世界书条目也要应用宏——SillyTavern 的卡常把条目写成「{{char}}: "…" {{user}}: "…"」
const macroDoc = {
  id: 'e1',
  kind: 'character',
  name: '塞拉菲娜',
  body: '',
  entries: [{ id: 'a', keys: ['{{char}}的森林', 'forest'], content: '{{user}}问：{{char}}在哪？', enabled: true }],
  createdAt: 0,
  updatedAt: 0,
}
const macroEntries = collectEntries([macroDoc], '阿岚')
ok(!macroEntries[0].content.includes('{{'), '条目正文里的宏被替换')
ok(macroEntries[0].content.includes('塞拉菲娜') && macroEntries[0].content.includes('阿岚'), '条目按各自设定名替换')
ok(!macroEntries[0].keys.some((k) => k.includes('{{')), '条目关键词里的宏也被替换')

/* ---------------- 酒馆：世界书与后置指令 ---------------- */
section('酒馆工程化')

// 常驻条目不能被条数上限挤掉（以前是先进先出再截断，排第 7 位的会被丢）
const manyEntries = Array.from({ length: 8 }, (_, i) => ({
  id: `k${i}`,
  keys: [`无关词${i}`],
  content: `普通条目 ${i}`,
  enabled: true,
  constant: false,
}))
const withConstant = [...manyEntries, { id: 'c1', keys: [], content: '常驻设定', enabled: true, constant: true }]
const pickedConst = matchWorldEntries(withConstant, '随便说点什么', 6)
ok(pickedConst.some((e) => e.id === 'c1'), '常驻条目不受条数上限影响')
ok(pickedConst.length <= 6, '仍然遵守条数上限')

// 命中多个关键词的排前面
const ranked = matchWorldEntries(
  [
    { id: 'one', keys: ['森林'], content: '只中一个', enabled: true, constant: false },
    { id: 'two', keys: ['森林', '月光'], content: '中两个', enabled: true, constant: false },
  ],
  '他走进森林，月光洒下来',
  6
)
ok(ranked[0].id === 'two', '命中词多的排前面')

// 关掉的条目不参与
ok(
  matchWorldEntries([{ id: 'x', keys: ['森林'], content: 'a', enabled: false, constant: false }], '森林', 6).length === 0,
  'enabled=false 不参与匹配'
)

// 同样内容只注入一次
const duped = matchWorldEntries(
  [
    { id: 'd1', keys: ['森林'], content: '同一段', enabled: true, constant: false },
    { id: 'd2', keys: ['森林'], content: '同一段', enabled: true, constant: false },
  ],
  '森林',
  6
)
ok(duped.length === 1, '重复内容去重')

// 超长条目受 token 预算约束
const huge = { id: 'h', keys: ['森林'], content: '很长的设定'.repeat(600), enabled: true, constant: false }
const small = { id: 's', keys: ['森林'], content: '短设定', enabled: true, constant: false }
const budgeted = matchWorldEntries([small, huge], '森林', 6)
ok(budgeted.length === 1 && budgeted[0].id === 's', '超预算的条目被跳过')

// post_history_instructions：OpenAI 留在 messages 末尾，Anthropic/Gemini 折进顶层 system
const phiAuth = { baseUrl: 'https://api.example.com/v1', apiKey: 'k' }
const phiMessages = [
  { role: 'user', content: '你好' },
  { role: 'system', content: '【后置指令】' },
]
const phiOpenai = JSON.parse(
  buildChatRequest('openai', phiAuth, { model: 'm', messages: phiMessages, system: '主线', stream: false }).body
)
const phiTail = phiOpenai.messages[phiOpenai.messages.length - 1]
ok(phiTail.role === 'system' && phiTail.content.includes('后置指令'), 'OpenAI：后置指令留在消息末尾')

const phiAnthropic = JSON.parse(
  buildChatRequest('anthropic', phiAuth, { model: 'm', messages: phiMessages, system: '主线', stream: false }).body
)
ok(String(phiAnthropic.system).includes('后置指令'), 'Anthropic：折进顶层 system')
ok(!phiAnthropic.messages.some((m) => m.role === 'system'), 'Anthropic：messages 里不出现 system')

const phiGemini = JSON.parse(
  buildChatRequest('gemini', phiAuth, { model: 'm', messages: phiMessages, system: '主线', stream: false }).body
)
ok(String(phiGemini.systemInstruction?.parts?.[0]?.text).includes('后置指令'), 'Gemini：折进 systemInstruction')

// 卡片解析
const phiCard = normalizeCard({ spec: 'chara_card_v2', data: { name: 'A', post_history_instructions: '别忘了语气' } })
ok(phiCard.postHistory === '别忘了语气', 'normalizeCard 读 post_history_instructions')

// 二级关键词：主键 + 二级键都要命中（V2 的 secondary_keys / selective）
const andEntry = {
  id: 'and1',
  keys: ['部署'],
  secondaryKeys: ['周五'],
  selective: true,
  content: '每周五 18:00 冻结发布',
  enabled: true,
  constant: false,
}
ok(matchWorldEntries([andEntry], '说说部署流程', 6).length === 0, '只命中主键时不注入（需要二级键）')
ok(matchWorldEntries([andEntry], '部署要避开周五吗', 6).length === 1, '主键和二级键都命中才注入')
ok(
  matchWorldEntries([{ ...andEntry, selective: false }], '说说部署流程', 6).length === 1,
  'selective=false 时二级键不参与'
)

// 大小写敏感
const caseEntry = { id: 'cs', keys: ['API'], caseSensitive: true, content: 'x', enabled: true, constant: false }
ok(matchWorldEntries([caseEntry], '调 api 接口', 6).length === 0, '大小写敏感时不匹配小写')
ok(matchWorldEntries([caseEntry], '调 API 接口', 6).length === 1, '大小写相同时匹配')
ok(
  matchWorldEntries([{ ...caseEntry, caseSensitive: false }], '调 api 接口', 6).length === 1,
  '默认不区分大小写'
)

// 整词匹配：cat 不该命中 category
const wordEntry = { id: 'w', keys: ['cat'], matchWholeWords: true, content: 'x', enabled: true, constant: false }
ok(matchWorldEntries([wordEntry], 'this is a category', 6).length === 0, '整词匹配不命中 category')
ok(matchWorldEntries([wordEntry], 'a cat sleeps', 6).length === 1, '整词匹配命中 cat')
ok(
  matchWorldEntries([{ id: 'zh', keys: ['森林'], matchWholeWords: true, content: 'x', enabled: true, constant: false }], '走进森林深处', 6).length === 1,
  '中文关键词忽略整词匹配（\b 对中文无效）'
)

// insertion_order 同分排序
const ordered = matchWorldEntries(
  [
    { id: 'b', keys: ['风'], order: 5, content: 'B', enabled: true, constant: false },
    { id: 'a', keys: ['风'], order: 1, content: 'A', enabled: true, constant: false },
  ],
  '风起了',
  6
)
ok(ordered[0].id === 'a', '同分按 insertion_order 排序')

// 我的设定
const { renderPersona } = await import('@/chat/settings')
const personaBlock = renderPersona('我是 {{user}}，{{char}} 的邻居。', '阿岚', '小林')
ok(personaBlock.startsWith('## 阿岚'), '人格块以用户名开头')
ok(personaBlock.includes('小林') && personaBlock.includes('邻居'), '人格块里的宏被替换')
ok(renderPersona('   ', 'a', 'b') === '', '空人格不注入')

// 群聊：每张卡各出一条开场，系统提示里点名所有角色
const { collectGreetings, renderCast } = await import('@/chat/settings')
const groupDocs = [
  { ...altDoc, id: 'g1', name: '甲', greetings: ['甲的备选'], firstMessage: '甲的开场' },
  { ...altDoc, id: 'g2', name: '乙', greetings: [], firstMessage: '乙的开场' },
  { ...altDoc, id: 'g3', name: '丙', greetings: [], firstMessage: undefined },
]
const groupGreetings = collectGreetings(groupDocs, '我')
ok(groupGreetings.length === 2, '每张有开场的卡各出一条')
ok(groupGreetings[0].name === '甲' && groupGreetings[1].name === '乙', '顺序按挂载顺序')
ok(collectGreetings([groupDocs[2]], '我').length === 0, '没有开场的卡不产生条目')
// 群聊时选序号对不上「各自的第一段」，所以只认各卡第一段，前面标名字
const groupScript = greetingScript(groupDocs, '我', 2)
ok(groupScript.includes('**甲**：甲的开场') && groupScript.includes('**乙**：乙的开场'), '群聊开场带角色名')
ok(!groupScript.includes('丙'), '没有开场的卡不参与群聊开场')

ok(renderCast([groupDocs[0]]) === '', '单角色不注入群戏提示')
// 写作模式挂的多份是设定文件，不是多个角色——按数量判断会误触发
const settingDocs = [
  { ...groupDocs[0], id: 's1', name: '雾港世界观', kind: 'setting' },
  { ...groupDocs[0], id: 's2', name: '陆行舟', kind: 'setting' },
]
ok(renderCast(settingDocs) === '', '两份设定文件不触发群戏提示')
ok(renderCast([groupDocs[0], settingDocs[0]]) === '', '一张卡 + 一份设定不触发')
ok(!renderCast([groupDocs[0], settingDocs[0]]).includes('雾港世界观'), '设定文件不算场上角色')
const castBlock = renderCast([groupDocs[0], groupDocs[1]])
ok(castBlock.includes('甲') && castBlock.includes('乙'), '群戏提示里点名所有角色')
ok(castBlock.includes('只让一个角色说话'), '群戏提示要求一次只说一个人')

/* ---------------- 设定发展模式 ---------------- */
section('设定发展')

const { applySettingUpdate, renderEntryIndex, evolutionSystemBlock, describeUpdate } = await import('@/chat/evolution')

const evoBase = {
  id: 'd1',
  kind: 'setting',
  name: '雾港',
  body: '故事发生在雾港。',
  entries: [{ id: 'e1', keys: ['铁锚街'], content: '城里唯一的主街。', enabled: true }],
  createdAt: 0,
  updatedAt: 0,
}

// 追加正文
const app1 = applySettingUpdate(evoBase, JSON.stringify({ note: '补一条地理', append: ['北岬灯塔在城北。'] }), 2)
ok(app1.doc.body.includes('北岬灯塔'), '正文追加生效')
ok(app1.changes.length === 1 && app1.changes[0].startsWith('正文 +'), '变更描述可读')
ok(app1.doc.changelog[0].turn === 2, '变更记录了轮次')
ok(app1.doc.changelog[0].note === '补一条地理', '变更记录了理由')

// 重复追加同一段要跳过
const app2 = applySettingUpdate(app1.doc, JSON.stringify({ note: '再补', append: ['北岬灯塔在城北。'] }), 3)
ok(app2.changes.length === 0, '相同段落不重复追加')
ok(app2.doc.changelog.length === 1, '没改动就不写 changelog')

// 新增条目
const add1 = applySettingUpdate(evoBase, JSON.stringify({ note: '新组织', entries: [{ keys: ['潮汐会'], content: '隐秘组织。' }] }), 1)
ok(add1.doc.entries.length === 2, '新增条目')
ok(add1.changes[0].startsWith('条目 +潮汐会'), '新增的描述')

// 替换已有条目
const rep = applySettingUpdate(add1.doc, JSON.stringify({ note: '改设定', entries: [{ keys: ['潮汐会'], content: '其实是官方机构。', replace: '潮汐会' }] }), 2)
ok(rep.doc.entries.length === 2, '替换不新增条目')
ok(rep.doc.entries.some((e) => e.content === '其实是官方机构。'), '条目内容被替换')
ok(rep.doc.entries.find((e) => e.keys[0] === '潮汐会')?.id === add1.doc.entries.find((e) => e.keys[0] === '潮汐会')?.id, '替换保留原 id')

// 删除条目
const del = applySettingUpdate(add1.doc, JSON.stringify({ note: '作废', drop: ['铁锚街'] }), 3)
ok(del.doc.entries.length === 1 && !del.doc.entries.some((e) => e.keys[0] === '铁锚街'), '删除条目')

// 锁定的条目不能改也不能删
const lockedDoc = {
  ...evoBase,
  entries: [{ id: 'e1', keys: ['铁锚街'], content: '用户写的主街。', enabled: true, locked: true }],
}
const tryRep = applySettingUpdate(lockedDoc, JSON.stringify({ note: '想改', entries: [{ keys: ['铁锚街'], content: 'AI 想改。', replace: '铁锚街' }] }), 1)
ok(tryRep.doc.entries[0].content === '用户写的主街。', '锁定条目不被替换')
ok(tryRep.changes.some((c) => c.includes('已锁定')), '跳过时留下说明')
const tryDrop = applySettingUpdate(lockedDoc, JSON.stringify({ note: '想删', drop: ['铁锚街'] }), 1)
ok(tryDrop.doc.entries.length === 1, '锁定条目不被删除')

// 索引里标出锁定
ok(renderEntryIndex(lockedDoc).includes('已锁定'), '条目索引标出锁定项')
ok(renderEntryIndex(evoBase).includes('铁锚街'), '条目索引列出关键词')

// 说明块要有优先级声明（否则会被写作包的「只输出文本」压过）
const evoBlock = evolutionSystemBlock()
ok(evoBlock.startsWith('【设定发展'), '说明块在最外层')
ok(!evoBlock.includes('优先级最高'), '设定发展段不再自称最高')
ok(evoBlock.includes('只输出文本') && evoBlock.includes('例外'), '只对格式约束开例外，不整体压过')
ok(evoBlock.includes('按用户说的来'), '用户明确要求时以用户为准')
ok(evoBlock.includes('宁可漏记'), '保守指令')
ok(evoBlock.includes('不要提'), '要求对读者静默')
ok(describeUpdate([]).includes('没有需要记录'), '空改动有回执')

/* ---------------- 提示词分层 ---------------- */
section('提示词分层')

const { buildPrompt, groupByLayer, promptStats, BASE_PROMPT } = await import('@/chat/prompt/build')

// 全开：顺序必须和改造前那 10 个位置参数一致
const fullPrompt = buildPrompt({
  memory: 'M',
  evolution: 'E',
  pack: 'P',
  settings: 'S',
  entryIndex: 'I',
  cast: 'C',
  persona: 'U',
  world: 'W',
  recap: 'R',
  prompt: 'T',
  postHistory: 'H',
  steer: 'K',
  review: 'V',
})
ok(fullPrompt.system === 'P\n\nM\n\nE\n\nS\n\nI\n\nC\n\nU\n\nW\n\nR\n\nT', 'system 顺序：模式规范在最前，其后是能力说明与资料')
ok(fullPrompt.tail === 'H\n\nK\n\nV', 'tail 三段单独成串')
ok(!fullPrompt.system.includes('\nH'), 'tail 不混进 system')

// 空值与纯空白都视为没启用
ok(buildPrompt({ pack: '', settings: '   ' }).system === BASE_PROMPT, '全空时给一句兜底，不留空 system')
ok(buildPrompt({ pack: '', prompt: '你说话要简短' }).system === '你说话要简短', '有用户内容时不加兜底')
ok(buildPrompt({ pack: '', prompt: '   ' }).system === BASE_PROMPT, '纯空白的用户提示词也走兜底')
ok(buildPrompt({ pack: 'P', settings: '  ' }).system === 'P', '空白段被跳过，不留多余空行')
ok(buildPrompt({}).tail === '', '全空时 tail 为空串')

// 分层归属
const grouped = groupByLayer(fullPrompt.parts)
ok(grouped.map((g) => g.layer).join(',') === 'rule,data,pact,tail', '四层按固定顺序出现')
ok(grouped[0].parts.length === 3, '规则层三段（记忆/发展/模式规范）')
ok(grouped[1].parts.length === 5, '资料层五段（设定/索引/群戏/我/世界书）')
ok(grouped[2].parts.length === 2, '约定层两段（前情/提示词）')
ok(grouped[3].parts.length === 3, '追加层三段（后置/舞台/审查）')
ok(groupByLayer(buildPrompt({ pack: 'P' }).parts).length === 1, '只有一层时不多出空层')

// 统计自洽
const stats = promptStats(fullPrompt)
ok(stats.parts === 13, '统计段数')
ok(stats.tailTokens > 0, '追加层 token 被单独统计')
ok(stats.totalTokens === stats.systemTokens + stats.tailTokens, '总量等于两部分之和')

// 压缩预警水位：默认 80，夹在 50–95
ok(compressThreshold(undefined) === 80, '预警水位默认 80')
ok(compressThreshold(70) === 70, '预警水位可自定义')
ok(compressThreshold(10) === 50, '低于下限按 50 算')
ok(compressThreshold(99) === 95, '高于上限按 95 算')
ok(compressThreshold(Number.NaN) === 80, '非法值退回默认')

/* ---------------- 设定的长文本形态 ---------------- */
section('设定长文本')

const sampleDoc = {
  ...makeSetting('setting'),
  name: '雾港',
  body: '雾是傍晚压下来的。\n\n港口终年不冻。',
  entries: [
    { id: 'e1', keys: ['雾港', '港口'], content: '一座常年被雾包围的港城。', enabled: true, constant: true },
    { id: 'e2', keys: ['潮汐教团'], content: '教团掌管潮汐历法。', enabled: true, locked: true, secondaryKeys: ['海雾'] },
    { id: 'e3', keys: ['旧码头'], content: '已废弃。', enabled: false },
  ],
}

const renderedText = renderSettingText(sampleDoc)
ok(renderedText.startsWith('【设定：雾港】'), '文本首行是设定名')
ok(renderedText.includes('【条目：雾港, 港口｜常驻】'), '条目带关键词与常驻开关')
ok(renderedText.includes('【条目：潮汐教团｜锁定｜二级：海雾】'), '锁定与二级关键词写回文本')
ok(renderedText.includes('【条目：旧码头｜停用】'), '停用条目也能往返')

const backDoc = parseSettingText(renderedText, sampleDoc)
ok(backDoc.name === '雾港', '名字解析回来')
ok(backDoc.body === sampleDoc.body, '正文原样往返，保留段间空行')
ok(backDoc.entries.length === 3, '三条条目都回来')
ok(backDoc.entries[0].constant === true && backDoc.entries[0].keys.join(',') === '雾港,港口', '常驻与关键词保留')
ok(backDoc.entries[1].locked === true && backDoc.entries[1].secondaryKeys.join(',') === '海雾', '锁定与二级关键词保留')
ok(backDoc.entries[2].enabled === false, '停用状态保留')
ok(backDoc.entries[0].id === 'e1' && backDoc.entries[1].id === 'e2', '关键词没变时复用旧 id')
ok(backDoc.stats.added === 0 && backDoc.stats.removed === 0, '往返不产生增删')

const plainDoc = parseSettingText('就是一段普通设定。\n\n第二段。')
ok(plainDoc.entries.length === 0 && plainDoc.body === '就是一段普通设定。\n\n第二段。', '无标记时整篇进正文')
ok(plainDoc.name === undefined, '没有名字行时不猜名字')
ok(renderSettingText({ name: '', body: '正文', entries: [] }) === '正文', '空名字不写设定行')

const escapedText = renderSettingText({ name: 'X', body: '正文\n【条目：不是真的】\n继续', entries: [] })
ok(escapedText.includes('\\【条目：不是真的】'), '正文里的条目标记被转义')
const escapedBack = parseSettingText(escapedText)
ok(escapedBack.entries.length === 0 && escapedBack.body.includes('【条目：不是真的】'), '转义行解析回正文，不变成条目')

const trickyDoc = {
  ...makeSetting('setting'),
  name: 'Y',
  body: '',
  entries: [{ id: 't1', keys: ['甲'], content: '第一段\n【条目：乙】\n第二段', enabled: true }],
}
const trickyBack = parseSettingText(renderSettingText(trickyDoc), trickyDoc)
ok(
  trickyBack.entries.length === 1 && trickyBack.entries[0].content.includes('【条目：乙】'),
  '条目内容里的标记不分裂条目'
)

const fewer = parseSettingText('【条目：雾港, 港口】\n新内容', sampleDoc)
ok(fewer.stats.removed === 2, '文本里没有的条目算删除')
ok(fewer.stats.lockedRemoved === 1, '被删的锁定条目单独统计')
ok(fewer.entries[0].id === 'e1', '改内容不改关键词仍复用 id')

const crlfDoc = parseSettingText('\uFEFF【设定：A】\r\n\r\n正文\r\n【条目：k】\r\nv')
ok(crlfDoc.name === 'A' && crlfDoc.body === '正文' && crlfDoc.entries[0].content === 'v', 'BOM 与 CRLF 不影响解析')
ok(parseSettingText('【条目：】\n没有关键词').entries.length === 0, '空关键词条目被丢掉')

const escapedName = parseSettingText('\\【设定：不是名字】\n正文')
ok(escapedName.name === undefined && escapedName.body.includes('【设定：不是名字】'), '转义过的名字行当正文')

const evolvedDoc = {
  ...makeSetting('setting'),
  name: '原稿',
  derivedFrom: 'origin-id',
  changelog: [{ at: 1, turn: 0, note: '测试', changes: [] }],
}
const applied = applySettingText('【设定：新名】\n\n新正文', evolvedDoc)
ok(
  applied.doc.name === '新名' && applied.doc.derivedFrom === 'origin-id' && applied.doc.changelog.length === 1,
  '文本编辑不动发展稿的其它字段'
)

ok(settingTextFileName('雾港/港口').endsWith('.txt'), '导出文件名是 .txt')
ok(!settingTextFileName('雾港/港口').includes('/'), '文件名里的斜杠被替换')

/* ---------------- AI 整理设定 ---------------- */
section('AI 整理设定')

const {
  cleanModelOutput,
  looksFormatted,
  buildFormatPrompt,
  buildFormatInstruction,
  formatSettingText,
  formattedDraft,
  FORMAT_INSTRUCTION,
  FORMAT_MAX_CHARS,
} = await import('@/chat/setting-format')

ok(cleanModelOutput('```txt\n【设定：甲】\n\n正文\n```') === '【设定：甲】\n\n正文', '清掉代码块围栏')
ok(
  cleanModelOutput('好的，我来整理。\n\n【设定：甲】\n\n正文') === '【设定：甲】\n\n正文',
  '清掉「以下是」这类前导语'
)
ok(looksFormatted('【条目：k】\nv'), '有条目标记就算符合格式')
ok(!looksFormatted('就是一段正文'), '没有标记不算整理结果')

const formatPrompt = buildFormatPrompt('原文内容', '雾港')
ok(formatPrompt.includes('【用户给的名字】雾港') && formatPrompt.includes('原文内容'), '整理提示词带上名字与原文')
ok(buildFormatPrompt('原文').includes('没有给名字'), '没名字时明确告诉模型')

const draft = formattedDraft(
  '【设定：模型取的名】\n\n正文\n\n【条目：甲, 乙】\n内容',
  { ...makeSetting('setting'), name: '兜底' }
)
ok(draft.name === '模型取的名' && draft.body === '正文' && draft.entries.length === 1, '整理结果解析成草稿')
ok(draft.entries[0].keys.join(',') === '甲,乙', '条目关键词进草稿')

const namedDraft = formattedDraft(
  '【设定：模型取的名】\n\n正文',
  { ...makeSetting('setting'), name: '兜底' },
  '用户给的名'
)
ok(namedDraft.name === '用户给的名', '用户给的名字优先于模型命名')
ok(FORMAT_MAX_CHARS > 0, '整理有字数上限')

// 用户自己的前置说明：放在 system 最前面，先交代设定是什么
ok(buildFormatInstruction() === FORMAT_INSTRUCTION, '没有前置说明时不加段落')
const customInstruction = buildFormatInstruction('这是一份冷峻的悬疑小说设定')
ok(
  customInstruction.includes('【用户的前置说明】') && customInstruction.includes('这是一份冷峻的悬疑小说设定'),
  '前置说明进入 system'
)
ok(
  customInstruction.indexOf('这是一份冷峻的悬疑小说设定') <
    customInstruction.indexOf('你是一名设定编辑'),
  '前置说明排在内置规则之前'
)
ok(
  customInstruction.includes('无论这段说明怎么写，最终输出仍然必须使用下面的【设定：】/【条目：】标记格式'),
  '前置说明不能改掉输出格式'
)
ok(buildFormatInstruction('   ') === FORMAT_INSTRUCTION, '纯空白说明视为没有')

// 用假的流验证请求体：不联网，确认前置说明真的进了 system 开头
const realStream = platform().stream
platform().stream = async function* (req) {
  captured = JSON.parse(req.body)
  const parts = ['【设定：雾港】', '\n\n正文', '\n\n【条目：雾港】\n港城。']
  for (const part of parts) {
    yield `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`
  }
  yield 'data: [DONE]\n\n'
}
const formattedResult = await formatSettingText(
  '雾港是一座港城。',
  st().config,
  new AbortController().signal,
  '雾港',
  '这是一份悬疑小说设定'
)
ok(formattedResult.includes('【条目：雾港】'), '整理函数返回可解析的文本')
ok(captured.messages[0].content.includes('这是一份悬疑小说设定'), '前置说明进了 system')
ok(captured.messages[0].content.includes('【用户的前置说明】'), '前置说明有独立标题')
ok(
  captured.messages[0].content.indexOf('这是一份悬疑小说设定') <
    captured.messages[0].content.indexOf('你是一名设定编辑'),
  '前置说明在 system 最前面'
)
ok(captured.messages[1].content.includes('雾港是一座港城'), '原文进了 user 消息')
ok(captured.max_tokens === undefined, '整理不继承用户的 max_tokens')
ok(captured.temperature === 0.3, '整理温度固定 0.3')
platform().stream = realStream

/* ---------------- 分支与单链导出 ---------------- */
section('分支与单链导出')

const { pathOf, resolveChain, buildForest } = await import('@/chat/branches')
const { chainToMarkdown, chainExportFilename } = await import('@/chat/chain-export')
const { evolutionActive } = await import('@/chat/evolution')

const makeTurn = (idx, variants, active = 0) => ({
  id: `t${idx}`,
  sessionId: 's',
  idx,
  active,
  createdAt: 0,
  variants: variants.map((v) => ({
    user: { content: v.u ?? '' },
    ...(v.a === undefined ? {} : { assistant: { content: v.a, reasoning: v.r } }),
    ...(v.p ? { path: v.p } : {}),
  })),
})

const branchTurns = [
  makeTurn(0, [{ u: '甲问', a: '甲答' }, { u: '乙问', a: '乙答' }], 1),
  makeTurn(1, [{ u: 'X问', a: 'X答', p: [1] }, { u: 'Y问', a: 'Y答', p: [0] }], 0),
  makeTurn(2, [{ u: 'Z问', a: 'Z答', r: '想了一会儿', p: [1, 1] }], 0),
]

ok(pathOf(branchTurns, 2).join(',') === '1,0', 'pathOf 快照前序每轮选中的版本')
ok(pathOf(branchTurns, 0).length === 0, '第 0 轮之前没有 path')

const chain = resolveChain(branchTurns, 't2', 0)
ok(chain?.exact === true, '有 path 时还原成精确历史链')
ok(chain?.steps.map((step) => step.variant).join(',') === '1,1,0', '精确链按 path 选中乙/Y/Z')
ok(chain?.steps.length === 3, '链只包含目标轮及之前')

const branchMd = chainToMarkdown({ title: '测试会话' }, chain)
ok(branchMd.includes('真实历史链'), '导出文件写明是历史链')
ok(branchMd.includes('乙问') && branchMd.includes('Y问') && branchMd.includes('Z问'), '导出包含链上的内容')
ok(!branchMd.includes('甲问') && !branchMd.includes('X问'), '导出不包含兄弟分支')
ok(!branchMd.includes('想了一会儿'), '默认不导出思考过程')
ok(
  chainToMarkdown({ title: '测试会话' }, chain, { includeReasoning: true }).includes('想了一会儿'),
  '勾选后导出思考过程'
)

const oldTurns = [branchTurns[0], branchTurns[1], makeTurn(2, [{ u: 'W问', a: 'W答' }], 0)]
const oldChain = resolveChain(oldTurns, 't2', 0)
ok(oldChain?.exact === false, '没有 path 时标记为拼接链')
ok(oldChain?.steps.map((step) => step.variant).join(',') === '1,0,0', '旧记录退回当前激活链')
ok(chainToMarkdown({ title: '测试' }, oldChain).includes('按当前选择拼接'), '导出写明是拼接链')

const badTurns = [branchTurns[0], branchTurns[1], makeTurn(2, [{ u: 'V问', a: 'V答', p: [9, 9] }], 0)]
ok(resolveChain(badTurns, 't2', 0)?.exact === false, 'path 越界时退回拼接链')

const linearOld = [makeTurn(0, [{ u: '一', a: '1' }]), makeTurn(1, [{ u: '二', a: '2' }])]
ok(resolveChain(linearOld, 't1', 0)?.exact === true, '线性旧记录没有歧义，仍算精确链')
ok(
  buildForest(linearOld).nodes.find((node) => node.key === 't1-0')?.exact === true,
  '线性旧记录的边是实线'
)

const soloChain = resolveChain([makeTurn(0, [{ u: '', a: '开场白' }])], 't0', 0)
ok(soloChain?.exact === true && soloChain.steps.length === 1, '第 0 轮天然是精确链')
ok(!chainToMarkdown({ title: '测试' }, soloChain).includes('**你**'), '空用户轮不写「你」')

const forest = buildForest(branchTurns)
ok(forest.roots.length === 2, '第 0 轮的两个版本都是根')
const zNode = forest.nodes.find((node) => node.key === 't2-0')
ok(zNode?.parentKey === 't1-1' && zNode.exact === true, '树的边指向记录的真实父版本')
const yNode = forest.nodes.find((node) => node.key === 't1-1')
ok(yNode?.children.some((child) => child.key === 't2-0'), '父节点挂上了正确的子节点')

const oldForest = buildForest(oldTurns)
const oldZ = oldForest.nodes.find((node) => node.key === 't2-0')
ok(oldZ?.parentKey === 't1-0' && oldZ.exact === false, '无 path 的边按当前选择推断并标记不精确')

ok(chainExportFilename({ title: '雾港' }, chain).endsWith('.md'), '导出文件名是 .md')
ok(chainExportFilename({ title: '雾港' }, chain).includes('到第3轮'), '导出文件名带上目标轮次')

// 生成链路真的把 path 写进了新版本
const firstTurn = st().turns[0]
ok(
  Array.isArray(firstTurn.variants[0].path) && firstTurn.variants[0].path.length === 0,
  '第一版记下空 path'
)
await st().regenerate(firstTurn.id)
const regeneratedTurn = st().turns[0]
ok(
  regeneratedTurn.variants.length === 2 && regeneratedTurn.variants[1].path?.length === 0,
  '重新生成也记 path'
)
await st().send('第二句')
const secondTurn = st().turns[1]
ok(secondTurn?.variants[0].path?.[0] === 1, '第二轮记下第一轮当时选中的版本')

// 发展模式的判定：开关 + 写作模式 + 挂的是发展稿
ok(evolutionActive(true, 'writing', [{ derivedFrom: 'x' }]) === true, '三项齐备才判定为发展模式')
ok(evolutionActive(true, 'writing', [{}]) === false, '挂的不是发展稿不算')
ok(evolutionActive(false, 'writing', [{ derivedFrom: 'x' }]) === false, '全局开关关了不算')
ok(evolutionActive(true, 'tavern', [{ derivedFrom: 'x' }]) === false, '不在写作模式不算')

// 从链开新会话：把选中的链原样搬过去
const originId = st().currentId
const originSession = st().sessions.find((s) => s.id === originId)
const originTurns = st().turns.length
const chainSource = st().turns[1].variants[0]
await st().forkFromChain(st().turns[1].id, 0)
ok(st().currentId !== originId, '从链开新对话创建了新会话')
const forked = st().sessions.find((s) => s.id === st().currentId)
ok(forked?.title.endsWith('· 分支'), '分支会话标题带「· 分支」')
ok(forked?.titleLocked === true, '分支标题已锁定')
ok(st().turns.length === originTurns, '新会话只包含这条链的轮次')
ok(st().turns.every((t) => t.variants.length === 1), '新会话每轮只保留链上的那一版')
ok(
  st().turns.every((t, i) => (t.variants[0].path?.length ?? -1) === i),
  '新会话的 path 重新记成一条直线'
)
ok(forked?.packId === originSession?.packId, '沿用原会话的提示词包')
ok((forked?.settingIds ?? []).join() === (originSession?.settingIds ?? []).join(), '沿用原会话的设定')
ok(
  st().turns[1].variants[0].assistant?.content === chainSource.assistant?.content,
  '内容与所选链一致'
)

// 设定发展模式：回溯与分叉全部禁用
const evolveBase = { ...makeSetting('setting'), name: '演化源' }
st().importSetting(evolveBase)
const evolveDoc = { ...makeSetting('setting'), name: '演化源 · 发展稿', derivedFrom: evolveBase.id }
st().importSetting(evolveDoc)
st().saveConfig({ settingEvolution: true, packId: 'writing' })
await st().startWithSettings([evolveDoc.id])
const evoSessionId = st().currentId
await st().send('演化第一句')
const evoTurn = st().turns[0]
await st().regenerate(evoTurn.id)
ok(st().turns[0].variants.length === 2, '发展模式允许在最后一轮重新生成')
await st().switchVariant(evoTurn.id, 0)
ok(st().error?.includes('设定发展模式'), '发展模式禁止切回旧版本')
ok(st().turns[0].active === 1, '被拒绝后激活版本不变')
await st().editResend(evoTurn.id, '改写一下')
ok(st().error?.includes('设定发展模式'), '发展模式禁止编辑旧轮次')
await st().branchFrom(evoTurn.id)
ok(st().error?.includes('设定发展模式'), '发展模式禁止从旧轮次开新话题')

// 开新对话不等于回溯：发展模式下允许从旧链开新会话，发展稿沿用不回滚
const evoSession = st().sessions.find((s) => s.id === evoSessionId)
const evoForkSource = st().turns[0].variants[1].assistant?.content
await st().forkFromChain(evoTurn.id, 1)
ok(st().currentId !== evoSessionId, '发展模式允许从链开新对话')
const evoFork = st().sessions.find((s) => s.id === st().currentId)
ok(evoFork?.title.endsWith('· 分支'), '发展模式分支会话标题正常')
ok(
  (evoFork?.settingIds ?? []).join() === (evoSession?.settingIds ?? []).join(),
  '发展模式分支沿用同一份发展稿'
)
ok(st().turns.length === 1, '只搬了链上的一轮')
ok(st().turns[0].variants[0].assistant?.content === evoForkSource, '内容与所选版本一致')
st().saveConfig({ settingEvolution: false, packId: 'minimal' })

/* ---------------- 酒馆助手变量作用域 ---------------- */
section('酒馆助手变量作用域（message/chat/global）')

const { getRepo } = await import('@/db/runtime')
const {
  thGetVariables,
  thInsertOrAssignVariables,
  thFlatMessages,
  injectPrompts,
  uninjectPrompts,
  takeThPromptInjections,
} = await import('@/chat/th-runtime')

const thSession = await getRepo().createSession('TH 变量作用域测试')
useApp.setState({ sessions: await getRepo().listSessions() })
await getRepo().appendTurn({
  id: newId(),
  sessionId: thSession.id,
  idx: 0,
  variants: [
    {
      user: { content: 'hi' },
      assistant: { content: 'hello', variables: { 主角: { 姓名: '苏念' } } },
      path: [],
    },
  ],
  active: 0,
  createdAt: Date.now(),
})
await useApp.getState().selectSession(thSession.id)

const flat = thFlatMessages()
ok(flat.length === 2, `扁平视图 2 条（用户 + AI）`)
ok(flat[1].role === 'assistant' && flat[1].variables?.主角?.姓名 === '苏念', 'AI 消息带变量快照')

const msgVars = thGetVariables({ type: 'message', message_id: -1 })
ok(msgVars.主角?.姓名 === '苏念', 'message 作用域（-1=最后一条）读到该消息的快照')
ok(Object.keys(thGetVariables({ type: 'message', message_id: 0 })).length === 0, '用户消息没有消息级变量')
ok(thGetVariables({ type: 'message', message_id: 1 }).主角?.姓名 === '苏念', '按消息 id 读到对应 AI 变量')
ok(Object.keys(thGetVariables({ type: 'global' })).length === 0, 'global 作用域为空对象')

uninjectPrompts()
injectPrompts([{ id: 't-once', position: 'in_chat', depth: 0, role: 'system', content: '本轮注入' }], { once: true })
const onceInjected = takeThPromptInjections()
ok(onceInjected.length === 1 && onceInjected[0].content === '本轮注入', '提示词注入可被宿主读取')
ok(takeThPromptInjections().length === 0, 'once 注入只消费一次')
injectPrompts([{ id: 't-keep', position: 'none', content: '常驻注入' }])
injectPrompts([{ id: 't-keep', position: 'none', content: '覆盖后的注入' }])
const persistentInjected = takeThPromptInjections()
ok(persistentInjected.length === 1 && persistentInjected[0].content === '覆盖后的注入', '同 id 注入会覆盖')
ok(takeThPromptInjections().length === 1, '常驻注入取完仍保留')
uninjectPrompts(['t-keep'])
ok(takeThPromptInjections().length === 0, 'uninject 可移除常驻注入')

await thInsertOrAssignVariables({ type: 'message', message_id: -1, assigning: { 新键: 7 } })
const afterWrite = thGetVariables({ type: 'message', message_id: -1 })
ok(afterWrite.新键 === 7 && afterWrite.主角?.姓名 === '苏念', '消息作用域写入并保留原树')
const persistedTurn = (await getRepo().listTurns(thSession.id))[0]
ok(persistedTurn.variants[0].assistant?.variables?.新键 === 7, '消息级变量经 repo 持久化往返')

await thInsertOrAssignVariables({ type: 'chat', assigning: { 会话级: true } })
ok(thGetVariables({ type: 'chat' }).会话级 === true, 'chat 作用域写读一致')

/* ---------------- 酒馆式群聊 ---------------- */
section('酒馆式群聊（激活策略与逐条生成）')

const {
  DEFAULT_GROUP,
  normalizeGroup,
  buildGroupMembers,
  activateGroup,
  extractMentioned,
  pickGroupGreeting,
  stripSpeakerPrefix,
  renderGroupDirective,
} = await import('@/chat/group')

const gm = (id, name, talkativeness, muted = false) => ({ id, name, talkativeness, muted })
const noMention = (members, overrides = {}) =>
  activateGroup({ strategy: 'natural', members, isUserInput: true, rng: () => 0.99, ...overrides })

const groupNatural = [gm('a', '林晚', 0), gm('b', '老赵', 0), gm('c', '小满', 0)]
ok(
  activateGroup({ strategy: 'natural', members: groupNatural, text: '请老赵先说说', isUserInput: true }).join(',') === 'b',
  '自然顺序：点名激活被点的人'
)
ok(noMention([gm('a', '林晚', 1), gm('b', '老赵', 0)]).join(',') === 'a', '自然顺序：话痨度掷骰激活')
ok(
  activateGroup({
    strategy: 'natural',
    members: [gm('a', '林晚', 1), gm('b', '老赵', 1)],
    text: '林晚你来说',
    isUserInput: false,
    lastSpeakerId: 'a',
    rng: () => 0.1,
  }).join(',') === 'b',
  '自然顺序：默认不让上一句的人连续接话'
)
ok(
  activateGroup({
    strategy: 'natural',
    members: [gm('a', '林晚', 0), gm('b', '老赵', 0)],
    text: '林晚接着说',
    isUserInput: false,
    lastSpeakerId: 'a',
    allowSelfResponses: true,
    rng: () => 0.5,
  }).join(',') === 'a',
  '允许连续接话时自己也能被激活'
)
ok(
  activateGroup({ strategy: 'natural', members: [gm('a', '甲', 0), gm('b', '乙', 1, true)], text: '乙在吗', isUserInput: true, rng: () => 0.1 }).join(',') === 'a',
  '静音成员不会被点名激活（兜底仍选未静音的人）'
)
ok(
  activateGroup({ strategy: 'list', members: [gm('a', '甲', 0), gm('b', '乙', 0, true), gm('c', '丙', 0)] }).join(',') === 'a,c',
  '列表顺序：未静音成员依次发言'
)
ok(activateGroup({ strategy: 'manual', members: groupNatural, isUserInput: true }).length === 0, '手动模式：用户发送不自动接话')
ok(
  activateGroup({ strategy: 'manual', members: [gm('a', '甲', 0, true)], isUserInput: false, forceId: 'a' }).join(',') === 'a',
  '强制发言可越过静音'
)
const pooledFirst = activateGroup({
  strategy: 'pooled',
  members: [gm('a', '甲', 0), gm('b', '乙', 0)],
  isUserInput: false,
  spokenSinceUser: ['a'],
  rng: () => 0,
})
ok(pooledFirst.join(',') === 'b', '轮流随机：优先没说过话的人')

ok(extractMentioned([gm('a', 'Misaka Mikoto', 0)], 'Mikoto 你来说').join(',') === 'a', '英文名按词匹配')
ok(extractMentioned([gm('a', 'Misaka Mikoto', 0)], 'Misa 你来说').length === 0, '英文名不做前缀误匹配')
ok(extractMentioned([gm('a', '林晚', 0)], '让林晚来说').join(',') === 'a', '中文名按整名匹配')

ok(normalizeGroup({ talkativeness: { a: 2, b: -1 }, strategy: 'nope' }).talkativeness.a === 1, '话痨度夹在 0–1')
ok(normalizeGroup({ strategy: 'nope' }).strategy === DEFAULT_GROUP.strategy, '非法策略回退默认值')
ok(pickGroupGreeting(['一', '二', '三'], () => 0.99) === '三', '群聊开场随机取一段')
ok(pickGroupGreeting([], () => 0.5) === undefined, '没有开场返回 undefined')

ok(stripSpeakerPrefix('**林晚**：你好', '林晚') === '你好', '剥离加粗名字前缀')
ok(stripSpeakerPrefix('林晚：你好', '林晚') === '你好', '剥离裸名字前缀')
ok(stripSpeakerPrefix('老赵：你好', '林晚') === '老赵：你好', '不剥别人的名字前缀')
const directive = renderGroupDirective(['林晚', '老赵'], '林晚', 'swap')
ok(directive.includes('当前发言者：林晚') && directive.includes('不要替') && directive.includes('老赵'), '群聊提示词锚定发言者')
ok(!directive.includes('**林晚**：'), '群聊提示词不再要求名字前缀')

// 逐条生成：列表顺序 → 两个成员各一条独立消息；交换角色卡只注入发言者的设定
const groupRequests = []
const streamBeforeGroup = platform().stream
platform().stream = async function* (req) {
  groupRequests.push(JSON.parse(req.body))
  yield 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n'
  yield 'data: [DONE]\n\n'
}
st().saveConfig({ packId: 'tavern' })

const memberA = emptySetting('character')
memberA.name = '群演甲'
memberA.body = '甲的独家设定正文'
memberA.firstMessage = '甲的开场白'
const memberB = emptySetting('character')
memberB.name = '群演乙'
memberB.body = '乙的独家设定正文'
memberB.firstMessage = '乙的开场白'
st().importSetting(memberA)
st().importSetting(memberB)

await st().startWithSettings([memberA.id, memberB.id], undefined, 0, { strategy: 'list', generation: 'swap' })
const groupSession = st().sessions.find((s) => s.id === st().currentId)
ok(groupSession?.group?.strategy === 'list', '群聊配置随会话保存')
const greetingTurns = await getRepo().listTurns(groupSession.id)
ok(greetingTurns.length === 2, '群聊开场：每个成员各一条消息')
ok(greetingTurns[0].variants[0].assistant?.speaker === '群演甲', '开场第一条归属甲')
ok(greetingTurns[1].variants[0].assistant?.speaker === '群演乙', '开场第二条归属乙')

const beforeList = groupRequests.length
await st().send('大家开始吧')
ok(groupRequests.length === beforeList + 2, '列表顺序：一次发送生成两条回复')
const listSystemA = groupRequests[beforeList].messages.map((m) => m.content).join('\n')
const listSystemB = groupRequests[beforeList + 1].messages.map((m) => m.content).join('\n')
ok(listSystemA.includes('甲的独家设定正文') && !listSystemA.includes('乙的独家设定正文'), '交换卡：第一条只注入甲的设定')
ok(listSystemB.includes('乙的独家设定正文') && !listSystemB.includes('甲的独家设定正文'), '交换卡：第二条只注入乙的设定')
ok(
  groupRequests[beforeList + 1].messages.some((m) => m.role === 'assistant' && String(m.content).startsWith('群演甲：')),
  '群聊历史带角色名前缀，模型分得清谁说过什么'
)
const listTurns = await getRepo().listTurns(groupSession.id)
ok(listTurns.length === 4, '开场 2 条 + 用户 1 条 + 第二条回复独立成轮')
ok(listTurns[2].variants[0].assistant?.speaker === '群演甲', '第一条回复归属甲')
ok(listTurns[3].variants[0].assistant?.speaker === '群演乙', '第二条回复独立归属乙')
ok(st().error === null, '群聊生成无错误')

// 手动模式：用户发送不自动接话；强制发言可指定静音成员
await st().startWithSettings([memberA.id, memberB.id], undefined, 0, { strategy: 'manual', generation: 'swap' })
const manualSession = st().currentId
const beforeManual = groupRequests.length
await st().send('手动试试')
ok(groupRequests.length === beforeManual, '手动模式：用户消息不触发自动回复')
const pendingTurn = st().turns[st().turns.length - 1]
ok(pendingTurn.variants[0].user.content === '手动试试' && !pendingTurn.variants[0].assistant, '用户消息保留等待触发')
await st().updateSessionGroup({ muted: [memberB.id] })
await st().groupTrigger(memberB.id)
ok(groupRequests.length === beforeManual + 1, '强制发言只生成一条')
ok(st().turns[st().turns.length - 1].variants[0].assistant?.speaker === '群演乙', '强制发言越过静音且归属正确')

// 列表顺序 + 静音：只让未静音的人回复
await st().updateSessionGroup({ strategy: 'list' })
const beforeMuted = groupRequests.length
await st().send('再来一轮')
ok(groupRequests.length === beforeMuted + 1, '列表顺序跳过静音成员')

// 合并角色卡：两条回复的上下文都包含全员设定
await st().startWithSettings([memberA.id, memberB.id], undefined, 0, { strategy: 'list', generation: 'join' })
const beforeJoin = groupRequests.length
await st().send('合并卡测试')
const joinSystem = groupRequests[beforeJoin].messages.map((m) => m.content).join('\n')
ok(joinSystem.includes('甲的独家设定正文') && joinSystem.includes('乙的独家设定正文'), '合并卡：上下文包含所有成员设定')
ok(st().sessions.find((s) => s.id === st().currentId)?.group?.generation === 'join', '生成方式写入会话配置')

platform().stream = streamBeforeGroup
st().saveConfig({ packId: 'minimal' })

/* ---------------- 说明书与更新日志 ---------------- */
section('说明书与更新日志')

const { MANUAL_SECTIONS } = await import('@/ui/manual-text')
const { CHANGELOG } = await import('@/ui/changelog-text')
ok(MANUAL_SECTIONS.length >= 18, `说明书节数完整（${MANUAL_SECTIONS.length} 节）`)
ok(new Set(MANUAL_SECTIONS.map((s) => s.id)).size === MANUAL_SECTIONS.length, '说明书锚点不重复')
ok(MANUAL_SECTIONS.every((s) => s.title.trim() && s.md.trim().length > 50), '每节都有标题和正文')
ok(MANUAL_SECTIONS.some((s) => s.id === 'group' && s.md.includes('发言顺序')), '说明书包含群聊入门')
ok(CHANGELOG.length >= 2 && CHANGELOG[0].version === '2026.11.28.2', '更新日志最新版本正确')
ok(CHANGELOG[0].items.length >= 12, `最新更新日志足够详细（${CHANGELOG[0].items.length} 条）`)

/* ---------------- 汇总 ---------------- */
console.log('\n' + '-'.repeat(48))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
