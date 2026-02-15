/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 暗黑競技風：粉方（金/紅）、黑方（紫/靛）；對抗版六立場視覺意圖
        'king-gold': 'rgb(212 175 55 / <alpha-value>)',
        'villain-purple': 'rgb(75 0 130 / <alpha-value>)',
        'crown-red': 'rgb(180 40 50 / <alpha-value>)',
        'graphite': 'rgb(60 60 65 / <alpha-value>)',
        'machine-silver': 'rgb(192 192 200 / <alpha-value>)',
        'rust-copper': 'rgb(184 115 51 / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
