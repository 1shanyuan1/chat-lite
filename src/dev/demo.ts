/**
 * 开发期的界面演示数据（只在 dev 用，生产构建会被摇掉）。
 *
 * 目的：不接 API、不花钱、不用等流式，直接把各种状态摆出来看排版。
 * 数据只写进 store 的内存，不落库——刷新或点「真实数据」即恢复。
 *
 * 每个用例对应一条渲染分支，加用例前先想清楚它证明了哪个分支没坏。
 */
import { activeVariant } from '@/db'
import type { ChatTurn, MemoryRecord, ToolCallRecord, TurnAssistant } from '@/db'
import type { SettingDoc } from '@/chat/settings'
import type { ChatConfig } from '@/chat/client'
import type { ModelInfo } from '@/chat/models'
import type { Attachment } from '@/chat/attachments'
import type { WebSource } from '@/chat/web-search-types'
import { useApp } from '@/chat/store'

export interface DemoCase {
  id: string
  label: string
  hint: string
}

interface DemoSpec {
  turns: ChatTurn[]
  streamingTurnId?: string
  toolStatus?: string
  /** 顶栏显示的会话标题；缺省取第一句用户消息 */
  title?: string
  /** 上下文窗口上限，决定横条填充比例；缺省 8000 */
  contextLimit?: number
  /** 其他配置补丁，比如思考档位 */
  config?: Partial<ChatConfig>
}

/**
 * 演示用的假模型。
 * 思考开关和档位只在「模型元数据声明支持思考」时才会出现
 * （adapters.ts 里 supportsReasoning 严格要求 meta.reasoning === true），
 * 所以必须连 models 一起注入，否则芯片根本不渲染。
 */
const DEMO_MODEL: ModelInfo = {
  id: 'deepseek-chat',
  label: 'DeepSeek-V4.1-Flash',
  contextLength: 128_000,
  vision: true,
  tools: true,
  reasoning: true,
  reasoningLevels: ['low', 'high', 'max'],
}

const DEMO_BASE_URL = 'https://api.deepseek.com/v1'

/**
 * 演示用的记忆内容，走 store 的预览槽，不写进真实存储。
 * 时间戳写死不用 Date.now()——模块顶层的函数调用会被 Rollup 当副作用保留。
 */
const SAMPLE_MEMORY: MemoryRecord[] = [
  {
    kind: 'profile',
    key: 'main',
    updatedAt: 0,
    body: `- 2026-10-30 在做安卓聊天客户端，界面偏好克制、少装饰
- 2026-10-30 气泡圆角用 20px，习惯比常见推荐值更圆
- 2026-10-30 讨论方案时希望先给结论，再展开理由
- 2026-10-27 用 TypeScript，明确不接受 any`,
  },
  {
    kind: 'index',
    key: 'demo-session-1',
    updatedAt: 0,
    body: `{
  "session": "深夜电台栏目名",
  "summary": "起了三个栏目名，最终倾向《夜航》，因为不限定内容、做久了不用改名",
  "tags": ["命名", "内容策划"],
  "date": "2026-10-26"
}`,
  },
  {
    kind: 'feedback',
    key: 'demo-turn-1',
    updatedAt: 0,
    body: `{
  "rating": "down",
  "text": "别把结论放最后，我要先看答案再看理由",
  "user": "这个方案行不行",
  "assistant": "从三个角度看，这个方案在成本上……（铺垫 400 字）……所以建议先做小规模验证。"
}`,
  },
]

/** 生成一张带渐变和文字的 SVG，用来当缩略图——不用往仓库里塞二进制 */
const svgImage = (label: string, from: string, to: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
      `</linearGradient></defs>` +
      `<rect width="320" height="320" fill="url(#g)"/>` +
      `<circle cx="230" cy="90" r="46" fill="rgba(255,255,255,.28)"/>` +
      `<text x="160" y="178" font-family="sans-serif" font-size="26" fill="#fff" ` +
      `text-anchor="middle">${label}</text></svg>`
  )}`

let seq = 0
const uid = (prefix: string) => `demo-${prefix}-${++seq}`

function turn(
  idx: number,
  user: string,
  assistant?: TurnAssistant,
  attachments?: Attachment[]
): ChatTurn {
  return {
    id: uid('turn'),
    sessionId: 'demo',
    idx,
    variants: [{ user: { content: user, ...(attachments ? { attachments } : {}) }, assistant }],
    active: 0,
    createdAt: Date.now() + idx * 1000,
  }
}

const sources: WebSource[] = [
  {
    url: 'https://api-docs.deepseek.com/news/news261017',
    title: 'DeepSeek-V4.1-Flash 发布公告',
    publishedAt: '2026-10-17',
  },
  {
    url: 'https://example.com/benchmark-report',
    title: '第三方基准测试汇总（2026 Q4）',
    publishedAt: '2026-10-18',
  },
  {
    url: 'https://example.com/long-context',
    title: '长上下文能力的实测对比',
  },
]

const searchCall = (): ToolCallRecord => ({
  id: 'call-search-1',
  name: 'web_search',
  arguments: JSON.stringify({ queries: ['DeepSeek V4.1 Flash 发布时间', 'V4.1 Flash 上下文长度'] }),
  result: '[外部内容提示]\nSources:\n- DeepSeek-V4.1-Flash 发布公告 …',
  sources,
})

const longReasoning = `用户问的是数值比较，但真正的坑在「为什么很多人答错」。
先确认事实：9.11 - 9.9 = -0.79，所以 9.9 更大。
再想错因：小数部分按字符串比较，"11" > "9"，于是直觉判反。
这属于「十进制位值」和「字符串长度」的混淆。
要不要提一下浮点误差？这里不涉及，提了反而干扰，略过。
结论顺序：先给答案，再解释错因，最后给一个记忆法。`

/**
 * 用例表按需构造，不在模块顶层生成。
 * 顶层写 turn(...) / JSON.stringify(...) 这类调用会被 Rollup 当成副作用保留，
 * 演示文案就会漏进生产包（实测漏了 7KB）。
 */
function buildDemos(): Record<string, DemoSpec> {
  // 2026-10-31 真实调用记录：硅基流动 DeepSeek-V4.1-Flash，长记忆开启。
  // 原样保留思考、工具调用和耗时，用来看真实的过程区长什么样。
  // 2026-10-31 四轮真实对话：身份 / 反驳 / 回忆 / 认可，四种触发各一次。
  const multiTurns: ChatTurn[] = [
    {
      "id": "multi-turn-0",
      "sessionId": "demo",
      "idx": 0,
      "variants": [
        {
          "user": {
            "content": "我在做一个安卓聊天客户端，主界面用的是 Material 3。"
          },
          "assistant": {
            "content": "Material 3 的聊天客户端挺常见的组合。你想聊哪部分？比如会话列表的布局、消息气泡样式、TopAppBar 和输入框的交互，还是主题色和动态取色？有具体卡住的地方可以直接说。",
            "reasoning": "The user says they're building an Android chat client with Material 3 main interface. This is identity/长期项目 info — worth recording. Then answer helpfully.\n\nLet me write memory then respond. Actually I should respond substantively too. The message is just context-setting; probably they'll ask something next. But I should give a useful response — maybe ask what specifically they need, or offer guidance. Keep it brief.\n\nLet me record: 用户在做安卓聊天客户端，主界面用 Material 3.\n\nThen respond with something useful, maybe a short question about what they need help with.",
            "usage": {
              "input": 781,
              "output": 177,
              "cacheRead": 0,
              "cacheWrite": 0,
              "cacheSource": "api"
            },
            "model": "deepseek-ai/DeepSeek-V4.1-Flash",
            "durationMs": 4877,
            "reasoningLevel": "high",
            "reasoningSupported": true,
            "interrupted": false,
            "toolCalls": [
              {
                "id": "01a190f38fe0930442619a54d8989ee1",
                "name": "write_memory",
                "arguments": "{\"entries\": [\"用户正在开发一个安卓聊天客户端，主界面采用 Material 3 设计。\"]}",
                "result": "已记住 1 条。"
              }
            ]
          }
        }
      ],
      "active": 0,
      "createdAt": 1793433234431
    },
    {
      "id": "multi-turn-1",
      "sessionId": "demo",
      "idx": 1,
      "variants": [
        {
          "user": {
            "content": "不对，Material 3 的动态取色我不想要，太花哨了。"
          },
          "assistant": {
            "content": "明白，动态取色确实会把品牌色冲淡，换个壁纸整个 App 的配色就变了，对聊天类应用来说辨识度反而变差。\n\n那走固定配色就行：\n\n- **不用 `dynamicColorScheme`**，直接定义一个固定的 `ColorScheme`（light/dark 各一套），`Theme.kt` 里把动态取色的分支去掉，只留 `lightColorScheme(...)` / `darkColorScheme(...)`\n- 关键角色建议按用途定死：`primary` 做发送按钮和选中态，`secondaryContainer` 给「自己发的消息气泡」，`surfaceContainer` 给「对方消息气泡」和输入框，`surface` 保持背景\n- 气泡色别直接用 `primary`，饱和度太高，大面积看久了累，用 `secondaryContainer` / `tertiaryContainer` 这类容器角色更合适，文字用对应的 `onXxxContainer`\n- 想省事的话用 Material Theme Builder 导出一份固定主题，把 `Color.kt` / `Theme.kt` 里的生成代码直接替换掉，比手调 `ColorScheme` 省心\n\n要不要我直接给你一份去掉动态取色后的 `Theme.kt` 写法？或者你先说说主色想走什么调子（深蓝、绿色、中性灰），我再给具体的色值建议。",
            "reasoning": "User pushed back. Record disagreement.回复：不用动态取色，固定主题色方案。给出建议。",
            "usage": {
              "input": 959,
              "output": 304,
              "cacheRead": 0,
              "cacheWrite": 0,
              "cacheSource": "api"
            },
            "model": "deepseek-ai/DeepSeek-V4.1-Flash",
            "durationMs": 7899,
            "reasoningLevel": "high",
            "reasoningSupported": true,
            "interrupted": false,
            "toolCalls": [
              {
                "id": "01a190f3c378834cc9e29d80879dfb7e",
                "name": "write_memory",
                "arguments": "{\"entries\": [\"用户不喜欢 Material 3 的动态取色（Material You）效果，觉得太花哨，明确不要用。\"]}",
                "result": "已记住 1 条。"
              }
            ]
          }
        }
      ],
      "active": 0,
      "createdAt": 1793433240353
    },
    {
      "id": "multi-turn-2",
      "sessionId": "demo",
      "idx": 2,
      "variants": [
        {
          "user": {
            "content": "我之前跟你说过我在做什么项目？"
          },
          "assistant": {
            "content": "你在做一个安卓聊天客户端，主界面用的是 Material 3。另外你明确说过 Material 3 的动态取色（Material You）不要用，觉得太花哨。\n\n目前聊到的是主题和配色这一块。需要我接着讲固定配色方案，还是先看你现在的 `Theme.kt`？",
            "reasoning": "The user asks: \"我之前跟你说过我在做什么项目？\" — I should recall. Memory says: developing Android chat client with Material 3, dislikes dynamic color. I can answer, but guidance says not to say \"我记得你说过\" for profile. However here user explicitly asks whether I know — so it's fine to state. Also could use search_chats but no such tool available here (only write_memory). So answer from memory.\n\nDo I need to write memory? This is a question about recall, not a new fact. No write needed. Maybe nothing new.\n\nThe instruction says don't restate profile as \"我记得你说过\" — but user directly asks, so answering is appropriate.",
            "usage": {
              "input": 1292,
              "output": 209,
              "cacheRead": 0,
              "cacheWrite": 0,
              "cacheSource": "api"
            },
            "model": "deepseek-ai/DeepSeek-V4.1-Flash",
            "durationMs": 4875,
            "reasoningLevel": "high",
            "reasoningSupported": true,
            "interrupted": false
          }
        }
      ],
      "active": 0,
      "createdAt": 1793433249327
    },
    {
      "id": "multi-turn-3",
      "sessionId": "demo",
      "idx": 3,
      "variants": [
        {
          "user": {
            "content": "对，就是这个，你理解得对。"
          },
          "assistant": {
            "content": "好，那就接着来。\n\n你现在的 `Theme.kt` 大概是这个结构（AS 新建 Compose 项目默认带动态取色）：\n\n```kotlin\n@Composable\nfun ChatTheme(\n    darkTheme: Boolean = isSystemInDarkTheme(),\n    dynamicColor: Boolean = true,   // ← 这行删掉或恒为 false\n    content: @Composable () -> Unit\n) {\n    val colorScheme = when {\n        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {\n            val context = LocalContext.current\n            if (darkTheme) dynamicDarkColorScheme(context)\n            else dynamicLightColorScheme(context)\n        }\n        darkTheme -> DarkColorScheme\n        else -> LightColorScheme\n    }\n    MaterialTheme(colorScheme = colorScheme, content = content)\n}\n```\n\n改成固定配色，最省事的做法：\n\n```kotlin\nprivate val LightColorScheme = lightColorScheme(\n    primary = Color(0xFF2E5AAC),              // 发送按钮、选中态\n    onPrimary = Color(0xFFFFFFFF),\n    secondaryContainer = Color(0xFFD7E2FF),   // 自己发的气泡\n    onSecondaryContainer = Color(0xFF001A41),\n    surfaceContainer = Color(0xFFF0F2F7),     // 对方气泡 / 输入框\n    onSurface = Color(0xFF1A1C1E),\n    surface = Color(0xFFFFFFFF),              // 背景\n    outlineVariant = Color(0xFFDDE1E8),       // 分割线\n)\n\nprivate val DarkColorScheme = darkColorScheme(\n    primary = Color(0xFFAEC6FF),\n    onPrimary = Color(0xFF00306B),\n    secondaryContainer = Color(0xFF3D5C96),\n    onSecondaryContainer = Color(0xFFD7E2FF),\n    surfaceContainer = Color(0xFF1F2125),\n    onSurface = Color(0xFFE3E2E6),\n    surface = Color(0xFF121316),\n    outlineVariant = Color(0xFF44474D),\n)\n\n@Composable\nfun ChatTheme(\n    darkTheme: Boolean = isSystemInDarkTheme(),\n    content: @Composable () -> Unit\n) {\n    MaterialTheme(\n        colorScheme = if (darkTheme",
            "reasoning": "User confirms. Memory: he approves this kind of answer — recalling project facts + preferences concisely. Already recorded both facts. Maybe record that he appreciates concise recall? That's a bit speculative. The guidance says record what answer style he approves. One entry: 用户认可\"直接复述已知项目信息和偏好、不重复啰嗦\"的回答方式. Slightly speculative but reasonable. I'll write one entry.\n\nThen answer briefly, continue.",
            "usage": {
              "input": 1448,
              "output": 501,
              "cacheRead": 0,
              "cacheWrite": 0,
              "cacheSource": "api"
            },
            "model": "deepseek-ai/DeepSeek-V4.1-Flash",
            "durationMs": 9307,
            "reasoningLevel": "high",
            "reasoningSupported": true,
            "interrupted": false,
            "toolCalls": [
              {
                "id": "01a190f3e1986a16c3847fa9e23c9e63",
                "name": "write_memory",
                "arguments": "{\"entries\": [\"用户认可直接、简洁地复述已知项目信息和偏好的回答方式，不需要多余的铺垫。\"]}",
                "result": "已记住 1 条。"
              }
            ]
          }
        }
      ],
      "active": 0,
      "createdAt": 1793433255248
    }
  ]

  const realTurns: ChatTurn[] = [
    {
      "id": "real-turn-1",
      "sessionId": "demo",
      "idx": 0,
      "variants": [
        {
          "user": {
            "content": "我在做一个安卓聊天客户端，气泡圆角一直纠结。我现在用 20px，你觉得合适吗？"
          },
          "assistant": {
            "content": "先说一个容易被忽略的点：安卓里写的 `20px` 和设计稿里的 `20` 大概率不是一回事。dp 会随屏幕密度缩放，px 不会，所以同一份布局在 2x、3x 屏上看起来圆角会差一倍。先确认一下你代码里用的是 `px` 字面量，还是 `dp`/`sp`；如果是前者，建议先换算过去，比如 `20dp`，再谈数值合不合适。\n\n如果已经是 dp，20dp 这个量级偏“圆润但不夸张”，在 56–72dp 高的单行气泡上属于常见范围，不算错。但真正决定观感好坏的不是这个数字单独取值，而是三件事：\n\n1. **气泡高度**。圆角半径超过高度一半，外观就变成了胶囊形。比如高度 40dp 的气泡配 20dp 圆角，正好是胶囊；高度 64dp 配 20dp 只是“圆角矩形”。你想要的是哪一种，先定下来。\n2. **一致性**。要么所有短气泡都是胶囊，要么都是圆角矩形。最难看的情况是长短消息圆角半径一样，但短消息因为高度小变成了胶囊、长消息还是圆角矩形，放在一起很别扭。\n3. **“尾巴”那一角**。很多聊天客户端把靠近头像的那个角做小（比如 4–8dp），其余三角大，视觉上就指向发送者。要么这样处理，要么干脆完全对称，两边都走圆角。\n\n比较稳妥的做法：定一个基准值（比如 18–20dp），再定一个“小角”值（4–8dp），然后让气泡高度至少是圆角的两倍以上，避免无意中变胶囊。\n\n如果你把气泡的实际高度和有没有用小角说一下，我可以直接帮你算一组具体数值。",
            "reasoning": "用户问气泡圆角20px是否合适。这是技术咨询。是否要记忆？用户在做一个安卓聊天客户端——透露长期项目，可以记一条。这不是吐槽或追问，但透露身份/长期目标，属于需要记的。\n\n先记，然后回答。\n\n技术回答：20px 在安卓上要注意单位。px vs dp。安卓一般用 dp，20dp 圆角对气泡来说偏大（很多气泡是 8-18dp）。如果用 px，在 xxhdpi 上 20px ≈ 6.7dp，很小。所以关键问题：你是 px 还是 dp？\n\n另外圆角设计要考虑：气泡最大圆角一般不超过高度一半，否则变成胶囊。消息一行的气泡高度约 40-48dp，圆角半径超过 24dp 就会看起来像胶囊。\n\n还有连续消息的圆角处理（同一发送者连续消息，相邻角变小），以及气泡高度。\n\n应该给出建议：先确认单位，用 dp；推荐 12-16dp 一般文本气泡；短消息（如\"好\"/\"OK\"）用胶囊形状时取高度一半。\n\n还要提醒：px 的问题在于不同密度屏幕显示不一致，20px 在 mdpi 上 20dp，在 xxxhdpi 上只有 5dp，几乎看不出圆角。\n\n回答要简洁，不要太长。给出判断而不是罗列所有选项。\n\n用户在纠结，说明可能没意识到单位问题。我先问清单位，同时给两种情况的答案。\n\n格式：简短，不用一堆标题。可以用少量要点。",
            "usage": {
              "input": 896,
              "output": 392,
              "cacheRead": 0,
              "cacheWrite": 0,
              "cacheSource": "api"
            },
            "model": "deepseek-ai/DeepSeek-V4.1-Flash",
            "durationMs": 17757,
            "reasoningLevel": "high",
            "reasoningSupported": true,
            "interrupted": false,
            "toolCalls": [
              {
                "id": "01a190ef654379ff4f23320a3f9dfc39",
                "name": "write_memory",
                "arguments": "{\"entries\": [\"用户在做安卓聊天客户端，正在打磨消息气泡的视觉细节（圆角半径）。\"]}",
                "result": "已记住 1 条。"
              }
            ]
          }
        }
      ],
      "active": 0,
      "createdAt": 1793432947146
    }
  ]

  // 四轮正常长度的对话，用来把上下文横条填到一半左右
  const ctxTurns: ChatTurn[] = [
    turn(0, '我想开始写周记，但每次写到一半就停了，有什么办法', {
      content: `停在一半，通常不是毅力问题，是「一次要写完整」这个预期太重。

三个办法，按见效快慢排：

**先写一句就交差。** 给周记定一个最低标准——只写「这周最想记住的一件事」，一句话也算完成。完成率上来了，再谈质量。

**别从周一写起。** 按时间顺序写会变成流水账，写着写着就烦了。改成按主题写：「这周想通的一件事」「这周搞砸的一件事」。

**固定一个触发点。** 不是固定时间，是固定场景——比如周日晚上洗完澡、坐到书桌前。场景比时间更容易形成条件反射。`,
      model: 'deepseek-chat',
      usage: { input: 38, output: 268, cacheRead: 0 },
    }),
    turn(1, '那周记一般写多长比较合适', {
      content: `看你写它的目的，差别很大：

**给自己看**：300–500 字足够。重点是「当时怎么想的」，不是「发生了什么」——事情本身你以后还记得，想法会忘。

**给未来的自己看**：可以更短，一两百字，但要写清楚背景。三年后的你已经不记得那天为什么烦躁。

**给别人看**（比如团队周报）：反而是结构比字数重要，三段式——做完了什么、卡在哪、下周要什么。

一个反直觉的建议：**先别管长度，先管连续性。** 连续写八周、每周 200 字，比断断续续写三篇 2000 字的收获大得多。`,
      model: 'deepseek-chat',
      usage: { input: 42, output: 312, cacheRead: 0 },
    }),
    turn(2, '怎么才能坚持下来，我试过好几次都断了', {
      content: `断掉通常发生在「某一周没什么可写」的时候，然后一周变两周，就再也不写了。

对付这个，有两件事比决心有用：

**允许写「这周没什么特别的」。** 这句话本身就是记录。很多人卡住是因为觉得没内容就不配写，于是干脆不写。

**别补写。** 断了就断了，不要回头补上周的。补写会把周记变成作业，作业一定会被拖延。

还有个技巧：把周记和另一件你已经在做的事绑在一起——比如每周日整理相册时顺手写两句。依附在已有的习惯上，比新建一个习惯容易得多。`,
      model: 'deepseek-chat',
      usage: { input: 36, output: 296, cacheRead: 0 },
    }),
    turn(3, '有没有必要固定在每周同一天写', {
      content: `有必要，但「固定」的重点不是哪天，是**可预期**。

固定日子的好处是它会变成一个小仪式：到了那天，脑子会自动开始回顾这一周。这种自动启动比靠意志力省力得多。

不过有两个例外值得注意：

- **别选周一。** 周一本来就有工作压力，周记很容易被挤掉。周日晚上或周六上午更稳。
- **允许 ±1 天。** 定得太死，一旦错过就整周放弃。留一个缓冲，反而更容易长期坚持。

如果实在固定不下来，退一步的做法是：每周设一个提醒，看到提醒时决定「现在写」还是「明天写」——有决定权，比有截止日期更容易持续。`,
      model: 'deepseek-chat',
      usage: { input: 34, output: 328, cacheRead: 0 },
    }),
  ]

  // 流式用例要指向具体轮次，所以先生成再引用
  const streamingTurn = turn(0, '用一句话解释量子纠缠', {
  reasoning:
    '要求是一句话，所以不能展开定义。抓核心：两个粒子共享一个整体状态，测量其中一个会立刻确定另一个。\n要避免「超光速传递信息」的误读，最好带一句。',
  content: '两个粒子可以共享同一个整体状态，无论相隔多远，测量其中一个会立刻确定另一个的结果——',
  model: 'deepseek-chat',
})

  const demos: Record<string, DemoSpec> = {
  plain: {
    turns: [
      turn(0, '帮我想三个适合深夜电台的栏目名', {
        content: `三个方向，风格各不相同：

1. **《夜航》**——偏安静，适合读信和慢节奏的音乐，名字里有「航行」的暗示，听众会觉得是在一起走一段路。
2. **《零点之后》**——更都市，适合聊城市里的人和事，时间点本身就是标签。
3. **《未眠人》**——把听众直接写进名字里，互动感最强，适合做来电环节。

如果只选一个，我倾向《夜航》：它不限定内容，栏目做久了也不用改名。`,
        model: 'deepseek-chat',
        usage: { input: 186, output: 268, cacheRead: 0 },
      }),
    ],
  },

  thinking: {
    turns: [
      turn(0, '9.11 和 9.9 哪个大？为什么很多人会答错', {
        reasoning: longReasoning,
        content: `**9.9 更大。**

原因是很多人把小数点后面当成整数在比：看到「11」比「9」长，就下意识觉得 9.11 更大。但小数比的是位值——十分位上是 1 对 9，9.11 在第一位就输了。

一个不容易错的看法：把它们都乘 100，变成 911 和 990，谁大一眼就清楚。`,
        model: 'deepseek-chat',
        usage: { input: 92, output: 214, cacheRead: 0 },
      }),
    ],
  },

  streaming: {
    turns: [streamingTurn],
    streamingTurnId: streamingTurn.id,
  },

  search: {
    toolStatus: '正在搜索…',
    turns: [
      turn(0, 'DeepSeek V4.1 Flash 是什么时候发布的？上下文有多长', {
        content: `据官方公告，**DeepSeek-V4.1-Flash 于 2026 年 10 月 17 日发布**，同一篇公告里还开放了 Search 与 Fetch 两个独立接口。

上下文方面，官方模型列表给出的窗口是 **1,048,576 tokens**，最大输出 393,216 tokens，输入支持文本与图片。

需要注意的是，第三方基准汇总里的数字和官方口径不完全一致，引用时建议以官方文档为准。`,
        model: 'deepseek-chat',
        toolCalls: [searchCall()],
        sources,
        usage: { input: 4820, output: 336, cacheRead: 3072 },
      }),
    ],
  },

  image: {
    turns: [
      turn(
        0,
        '这张图的配色适合做深色主题的强调色吗',
        {
          content: `可以用，但要压暗一档。

这张图是蓝紫渐变，饱和度偏高。直接铺在深色背景上，大面积使用会显得刺眼，而且和深灰底色对比过强。

建议：取中间那个蓝紫作为强调色，但把明度降 15% 左右，只用在按钮和链接上；渐变本身留给头像、封面这类小块区域。`,
          model: 'deepseek-chat',
          usage: { input: 1120, output: 186, cacheRead: 0 },
        },
        [
          {
            id: uid('att'),
            kind: 'image',
            name: 'cover-gradient.svg',
            mime: 'image/svg+xml',
            size: 2_480,
            dataUrl: svgImage('cover', '#6366f1', '#a855f7'),
          },
        ]
      ),
    ],
  },

  file: {
    turns: [
      turn(
        0,
        '按这份配置帮我看看有没有问题',
        {
          content: `看下来有两处值得改：

**1. 温度设成了 0.9，但你又要求「输出稳定」。** 这两件事是冲突的，要稳定就压到 0.3 以下。

**2. 最大输出只给了 512。** 你的提示词里要求「分点详述」，512 很容易在中途被截断，建议至少 2048。

其余参数没问题。`,
          model: 'deepseek-chat',
          usage: { input: 640, output: 158, cacheRead: 0, estimated: true },
        },
        [
          {
            id: uid('att'),
            kind: 'text',
            name: 'config.yaml',
            mime: 'application/x-yaml',
            size: 18_420,
            text: 'model: deepseek-chat\ntemperature: 0.9\nmax_tokens: 512\n',
            truncated: true,
          },
        ]
      ),
    ],
  },

  markdown: {
    turns: [
      turn(0, '给我一份 markdown 渲染自检清单', {
        content: `## 标题层级

### 三级标题

正文里混排**粗体**、*斜体*、\`行内代码\` 和一个[链接](https://example.com)。

- 无序列表第一项
- 第二项，带一点更长的文字用来观察换行后的缩进是否对齐
  - 嵌套一层
- 第三项

1. 有序列表
2. 第二项

| 元素 | 检查点 | 常见问题 |
| --- | --- | --- |
| 代码块 | 横向滚动 | 长行把容器撑破 |
| 表格 | 窄屏换行 | 列宽被挤压 |
| 引用 | 左边框 | 与正文间距过大 |

\`\`\`ts
// 代码块：重点看横向滚动条和等宽字体
export function composeSystemPrompt(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join('\\n\\n')
}
\`\`\`

> 引用块：用来验证左边框和文字颜色的对比度。

最后一段普通文字，确认段落间距一致。`,
        model: 'deepseek-chat',
        usage: { input: 48, output: 512, cacheRead: 0 },
      }),
    ],
  },

  error: {
    turns: [
      turn(0, '把刚才那段再展开讲讲', {
        content: '（请求失败：401 无效的 API Key，请到设置里检查）',
        model: 'deepseek-chat',
        interrupted: true,
      }),
    ],
  },

  variants: {
    turns: [
      {
        id: uid('turn'),
        sessionId: 'demo',
        idx: 0,
        active: 1,
        createdAt: Date.now(),
        variants: [
          {
            user: { content: '解释一下什么是「上下文窗口」' },
            assistant: {
              content:
                '上下文窗口就是模型一次能「看见」的 token 上限。超过这个长度的内容，模型看不到。',
              model: 'deepseek-chat',
              usage: { input: 42, output: 68, cacheRead: 0 },
            },
          },
          {
            user: { content: '解释一下什么是「上下文窗口」' },
            assistant: {
              content: `把模型想象成一个记性有限的人：他能同时记住的话就那么多，叫上下文窗口。

- **单位是 token**，不是字数。中文大致 1 个字 ≈ 1 token，英文一个词可能拆成几个。
- **窗口是「同时」**，不是「累计」。聊到第 50 轮时，最早那几轮会被挤出去。
- **输入和输出共享**这个额度，所以「最大输出」设得太大，留给对话的空间就少了。

所以长对话迟早要压缩或摘要——这不是实现缺陷，是窗口本身的限制。`,
              model: 'deepseek-chat',
              usage: { input: 42, output: 268, cacheRead: 0 },
            },
          },
        ],
      },
    ],
  },

    // 长对话：填充比例过半，用来观察横条的中间状态
    // 这四轮实测 881 token，1600 的窗口正好填到 55%
    context: {
      contextLimit: 1600,
      turns: ctxTurns,
    },

    // 同一段对话，窗口更小 → 触发 80% 以上的告警态
    contextFull: {
      contextLimit: 1000,
      turns: ctxTurns,
    },

    // 思考档位：芯片显示「思考 最高」
    reasoning: {
      config: { reasoningLevel: 'max' },
      turns: [
        turn(0, '这个方案有什么风险', {
          reasoning: '先分技术风险和产品风险。技术上是并发写入，产品上是用户预期。\n两边都要给可执行的缓解措施，别只列风险。',
          content: `主要风险有三处：

**1. 并发写入会互相覆盖。** 两个人同时改同一条记录时，后写的会赢。缓解办法是加版本号，冲突时提示用户手动合并。

**2. 首次导入会很慢。** 全量导入 3 万条时接口会超时，建议改成后台任务 + 进度轮询。

**3. 用户会以为删除是立即生效的。** 实际是软删除，回收站保留 30 天。这一点必须在确认框里写清楚。`,
          model: 'deepseek-chat',
          usage: { input: 320, output: 286, cacheRead: 0 },
        }),
      ],
    },

    // 蓝图用：多轮 + 中间有分支，能看出树的结构
    tree: {
      turns: [
        turn(0, '帮我定一下聊天界面的正文字号', {
          content: '16px。移动端正文低于 15px 长时间读会累，高于 17px 又显得松散。',
          model: 'deepseek-chat',
          usage: { input: 40, output: 60, cacheRead: 0 },
        }),
        turn(1, '16px 会不会太大，我想一屏多放几条', {
          content: '一屏放几条由行高和留白决定，不是字号。16px 配 1.6 的行高，比 15px 配 1.4 更容易读。',
          model: 'deepseek-chat',
          usage: { input: 52, output: 74, cacheRead: 0 },
        }),
        {
          id: uid('turn'),
          sessionId: 'demo',
          idx: 2,
          active: 1,
          createdAt: Date.now(),
          variants: [
            {
              user: { content: '那行高定多少' },
              assistant: {
                content: '1.5。再松就散，再紧就挤。',
                model: 'deepseek-chat',
                usage: { input: 30, output: 24, cacheRead: 0 },
              },
            },
            {
              user: { content: '那行高定多少' },
              assistant: {
                content:
                  '1.6。中文方块字比拉丁字母更需要行距，1.5 在长段落里会显得挤；1.7 以上又会让人觉得段落之间分不清。',
                model: 'deepseek-chat',
                usage: { input: 30, output: 96, cacheRead: 0 },
              },
            },
            {
              user: { content: '那行高定多少' },
              assistant: {
                content: '1.6，并且段间距要比行距大 1.5 倍，这样段落边界才清楚。',
                model: 'deepseek-chat',
                usage: { input: 30, output: 58, cacheRead: 0 },
              },
            },
          ],
        },
        turn(3, '气泡内边距呢', {
          content: '左右 16px、上下 10px。左右大于上下，是因为中文行首行尾需要留白。',
          model: 'deepseek-chat',
          usage: { input: 36, output: 70, cacheRead: 0 },
        }),
      ],
    },

    // 多处分叉：看蓝图的树形结构（两处 fork，其中一处三个版本）
    branched: {
      turns: [
        turn(0, '我在给聊天应用做消息列表，虚拟滚动值得上吗', {
          content: '看量级。几百条以内不值得，DOM 撑得住；上千条再上，否则首屏反而更慢。',
          model: 'deepseek-chat',
          usage: { input: 44, output: 66, cacheRead: 0 },
        }),
        turn(1, '那上千条的时候，渲染会不会卡在 markdown 解析上', {
          content: '会。解析比渲染更贵，通常先卡在解析。缓存解析结果，按消息 id 存，命中就不用重算。',
          model: 'deepseek-chat',
          usage: { input: 50, output: 82, cacheRead: 0 },
        }),
        {
          id: uid('turn'),
          sessionId: 'demo',
          idx: 2,
          active: 0,
          createdAt: Date.now(),
          variants: [
            {
              user: { content: '缓存放在哪一层比较合适' },
              assistant: {
                content: '内存 Map，key 用「消息 id + 版本号」。刷新就没了，但解析本来也不贵到需要持久化。',
                model: 'deepseek-chat',
                usage: { input: 36, output: 88, cacheRead: 0 },
              },
            },
            {
              user: { content: '缓存放在哪一层比较合适' },
              assistant: {
                content:
                  '两级：内存 Map 管当前会话，IndexedDB 存最近 200 条的解析结果。冷启动时先读缓存，边滚边补。',
                model: 'deepseek-chat',
                usage: { input: 36, output: 112, cacheRead: 0 },
              },
            },
            {
              user: { content: '缓存放在哪一层比较合适' },
              assistant: {
                content: '别缓存。改成流式时就增量解析，一段一段拼，比整条解析再缓存更省内存。',
                model: 'deepseek-chat',
                usage: { input: 36, output: 74, cacheRead: 0 },
              },
            },
          ],
        },
        turn(3, '增量解析遇到代码块怎么办，得等收尾才知道围栏闭合没', {
          content: '把未闭合的围栏当普通文本渲染，收尾时再替换成代码块。视觉上闪一下，但不会解析错。',
          model: 'deepseek-chat',
          usage: { input: 48, output: 96, cacheRead: 0 },
        }),
        {
          id: uid('turn'),
          sessionId: 'demo',
          idx: 4,
          active: 1,
          createdAt: Date.now(),
          variants: [
            {
              user: { content: '那表格呢，边收边渲染会不会一直抖' },
              assistant: {
                content: '会抖。表格整块解析，收尾前先占位，收完再一次性插入。',
                model: 'deepseek-chat',
                usage: { input: 34, output: 62, cacheRead: 0 },
              },
            },
            {
              user: { content: '那表格呢，边收边渲染会不会一直抖' },
              assistant: {
                content:
                  '会。列宽在每行到达时都会重算，整块高度跟着跳。做法是给表格一个最小高度占位，收完再放开，抖动会从「连续」变成「一次」。',
                model: 'deepseek-chat',
                usage: { input: 34, output: 104, cacheRead: 0 },
              },
            },
          ],
        },
        turn(5, '明白了，那先把虚拟滚动上了再说', {
          content: '可以。先把解析缓存做好，虚拟滚动才有意义——否则滚到哪都在重算，等于白滚。',
          model: 'deepseek-chat',
          usage: { input: 40, output: 78, cacheRead: 0 },
        }),
      ],
    },

    // 四轮真实对话：每轮独立的过程区
    multi: {
      config: { longMemory: true, packId: 'minimal', reasoningLevel: 'high' },
      turns: multiTurns,
    },

    // 真实调用记录：思考、工具调用、耗时都是真的
    real: {
      config: { longMemory: true, packId: 'minimal', reasoningLevel: 'high' },
      turns: realTurns,
    },

    // 长记忆：思考被隐藏，只留成品 + 状态标签 + 赞踩
    memory: {
      config: { longMemory: true, packId: 'minimal', reasoningLevel: 'high' },
      turns: [
        turn(0, '我最近在做一个聊天客户端，总在纠结气泡圆角用多大', {
          reasoning: '用户在讲自己的项目，这是值得长期记住的信息。\n圆角大小是具体偏好，也可以记。\n回答要给一个具体数字，别说「看情况」。',
          content: `18px 左右，配 6px 的直角切角。

再大的话小屏上会显得没骨气，再小又像系统弹窗。DeepSeek 和微信都在这个区间。

如果你要做旧机型适配，可以按宽度缩：360dp 用 16px，412dp 用 18px，差 2px 在真机上能看出来。`,
          model: 'deepseek-chat',
          usage: { input: 860, output: 168, cacheRead: 512 },
        }),
        turn(1, '对，我也是这么想的，但我用的是 20px', {
          reasoning: '用户给了具体数值，说明他已有判断。不要纠正，先确认，再补充什么时候 20 也合理。',
          // 工具调用折叠在过程区里，正文只留成品
          toolCalls: [
            {
              id: 'call-mem-1',
              name: 'write_memory',
              arguments: JSON.stringify({ entries: ['气泡圆角习惯用 20px，比常见推荐值更圆'] }),
              result: '已记住 1 条。',
            },
          ],
          content: `20px 也没问题，前提是气泡里的行距要跟着松一点。

圆角越大，文字离边缘的视觉距离越远。18px 配 1.6 的行高刚好，20px 的话建议把内边距从 16px 加到 18px，否则字会显得挤在中间。`,
          model: 'deepseek-chat',
          usage: { input: 1240, output: 132, cacheRead: 900 },
        }),
      ],
    },

    empty: { turns: [] },

    // 寄存区用例：卡片数据在 DEMO_SETTINGS 里，这里只需要一个空会话占位
    vault: { turns: [] },
  }

  // 补耗时：按正文长度估，长回答看起来更慢，比写死一堆数字自然
  for (const spec of Object.values(demos)) {
    for (const turn of spec.turns) {
      for (const variant of turn.variants) {
        const a = variant.assistant
        if (!a) continue
        if (a.durationMs === undefined) a.durationMs = 1200 + Math.round(a.content.length * 12)
        a.reasoningSupported ??= true
      }
    }
  }

  return demos
}

let demoCache: Record<string, DemoSpec> | null = null
const demos = () => (demoCache ??= buildDemos())

/** 取单个用例的原始数据；applyDemo 和自检脚本都用它 */
export const demoSpec = (id: string) => demos()[id]

/**
 * 寄存区演示数据。
 *
 * 元信息（规范、作者、版本、标签、开场段数）取自一张真实的 V2 卡，
 * 正文和开场白换成了中性示例——这是演示壳，不该把成人向内容渲染出来。
 * 三张卡分别对应：角色卡、世界书（正文为空、靠关键词当简介）、旧版导入的卡。
 */
const DEMO_SETTINGS: SettingDoc[] = [
  {
    id: 'demo-card-haena',
    kind: 'character',
    name: 'Haena',
    body: '{{char}} 是住在城郊的 gyaru，棕色皮肤，头发用发胶向后梳成利落的造型。她个子比同龄人高，走路带风，说话嗓门也大。\n\n性格：护短、直率，情绪都写在脸上。对熟人极有耐心，对陌生人先摆出不好惹的样子。\n\n情境：周末下午，两人坐在公园长椅上，天快黑了。',
    entries: [],
    firstMessage: '{{char}} 把手臂搭在 {{user}} 肩上，往四周看了一圈。\n\n{{char}}：「坐这边吧，人少。」',
    greetings: [
      '{{char}} 拎着两杯饮料走过来，把其中一杯塞进 {{user}} 手里。\n\n{{char}}：「加了冰，你喝慢点。」',
      '{{char}} 靠在栏杆上，用下巴点了点远处的灯。\n\n{{char}}：「那边今晚有夜市，去不去？」',
      '{{char}} 把外套脱下来扔给 {{user}}，自己只穿一件短袖。\n\n{{char}}：「别逞强，穿上。」',
    ],
    tags: ['Female', 'Romance', 'gyaru', 'brown', 'Malepov', 'Size Difference'],
    creator: 'DcKaizen',
    version: 'main',
    spec: 'chara_card_v2',
    creatorNotes: '[UPDATED] 增加了更多开场白。（演示用文案，原文已隐去）',
    createdAt: 0,
    updatedAt: 3,
  },
  {
    id: 'demo-world-fogport',
    kind: 'world',
    name: '雾港世界书',
    body: '',
    entries: [
      { id: 'demo-e1', keys: ['灯塔', '守夜'], content: '灯塔每晚八点点亮，守夜人要在钟楼记一笔。', enabled: true, constant: true },
      { id: 'demo-e2', keys: ['渡船'], content: '渡船一天两班，最后一班在雾起来之前。', enabled: true, constant: true },
      { id: 'demo-e3', keys: ['雾潮', '潮汐'], content: '雾潮每月十五涨到石阶第三级，那天不出海。', enabled: true },
      { id: 'demo-e4', keys: ['教会', '祷词'], content: '教会只在新月和满月开钟，祷词用古语。', enabled: true },
      { id: 'demo-e5', keys: ['旧钟楼'], content: '钟楼的钟停在三点十七分，没人去修。', enabled: true },
    ],
    createdAt: 0,
    updatedAt: 2,
  },
  {
    id: 'demo-card-old',
    kind: 'character',
    name: '旧版导入的卡',
    body: '这张卡是从旧版本导入的，没有作者、标签和规范字段。寄存区仍然能从正文算出简介。',
    entries: [],
    firstMessage: '「你来了。」',
    createdAt: 0,
    updatedAt: 1,
  },
]

export const DEMO_CASES: DemoCase[] = [
  { id: 'plain', label: '普通对话', hint: '最短路径：一问一答' },
  { id: 'thinking', label: '思考过程', hint: '折叠的推理块 + 正文' },
  { id: 'streaming', label: '生成中', hint: '流式状态：停止按钮、光标、半截回答' },
  { id: 'search', label: '联网搜索', hint: '工具调用记录 + 来源列表' },
  { id: 'image', label: '图片附件', hint: '多模态缩略图' },
  { id: 'file', label: '文本附件', hint: '截断标记 + 用量估算' },
  { id: 'markdown', label: '长内容', hint: '标题/列表/表格/代码块/引用' },
  { id: 'error', label: '出错', hint: '中断态的错误文案' },
  { id: 'variants', label: '多版本', hint: '版本切换器 + 两份不同回答' },
  { id: 'context', label: '上下文过半', hint: '模拟 1.6K 窗口，横条约 55%' },
  { id: 'contextFull', label: '上下文吃紧', hint: '模拟 1K 窗口，约 88% 触发告警条与「压缩并开新对话」' },
  { id: 'reasoning', label: '思考档位', hint: '芯片显示「思考 最高」，展开可选低/高/最高/关' },
  { id: 'tree', label: '分支对话', hint: '四轮，中间一轮有三个版本——用来看分支图' },
  { id: 'branched', label: '多处分叉', hint: '六轮，两处 fork（3 版 + 2 版），分支图里能看出树形' },
  { id: 'multi', label: '四轮真实', hint: '身份/反驳/回忆/认可各一次，看记忆怎么累积' },
  { id: 'real', label: '真实记录', hint: '一次真实调用：真思考、真工具调用、真耗时' },
  { id: 'memory', label: '长记忆', hint: '思考折叠在过程区，正文只留成品 + 赞踩' },
  { id: 'empty', label: '空白起始页', hint: '没有对话时的模式选择' },
  { id: 'vault', label: '寄存区', hint: '列表简介 + 详情元信息；元信息取自真实 V2 卡，正文已换成中性示例' },
]


/**
 * 进演示前的原始配置快照。
 * 演示会临时改 model / baseUrl / contextLimit，而这些字段在用户点芯片时
 * 会经 saveConfig 落盘——不备份就会把演示值写进真实配置。
 */
let originalConfig: ChatConfig | null = null

/** 退出演示：把快照写回，再刷新就是真实数据 */
export function restoreDemo(): void {
  useApp.setState({
    memoryPreview: null,
    settingsPreview: null,
    drawerOpen: false,
    drawerTab: 'chats',
  })
  if (!originalConfig) return
  useApp.getState().saveConfig(originalConfig)
  originalConfig = null
}

/** 把演示数据塞进 store（只改内存，不落库） */
export function applyDemo(id: string): void {
  const spec = demoSpec(id)
  if (!spec) return

  const config = useApp.getState().config
  originalConfig ??= config

  // 演示也造一个会话，否则顶栏只能显示「新对话」，看不出标题效果
  const firstUser = spec.turns[0] ? activeVariant(spec.turns[0]).user.content.trim() : ''
  const demoSession = {
    id: 'demo',
    title: spec.title ?? (firstUser.slice(0, 20) + (firstUser.length > 20 ? '…' : '') || '演示对话'),
    updatedAt: 0,
    packId: spec.config?.packId ?? 'minimal',
  }

  useApp.setState({
    currentId: 'demo',
    sessions: [demoSession],
    // 注入假模型：没有它，思考芯片和上下文横条都不会出现
    models: [DEMO_MODEL],
    config: {
      ...config,
      model: DEMO_MODEL.id,
      baseUrl: DEMO_BASE_URL,
      protocol: 'auto',
      contextLimit: spec.contextLimit ?? 8000,
      ...spec.config,
    },
    turns: spec.turns,
    editingTurnId: null,
    // 只有「长记忆」用例才摆示例记忆，其余用例保持空
    memoryPreview: id === 'memory' ? SAMPLE_MEMORY : null,
    // 寄存区用例：直接把抽屉打开并落在「寄存区」这一栏
    settingsPreview: id === 'vault' ? DEMO_SETTINGS : null,
    streamingTurnId: spec.streamingTurnId ?? null,
    toolStatus: spec.toolStatus ?? null,
    error: null,
    drawerOpen: id === 'vault',
    drawerTab: id === 'vault' ? 'chars' : 'chats',
    settingsOpen: false,
    draft: '',
    pendingSettingIds: [],
  })
}
