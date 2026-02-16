/**
 * ReconPermissionIndicator — 偵查權限軍事風指示燈
 * 未授權：灰點 + RECON PERMISSION: RESTRICTED
 * 已授權：戰術綠 (#00E676) 脈衝 + RECON PERMISSION: AUTHORIZED，font-mono 終端感
 */
import { useTranslation } from "react-i18next";
import { RECON_AUTHORIZED_COLOR } from "../lib/constants";

export default function ReconPermissionIndicator({ authorized, className = "" }) {
  const { t } = useTranslation("common");
  return (
    <div
      className={`flex items-center gap-2 font-mono text-xs tracking-widest uppercase ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-label={
        authorized
          ? t("reconPermissionAuthorized")
          : t("reconPermissionRestricted")
      }
    >
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${authorized ? "animate-pulse" : "bg-gray-600"}`}
        style={
          authorized
            ? {
                backgroundColor: RECON_AUTHORIZED_COLOR,
                boxShadow: `0 0 8px ${RECON_AUTHORIZED_COLOR}`,
              }
            : undefined
        }
        aria-hidden
      />
      <span
        className={authorized ? "" : "text-gray-500"}
        style={authorized ? { color: RECON_AUTHORIZED_COLOR } : undefined}
      >
        {authorized
          ? t("reconPermissionAuthorized")
          : t("reconPermissionRestricted")}
      </span>
    </div>
  );
}
