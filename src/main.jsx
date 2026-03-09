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

// --- 診斷腳本開始 ---
(function() {
  const initDebugRadar = () => {
    const radar = document.createElement('div');
    radar.id = 'app-check-radar';
    radar.style = `
      position: fixed; top: 10px; right: 10px; z-index: 999999;
      background: rgba(0, 0, 0, 0.95); color: #00ff00; padding: 15px;
      font-family: monospace; font-size: 12px; border: 2px solid #333;
      border-radius: 8px; box-shadow: 0 0 20px rgba(0,0,0,0.8);
      max-width: 320px; pointer-events: none; line-height: 1.5;
    `;
    radar.innerHTML = '📡 App Check 診斷中...';
    document.body.appendChild(radar);

    const updateRadar = (info) => {
      const { status, domain, key, error } = info;
      radar.innerHTML = `
        <div style="border-bottom: 1px solid #444; margin-bottom: 8px; padding-bottom: 5px; font-weight: bold; color: #fff; font-size: 14px;">
          🛡️ App Check Debugger
        </div>
        <div style="margin-bottom: 4px;">📍 Domain: <span style="color: ${domain.includes('netlify.app') ? '#00ff00' : '#ff4444'}">${domain}</span></div>
        <div style="margin-bottom: 4px;">🔑 Key (末五碼): <span style="color: #aaa;">...${key.substring(key.length - 5)}</span></div>
        <div style="margin-top: 10px; padding: 8px; background: ${status === 'SUCCESS' ? '#050' : '#500'}; color: #fff; text-align: center; border-radius: 4px; font-weight: bold;">
          ${status === 'SUCCESS' ? '✅ 網域與金鑰匹配成功' : '❌ 驗證失敗 (401/400)'}
        </div>
        ${error ? `<div style="color: #ffb8b8; font-size: 11px; margin-top: 8px; white-space: pre-wrap; border-top: 1px solid #444; pt: 5px;">原因: ${error}</div>` : ''}
        <div style="font-size: 10px; color: #666; margin-top: 8px; text-align: right;">v3 Standard Only</div>
      `;
    };

    setTimeout(async () => {
      const domain = window.location.hostname;
      const siteKey = import.meta.env.VITE_APP_CHECK_SITE_KEY || 'MISSING';
      
      try {
        const { getApp } = await import('firebase/app');
        const { getToken } = await import('firebase/app-check');
        const app = getApp();
        // 強制獲取新 Token 進行測試
        const result = await getToken(app.container.getProvider('app-check').getImmediate(), false);
        
        if (result.token) {
          updateRadar({ status: 'SUCCESS', domain, key: siteKey });
          console.log('%c[Radar] App Check Token Verified!', 'color: #00ff00');
        } else {
          updateRadar({ status: 'FAIL', domain, key: siteKey, error: '領取到空 Token' });
        }
      } catch (err) {
        let errorMsg = err.message;
        if (err.message.includes('recaptcha-error')) {
          errorMsg = 'reCAPTCHA 驗證失敗。請檢查：\n1. reCAPTCHA 後台網域清單\n2. 是否誤用 Enterprise 金鑰';
        }
        updateRadar({ status: 'FAIL', domain, key: siteKey, error: errorMsg });
      }
    }, 3000);
  };

  if (document.readyState === 'complete') {
    initDebugRadar();
  } else {
    window.addEventListener('load', initDebugRadar);
  }
})();
// --- 診斷腳本結束 ---
