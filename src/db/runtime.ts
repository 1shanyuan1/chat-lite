import { Capacitor } from '@capacitor/core'
import { createLocalRepo, createSqliteRepo, type Repo } from './index'

let repo: Repo | null = null

export async function initRepo(): Promise<Repo> {
  if (repo) return repo
  repo = Capacitor.isNativePlatform() ? await createSqliteRepo() : createLocalRepo()
  return repo
}

export function getRepo(): Repo {
  if (!repo) throw new Error('repo 尚未初始化')
  return repo
}
