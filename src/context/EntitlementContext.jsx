/**
 * EntitlementContext — 訂閱與廣告獎勵權限層
 *
 * 設計意圖（Strava Premium Gate 模式）：
 *   1. 單一職責：只管「你能做什麼」— isPremium、revote（廣告換票）、refreshEntitlements。
 *   2. 派生態：isPremium 直接從 ProfileContext.profile.isPremium 讀取，無需額外 Firestore 呼叫。
 *   3. 解耦廣告流程：revote 的 Ad Reward Token 取得、reCAPTCHA、Cloud Function 呼叫全封裝在此，
 *      AuthContext 與 ProfileContext 完全不感知廣告邏輯。
 *   4. 獨立錯誤通道：entitlementError 與 AuthContext.authError 並列，
 *      useAuth() 複合 Hook 在外層合併（auth error 優先），組件端感知零差異。
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { auth } from "../lib/firebase";
import { requestResetAdRewardToken } from "../services/RewardedAdsService";
import { callResetPosition } from "../services/ResetPositionService";
import { getRecaptchaToken } from "../services/RecaptchaService";
import { getCallableDetailsCode } from "../utils/firebaseCallableError";
import i18n from "../i18n/config";
import { useAuthContext } from "./AuthContext";
import { useProfile } from "./ProfileContext";

export const EntitlementContext = createContext(null);

function isTokenServiceBlockedError(err) {
  const msg = err?.message ?? "";
  return (
    msg.includes("API_KEY_SERVICE_BLOCKED") ||
    (msg.includes("securetoken.googleapis.com") && msg.includes("blocked"))
  );
}

/** Callable 前強制刷新 Auth token，避免 UI 已登入但 request.auth 為空 */
async function ensureFreshAuthTokenForCallable() {
  if (!auth?.currentUser) return false;
  await auth.currentUser.getIdToken(true);
  return true;
}

export function EntitlementProvider({ children }) {
  const { currentUser } = useAuthContext();
  const { profile } = useProfile();
  const [entitlementError, setEntitlementError] = useState(null);
  /** 廣告準備中旗標：供 VotePage 顯示 AdPreloadOverlay，在 SDK 接管前給用戶情境說明 */
  const [revoteAdLoading, setRevoteAdLoading] = useState(false);

  /** isPremium 直接從 profile 快照讀取，與 ProfileContext.onSnapshot 保持實時同步 */
  const isPremium = profile?.isPremium === true;

  const clearEntitlementError = useCallback(
    () => setEntitlementError(null),
    [],
  );

  const refreshEntitlements = useCallback(async () => {
    // EntitlementContext 的 isPremium 已由 ProfileContext.onSnapshot 自動維護，
    // 此方法保留供外部強制觸發（例如：完成付費後立即刷新，不等待 onSnapshot 推送）。
    // 實作：觸發 ProfileContext 的 isPremium 更新由 profile 快照驅動，此處為空殼接口。
    if (!currentUser?.uid) return;
    // 未來可在此插入付費服務的「強制同步」邏輯
  }, [currentUser?.uid]);

  /**
   * revote — 廣告換票（重置立場）
   * 流程：刷新 token → 取廣告獎勵 token → reCAPTCHA → Cloud Function resetPosition
   * 若 callable 返回 auth-required，先強制刷新 token 後再重試一次。
   */
  const revote = useCallback(
    async (resetProfile = false) => {
      const uid = currentUser?.uid;
      if (!uid) {
        const msg = i18n.t("common:error_missingDbOrUid");
        setEntitlementError(msg);
        throw new Error(msg);
      }
      setEntitlementError(null);
      try {
        await ensureFreshAuthTokenForCallable();

        setRevoteAdLoading(true);
        let adRewardToken;
        try {
          adRewardToken = await requestResetAdRewardToken();
        } finally {
          setRevoteAdLoading(false);
        }
        const recaptchaToken = await getRecaptchaToken("reset_position");

        let resetResult;
        try {
          resetResult = await callResetPosition({ adRewardToken, recaptchaToken, resetProfile });
        } catch (firstErr) {
          const firstBackendCode = getCallableDetailsCode(firstErr);
          if (firstBackendCode !== "auth-required") throw firstErr;
          // token 於廣告流程中失效，強制刷新後重試
          await ensureFreshAuthTokenForCallable();
          resetResult = await callResetPosition({ adRewardToken, recaptchaToken, resetProfile });
        }

        const { deletedVoteId } = resetResult;
        if (import.meta.env.DEV) {
          console.log(
            "[EntitlementContext] resetPosition 完成 — deletedVoteId:", deletedVoteId,
            "| resetProfile:", resetProfile,
          );
        }
      } catch (err) {
        const backendCode = getCallableDetailsCode(err);
        let msg;
        if (backendCode === "auth-required") {
          msg = i18n.t("common:voteError_authRequired");
        } else if (isTokenServiceBlockedError(err)) {
          msg = i18n.t("common:voteError_tokenServiceBlocked");
        } else if (backendCode === "low-score-robot") {
          msg = i18n.t("common:voteError_lowScoreRobot");
        } else if (backendCode === "device-already-voted") {
          msg = i18n.t("common:voteError_deviceAlreadyVoted");
        } else if (backendCode === "ad-not-watched") {
          msg = i18n.t("common:voteError_adNotWatched");
        } else if (backendCode === "reset-internal") {
          msg = i18n.t("common:voteError_resetInternal");
        } else if (
          backendCode === "signature-missing" ||
          backendCode === "signature-mismatch" ||
          backendCode === "signature-invalid-timestamp" ||
          backendCode === "signature-timestamp-skew"
        ) {
          msg = i18n.t("common:revoteSignatureError");
        } else {
          msg = i18n.t("common:voteError_genericRetry");
        }
        setEntitlementError(msg);
        if (import.meta.env.DEV) {
          console.warn("[EntitlementContext] revote/resetPosition 失敗:", {
            code: backendCode,
            message: err?.message,
          });
        }
        throw new Error(msg);
      }
    },
    [currentUser?.uid],
  );

  const value = useMemo(
    () => ({
      isPremium,
      revoteAdLoading,
      entitlementError,
      clearEntitlementError,
      refreshEntitlements,
      revote,
    }),
    [isPremium, revoteAdLoading, entitlementError, clearEntitlementError, refreshEntitlements, revote],
  );

  return (
    <EntitlementContext.Provider value={value}>
      {children}
    </EntitlementContext.Provider>
  );
}

export function useEntitlement() {
  const ctx = useContext(EntitlementContext);
  if (ctx == null)
    throw new Error("useEntitlement must be used within EntitlementProvider");
  return ctx;
}
