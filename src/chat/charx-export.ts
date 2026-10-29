import { strToU8, zipSync } from 'fflate'
import type { SettingDoc } from './settings'

const AVATAR_PATH = 'assets/icon/images/avatar.png'

/** data URL → 字节；不是图片或解不开就返回 undefined */
export function dataUrlToBytes(dataUrl?: string): { bytes: Uint8Array; ext: string } | undefined {
  if (!dataUrl || !dataUrl.startsWith('data:')) return undefined
  const match = /^data:image\/([a-z+]+);base64,(.+)$/i.exec(dataUrl)
  if (!match) return undefined
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg')
  try {
    const binary = atob(match[2])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { bytes, ext }
  } catch {
    return undefined
  }
}

/**
 * 导出成 CHARX：ZIP + 根目录 card.json（chara_card_v3）+ assets 里的头像。
 * 这是 RisuAI / V3 生态的容器，也是唯一能带着图一起分享的格式。
 */
export function buildCharx(doc: SettingDoc): Uint8Array {
  const avatar = dataUrlToBytes(doc.avatar)
  const files: Record<string, Uint8Array> = {}

  const card = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      name: doc.name,
      description: doc.body,
      personality: '',
      scenario: '',
      first_mes: doc.firstMessage ?? '',
      mes_example: '',
      creator_notes: '从 Chat Lite 导出',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      creator: 'Chat Lite',
      character_version: '1.0',
      extensions: {},
      character_book: {
        name: `${doc.name} 的世界书`,
        entries: doc.entries.map((entry, index) => ({
          id: index,
          keys: entry.keys,
          content: entry.content,
          enabled: entry.enabled,
          insertion_order: index,
          case_sensitive: false,
          selective: false,
          constant: Boolean(entry.constant),
          extensions: {},
        })),
      },
      // 头像写进 assets，卡里用 embeded:// 引用（规范就是少一个 d）
      assets: avatar
        ? [
            {
              type: 'icon',
              uri: `embeded://${avatar.ext === 'jpg' ? 'assets/icon/images/avatar.jpg' : AVATAR_PATH}`,
              name: 'main',
              ext: avatar.ext,
            },
          ]
        : [],
    },
  }

  files['card.json'] = strToU8(JSON.stringify(card, null, 2))
  if (avatar) {
    files[avatar.ext === 'jpg' ? 'assets/icon/images/avatar.jpg' : AVATAR_PATH] = avatar.bytes
  }

  return zipSync(files, { level: 6 })
}

export const charxFileName = (name: string) =>
  `${(name || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.charx`
