/**
 * BattleCard — 戰力分享卡片（投票完成後彈出）
 * 顯示頭像、派系、GOAT 宣言、地區排名；支援 html-to-image 下載戰報。
 * 重置按鈕：磨砂玻璃感，點擊後由父層執行 Transaction 撤銷投票，本卡以 exit 動畫「粒子化崩解」後卸載。
 */
import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { toPng } from "html-to-image";
import { Download, RotateCcw } from "lucide-react";
import { TEAMS } from "../lib/constants";
import { getStanceDisplay } from "../i18n/i18n";

function getTeamLabel(voterTeam, t) {
  const team = TEAMS.find((x) => x.value === voterTeam);
  if (team && t) return t(`team_${voterTeam}`) || team.label;
  return team?.label ?? voterTeam ?? "—";
}

function getStanceLabel(status) {
  return getStanceDisplay(status, "zh") ?? status ?? "—";
}

function getStanceLabelPrimary(status) {
  return getStanceDisplay(status, "en") ?? status ?? "—";
}

export default function BattleCard({
  open,
  onClose,
  onRevote,
  revoking = false,
  revoteError,
  onRevoteReload,
  photoURL,
  displayName,
  voterTeam,
  status,
  reasonLabels = [],
  city = "",
  country = "",
  rankLabel,
  exit = { opacity: 0, scale: 0.9 },
}) {
  const { t } = useTranslation("common");
  const cardRef = useRef(null);

  const teamLabel = getTeamLabel(voterTeam, t);
  const stanceLabel = getStanceLabel(status);
  const stanceLabelPrimary = getStanceLabelPrimary(status);
  const regionText = [country, city].filter(Boolean).join(" · ") || t("global");

  const handleDownload = useCallback(() => {
    if (!cardRef.current) return;
    toPng(cardRef.current, {
      backgroundColor: "#0a0a0a",
      pixelRatio: 2,
      cacheBust: true,
    })
      .then((dataUrl) => {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = `GOAT-Meter-${stanceLabelPrimary}-${Date.now()}.png`;
        a.click();
      })
      .catch((err) => console.error("[BattleCard] toPng failed", err));
  }, [stanceLabelPrimary]);

  if (!open) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="battle-card-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={exit}
      transition={{ duration: 0.25 }}
      onClick={() => onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={cardRef}
          className="rounded-2xl border-2 border-king-gold/50 bg-gray-900/85 backdrop-blur-[16px] p-6 shadow-xl flex flex-col min-h-0"
          style={{
            boxShadow:
              "0 0 40px rgba(212,175,55,0.15), inset 0 1px 0 rgba(212,175,55,0.1)",
          }}
        >
          <div className="flex flex-col flex-1 min-h-0 space-y-6">
            {/* 身份區 */}
            <div className="flex items-center gap-4 flex-shrink-0">
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-king-gold/50 bg-gray-800 flex-shrink-0">
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl text-king-gold/70">
                    ?
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="text-white font-bold truncate leading-relaxed">
                  {displayName || t("anonymousWarrior")}
                </p>
                <p
                  className="text-king-gold text-sm truncate leading-relaxed"
                  title={t("supporting_team", { team: teamLabel })}
                >
                  {t("supporting_team", { team: teamLabel })}
                </p>
              </div>
            </div>

            {/* 宣言區：卡片中的卡片（深色方框 + 標籤化） */}
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto max-h-[50vh] custom-scrollbar rounded-xl bg-white/5 p-4">
              <p
                id="battle-card-title"
                className="text-xs text-gray-500 uppercase tracking-wider mb-2 leading-relaxed"
              >
                {t("warzoneStance")}
              </p>
              <p
                className="text-king-gold font-semibold break-words mb-4 leading-relaxed"
                style={{ fontSize: "clamp(1.1rem, 4vw, 1.5rem)" }}
              >
                {stanceLabel}
              </p>
              {reasonLabels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {reasonLabels.map((label, i) => (
                    <span
                      key={`${label}-${i}`}
                      className="inline-flex px-2 py-1 bg-gray-800 rounded text-[10px] text-gray-300 leading-relaxed"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 底部元數據：固底 */}
            <div className="mt-auto pt-4 flex justify-between items-center gap-2 text-sm min-w-0 flex-shrink-0 border-t border-villain-purple/20">
              <span
                className="text-villain-purple/90 truncate min-w-0 flex-1 leading-relaxed"
                title={regionText}
              >
                {regionText}
              </span>
              <span
                className="text-king-gold font-medium truncate min-w-0 leading-relaxed"
                title={rankLabel ?? t("rankLabel")}
              >
                {rankLabel ?? t("rankLabel")}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownload}
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-king-gold text-black font-bold"
        >
          <Download className="w-5 h-5 shrink-0" aria-hidden />
          {t("downloadReport")}
        </button>

        <div className={`flex gap-3 mt-3 w-full ${onRevote ? "" : "flex-col"}`}>
          {onRevote && (
            <motion.button
              type="button"
              onClick={onRevote}
              disabled={revoking}
              className="flex-1 min-w-0 py-3 px-4 rounded-xl font-medium text-sm text-king-gold/95 bg-white/10 backdrop-blur-md border border-king-gold/30 hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              whileHover={!revoking ? { scale: 1.02 } : {}}
              whileTap={!revoking ? { scale: 0.98 } : {}}
            >
              <RotateCcw className="w-4 h-4 shrink-0" aria-hidden />
              {revoking ? t("resettingStance") : t("resetStance")}
            </motion.button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={onRevote ? "px-4 py-3 rounded-xl border border-villain-purple/50 text-gray-300 hover:text-white shrink-0" : "w-full py-3 rounded-xl border border-villain-purple/50 text-gray-300 hover:text-white"}
          >
            {t("close")}
          </button>
        </div>
        {revoteError && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-red-400" role="alert">
              {revoteError}
            </p>
            {onRevoteReload && (
              <button
                type="button"
                onClick={onRevoteReload}
                className="py-2 px-3 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-400/50 hover:bg-red-500/30"
              >
                {t("retry")}
              </button>
            )}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
