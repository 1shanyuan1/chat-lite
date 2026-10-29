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

ok(BUILTIN_PACKS.length === 3, `内置三套包（${BUILTIN_PACKS.length}）`)
ok(new Set(BUILTIN_PACKS.map((p) => p.id)).size === 3, '包 id 不重复')
ok(BUILTIN_PACKS.every((p) => p.name && p.hint), '每套包都有名称与说明')
ok(findPack(DEFAULT_PACK_ID).id === 'minimal', '默认落到极简包')
ok(findPack('writing').name === '写作', '按 id 取包')
ok(findPack('不存在').id === 'minimal', '未知 id 回退到极简')
ok(findPack(undefined).id === 'minimal', '未设置时回退到极简')

const writing = findPack('writing')
ok(writing.systemPrompt.length > 20, '写作包带系统提示词')
ok(writing.actions.length >= 4, `写作包 ${writing.actions.length} 个快捷动作`)
ok(writing.actions.every((a) => a.id && a.label && a.template.includes('{{input}}')), '每个动作都有 id/标签且含 {{input}} 占位')
ok(findPack('minimal').actions.length === 0, '极简包没有动作，不占界面')

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

/* ---------------- 汇总 ---------------- */
console.log('\n' + '-'.repeat(48))
console.log(`通过 ${passed} 项，失败 ${failed} 项`)
process.exit(failed === 0 ? 0 : 1)
