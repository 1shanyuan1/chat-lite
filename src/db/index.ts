import type { Usage } from '@/chat/tokens'

export type Role = 'user' | 'assistant'

export interface Session {
  id: string
  title: string
  updatedAt: number
  /** 会话级系统提示词（压缩接续时会把摘要写进这里） */
  systemPrompt?: string
  /** 绑定的提示词包，缺省时用全局设置 */
  packId?: string
  /** 绑定的角色卡（旧字段，仅用于迁移读取） */
  characterId?: string
  /** 挂载的设定文件，可多个 */
  settingIds?: string[]
  /** 绑定的生成预设（可选） */
  presetId?: string
}

export interface TurnUser {
  content: string
}

export interface TurnAssistant {
  content: string
  reasoning?: string
  model?: string
  usage?: Usage
  interrupted?: boolean
}

/** 一轮 = 一次提问 + 一次回答；variants 里存的是互相替代的版本 */
export interface TurnVariant {
  user: TurnUser
  assistant?: TurnAssistant
}

export interface ChatTurn {
  id: string
  sessionId: string
  idx: number
  variants: TurnVariant[]
  active: number
  createdAt: number
}

export interface SearchHit {
  sessionId: string
  sessionTitle: string
  turnId: string
  idx: number
  text: string
  /** 命中的是提问还是回答（与浏览定位一致） */
  field: 'user' | 'assistant'
}

export interface Repo {
  listSessions(): Promise<Session[]>
  createSession(
    title: string,
    systemPrompt?: string,
    packId?: string,
    settingIds?: string[],
    presetId?: string
  ): Promise<Session>
  renameSession(id: string, title: string): Promise<void>
  setSessionPack(id: string, packId: string): Promise<void>
  deleteSession(id: string): Promise<void>
  listTurns(sessionId: string): Promise<ChatTurn[]>
  appendTurn(turn: ChatTurn): Promise<void>
  updateTurn(turn: ChatTurn): Promise<void>
  deleteTurnsFrom(sessionId: string, fromIdx: number): Promise<void>
  search(query: string, limit?: number): Promise<SearchHit[]>
  clearAll(): Promise<void>
}

export const newId = (): string => crypto.randomUUID()

/** setting_ids 存成 JSON 文本，兼容空值 */
export function parseIds(raw: unknown): string[] {
  if (raw == null) return []
  try {
    const list = JSON.parse(String(raw)) as unknown
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

export const activeVariant = (turn: ChatTurn): TurnVariant => turn.variants[turn.active] ?? turn.variants[0]

/**
 * 只索引当前激活版本：搜索结果必须能在页面上定位到，
 * 否则用户会点进来找不到命中（旧版本仍保留在数据里，只是不参与检索）。
 */
export const turnTexts = (turn: ChatTurn): { user: string; assistant: string } => {
  const variant = activeVariant(turn)
  return { user: variant.user.content, assistant: variant.assistant?.content ?? '' }
}

export const turnSearchText = (turn: ChatTurn): string => {
  const { user, assistant } = turnTexts(turn)
  return `${user}\n${assistant}`
}

/* ---------------- Web / 预览：localStorage ---------------- */

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function createLocalRepo(): Repo {
  const SESSIONS = 'cl.sessions'
  const TURNS = 'cl.turns'

  const allTurns = () => readJson<ChatTurn[]>(TURNS, [])

  return {
    async listSessions() {
      return readJson<Session[]>(SESSIONS, []).sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async createSession(title, systemPrompt, packId, settingIds, presetId) {
      const session: Session = { id: newId(), title, updatedAt: Date.now(), systemPrompt, packId, settingIds, presetId }
      writeJson(SESSIONS, [session, ...readJson<Session[]>(SESSIONS, [])])
      return session
    },
    async setSessionPack(id, packId) {
      writeJson(
        SESSIONS,
        readJson<Session[]>(SESSIONS, []).map((s) => (s.id === id ? { ...s, packId } : s))
      )
    },
    async renameSession(id, title) {
      writeJson(
        SESSIONS,
        readJson<Session[]>(SESSIONS, []).map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s))
      )
    },
    async deleteSession(id) {
      writeJson(
        SESSIONS,
        readJson<Session[]>(SESSIONS, []).filter((s) => s.id !== id)
      )
      writeJson(
        TURNS,
        allTurns().filter((t) => t.sessionId !== id)
      )
    },
    async listTurns(sessionId) {
      return allTurns()
        .filter((t) => t.sessionId === sessionId)
        .sort((a, b) => a.idx - b.idx)
    },
    async appendTurn(turn) {
      writeJson(TURNS, [...allTurns(), turn])
    },
    async updateTurn(turn) {
      writeJson(
        TURNS,
        allTurns().map((t) => (t.id === turn.id ? turn : t))
      )
    },
    async deleteTurnsFrom(sessionId, fromIdx) {
      writeJson(
        TURNS,
        allTurns().filter((t) => !(t.sessionId === sessionId && t.idx >= fromIdx))
      )
    },
    async search(query, limit = 50) {
      const q = query.trim().toLowerCase()
      if (!q) return []
      const sessions = readJson<Session[]>(SESSIONS, [])
      const byId = new Map(sessions.map((s) => [s.id, s]))
      const hits: SearchHit[] = []
      for (const turn of allTurns()) {
        const texts = turnTexts(turn)
        for (const field of ['user', 'assistant'] as const) {
          const text = texts[field]
          if (!text || !text.toLowerCase().includes(q)) continue
          hits.push({
            sessionId: turn.sessionId,
            sessionTitle: byId.get(turn.sessionId)?.title ?? '未命名',
            turnId: turn.id,
            idx: turn.idx,
            text,
            field,
          })
          if (hits.length >= limit) return hits
        }
      }
      return hits
    },
    async clearAll() {
      writeJson(SESSIONS, [])
      writeJson(TURNS, [])
    },
  }
}

/* ---------------- 原生：SQLite ---------------- */

const DDL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  system_prompt TEXT,
  pack_id TEXT,
  character_id TEXT,
  setting_ids TEXT,
  preset_id TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  variants TEXT NOT NULL,
  active INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  user_text TEXT NOT NULL DEFAULT '',
  assistant_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns (session_id, idx);
`

export async function createSqliteRepo(): Promise<Repo> {
  const { CapacitorSQLite, SQLiteConnection } = await import('@capacitor-community/sqlite')
  const connection = new SQLiteConnection(CapacitorSQLite)
  const db = await connection.createConnection('chatlite2', false, 'no-encryption', 1, false)
  await db.open()
  await db.execute(DDL)
  // 老库补列（幂等）
  await db.execute("ALTER TABLE turns ADD COLUMN user_text TEXT NOT NULL DEFAULT ''").catch(() => undefined)
  await db.execute("ALTER TABLE turns ADD COLUMN assistant_text TEXT NOT NULL DEFAULT ''").catch(() => undefined)
  await db.execute('ALTER TABLE sessions ADD COLUMN pack_id TEXT').catch(() => undefined)
  await db.execute('ALTER TABLE sessions ADD COLUMN character_id TEXT').catch(() => undefined)
  await db.execute('ALTER TABLE sessions ADD COLUMN setting_ids TEXT').catch(() => undefined)
  await db.execute('ALTER TABLE sessions ADD COLUMN preset_id TEXT').catch(() => undefined)

  const rowToTurn = (row: Record<string, unknown>): ChatTurn => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    idx: Number(row.idx),
    variants: JSON.parse(String(row.variants)) as TurnVariant[],
    active: Number(row.active),
    createdAt: Number(row.created_at),
  })

  return {
    async listSessions() {
      const res = await db.query(
        'SELECT id, title, updated_at, system_prompt, pack_id, character_id, setting_ids, preset_id FROM sessions ORDER BY updated_at DESC'
      )
      return (res.values ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        title: String(row.title),
        updatedAt: Number(row.updated_at),
        systemPrompt: row.system_prompt == null ? undefined : String(row.system_prompt),
        packId: row.pack_id == null ? undefined : String(row.pack_id),
        characterId: row.character_id == null ? undefined : String(row.character_id),
        settingIds: parseIds(row.setting_ids),
        presetId: row.preset_id == null ? undefined : String(row.preset_id),
      }))
    },
    async createSession(title, systemPrompt, packId, settingIds, presetId) {
      const session: Session = { id: newId(), title, updatedAt: Date.now(), systemPrompt, packId, settingIds, presetId }
      await db.run(
        'INSERT INTO sessions (id, title, updated_at, system_prompt, pack_id, setting_ids) VALUES (?, ?, ?, ?, ?, ?)',
        [
          session.id,
          session.title,
          session.updatedAt,
          session.systemPrompt ?? null,
          session.packId ?? null,
          settingIds && settingIds.length > 0 ? JSON.stringify(settingIds) : null,
        ]
      )
      return session
    },
    async setSessionPack(id, packId) {
      await db.run('UPDATE sessions SET pack_id = ? WHERE id = ?', [packId, id])
    },
    async renameSession(id, title) {
      await db.run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', [title, Date.now(), id])
    },
    async deleteSession(id) {
      await db.run('DELETE FROM turns WHERE session_id = ?', [id])
      await db.run('DELETE FROM sessions WHERE id = ?', [id])
    },
    async listTurns(sessionId) {
      const res = await db.query('SELECT * FROM turns WHERE session_id = ? ORDER BY idx ASC', [sessionId])
      return (res.values ?? []).map(rowToTurn)
    },
    async appendTurn(turn) {
      const texts = turnTexts(turn)
      await db.run(
        'INSERT INTO turns (id, session_id, idx, variants, active, created_at, search_text, user_text, assistant_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          turn.id,
          turn.sessionId,
          turn.idx,
          JSON.stringify(turn.variants),
          turn.active,
          turn.createdAt,
          turnSearchText(turn),
          texts.user,
          texts.assistant,
        ]
      )
    },
    async updateTurn(turn) {
      const texts = turnTexts(turn)
      await db.run(
        'UPDATE turns SET variants = ?, active = ?, search_text = ?, user_text = ?, assistant_text = ? WHERE id = ?',
        [JSON.stringify(turn.variants), turn.active, turnSearchText(turn), texts.user, texts.assistant, turn.id]
      )
    },
    async deleteTurnsFrom(sessionId, fromIdx) {
      await db.run('DELETE FROM turns WHERE session_id = ? AND idx >= ?', [sessionId, fromIdx])
    },
    async search(query, limit = 50) {
      const q = query.trim()
      if (!q) return []
      const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`)
      const like = `%${escaped}%`
      const res = await db.query(
        `SELECT t.id, t.session_id, t.idx, t.user_text, t.assistant_text, s.title
         FROM turns t LEFT JOIN sessions s ON s.id = t.session_id
         WHERE t.user_text LIKE ? ESCAPE '\\' OR t.assistant_text LIKE ? ESCAPE '\\'
         ORDER BY t.created_at DESC LIMIT ?`,
        [like, like, limit]
      )
      const needle = q.toLowerCase()
      const hits: SearchHit[] = []
      for (const row of (res.values ?? []) as Array<Record<string, unknown>>) {
        const sessionTitle = row.title == null ? '未命名' : String(row.title)
        for (const field of ['user', 'assistant'] as const) {
          const text = String(row[field === 'user' ? 'user_text' : 'assistant_text'] ?? '')
          if (!text.toLowerCase().includes(needle)) continue
          hits.push({
            turnId: String(row.id),
            sessionId: String(row.session_id),
            idx: Number(row.idx),
            sessionTitle,
            text,
            field,
          })
        }
      }
      return hits
    },
    async clearAll() {
      await db.run('DELETE FROM turns')
      await db.run('DELETE FROM sessions')
    },
  }
}
