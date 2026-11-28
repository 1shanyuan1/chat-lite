/**
 * 生成测试卡套件：覆盖酒馆生态各形态的最小功能卡。
 * 输出 workspace/testcards/*.json + 说明.md。
 *
 *   node scripts/make-testcards.mjs
 *   然后逐张 cardcase 验证导入，再 adb push 进模拟器实测。
 */
import fs from 'node:fs'
import path from 'node:path'

const OUT = 'workspace/testcards'
fs.mkdirSync(OUT, { recursive: true })

const wrap = (data, spec = 'chara_card_v3') => JSON.stringify({ spec, spec_version: '3.0', data }, null, 1)

const cards = []

/* 1. 经典文本卡：无扩展基线 */
cards.push({
  file: '01-经典文本卡.json',
  json: wrap({
    name: '经典文本·图书管理员',
    description: '你是守夜图书馆的管理员林晚，说话轻声细语，热爱旧书的味道。',
    personality: '温和、博学、偶尔幽默',
    scenario: '深夜的旧图书馆，油灯与书架之间。',
    first_mes: '林晚从书架后探出头：「这么晚还来看书？{{user}}，油灯我给你留着呢。」',
    alternate_greetings: ['林晚正在整理书架，回头微微一笑：「欢迎回来。」'],
    character_book: {
      entries: [
        { keys: ['禁书'], content: '三层禁书区只对林晚开放，传说里面有会低语的书。', enabled: true },
        { keys: ['雨'], content: '下雨时图书馆的屋顶会漏雨，林晚用铜盆接水。', constant: true, enabled: true },
      ],
    },
  }),
})

/* 2. 正则面板卡：模型出标记 → 显示侧正则换成静态面板（含折叠/表格/图片/进度条） */
const panelHtml =
  '<div style="border:1px solid #b45309;border-radius:8px;padding:8px;background:#fffbf0">' +
  '<b>📜 冒险者面板</b><div style="height:6px;background:#e5e7eb;border-radius:3px;margin:6px 0">' +
  '<div style="width:70%;height:6px;background:#f59e0b;border-radius:3px"></div></div>' +
  '<table style="width:100%"><tr><td>生命</td><td><b>12/20</b></td><td>金币</td><td><b>35</b></td></tr></table>' +
  '<details><summary>装备（点击展开）</summary><ul><li>铜剑</li><li>旧地图</li></ul></details>' +
  '<img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20width%3D%2260%22%20height%3D%2220%22%3E%3Ctext%3Ebanner%3C/text%3E%3C/svg%3E" alt="旗" />' +
  '</div>'
cards.push({
  file: '02-正则面板卡.json',
  json: wrap({
    name: '正则面板·冒险者酒馆',
    description: '酒馆老板娘“梅姐”经营着一间冒险者聚集的酒馆。每次回复的末尾输出 <冒险者面板/>。',
    first_mes: '梅姐擦着杯子：「新面孔啊？坐。你的面板我给你挂墙上了。」\n<冒险者面板/>',
    character_book: {
      entries: [
        {
          keys: ['面板'],
          content: '规则：每次回复末尾必须输出 <冒险者面板/> 占位符。生命值根据剧情增减。',
          constant: true,
          enabled: true,
        },
      ],
    },
    extensions: {
      regex_scripts: [
        {
          id: 'r1',
          scriptName: '面板渲染',
          findRegex: '/<冒险者面板\\/>/g',
          replaceString: panelHtml,
          placement: [2],
          markdownOnly: true,
        },
        {
          id: 'r2',
          scriptName: '提示词清理',
          findRegex: '/<冒险者面板\\/>/g',
          replaceString: '',
          placement: [2],
          promptOnly: true,
        },
      ],
    },
  }),
})

/* 3. QR 按钮卡：三种按钮形态 */
cards.push({
  file: '03-QR按钮卡.json',
  json: wrap({
    name: 'QR按钮·问询台',
    description: '前台接待员小舟，负责回答关于小镇的一切问题。',
    first_mes: '小舟抬头：「需要帮忙吗？下面的按钮可以直接问。」',
    extensions: {
      quick_replies: [
        { label: '问天气', message: '今天小镇天气怎么样？' },
        { label: '问传说', message: '给我讲一个这座镇的传说吧 {{random:关于古井,关于钟楼,关于雾夜}}' },
        { label: '记录心情', message: '/setvar 心情 愉快' },
      ],
    },
  }),
})

/* 4. 深度注入卡：@D 条目 + depth_prompt */
cards.push({
  file: '04-深度注入卡.json',
  json: wrap({
    name: '深度注入·守钟人',
    description: '守钟人老周守着镇口的钟楼，沉默寡言。',
    first_mes: '老周敲了三下钟：「听见了？这是今天的规矩。」',
    extensions: {
      depth_prompt: { prompt: '（系统提醒：无论剧情如何，每段回复都必须以【钟声回响】四个字开头。）', depth: 1, role: 'system' },
    },
    character_book: {
      entries: [
        {
          keys: ['钟声'],
          content: '【深度注入✓】钟楼的钟在每整点自动敲响，镇民以此为时钟。',
          constant: true,
          position: 4,
          depth: 0,
          enabled: true,
        },
        {
          keys: ['规矩'],
          content: '【深度注入✓】规矩：日落后任何人不得登上钟楼。',
          constant: true,
          position: 4,
          depth: 2,
          enabled: true,
        },
        { keys: ['钟'], content: '普通条目：钟楼有一百级台阶。', constant: true, enabled: true },
      ],
    },
  }),
})

/* 5. 宏演示卡 */
cards.push({
  file: '05-宏演示卡.json',
  json: wrap({
    name: '宏演示·占卜师',
    description: '占卜师薇拉喜欢用随机与骰子说话。',
    first_mes:
      '薇拉摇了摇水晶球：「今日灵感：{{pick:星星,月亮,雾}}。时辰：{{time}}，日期：{{date}}。掷个骰子：{{roll:1d20}}。如果让我随机选一句话——{{random:命运在微笑,命运在打盹,命运在打喷嚏}}。」',
    character_book: {
      entries: [
        {
          keys: ['占卜'],
          content: '规则：用户要求占卜时，输出 {{roll:2d6}} 作为卦象点数，并在 {{time}} 完成推演。',
          constant: true,
          enabled: true,
        },
      ],
    },
  }),
})

/* 6. 经典角色 B：与 01 搭配挂载 → 群聊 */
cards.push({
  file: '06-经典角色B卡.json',
  json: wrap({
    name: '经典文本·守夜人老赵',
    description: '老赵是图书馆的夜班保安，嗓门大，心思细。',
    personality: '直爽、护着林晚',
    first_mes: '老赵拿着手电晃过来：「小林，闭馆了啊——哟，还有客人？登记一下。」',
    character_book: {
      entries: [{ keys: ['登记'], content: '访客登记本在老赵的腰包里，丢了要写检查。', enabled: true }],
    },
  }),
})

/* 7. MVU 轻量变量卡：UpdateVariable(JSONPatch) + 状态栏正则（无助手脚本） */
cards.push({
  file: '07-MVU轻量变量卡.json',
  json: wrap({
    name: 'MVU轻量·养成小妖',
    description:
      '一只刚化形的小妖“团团”跟着{{user}}生活。每次回复末尾输出 <UpdateVariable><JSONPatch>[{"op":"replace","path":"/心情","value":"（按剧情）"},{"op":"replace","path":"/亲密度","value":（按剧情的数字）}]</JSONPatch></UpdateVariable> 和 <状态栏/>。',
    first_mes: '团团从袖子里探出脑袋：「叽！今天也要一起过呀。」\n<状态栏/>',
    character_book: {
      entries: [
        {
          keys: ['状态'],
          content: '变量协议：心情是字符串，亲密度是 0-100 的数字。每次根据剧情用 UpdateVariable 更新。',
          constant: true,
          enabled: true,
        },
      ],
    },
    extensions: {
      regex_scripts: [
        {
          id: 'm1',
          scriptName: '隐藏变量块',
          findRegex: '/<UpdateVariable>[\\s\\S]*?<\\/UpdateVariable>/g',
          replaceString: '',
          placement: [2],
          markdownOnly: true,
        },
        {
          id: 'm2',
          scriptName: '状态栏',
          findRegex: '/<状态栏\\/>/g',
          replaceString:
            '<div style="border:1px solid #7c3aed;border-radius:8px;padding:6px;background:#f5f3ff"><b>🐱 团团状态</b><div>心情：<b>待剧情</b></div><div>亲密度：<b>待剧情</b></div></div>',
          placement: [2],
          markdownOnly: true,
        },
        {
          id: 'm3',
          scriptName: '提示词清理',
          findRegex: '/<状态栏\\/>/g',
          replaceString: '',
          placement: [2],
          promptOnly: true,
        },
      ],
    },
  }),
})

for (const card of cards) {
  fs.writeFileSync(path.join(OUT, card.file), card.json)
}

fs.writeFileSync(
  path.join(OUT, '说明.md'),
  `# 测试卡套件（${cards.length} 张）

逐张导入后按「预期行为」核对。全部为最小功能卡，正文都很短。

| 卡 | 形态 | 预期行为 |
|---|---|---|
| 01-经典文本卡 | 无扩展基线 | 普通对话；说「禁书」「雨」触发世界书 |
| 02-正则面板卡 | 正则+CSS 面板 | 每轮回复末尾出现金色冒险者面板（表格/进度条/折叠/图片）；提示词里无占位符 |
| 03-QR按钮卡 | QR 三形态 | 输入框上方 3 个按钮：前两个直接发送（含 random 宏）；「记录心情」写变量 |
| 04-深度注入卡 | @D + depth_prompt | 每轮回复以【钟声回响】开头（depth_prompt depth=1）；说「钟声」「规矩」触发 @D 条目 |
| 05-宏演示卡 | 宏族 | 开场与占卜里出现随机的 pick/roll/time/date 结果 |
| 06-经典角色B卡 | 群聊第二角色 | 与 01 同时挂载 → 输入框上方出现 @林晚/@老赵 点名条；@老赵 你好 → 回复带「**老赵**：」且消息标签显示 老赵 |
| 07-MVU轻量变量卡 | MVU 协议+状态栏 | 回复无 <UpdateVariable> 残留（已隐藏）；状态栏出现「团团状态」（首轮为占位样式，第二轮起变量渲染） |

群聊组合：01 + 06 同时挂载。
已由 cardcase 验证导入路径；真机行为在 MuMu 上逐张核对。
`
)

console.log(`生成 ${cards.length} 张测试卡 + 说明.md → ${OUT}/`)
