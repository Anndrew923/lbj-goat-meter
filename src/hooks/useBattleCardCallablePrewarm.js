import { useEffect, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";

/**
 * 觸發 generateBattleCard({ prewarm: true })：僅喚醒雲端實例與程式碼載入，不開 Chromium。
 * 每個分頁生命週期最多執行一次（prewarmedRef）；須傳入 currentUser 避免無登入呼叫。
 */
export function useBattleCardCallablePrewarm(currentUser) {
  const prewarmedRef = useRef(false);

  useEffect(() => {
    if (!functions || !currentUser || prewarmedRef.current) return;
    const gen = httpsCallable(functions, "generateBattleCard");
    gen({ prewarm: true }).catch(() => {});
    prewarmedRef.current = true;
    console.log("[Strategy] Warzone Studio pre-warming...");
  }, [currentUser]);
}
