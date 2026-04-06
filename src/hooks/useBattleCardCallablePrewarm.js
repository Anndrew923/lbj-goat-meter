import { useEffect, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { getFirebaseFunctions } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

/**
 * 觸發 generateBattleCard({ prewarm: true })：僅喚醒雲端實例與程式碼載入，不開 Chromium。
 * 以 lastUidRef 略過同一 uid 之重複 effect（含 React Strict Mode 雙掛載）。
 */
export function useBattleCardCallablePrewarm() {
  const { currentUser } = useAuth();
  const lastPrewarmedUidRef = useRef(null);

  useEffect(() => {
    if (!currentUser) {
      lastPrewarmedUidRef.current = null;
      return;
    }
    if (lastPrewarmedUidRef.current === currentUser.uid) return;
    lastPrewarmedUidRef.current = currentUser.uid;

    const run = async () => {
      try {
        const fns = getFirebaseFunctions();
        if (!fns) return;
        await httpsCallable(fns, "generateBattleCard", { timeout: 30_000 })({ prewarm: true });
      } catch {
        // 非關鍵路徑
      }
    };
    void run();
  }, [currentUser?.uid]);
}
