/**
 * ResetPositionService — Cloud Function resetPosition 客戶端封裝
 *
 * 設計意圖：
 * - 將 resetPosition Cloud Function 呼叫集中管理，便於在 Context 或其他服務重用。
 * - 僅負責與 Functions 溝通與 DEV 稽查 Log，不做 i18n 映射（交由上層處理）。
 */

import { httpsCallable } from "firebase/functions";
import app, { getFirebaseFunctions } from "../lib/firebase";
import { createGoldenKeySignature, GOLDEN_KEY_ACTIONS } from "./GoldenKeyService";

function getFunctionsInstance() {
  if (!app) {
    throw new Error(
      "[ResetPositionService] Firebase app is not initialized. Check environment variables (.env) before calling resetPosition."
    );
  }
  const fns = getFirebaseFunctions();
  if (!fns) {
    throw new Error(
      "[ResetPositionService] Firebase Functions 未初始化。請設定 VITE_FIREBASE_FUNCTIONS_REGION 與後端一致。"
    );
  }
  return fns;
}

/**
 * 呼叫後端 resetPosition onCall。
 *
 * @param {{ adRewardToken: string, recaptchaToken: string | null, resetProfile?: boolean }} params
 * @param resetProfile 若為 true，後端同時清除 voterTeam / hasProfile 等欄位，
 *   前端 hasSelectedWarzone 變 false，VotingArena 強制回到 no_warzone 模式。
 * @returns {Promise<{ deletedVoteId: string | null }>}
 */
export async function callResetPosition(params) {
  const { adRewardToken, recaptchaToken, resetProfile = false } = params || {};
  const payload = { adRewardToken, recaptchaToken, resetProfile };

  const { xGoatTimestamp, xGoatSignature } = await createGoldenKeySignature(
    GOLDEN_KEY_ACTIONS.RESET_POSITION,
    { adRewardToken: adRewardToken || null }
  );

  const functions = getFunctionsInstance();
  const callable = httpsCallable(functions, "resetPosition");
  const result = await callable({
    ...payload,
    xGoatTimestamp,
    xGoatSignature,
  });

  const data = result?.data || {};
  const deletedVoteId =
    typeof data?.deletedVoteId === "string" && data.deletedVoteId.length > 0
      ? data.deletedVoteId
      : null;

  if (import.meta.env.DEV) {
    console.log(
      "[ResetPositionService] resetPosition 成功 — deletedVoteId:",
      deletedVoteId
    );
  }

  return { deletedVoteId };
}

