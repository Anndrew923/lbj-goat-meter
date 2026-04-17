import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "gm_protocol_v1_accepted";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export default function useProtocolInitialization() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!canUseStorage()) {
      setIsOpen(false);
      return;
    }
    try {
      const accepted = window.localStorage.getItem(STORAGE_KEY);
      setIsOpen(!accepted);
    } catch {
      // Storage 例外時以不阻塞主流程為優先。
      setIsOpen(false);
    }
  }, []);

  const completeProtocol = useCallback(() => {
    if (canUseStorage()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, "true");
      } catch {
        // Ignore storage failures, still close overlay.
      }
    }
    setIsOpen(false);
  }, []);

  const replayProtocol = useCallback(() => {
    setIsOpen(true);
  }, []);

  return {
    isOpen,
    completeProtocol,
    replayProtocol,
    storageKey: STORAGE_KEY,
  };
}
