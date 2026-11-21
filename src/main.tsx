import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { initPlatform } from './platform'
import { initRepo } from './db/runtime'
import { useApp } from './chat/store'
import DevFrame from './ui/DevFrame'
import { installViewportHeight } from './ui/viewport-height'

async function bootstrap() {
  installViewportHeight()
  await initPlatform()
  await initRepo()
  await useApp.getState().init()
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* dev 下包一层尺寸预览壳；生产构建里这段分支会被整个摇掉 */}
      {import.meta.env.DEV ? (
        <DevFrame>
          <App />
        </DevFrame>
      ) : (
        <App />
      )}
    </React.StrictMode>
  )
}

void bootstrap()
