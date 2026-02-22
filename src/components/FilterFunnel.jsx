/**
 * FilterFunnel — 多維度篩選抽屜（精密儀器感）
 * 提供 ageGroup、gender、voterTeam、country、city 的組合，並將選擇傳給父層以連動 useSentimentData 與 PulseMap。
 * 國家篩選使用 SmartWarzoneSelector（與 UserProfileSetup 體驗對齊）。頂端授權狀態燈：未授權時灰燈 + 鎖定；已授權時戰術美金綠 (#00E676)。
 */
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { SlidersHorizontal, X } from "lucide-react";
import { AGE_GROUPS, GENDERS, TEAMS, getTeamCityKey } from "../lib/constants";
import { triggerHaptic } from "../utils/hapticUtils";
import ReconPermissionIndicator from "./ReconPermissionIndicator";
import SmartWarzoneSelector from "./SmartWarzoneSelector";

const defaultFilters = {
  ageGroup: "",
  gender: "",
  team: "",
  city: "",
  country: "",
};

function getOptionKey(type, value) {
  if (type === "ageGroup")
    return value === "45+"
      ? "ageGroup_45_plus"
      : `ageGroup_${value.replace(/-/g, "_")}`;
  if (type === "gender") return `gender_${value}`;
  if (type === "team") return getTeamCityKey(value);
  return value;
}

export default function FilterFunnel({
  open,
  onClose,
  filters: controlledFilters,
  onFiltersChange,
  /** 未傳或 true 時可操作；false 時鎖定篩選，防繞過廣告 */
  authorized = true,
  /** 套用後要捲動到的區塊 id（例如全球情緒地圖），不傳則僅關閉面板 */
  scrollTargetId,
}) {
  const { t } = useTranslation("common");
  const isControlled = controlledFilters != null && onFiltersChange != null;
  const [localFilters, setLocalFilters] = useState(defaultFilters);
  const filters = isControlled ? controlledFilters : localFilters;
  const setFilters = isControlled ? onFiltersChange : setLocalFilters;
  const locked = authorized === false;

  const update = (key, value) => {
    if (locked) {
      triggerHaptic([30, 50, 30]);
      return;
    }
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearAll = () => {
    if (locked) {
      triggerHaptic([30, 50, 30]);
      return;
    }
    setFilters({ ...defaultFilters });
  };

  const hasAny = Object.values(filters).some(
    (v) => v != null && String(v).trim() !== "",
  );

  const scrollTimeoutRef = useRef(null);

  const handleApplyFilters = () => {
    triggerHaptic(10);
    onClose();
    if (scrollTargetId) {
      // 等抽屜關閉動畫 (duration 0.25s) 後再捲動，避免與 exit 動畫搶幀
      const DRAWER_EXIT_MS = 280;
      scrollTimeoutRef.current = window.setTimeout(() => {
        scrollTimeoutRef.current = null;
        document.getElementById(scrollTargetId)?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, DRAWER_EXIT_MS);
    }
  };

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current != null) {
        window.clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, []);

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm border-l border-villain-purple/40 bg-gray-950 shadow-2xl flex flex-col"
              role="dialog"
              aria-label={t("filterDrawerAria")}
              aria-disabled={locked || undefined}
            >
              <div className="flex items-center justify-between border-b border-villain-purple/30 px-4 py-3 flex-shrink-0">
                <div className="flex items-center gap-2 text-king-gold">
                  <SlidersHorizontal className="w-5 h-5" aria-hidden />
                  <h2 className="font-bold">{t("filterPanelTitle")}</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-white rounded-lg"
                  aria-label={t("close")}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* 篩選器頂端偵查權限指示燈 */}
              <div className="px-4 pt-3 pb-1 border-b border-white/5 flex-shrink-0">
                <ReconPermissionIndicator
                  authorized={authorized}
                  className="text-[10px]"
                />
              </div>
              <div
                className={`p-4 space-y-5 overflow-y-auto flex-1 min-h-0 ${locked ? "pointer-events-none opacity-50" : ""}`}
              >
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {t("ageGroupLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {AGE_GROUPS.map(({ value }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          update(
                            "ageGroup",
                            filters.ageGroup === value ? "" : value,
                          )
                        }
                        className={`px-3 py-1.5 rounded-md text-sm ${
                          filters.ageGroup === value
                            ? "bg-king-gold/20 text-king-gold border border-king-gold/50"
                            : "bg-gray-800 text-gray-400 border border-gray-700"
                        }`}
                      >
                        {t(getOptionKey("ageGroup", value))}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {t("genderLabel")}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map(({ value }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          update(
                            "gender",
                            filters.gender === value ? "" : value,
                          )
                        }
                        className={`px-3 py-1.5 rounded-md text-sm ${
                          filters.gender === value
                            ? "bg-villain-purple/20 text-villain-purple border border-villain-purple/50"
                            : "bg-gray-800 text-gray-400 border border-gray-700"
                        }`}
                      >
                        {t(getOptionKey("gender", value))}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {t("teamLabel")}
                  </label>
                  <select
                    value={filters.team ?? ""}
                    onChange={(e) => update("team", e.target.value)}
                    disabled={locked}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label={t("selectTeam")}
                  >
                    <option value="">{t("all")}</option>
                    {TEAMS.map(({ value }) => (
                      <option key={value} value={value}>
                        {t(getOptionKey("team", value))}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {t("countryLabel")}
                  </label>
                  <SmartWarzoneSelector
                    value={filters.country ?? ""}
                    onChange={(v) => update("country", v)}
                    disabled={locked}
                    aria-label={t("countryLabel")}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    {t("cityLabel")}
                  </label>
                  <input
                    type="text"
                    value={filters.city ?? ""}
                    onChange={(e) => update("city", e.target.value)}
                    placeholder={t("cityPlaceholder")}
                    disabled={locked}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                    aria-label={t("cityLabel")}
                  />
                </div>
                {hasAny && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={clearAll}
                    className="w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {t("clearAll")}
                  </button>
                )}
              </div>
              {/* 固定底部：套用篩選（軍事質感主按鈕）；safe-area + 1.5rem 杜絕與系統手勢列／Home Indicator 重疊誤觸；env(...,0px) 為不支援時 fallback */}
              <div className="filter-funnel-bottom-safe flex-shrink-0 pt-4 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] border-t border-villain-purple/30 bg-gray-950">
                <button
                  type="button"
                  onClick={handleApplyFilters}
                  className="w-full py-3 rounded-lg bg-king-gold text-black font-bold shadow-lg shadow-king-gold/20 hover:bg-king-gold/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-king-gold focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950"
                  aria-label={t("applyFilters")}
                >
                  {t("applyFilters")}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
