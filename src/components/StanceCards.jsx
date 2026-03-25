/**
 * StanceCards — 六大立場卡片網格（史詩戰術流光版）
 * Grid 排版、等高卡片、海報感排版、STANCE_COLORS 動態主標與水印。
 * 外層立場專屬 Border Beam 流光，選中態深色漸層 + 呼吸光暈；goatFlash/fraudShatter 時邊框同步劇烈閃爍。
 * 主標使用 clamp(1rem, 4vw, 1.5rem) + overflow-wrap: anywhere，確保各解析度下標題不截斷。
 */
import { motion } from "framer-motion";
import { getStancesForArena } from "../i18n/i18n";
import { STANCE_COLORS } from "../lib/constants";

function getStanceColor(value) {
  return STANCE_COLORS[value] ?? "#9ca3af";
}

/** 主題 → Border Beam 漸層 class（流光色彩映射：王道 / 邪道 / 戰術等） */
function getBeamGradientClass(theme) {
  switch (theme) {
    case "king-gold":
      return "from-king-gold via-red-500 to-king-gold";
    case "villain-purple":
      return "from-villain-purple via-indigo-500 to-villain-purple";
    case "tactical-emerald":
      return "from-tactical-emerald via-cyan-400 to-tactical-emerald";
    case "crown-red":
      return "from-red-600 via-red-400 to-red-600";
    case "graphite":
      return "from-gray-500 via-gray-400 to-gray-500";
    case "machine-silver":
      return "from-machine-silver via-gray-300 to-machine-silver";
    case "rust-copper":
      return "from-amber-600 via-amber-400 to-amber-600";
    default:
      return "from-gray-500 via-gray-400 to-gray-500";
  }
}

/** 主題 → 選中態呼吸光暈 rgba（供 shadow 使用，Supernova 模式下適度提高強度以在亮色背景中保持層次） */
const THEME_GLOW_RGB = {
  "king-gold": "212,175,55",
  "villain-purple": "75,0,130",
  "crown-red": "180,40,50",
  "tactical-emerald": "0,230,118",
  graphite: "60,60,65",
  "machine-silver": "224,224,224",
  "rust-copper": "184,115,51",
};

function getSelectedShadowStyle(theme) {
  const rgb = THEME_GLOW_RGB[theme] ?? "107,114,128";
  return { boxShadow: `0 0 24px rgba(${rgb},0.85)` };
}

/** 未選中：金屬漸層背景（多節點線性漸層模擬金屬反射，深-亮-極亮-亮-深） */
function getMetallicBackgroundStyle(theme) {
  const gradients = {
    "king-gold":
      "linear-gradient(135deg, #0f0d05 0%, #2a240c 45%, #5a4d1a 50%, #2a240c 55%, #0f0d05 100%)",
    "villain-purple":
      "linear-gradient(135deg, #0d0512 0%, #1a0d2e 45%, #3d1a6e 50%, #1a0d2e 55%, #0d0512 100%)",
    "crown-red":
      "linear-gradient(135deg, #150506 0%, #2a0c0e 45%, #5a1a1e 50%, #2a0c0e 55%, #150506 100%)",
    "tactical-emerald":
      "linear-gradient(135deg, #020d08 0%, #0d2a1a 45%, #1a5a3d 50%, #0d2a1a 55%, #020d08 100%)",
    graphite:
      "linear-gradient(135deg, #0a0a0b 0%, #1a1a1c 45%, #3d3d42 50%, #1a1a1c 55%, #0a0a0b 100%)",
    "machine-silver":
      "linear-gradient(135deg, #0d0d0d 0%, #1c1c1c 45%, #4a4a4a 50%, #1c1c1c 55%, #0d0d0d 100%)",
    "rust-copper":
      "linear-gradient(135deg, #0f0a05 0%, #2a1a0c 45%, #5a3d1a 50%, #2a1a0c 55%, #0f0a05 100%)",
  };
  const bg =
    gradients[theme] ??
    "linear-gradient(135deg, #0a0a0b 0%, #1a1a1c 45%, #3d3d42 50%, #1a1a1c 55%, #0a0a0b 100%)";
  return { backgroundImage: bg };
}

/** 未選中：僅文字/邊框/hover，背景由金屬漸層 style 注入 */
function getUnselectedCardClass(theme) {
  switch (theme) {
    case "king-gold":
      return "text-king-gold border border-king-gold/50 hover:bg-king-gold/20";
    case "villain-purple":
      return "text-villain-purple border border-villain-purple/50 hover:bg-villain-purple/20";
    case "crown-red":
      return "text-red-400 border border-red-500/50 hover:bg-red-500/20";
    case "tactical-emerald":
      return "text-tactical-emerald border border-tactical-emerald/60 hover:bg-tactical-emerald/20";
    case "graphite":
      return "text-gray-400 border border-gray-500 hover:bg-gray-600/30";
    case "machine-silver":
      return "text-machine-silver border border-machine-silver/50 hover:bg-machine-silver/20";
    case "rust-copper":
      return "text-amber-700 border border-amber-600/50 hover:bg-amber-600/20";
    default:
      return "text-gray-300 border border-gray-600";
  }
}

/** 選中態：深色漸層背景 + 文字對比色（設計意圖：厚重感、呼吸光暈由 style 注入） */
function getSelectedCardClass(theme) {
  switch (theme) {
    case "king-gold":
      return "stance-card-active text-black";
    case "villain-purple":
      return "stance-card-active text-white";
    case "crown-red":
      return "stance-card-active text-white";
    case "tactical-emerald":
      return "stance-card-active text-black";
    case "graphite":
      return "stance-card-active text-white";
    case "machine-silver":
      return "stance-card-active text-black";
    case "rust-copper":
      return "stance-card-active text-black";
    default:
      return "stance-card-active text-white";
  }
}

/**
 * @param {string | null} [selectedStance] - 當前選中的立場 value
 * @param {(value: string) => void} [onSelect] - 點擊卡片時回調
 * @param {boolean} [disabled] - 是否禁用點擊（如來賓模式僅開登入彈窗）
 * @param {boolean} [goatFlash] - 是否播放 GOAT 金閃動畫
 * @param {boolean} [fraudShatter] - 是否播放 FRAUD 紫碎動畫
 * @param {boolean} [animationsPaused] - Modal 遮罩主戰場時關閉邊框／呼吸動畫（省 WebView GPU）
 */
export default function StanceCards({
  selectedStance,
  onSelect,
  disabled,
  goatFlash = false,
  fraudShatter = false,
  animationsPaused = false,
}) {
  const rows = getStancesForArena();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 items-stretch">
      {rows.map(({ value, theme, primary, secondary }) => {
        const color = getStanceColor(value);
        const isSelected = selectedStance === value;
        const watermarkLetter = (primary && primary[0]) || value[0];
        const beamFlashActive =
          !animationsPaused &&
          ((value === "goat" && goatFlash) || (value === "fraud" && fraudShatter));
        const beamClass = animationsPaused
          ? ""
          : "animate-border-beam motion-reduce:animate-none";
        const beamFlashClass = beamFlashActive ? "animate-beam-flash" : "";

        return (
          <div
            key={value}
            className={`rounded-xl p-[1.5px] bg-gradient-to-r bg-beam bg-[length:200%_100%] transition-opacity duration-300 ${beamClass} ${getBeamGradientClass(
              theme
            )} ${isSelected ? "opacity-100" : "opacity-70"} ${beamFlashClass}`}
          >
            <motion.button
              type="button"
              onClick={() => !disabled && onSelect?.(value)}
              disabled={disabled}
              aria-pressed={isSelected}
              aria-label={`${primary}: ${secondary}`}
              whileHover={disabled ? undefined : { scale: 1.02 }}
              whileTap={disabled ? undefined : { scale: 0.98 }}
              className={`relative min-h-[110px] rounded-[10px] text-left px-4 py-2.5 transition-colors flex flex-col items-start justify-end overflow-hidden disabled:cursor-not-allowed w-full ${
                isSelected
                  ? getSelectedCardClass(theme)
                  : `${animationsPaused ? "" : "animate-subtle-pulse motion-reduce:animate-none "} ${getUnselectedCardClass(theme)}`
              }`}
              style={
                isSelected
                  ? getSelectedShadowStyle(theme)
                  : getMetallicBackgroundStyle(theme)
              }
            >
              {/* 表面高光：未選中時斜向光線滑過金屬，在水印之上 */}
              {!isSelected && (
                <div
                  className="absolute inset-0 rounded-[10px] bg-gradient-to-tr from-transparent via-white/10 to-transparent pointer-events-none z-[1]"
                  aria-hidden
                />
              )}
              {/* 背景水印：金屬材質下更清晰（opacity 0.1） */}
              <span
                className="absolute right-[-5%] bottom-[-5%] text-7xl sm:text-8xl lg:text-9xl font-black opacity-[0.1] italic pointer-events-none select-none z-0"
                style={{ color }}
                aria-hidden
              >
                {watermarkLetter.toUpperCase()}
              </span>
              {value === "goat" && goatFlash && (
                <motion.span
                  className="absolute inset-0 z-[2] rounded-[10px] bg-king-gold pointer-events-none"
                  initial={{ opacity: 0.8, scale: 0.8 }}
                  animate={{ opacity: 0, scale: 1.5 }}
                  transition={{ duration: 0.5 }}
                  style={{ boxShadow: "0 0 24px rgba(212,175,55,0.8)" }}
                />
              )}
              {value === "fraud" && fraudShatter && (
                <motion.span
                  className="absolute inset-0 z-[2] rounded-[10px] bg-villain-purple pointer-events-none"
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
                className="relative z-10 min-w-0 font-black uppercase tracking-tighter leading-tight text-[clamp(1rem,4vw,1.5rem)] [overflow-wrap:anywhere] drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"
                style={isSelected ? undefined : { color }}
              >
                {primary}
              </span>
              <span
                className="relative z-10 min-w-0 text-[9px] sm:text-[10px] font-normal opacity-90 mt-0.5 [overflow-wrap:anywhere]"
                style={isSelected ? undefined : { color }}
              >
                {secondary}
              </span>
            </motion.button>
          </div>
        );
      })}
    </div>
  );
}
