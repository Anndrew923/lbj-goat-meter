/**
 * PulseMap — 全球情緒熱力圖（/vote 視覺重心）
 * 依各國統計將區塊染成金色（粉方佔優）或紫色（黑方佔優）；點擊國家可更新 filters 並連動 AnalyticsDashboard。
 * 技術選用：react-simple-maps（SVG 輕量），地圖 import 打包，記憶化 Geographies、畫布比例鎖定、數據緩衝，消除抖動。
 */
import { Component, useMemo, useState, useCallback, useEffect, useRef, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { motion } from 'framer-motion'
import { useSentimentData } from '../hooks/useSentimentData'

/** 地圖 TopoJSON：放在 public/，開頭斜線指向根路徑 */
const GEO_URL = '/countries-110m.json'

/** 穩定空物件，避免 useSentimentData(filters) 每輪新 {} 導致 useEffect 依賴變動 → 無限更新 */
const EMPTY_SENTIMENT_FILTERS = {}

/** 畫布比例：與正式地圖一致，消除 Layout Shift */
const MAP_ASPECT = 'aspect-[2/1]'
const MAP_CONTAINER_CLASS = `w-full ${MAP_ASPECT} rounded-lg overflow-hidden bg-gray-800/90 border border-gray-600/50 min-h-0`

/** 地理資料載入前或載入失敗時的靜態網格底圖（與正式地圖容器尺寸一致） */
function MapStaticGrid({ messageKey = 'loadingMap' }) {
  const { t } = useTranslation('common')
  return (
    <div className="rounded-xl border border-villain-purple/30 bg-gray-900/80 overflow-hidden" role="status" aria-label={t(messageKey)}>
      <div className="px-4 py-2 border-b border-villain-purple/20 flex items-center justify-between">
        <div className="h-6 w-40 bg-gray-700/60 rounded animate-pulse" />
        <div className="h-3 w-32 bg-gray-700/40 rounded animate-pulse" />
      </div>
      <div className="p-2">
        <div className={MAP_CONTAINER_CLASS}>
          <svg viewBox="0 0 800 400" className="w-full h-full text-gray-600/70" aria-hidden="true">
            <defs>
              <pattern id="pulsemap-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.4" />
              </pattern>
              <linearGradient id="pulsemap-shade" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0.05" />
              </linearGradient>
            </defs>
            <rect width="800" height="400" fill="url(#pulsemap-grid)" />
            <rect width="800" height="400" fill="url(#pulsemap-shade)" />
            <ellipse cx="200" cy="180" rx="90" ry="70" fill="currentColor" fillOpacity="0.12" />
            <ellipse cx="520" cy="120" rx="80" ry="50" fill="currentColor" fillOpacity="0.1" />
            <ellipse cx="400" cy="280" rx="100" ry="60" fill="currentColor" fillOpacity="0.1" />
          </svg>
        </div>
        <p className="mt-2 text-center text-sm text-gray-400 animate-pulse">{t(messageKey)}</p>
      </div>
    </div>
  )
}

/** 捕獲地圖 fetch/渲染錯誤，顯示靜態網格避免崩潰 */
class MapErrorBoundary extends Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    if (this.state.hasError) return <MapStaticGrid messageKey="mapLoadError" />
    return this.props.children
  }
}

const PRO_STANCES = new Set(['goat', 'king', 'machine'])
const ANTI_STANCES = new Set(['fraud', 'stat_padder', 'mercenary'])

/** 依投票數據按國家彙總：pro 與 anti 票數，用於著色 */
function aggregateByCountry(data) {
  const byCountry = {}
  data.forEach((v) => {
    const cc = (v.country ?? '').toUpperCase().slice(0, 2)
    if (!cc) return
    if (!byCountry[cc]) byCountry[cc] = { pro: 0, anti: 0 }
    if (PRO_STANCES.has(v.status)) byCountry[cc].pro += 1
    else if (ANTI_STANCES.has(v.status)) byCountry[cc].anti += 1
  })
  return byCountry
}

/** world-atlas TopoJSON 的 id 多為數字，需對應至 ISO 代碼；此處用常見 2 碼對照（可擴充） */
const COUNTRY_ID_TO_ISO2 = {
  1: 'AF', 4: 'AO', 8: 'AL', 12: 'DZ', 20: 'AD', 24: 'AO', 28: 'AG', 32: 'AR', 36: 'AU', 40: 'AT', 48: 'BH', 50: 'BD', 52: 'BB', 56: 'BE', 64: 'BT', 68: 'BO', 70: 'BA', 72: 'BW', 76: 'BR', 84: 'BZ', 90: 'SB', 96: 'BN', 100: 'BG', 104: 'MM', 108: 'BI', 112: 'BY', 116: 'KH', 120: 'CM', 124: 'CA', 132: 'CV', 140: 'CF', 144: 'LK', 148: 'TD', 152: 'CL', 156: 'CN', 170: 'CO', 174: 'KM', 178: 'CG', 180: 'CD', 188: 'CR', 191: 'HR', 192: 'CU', 196: 'CY', 203: 'CZ', 204: 'BJ', 208: 'DK', 212: 'DM', 214: 'DO', 218: 'EC', 222: 'SV', 226: 'GQ', 231: 'ET', 232: 'ER', 233: 'EE', 234: 'FO', 242: 'FJ', 246: 'FI', 250: 'FR', 258: 'PF', 262: 'DJ', 266: 'GA', 268: 'GE', 270: 'GM', 275: 'PS', 276: 'DE', 288: 'GH', 296: 'KI', 300: 'GR', 308: 'GD', 316: 'GU', 320: 'GT', 324: 'GN', 328: 'GY', 332: 'HT', 336: 'VA', 340: 'HN', 348: 'HU', 352: 'IS', 356: 'IN', 360: 'ID', 368: 'IQ', 372: 'IE', 376: 'IL', 380: 'IT', 384: 'CI', 388: 'JM', 392: 'JP', 398: 'KZ', 400: 'JO', 404: 'KE', 408: 'KP', 410: 'KR', 414: 'KW', 417: 'KG', 418: 'LA', 422: 'LB', 426: 'LS', 428: 'LV', 430: 'LR', 434: 'LY', 438: 'LI', 440: 'LT', 442: 'LU', 450: 'MG', 454: 'MW', 458: 'MY', 462: 'MV', 466: 'ML', 470: 'MT', 478: 'MR', 480: 'MU', 484: 'MX', 492: 'MC', 496: 'MN', 498: 'MD', 499: 'ME', 504: 'MA', 508: 'MZ', 516: 'NA', 520: 'NR', 524: 'NP', 528: 'NL', 554: 'NZ', 558: 'NI', 562: 'NE', 566: 'NG', 578: 'NO', 583: 'FM', 584: 'MH', 585: 'PW', 586: 'PK', 591: 'PA', 598: 'PG', 600: 'PY', 604: 'PE', 608: 'PH', 616: 'PL', 620: 'PT', 624: 'GW', 626: 'TL', 634: 'QA', 642: 'RO', 643: 'RU', 646: 'RW', 682: 'SA', 686: 'SN', 688: 'RS', 690: 'SC', 694: 'SL', 702: 'SG', 703: 'SK', 704: 'VN', 705: 'SI', 706: 'SO', 710: 'ZA', 728: 'SS', 729: 'SD', 740: 'SR', 748: 'SZ', 752: 'SE', 756: 'CH', 760: 'SY', 762: 'TJ', 764: 'TH', 768: 'TG', 776: 'TO', 780: 'TT', 784: 'AE', 788: 'TN', 795: 'TM', 798: 'TV', 800: 'UG', 804: 'UA', 807: 'MK', 818: 'EG', 826: 'GB', 834: 'TZ', 840: 'US', 854: 'BF', 858: 'UY', 860: 'UZ', 862: 'VE', 882: 'WS', 887: 'YE', 894: 'ZM', 716: 'ZW',   158: 'TW', 702: 'SG', 704: 'VN', 764: 'TH', 608: 'PH', 410: 'KR', 392: 'JP', 156: 'CN', 344: 'HK', 446: 'MO',
}

function getIso2FromGeo(geography) {
  const props = geography?.properties
  const iso2 = props?.ISO_A2 ?? props?.iso_a2 ?? props?.ISO_A2_EH
  if (iso2 && typeof iso2 === 'string') return iso2.slice(0, 2).toUpperCase()
  const id = geography?.id
  if (id == null) return null
  if (typeof id === 'string' && id.length === 2) return id.toUpperCase()
  return COUNTRY_ID_TO_ISO2[id] ?? null
}

/** 穩定 key：優先 geo.rsmKey / geo.id / iso2；最後才用 fallbackIndex 避免重複 key */
function getGeoKey(geo, iso2, fallbackIndex = 0) {
  if (geo?.rsmKey != null) return String(geo.rsmKey)
  if (geo?.id != null) return String(geo.id)
  if (iso2) return `iso-${iso2}`
  const p = geo?.properties
  const name = p?.name ?? p?.NAME ?? p?.ISO_A2
  return name != null ? `geo-${String(name)}` : `geo-unknown-${fallbackIndex}`
}

/** 記憶化地球路徑：除非 geographies / byCountry / selectedCountry / hovered 變更，否則不重算 */
const MemoizedMapPaths = memo(function MemoizedMapPaths({
  geographies,
  byCountry,
  selectedCountry,
  hovered,
  setHovered,
  onFiltersChange,
}) {
  const paths = useMemo(() => {
    const list = geographies ?? []
    return list.map((geo, index) => {
      const iso2 = getIso2FromGeo(geo)
      const isSelected = iso2 && selectedCountry === iso2
      const isHovered = hovered === iso2
      let base = 'rgba(55,65,81,0.6)'
      if (iso2 && byCountry[iso2]) {
        const stats = byCountry[iso2]
        if (stats.pro > 0 || stats.anti > 0) {
          const total = stats.pro + stats.anti
          const proRatio = stats.pro / total
          if (proRatio > 0.55) base = 'rgba(212,175,55,0.85)'
          else if (proRatio < 0.45) base = 'rgba(75,0,130,0.85)'
          else base = 'rgba(107,114,128,0.8)'
        }
      } else if (!iso2) base = 'rgba(55,65,81,0.8)'
      const fill = (isHovered || isSelected) ? base.replace(/0\.\d+\)/, '1)') : base
      return (
        <Geography
          key={getGeoKey(geo, iso2, index)}
          geography={geo}
          fill={fill}
          stroke="rgba(30,30,30,0.8)"
          strokeWidth={isSelected ? 1.5 : 0.5}
          style={{
            default: { outline: 'none' },
            hover: { outline: 'none', cursor: onFiltersChange ? 'pointer' : 'default' },
            pressed: { outline: 'none' },
          }}
          onMouseEnter={() => setHovered(iso2)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => { if (iso2 && onFiltersChange) onFiltersChange((prev) => ({ ...prev, country: iso2 })) }}
        />
      )
    })
  }, [geographies, byCountry, selectedCountry, hovered, onFiltersChange, setHovered])
  return paths
})

const SENTIMENT_UPDATE_DELAY_MS = 120

export default function PulseMap({ filters, onFiltersChange }) {
  const { t } = useTranslation('common')
  const { data, loading, error } = useSentimentData(EMPTY_SENTIMENT_FILTERS, { pageSize: 800 })
  const [hovered, setHovered] = useState(null)
  const [bufferedData, setBufferedData] = useState([])
  const delayRef = useRef(null)

  // 緩衝 Firestore 高頻推送：僅在停止更新約 120ms 後才寫入，減少地圖重繪
  useEffect(() => {
    if (loading || error) {
      setBufferedData([])
      if (delayRef.current) clearTimeout(delayRef.current)
      return
    }
    const id = setTimeout(() => {
      setBufferedData(data)
      delayRef.current = null
    }, SENTIMENT_UPDATE_DELAY_MS)
    delayRef.current = id
    return () => clearTimeout(id)
  }, [data, loading, error])

  const byCountry = useMemo(
    () => aggregateByCountry(bufferedData ?? []),
    [bufferedData]
  )
  const selectedCountry = filters?.country ?? null
  const setHoveredStable = useCallback((v) => setHovered(v), [])

  // 錯誤時仍用靜態網格；loading 時不卸載地圖，改為遮罩＋轉圈
  if (error) return <MapStaticGrid messageKey="mapLoadError" />

  return (
    <MapErrorBoundary>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-xl border border-villain-purple/30 bg-gray-900/80 overflow-hidden"
    >
      <div className="px-4 py-2 border-b border-villain-purple/20 flex items-center justify-between">
        <h3 className="text-lg font-bold text-king-gold">{t('globalSentimentMap')}</h3>
        <p className="text-xs text-gray-500">{t('mapLegend')}</p>
      </div>
      <div className="p-2">
        <div className={`${MAP_CONTAINER_CLASS} relative`}>
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{ scale: 120, center: [20, 20] }}
            width={800}
            height={400}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={GEO_URL}>
              {({ geographies }) => (
                <MemoizedMapPaths
                  geographies={geographies}
                  byCountry={byCountry}
                  selectedCountry={selectedCountry}
                  hovered={hovered}
                  setHovered={setHoveredStable}
                  onFiltersChange={onFiltersChange}
                />
              )}
            </Geographies>
          </ComposableMap>
          {loading && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-gray-900/70 rounded-lg pointer-events-none"
              role="status"
              aria-label={t('loadingMap')}
            >
              <div className="w-10 h-10 border-2 border-king-gold/60 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </motion.div>
    </MapErrorBoundary>
  )
}
