/**
 * 更新日志：随版本更新，新的加在最上面。
 * 一条 = { version, date, items }；items 是若干行 markdown，每行一条变动。
 */
export interface ChangelogEntry {
  version: string
  /** 发布日期，如 2026-11-21 */
  date: string
  items: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '2026.11.22.1',
    date: '2026-11-22',
    items: [
      '- 设置页小保存：开关与选择类点一下立即生效；文字修改有悬浮保存按钮，不再漏存',
      '- 长记忆主动记录：AI 会在对话中适时把你的目标、偏好、计划记进画像，不再只靠赞 / 踩',
      '- 新对话页：角色卡 / 世界书分组折叠，删除加了确认，不再一滑就误删',
      '- 设定发展模式：审查提醒从每 6 轮加密到每 3 轮，开场阶段的设定更容易被跟进；开关挪进起始页',
      '- 新增版本检查：关于页可查最新版本',
      '- 首个公开版本发布：产品页上线（ifno.fun/chat-lite），GitHub 仓库开放',
    ],
  },
]
