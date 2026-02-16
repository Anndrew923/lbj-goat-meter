/**
 * StanceCards — 六大立場卡片網格
 * Grid 排版、等高卡片、海報感排版、STANCE_COLORS 動態主標與水印。
 */
import { motion } from "framer-motion";
import { getStancesForArena } from "../i18n/i18n";
import { STANCE_COLORS } from "../lib/constants";

function getStanceColor(value) {
  return STANCE_COLORS[value] ?? "#9ca3af";
}

/** 依 theme 與選中狀態取得按鈕/卡片樣式 */
function getStanceCardClass(theme, isSelected) {
  if (!isSelected) {
    if (theme === "king-gold")
      return "bg-gray-800 text-king-gold border border-king-gold/50 hover:bg-king-gold/20";
    if (theme === "villain-purple")
      return "bg-gray-800 text-villain-purple border border-villain-purple/50 hover:bg-villain-purple/20";
    if (theme === "crown-red")
      return "bg-gray-800 text-red-400 border border-red-500/50 hover:bg-red-500/20";
    if (theme === "graphite")
      return "bg-gray-800 text-gray-400 border border-gray-500 hover:bg-gray-600/30";
    if (theme === "machine-silver")
      return "bg-gray-800 text-gray-300 border border-gray-400/50 hover:bg-gray-400/20";
    if (theme === "rust-copper")
      return "bg-gray-800 text-amber-700 border border-amber-600/50 hover:bg-amber-600/20";
    return "bg-gray-800 text-gray-300 border border-gray-600";
  }
  if (theme === "king-gold")
    return "bg-king-gold text-black shadow-lg shadow-king-gold/40";
  if (theme === "villain-purple")
    return "bg-villain-purple text-white shadow-lg shadow-villain-purple/40";
  if (theme === "crown-red")
    return "bg-red-600 text-white shadow-lg shadow-red-500/40";
  if (theme === "graphite")
    return "bg-gray-600 text-white shadow-lg shadow-gray-500/40";
  if (theme === "machine-silver")
    return "bg-gray-400 text-black shadow-lg shadow-gray-400/40";
  if (theme === "rust-copper")
    return "bg-amber-600 text-black shadow-lg shadow-amber-500/40";
  return "bg-gray-500 text-white";
}

/**
 * @param {string | null} [selectedStance] - 當前選中的立場 value
 * @param {(value: string) => void} [onSelect] - 點擊卡片時回調
 * @param {boolean} [disabled] - 是否禁用點擊（如來賓模式僅開登入彈窗）
 * @param {boolean} [goatFlash] - 是否播放 GOAT 金閃動畫
 * @param {boolean} [fraudShatter] - 是否播放 FRAUD 紫碎動畫
 */
export default function StanceCards({
  selectedStance,
  onSelect,
  disabled,
  goatFlash = false,
  fraudShatter = false,
}) {
  const rows = getStancesForArena();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
      {rows.map(({ value, theme, primary, secondary }) => {
        const color = getStanceColor(value);
        const watermarkLetter = (primary && primary[0]) || value[0];
        return (
          <motion.button
            key={value}
            type="button"
            onClick={() => !disabled && onSelect?.(value)}
            disabled={disabled}
            aria-pressed={selectedStance === value}
            aria-label={`${primary}: ${secondary}`}
            whileHover={disabled ? undefined : { scale: 1.02 }}
            whileTap={disabled ? undefined : { scale: 0.98 }}
            className={`relative min-h-[110px] rounded-lg text-left px-4 py-2.5 transition-colors flex flex-col items-start justify-end overflow-hidden disabled:cursor-not-allowed ${getStanceCardClass(
              theme,
              selectedStance === value
            )}`}
          >
            {/* 背景水印：巨大字母 */}
            <span
              className="absolute right-[-5%] bottom-[-5%] text-7xl sm:text-8xl lg:text-9xl font-black opacity-[0.05] italic pointer-events-none select-none"
              style={{ color }}
              aria-hidden
            >
              {watermarkLetter.toUpperCase()}
            </span>
            {value === "goat" && goatFlash && (
              <motion.span
                className="absolute inset-0 rounded-lg bg-king-gold pointer-events-none"
                initial={{ opacity: 0.8, scale: 0.8 }}
                animate={{ opacity: 0, scale: 1.5 }}
                transition={{ duration: 0.5 }}
                style={{ boxShadow: "0 0 24px rgba(212,175,55,0.8)" }}
              />
            )}
            {value === "fraud" && fraudShatter && (
              <motion.span
                className="absolute inset-0 rounded-lg bg-villain-purple pointer-events-none"
                initial={{ opacity: 1, scale: 1 }}
                animate={{ opacity: 0, scale: 1.2 }}
                transition={{ duration: 0.4 }}
                style={{
                  boxShadow:
                    "0 0 20px rgba(75,0,130,0.9), inset 0 0 20px rgba(0,0,0,0.5)",
                  filter: "brightness(1.3)",
                }}
              />
            )}
            <span
              className="relative z-0 text-2xl sm:text-3xl lg:text-4xl font-black uppercase tracking-tighter leading-tight"
              style={{ color: selectedStance === value ? undefined : color }}
            >
              {primary}
            </span>
            <span className="relative z-0 text-[9px] sm:text-[10px] font-normal opacity-90 mt-0.5 line-clamp-2">
              {secondary}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
