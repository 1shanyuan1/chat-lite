import React from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import AppNext from './AppNext'
import { initPlatform } from '../platform'
import { initRepo } from '../db/runtime'
import { useApp } from '../chat/store'
import DevFrame from '../ui/DevFrame'
import { installViewportHeight } from '../ui/viewport-height'

/**
 * UI 实验版入口。与正式版共用同一份 store / 引擎 / 数据，
 * 只有渲染层不同——对照评估时看到的是同一批会话和设定。
 * 本文件只被 ui-next.html 引用，不进生产构建。
 */
async function bootstrap() {
  installViewportHeight()
  await initPlatform()
  await initRepo()
  await useApp.getState().init()
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* 与正式版共用尺寸预览壳（?demo= 演示数据也在这里生效） */}
      {import.meta.env.DEV ? (
        <DevFrame>
          <AppNext />
        </DevFrame>
      ) : (
        <AppNext />
      )}
    </React.StrictMode>
  )
}

void bootstrap()
