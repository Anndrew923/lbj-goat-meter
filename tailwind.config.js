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
      },
      animation: {
        'border-blink': 'border-blink 1.5s ease-in-out infinite',
        marquee: 'marquee 40s linear infinite',
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
