/**
 * 生成一批示例文件，用来在手机上测导入：
 *   PNG 角色卡 / CHARX / JSON 卡 / 世界书 / 预设 / 自由设定 / 提示词 / 文件夹组合包 / 混合包
 * 用法：npm run samples
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { buildBundle, collectBundleItems } from '@/chat/bundle-export'
import { cardToV2 } from '@/chat/card-json'
import { buildCharx } from '@/chat/charx-export'
import { buildPngCard } from '@/chat/png-export'
import type { SettingDoc } from '@/chat/settings'
import { encodePng } from './lib/png-writer'

const OUT = process.env.SAMPLES_DIR ?? 'D:/chat-lite-samples'
mkdirSync(OUT, { recursive: true })

/* ---------------- 头像：渐变 + 柔光，纯数学生成 ---------------- */
function avatar(top: [number, number, number], bottom: [number, number, number], glow: [number, number, number]) {
  const size = 512
  return encodePng(size, size, (x, y) => {
    const t = y / size
    const cx = size / 2
    const cy = size * 0.42
    const d = Math.hypot(x - cx, y - cy) / size
    const g = Math.max(0, 1 - d * 2.6)
    return {
      r: Math.round(top[0] * (1 - t) + bottom[0] * t + glow[0] * g * 0.5),
      g: Math.round(top[1] * (1 - t) + bottom[1] * t + glow[1] * g * 0.5),
      b: Math.round(top[2] * (1 - t) + bottom[2] * t + glow[2] * g * 0.5),
    }
  })
}

const toDataUrl = (bytes: Uint8Array, mime = 'image/png') =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

/* ---------------- 内容 ---------------- */

const linShen: SettingDoc = {
  id: 'sample-linshen',
  kind: 'character',
  name: '林深',
  body: [
    '设定：林深，29 岁，凌晨电台《夜航》的唯一主播。声音低而慢，播了六年。',
    '性格：温和、话少、偶尔毒舌。对听众极有耐心，对自己苛刻。',
    '情境：现在是凌晨两点，直播间里只有你一个听众在线。',
    '说话习惯：多用短句，几乎不用感叹号；不主动结束对话；会记得听众上次说过的事。',
  ].join('\n'),
  entries: [
    {
      id: 'e-lin-1',
      keys: ['夜航', '节目', '电台'],
      content: '《夜航》是林深主持的深夜电台节目，每周三因设备检修停播。',
      enabled: true,
    },
    {
      id: 'e-lin-2',
      keys: ['豆子', '猫'],
      content: '豆子是林深养的两岁狸花猫，节目里偶尔能听到它的叫声。',
      enabled: true,
    },
    {
      id: 'e-lin-3',
      keys: ['雨', '雨夜'],
      content: '每逢雨夜，林深会把麦克风挪到窗边，播十分钟雨声。',
      enabled: true,
    },
  ],
  firstMessage: '「喂，{{user}}，今晚想听什么？要是不说话，我可就自己点歌了。」',
  avatar: toDataUrl(avatar([38, 42, 92], [12, 14, 32], [120, 110, 220])),
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const tieJiang: SettingDoc = {
  id: 'sample-tiejiang',
  kind: 'character',
  name: '老铁',
  body: [
    '设定：老铁，镇东锻炉的老板，四十年只打过一把刀。手艺好，脾气冲。',
    '性格：直来直去，看不上花哨的活，但从不糊弄人。',
    '情境：午后店里没客，他在敲打一块还没成形的铁。',
    '说话习惯：短句，爱用行话，不说客气话。',
  ].join('\n'),
  entries: [
    {
      id: 'e-tie-1',
      keys: ['锻炉', '店'],
      content: '镇东锻炉三代人的铺子，火候靠老师傅的眼看，不靠仪器。',
      enabled: true,
    },
  ],
  firstMessage: '「要打点什么？先说尺寸，别急着付钱。」',
  avatar: toDataUrl(avatar([120, 74, 24], [32, 20, 12], [230, 160, 70])),
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

const worldEntries = [
  { keys: ['夜航', '节目', '电台'], content: '《夜航》是林深主持的深夜电台节目，每周三因设备检修停播。' },
  { keys: ['豆子', '猫'], content: '豆子是林深养的两岁狸花猫，节目里偶尔能听到它的叫声。' },
  { keys: ['雨', '雨夜'], content: '每逢雨夜，林深会把麦克风挪到窗边，播十分钟雨声。' },
  { keys: ['听众', '麦克风'], content: '《夜航》固定有七名听众，彼此不知道对方存在。' },
  { keys: ['停播', '周三'], content: '每周三凌晨一点到四点停播，设备检修。林深会在停播前播最后一句话。' },
]

/* ---------------- 写文件 ---------------- */

const write = (name: string, data: Uint8Array | string) => {
  const path = join(OUT, name)
  writeFileSync(path, typeof data === 'string' ? data : Buffer.from(data))
  console.log('  ' + name)
}

console.log('生成示例文件到 ' + OUT)

// 1. PNG 角色卡（tEXt 写回）
const pngLin = buildPngCard(linShen)
if (!pngLin) throw new Error('PNG 卡生成失败')
write('林深-电台主播.png', pngLin)
const pngTie = buildPngCard(tieJiang)
if (!pngTie) throw new Error('PNG 卡生成失败')
write('老铁-锻炉老板.png', pngTie)

// 2. CHARX
write('林深-电台主播.charx', buildCharx(linShen))

// 3. JSON 卡（V2）
write(
  '林深-电台主播.json',
  JSON.stringify(
    {
      ...cardToV2(linShen),
      data: {
        ...cardToV2(linShen).data,
        character_book: {
          entries: worldEntries.map((e, i) => ({
            keys: e.keys,
            key: e.keys,
            content: e.content,
            enabled: true,
            insertion_order: i,
          })),
        },
      },
    },
    null,
    2
  )
)

// 4. 世界书（ST 的 world info 格式）
const worldJson = {
  name: '夜航设定',
  entries: Object.fromEntries(
    worldEntries.map((e, i) => [
      String(i),
      {
        uid: i,
        keys: e.keys,
        key: e.keys,
        content: e.content,
        comment: '',
        constant: false,
        selective: true,
        order: i * 10,
        position: 0,
        disable: false,
        probability: 100,
        use_regex: false,
      },
    ])
  ),
}
write('夜航-世界书.json', JSON.stringify(worldJson, null, 2))

// 5. 预设
write(
  '严谨-预设.json',
  JSON.stringify({ spec: 'chatlite_preset', version: 1, name: '严谨', top_p: 0.9, max_tokens: 2048 }, null, 2)
)
write(
  '长文-预设.json',
  JSON.stringify({ spec: 'chatlite_preset', version: 1, name: '长文', max_tokens: 8192 }, null, 2)
)

// 6. 自由设定（写作区）
const cyberSetting: SettingDoc = {
  id: 'sample-cyber',
  kind: 'setting',
  name: '蒸汽朋克世界观',
  body: [
    '设定：近未来的蒸汽城市，蒸汽既是动力也是货币。',
    '氛围：潮湿的铁锈味，齿轮的咬合声，煤气灯在雨里发黄。',
    '规则：没有内燃机，只有锅炉与压力表；越高级的城市越依赖地下管网。',
    '写作要求：避免现代词汇，机械感要具体（压力、热量、磨损），不要凭空出现科技。',
  ].join('\n'),
  entries: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}
write(
  '蒸汽朋克-设定.json',
  JSON.stringify(
    {
      spec: 'chatlite_setting',
      version: 1,
      name: cyberSetting.name,
      body: cyberSetting.body,
      entries: [],
      firstMessage: '',
    },
    null,
    2
  )
)

// 7. 纯文本提示词（导入后会变成提示词 + 设定）
write(
  '冷峻文风.txt',
  [
    '你是中文写作助手。要求：',
    '1. 不使用形容词堆砌，尽量用动词和名词。',
    '2. 短句为主，长句只用来写景。',
    '3. 不解释你的写法，只给成品。',
  ].join('\n')
)

// 8. 文件夹组合包（有 manifest，按声明类型入库）
const folderItems = collectBundleItems(
  [
    { ...linShen, folderId: 'sample' },
    { ...tieJiang, folderId: 'sample' },
  ],
  [{ id: 'sample-preset', name: '长文', maxTokens: 8192, folderId: 'sample', createdAt: 0, updatedAt: 0 }]
)
write('夜航-组合包.chatlite.zip', buildBundle('夜航', folderItems))

// 9. 混合包（没有 manifest，逐文件按内容识别：PNG 卡 + 世界书）
write(
  '社区随手打包.zip',
  zipSync(
    {
      '林深.png': buildPngCard(linShen)!,
      '夜航世界观.json': strToU8(JSON.stringify(worldJson, null, 2)),
      '说明.txt': strToU8('这是一个社区常见的随手打包：一个 PNG 角色卡加一本世界书。\n'),
    },
    { level: 6 }
  )
)

console.log('\n完成')
