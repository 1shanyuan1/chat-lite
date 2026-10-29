import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { initPlatform } from './platform'
import { initRepo } from './db/runtime'
import { useApp } from './chat/store'

async function bootstrap() {
  await initPlatform()
  await initRepo()
  await useApp.getState().init()
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
