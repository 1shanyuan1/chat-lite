import type { SettingDoc } from './settings'

/** 导出成 SillyTavern 的 V2 JSON（生态通用格式） */
export function cardToV2(doc: SettingDoc) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
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
      character_book: {
        entries: doc.entries.map((entry, index) => ({
          keys: entry.keys,
          content: entry.content,
          enabled: entry.enabled,
          insertion_order: index,
        })),
      },
    },
  }
}

/** 导出成 V3（CHARX 里的 card.json，或 PNG 的 ccv3 块） */
export function cardToV3(doc: SettingDoc, assetUri?: string, assetExt?: string) {
  return {
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
      assets:
        assetUri && assetExt
          ? [{ type: 'icon', uri: assetUri, name: 'main', ext: assetExt }]
          : [],
    },
  }
}
