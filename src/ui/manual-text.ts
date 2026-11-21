/**
 * 使用说明书文案：面向用户，按节组织，每节一小块 markdown。
 * 目录由 MANUAL_SECTIONS 自动生成，增删节不用改 AboutSheet。
 * 写法遵循 docs/ui-copy.md 第二节：克制、短句、列表项不加句末标点。
 */
export interface ManualSection {
  /** 锚点 id，目录跳转用 */
  id: string
  title: string
  /** 节正文（markdown，不含标题本身） */
  md: string
}

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: 'start',
    title: '快速开始',
    md: `1. 设置页填 API 地址和 Key（内置 13 家服务商预设，选中即带出地址）
2. 开始页选模式，可勾角色卡或世界书
3. 发第一句话，开聊`,
  },
  {
    id: 'modes',
    title: '三种模式',
    md: `- 极简：纯聊天；长记忆只在这里生效
- 写作：推进文本；设定发展（实验）在这里用
- 酒馆：角色对话；挂角色卡和世界书`,
  },
  {
    id: 'cards',
    title: '角色卡与世界书',
    md: `- 导入：SillyTavern 的 PNG / JSON / CHARX / 压缩包直接选，V2 / V3 都支持
- 世界书按关键词触发，常驻条目每轮注入
- 导出：PNG（可拖回 SillyTavern）、CHARX、JSON；文件夹可打包成组合包`,
  },
  {
    id: 'vault',
    title: '寄存区',
    md: `- 抽屉（左上角）→ 寄存区：角色卡、世界书、提示词、设定，用文件夹归整
- 编辑器有「整篇文本」和「结构」两种模式；长设定可交给 AI 整理成「正文 + 关键词条目」`,
  },
  {
    id: 'models',
    title: '模型与服务商',
    md: `- 设置页选服务商、填 Key；协议自动识别，认不出再手动指定 OpenAI / Anthropic / Gemini
- 「获取模型列表」拉模型清单，拉不到的按提示手填
- 温度、最大输出、上下文上限按需调；思考档位由各家方言决定，不支持的档位不会出现`,
  },
  {
    id: 'search',
    title: '联网搜索',
    md: `- 输入框上的「联网」开关：
- 模型内：服务商自带搜索，免配置（推荐）
- 本地源：DeepSeek 搜索（约 ¥0.005 一次）或自定义接口
- 都没配时兜底走 Bing`,
  },
  {
    id: 'attachments',
    title: '附件',
    md: `- 图片、PDF、Word / Excel / PPT、压缩包、txt / md 等文本都能带
- 「辅助识图」把图片先转成文字描述再发给主模型
- 历史图片默认只带最近 2 轮，设置里可调`,
  },
  {
    id: 'memory',
    title: '记忆（实验）',
    md: `- 只在极简模式：AI 自动记下关于你的事，回答时只给成品
- 画像在设置页查看、整理、清空；预算默认 6000 token`,
  },
  {
    id: 'evolution',
    title: '设定发展（实验）',
    md: `- 只在写作模式：AI 把设定复制成发展稿，边写边补，原卡不动
- 开启后不能回溯旧版本；导出和开新对话不受影响`,
  },
  {
    id: 'sessions',
    title: '会话管理',
    md: `- 抽屉：会话列表、全文搜索、导出整会话为 md
- 分支图（右上角）：每轮多版本按树查看、切换、导出单链
- 上下文过半会预警，也可随时点「压缩」手动触发；更早内容压成摘要接着写`,
  },
  {
    id: 'appearance',
    title: '外观',
    md: `- 17 套预设色组（每套含深浅）+ 自定义取色
- 消息样式：气泡 / 平铺；圆角风格：圆角 / 直角`,
  },
  {
    id: 'privacy',
    title: '数据与隐私',
    md: `- 所有数据只存本机：网页版在 localStorage，安卓版在本地数据库
- API Key 不上传，请求直连你填写的接口
- 卸载应用即全部清除；重要内容请自行导出备份`,
  },
]
