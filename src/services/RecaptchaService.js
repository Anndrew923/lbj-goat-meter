/**
 * RecaptchaService — 前端 reCAPTCHA Token 取得層
 *
 * 設計意圖：
 * - 使用「標準版」 reCAPTCHA v3（非 Enterprise），對應你在 Google reCAPTCHA 後台建立的 v3 金鑰。
 * - 將 reCAPTCHA token 取得集中管理，避免各處直接操作 window.grecaptcha。
 * - 僅在「即將呼叫 Cloud Functions」前才執行，確保 token 時效最新。
 * - 若 SDK 尚未載入，會動態注入官方 v3 script（api.js），載入完成後再 execute。
 */

let recaptchaScriptPromise = null;

function ensureRecaptchaScript(siteKey) {
  if (typeof window === "undefined") return Promise.resolve();

  if (window.grecaptcha?.execute) {
    return Promise.resolve();
  }

  if (recaptchaScriptPromise) {
    return recaptchaScriptPromise;
  }

  recaptchaScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src^="https://www.google.com/recaptcha/api.js"]'
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", (e) => reject(e));
      return;
    }

    const script = document.createElement("script");
    // 標準 reCAPTCHA v3 script
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(
      siteKey
    )}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });

  return recaptchaScriptPromise;
}

/**
 * 官方建議：在 api.js?render= 載入後，先經 grecaptcha.ready() 再 execute，避免「腳本已載入但 API 尚未就緒」導致空 token。
 *
 * @param {string} siteKey
 * @param {string} action
 * @returns {Promise<string | null>}
 */
async function executeRecaptchaV3(siteKey, action) {
  const g = window.grecaptcha;
  if (!g?.execute) return null;

  const run = async () => {
    const token = await g.execute(siteKey, { action });
    return typeof token === "string" && token.trim() ? token.trim() : null;
  };

  if (typeof g.ready === "function") {
    return new Promise((resolve) => {
      g.ready(async () => {
        try {
          resolve(await run());
        } catch {
          resolve(null);
        }
      });
    });
  }

  try {
    return await run();
  } catch {
    return null;
  }
}

/**
 * 取得 reCAPTCHA token（若 SDK 未載入則回傳 null，由呼叫端決定是否繼續或提示）。
 *
 * @param {string} action - 例如 'submit_vote' / 'reset_position'
 * @returns {Promise<string | null>}
 */
export async function getRecaptchaToken(action = "submit_vote") {
  try {
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (!siteKey) {
      if (import.meta.env.DEV) {
        console.warn(
          "[RecaptchaService] 缺少 VITE_RECAPTCHA_SITE_KEY，將以無 token 呼叫後端。"
        );
      }
      return null;
    }

    await ensureRecaptchaScript(siteKey);

    const g = window.grecaptcha;
    if (!g?.execute) {
      if (import.meta.env.DEV) {
        console.warn(
          "[RecaptchaService] grecaptcha 未就緒（可能被外掛或網路攔截）。投票仍可送出，後端將依設定決定是否要求 token。"
        );
      }
      return null;
    }

    // 短暫重試：偶發首幀 execute 回空，或與 ready 競態。
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 150));
      }
      const token = await executeRecaptchaV3(siteKey, action);
      if (token) return token;
    }
    return null;
  } catch (err) {
    if (import.meta.env.DEV) {
      // 註：recaptcha/api2/pat 的 401 為 PAT 協定預期行為，不影響 token 取得，見 docs/DEPLOY-DIAGNOSIS-401.md
      console.warn(
        "[RecaptchaService] 取得 reCAPTCHA token 失敗：",
        err?.message ?? err
      );
    }
    return null;
  }
}

