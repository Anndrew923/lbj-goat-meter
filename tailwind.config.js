/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 暗黑競技風：粉方（金/紅）、黑方（紫/靛）；使用 RGB 以支援 opacity 修飾（如 villain-purple/80）
        'king-gold': 'rgb(212 175 55 / <alpha-value>)',
        'villain-purple': 'rgb(75 0 130 / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
