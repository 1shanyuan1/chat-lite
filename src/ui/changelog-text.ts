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

export const CHANGELOG: ChangelogEntry[] = []
