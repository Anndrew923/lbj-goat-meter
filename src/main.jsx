import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom'
import './i18n/config'
import { AuthProvider } from './context/AuthContext.jsx'
import App from './App.jsx'
import RenderStudioPage from './pages/RenderStudioPage.jsx'
import './index.css'

/**
 * Puppeteer 攝影棚：必須用 hash 路由，讓實際 document path 維持 `/`。
 * Vite base 為 `./` 時，若開在 /render-studio/uuid，相對腳本會變成 /render-studio/assets → 404，
 * React 永不執行，waitForFunction(__RENDER_READY__) 必然逾時。
 */
function isHeadlessRenderStudio() {
  if (typeof window === 'undefined') return false
  const raw = (window.location.hash || '').replace(/^#/, '')
  if (!raw) return false
  const normalized = raw.startsWith('/') ? raw : `/${raw}`
  if (!normalized.startsWith('/render-studio/')) return false
  const qs = normalized.includes('?') ? normalized.split('?').slice(1).join('?') : ''
  const hashMode = new URLSearchParams(qs).get('mode')
  if (hashMode === 'puppeteer') return true
  // 後端 Puppeteer：mode 可放在 # 前（/?mode=puppeteer#/render-studio/...）以兼容 Vite base 與資產路徑
  return new URLSearchParams(window.location.search || '').get('mode') === 'puppeteer'
}

const headlessStudio = isHeadlessRenderStudio()

createRoot(document.getElementById('container')).render(
  <StrictMode>
    {headlessStudio ? (
      <HashRouter>
        <Routes>
          <Route path="/render-studio/:jobId" element={<RenderStudioPage />} />
        </Routes>
      </HashRouter>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
)
