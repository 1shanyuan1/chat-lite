import type { DocKind } from './settings'

export type FolderArea = 'tavern' | 'writing'

export interface VaultFolder {
  id: string
  area: FolderArea
  name: string
  createdAt: number
}

/** 每个区允许放哪些东西 */
export const FOLDER_CONTENTS: Record<FolderArea, Array<{ kind: DocKind | 'preset'; label: string }>> = {
  tavern: [
    { kind: 'character', label: '角色卡' },
    { kind: 'world', label: '世界书' },
    { kind: 'preset', label: '预设' },
  ],
  writing: [
    { kind: 'setting', label: '设定' },
    { kind: 'preset', label: '预设' },
  ],
}

export const areaOfKind = (kind: DocKind): FolderArea => (kind === 'setting' ? 'writing' : 'tavern')

export const folderName = (folders: VaultFolder[], id?: string) => folders.find((f) => f.id === id)?.name
