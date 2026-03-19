/**
 * GoldenKeyService — 客戶端請求簽章（黃金鑰匙）
 *
 * 設計意圖：
 * - 以「共用密鑰 + HMAC-SHA256」產生簽章，綁定請求負載與時間戳，供後端 Cloud Functions 驗證。
 * - 為避免與 Firebase Callable 的 header 限制衝突，簽章一律以資料欄位傳遞：
 *   - x-goat-timestamp: Unix ms
 *   - x-goat-signature: hex(HMAC_SHA256(secret, `${action}|${timestamp}|${payloadHash}`))
 * - 秘密金鑰透過環境變數注入（VITE_GOAT_GOLDEN_KEY_SECRET），前後端需一致。
 *
 * 安全說明：
 * - 此方案屬「應用層防禦與簡易風控訊號」，無法防止逆向工程取得金鑰。
 * - 真正的信任邊界仍在：Firebase Auth / device_locks / 後端 Transaction 與行為風控。
 */

const ACTION_SUBMIT_VOTE = 'submit_vote';
const ACTION_RESET_POSITION = 'reset_position';
const ACTION_SUBMIT_BREAKING_VOTE = 'submit_breaking_vote';

/**
 * 取得 Client 端的黃金鑰匙密鑰字串。
 * 若未設定則回傳 null，後端會視為未簽章請求。
 */
function getGoldenKeySecret() {
  const raw = import.meta.env.VITE_GOAT_GOLDEN_KEY_SECRET;
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v || null;
}

/**
 * 使用 Web Crypto 計算 HMAC-SHA256。
 * 若執行環境不支援 crypto.subtle，回傳 null，讓呼叫端決定是否降級處理。
 */
async function hmacSha256Hex(secret, message) {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return null;
  }
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const msgData = enc.encode(message);
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', key, msgData);
  const bytes = new Uint8Array(signature);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 生成 Golden Key 請求簽章欄位。
 *
 * @param {string} action - 動作代碼（submit_vote / reset_position / submit_breaking_vote）
 * @param {Record<string, unknown>} payloadForHash - 將被送往後端的 payload 子集（與安全性相關欄位）
 * @returns {Promise<{ xGoatTimestamp: number, xGoatSignature: string | null }>}
 */
export async function createGoldenKeySignature(action, payloadForHash) {
  const ts = Date.now();
  const secret = getGoldenKeySecret();

  // 若前端未設定密鑰，仍回傳 timestamp，signature 為 null，後端會回傳 403 signature-missing。
  if (!secret) {
    if (typeof window !== "undefined" && !import.meta.env.DEV) {
      console.warn(
        "[GoldenKeyService] VITE_GOAT_GOLDEN_KEY_SECRET 未設定，請求將被後端拒絕（signature-missing）。請在 build 環境變數中設定與後端相同的密鑰。"
      );
    }
    return {
      xGoatTimestamp: ts,
      xGoatSignature: null,
    };
  }

  const payloadJson = JSON.stringify(payloadForHash ?? {});
  const message = `${action}|${ts}|${payloadJson}`;
  try {
    const sig = await hmacSha256Hex(secret, message);
    return {
      xGoatTimestamp: ts,
      xGoatSignature: sig,
    };
  } catch (err) {
    // 若瀏覽器不支援 Web Crypto 或計算失敗，降級為僅附帶 timestamp。
    console.warn('[GoldenKeyService] Failed to compute HMAC, fallback to timestamp only:', err);
    return {
      xGoatTimestamp: ts,
      xGoatSignature: null,
    };
  }
}

export const GOLDEN_KEY_ACTIONS = {
  SUBMIT_VOTE: ACTION_SUBMIT_VOTE,
  RESET_POSITION: ACTION_RESET_POSITION,
  SUBMIT_BREAKING_VOTE: ACTION_SUBMIT_BREAKING_VOTE,
};

