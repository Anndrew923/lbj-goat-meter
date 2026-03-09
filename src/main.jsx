// Bruce: 純原生 JS 診斷雷達，放在 main.jsx 最頂端
(function() {
  const radar = document.createElement('div');
  radar.style = 'position:fixed;top:10px;right:10px;z-index:10000;background:#000;color:#0f0;padding:15px;font-family:monospace;border:2px solid #333;border-radius:8px;';
  radar.innerHTML = '📡 Radar Active (Checking...)';
  document.body.appendChild(radar);

  window.addEventListener('load', () => {
    const domain = window.location.hostname;
    const key = "6LfesYMsAAAAAJeIdp8KuXmZT9oBi-q5d1bDQb9o"; // 這裡直接寫死正確的 Site Key 進行比對
    
    radar.innerHTML = `
      <div style="font-weight:bold;border-bottom:1px solid #333">🛡️ App Check Debugger</div>
      <div>📍 Domain: ${domain}</div>
      <div>🔑 Site Key: ...${key.slice(-5)}</div>
      <div style="margin-top:10px;color:#fff;background:#a00;padding:5px;">
        ⚠️ 403 偵測：請 Boss 確認 Firebase 後台 Secret Key 是否正確。
      </div>
    `;
  });
})();

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './i18n/config'
import { AuthProvider } from './context/AuthContext.jsx'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
