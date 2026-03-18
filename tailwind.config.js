/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    "bg-tactical-emerald",
    "text-tactical-emerald",
    "border-tactical-emerald",
    "shadow-tactical-emerald/50",
    "border-tactical-emerald/60",
    "hover:bg-tactical-emerald/20",
    // 跑馬燈：確保 JIT 一定會產出，避免本地未掃到而無動畫
    "animate-marquee",
    "motion-reduce:animate-none",
    // StanceCards 立場專屬流光漸層（Border Beam）
    "from-king-gold",
    "via-red-500",
    "to-king-gold",
    "from-villain-purple",
    "via-indigo-500",
    "to-villain-purple",
    "from-tactical-emerald",
    "via-cyan-400",
    "to-tactical-emerald",
    "from-red-600",
    "via-red-400",
    "to-red-600",
    "from-gray-500",
    "via-gray-400",
    "to-gray-500",
    "from-machine-silver",
    "via-gray-300",
    "to-machine-silver",
    "from-amber-600",
    "via-amber-400",
    "to-amber-600",
    "animate-beam-flash",
    "animate-subtle-pulse",
    "drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]",
    "animate-aura-epic",
    "animate-energy-flow",
  ],
  theme: {
    extend: {
      fontFamily: {
        secondary: ['"Rajdhani"', 'sans-serif'],
      },
      keyframes: {
        'border-blink': {
          '0%, 100%': { borderColor: 'rgb(212 175 55 / 0.95)', boxShadow: '0 0 12px rgb(212 175 55 / 0.4)' },
          '50%': { borderColor: 'rgb(212 175 55 / 0.35)', boxShadow: '0 0 8px rgb(212 175 55 / 0.15)' },
        },
        /* 跑馬燈：僅用 translateX，GPU 加速、無縫接軌 */
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        // AnalystGate：玻璃擬態掃描條，自上而下緩慢掃描卡片
        'gate-scan': {
          '0%': { transform: 'translateY(-110%)', opacity: '0' },
          '10%': { opacity: '0.75' },
          '90%': { opacity: '0.75' },
          '100%': { transform: 'translateY(110%)', opacity: '0' },
        },
        // 情報能量 HUD：扣點時短暫放大並帶金色光暈
        'intel-ping': {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 0 rgba(212,175,55,0.0)', borderColor: 'rgba(148,163,184,0.5)' },
          '40%': { transform: 'scale(1.1)', boxShadow: '0 0 18px rgba(212,175,55,0.65)', borderColor: 'rgba(212,175,55,0.9)' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 0 rgba(212,175,55,0.0)', borderColor: 'rgba(148,163,184,0.5)' },
        },
        /* 突發橫幅：邊框漸層流光（Border Beam） */
        'border-beam': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        /* 史詩級視覺：邊框閃爍、呼吸縮放、背景流動（務必保留） */
        'beam-flash': {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '25%': { opacity: '1', filter: 'brightness(2)' },
          '50%': { opacity: '0.6', filter: 'brightness(1.5)' },
          '75%': { opacity: '1', filter: 'brightness(2)' },
        },
        'subtle-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.015)' },
        },
        'energy-flow': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        /* 歷史分頁：水平掃描線，進入時播放 1 秒，自左至右掃過容器 */
        'scanning-line': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(500%)' },
        },
        /* 主投票區塊：史詩級背景光暈 — 緩慢旋轉 + 呼吸 */
        'aura-rotate': {
          '0%': { transform: 'translate(-50%, -50%) rotate(0deg)' },
          '100%': { transform: 'translate(-50%, -50%) rotate(360deg)' },
        },
        'aura-breathe': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
      },
      animation: {
        'border-blink': 'border-blink 1.5s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
        'gate-scan': 'gate-scan 2.6s linear infinite',
        'intel-ping': 'intel-ping 0.45s ease-out',
        'border-beam': 'border-beam 2.5s linear infinite',
        /* 史詩級視覺動畫（務必保留） */
        'beam-flash': 'beam-flash 0.5s ease-out',
        'subtle-pulse': 'subtle-pulse 3s ease-in-out infinite',
        'energy-flow': 'energy-flow 10s ease infinite',
        'aura-epic': 'aura-rotate 20s linear infinite, aura-breathe 8s ease-in-out infinite',
        'scanning-line': 'scanning-line 1s ease-out forwards',
      },
      backgroundSize: {
        'beam': '200% 100%',
      },
      colors: {
        // 暗黑競技風：粉方（金/紅）、黑方（紫/靛）；對抗版六立場視覺意圖
        'king-gold': 'rgb(212 175 55 / <alpha-value>)',
        'villain-purple': 'rgb(75 0 130 / <alpha-value>)',
        'crown-red': 'rgb(180 40 50 / <alpha-value>)',
        'graphite': 'rgb(60 60 65 / <alpha-value>)',
        'tactical-emerald': 'rgb(0 230 118 / <alpha-value>)',
        'machine-silver': 'rgb(224 224 224 / <alpha-value>)',
        'rust-copper': 'rgb(184 115 51 / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
