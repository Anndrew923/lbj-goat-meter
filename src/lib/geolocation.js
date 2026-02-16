/**
 * 地理定位 — 戰區登錄與投票用。
 * 優先使用瀏覽器原生 geolocation 取得經緯度，再以反向地理編碼取得國家／城市；
 * 若用戶拒絕權限或失敗，則備援使用 IP 定位（多源 + 預設座標，避免單一 API 403 導致卡死）。
 */

const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'
// Nominatim 使用政策要求提供識別應用程式的 User-Agent
const NOMINATIM_UA = 'GOATMeterLBJ/1.0 (Geolocation for profile setup)'

/** 預設中心（台北）：當所有定位方式皆失敗時使用，確保地圖與表單仍可運作 */
export const DEFAULT_COORDS = { lat: 25.033, lng: 121.565 }
export const DEFAULT_COUNTRY = 'TW'
export const DEFAULT_CITY = 'Taipei'

/** IP 定位 API 列表：依序嘗試；任一 403 即不再嘗試其他源，直接回傳 null 由上層用預設座標。 */
const IP_API_SOURCES = [
  { url: 'https://ipapi.co/json/', parse: (d) => (d?.country_code ? { country: d.country_code, city: d.city ?? '' } : null) },
  { url: 'https://ip-api.com/json/?fields=status,countryCode,city,country', parse: (d) => (d?.status === 'success' && d?.countryCode ? { country: d.countryCode, city: d.city ?? '' } : null) },
]

/**
 * 以經緯度反向地理編碼取得國家代碼與城市（Nominatim，免 Key）。
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<{ country: string, city: string } | null>}
 */
async function reverseGeocode(lat, lon) {
  try {
    const url = `${NOMINATIM_REVERSE}?lat=${lat}&lon=${lon}&format=json`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { Accept: 'application/json', 'User-Agent': NOMINATIM_UA },
    })
    const data = await res.json()
    const cc = data?.address?.country_code?.toUpperCase()
    if (!cc) return null
    return {
      country: cc.length === 2 ? cc : cc.slice(0, 2),
      city: data?.address?.city ?? data?.address?.town ?? data?.address?.village ?? '',
    }
  } catch {
    return null
  }
}

/**
 * 取得當前位置：優先 navigator.geolocation → 反向地理編碼；備援 IP 多源；失敗則安靜降級為預設座標（不拋錯）。
 * @returns {Promise<{ country: string, city: string, coords?: { lat: number, lng: number }, source: 'geolocation' | 'ip' }>}
 */
export async function getLocation() {
  try {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            timeout: 10000,
            maximumAge: 300000,
            enableHighAccuracy: true,
          })
        })
        const { latitude: lat, longitude: lng } = position.coords
        const address = await reverseGeocode(lat, lng)
        if (address) {
          return {
            ...address,
            coords: { lat, lng },
            source: 'geolocation',
          }
        }
        return {
          country: '',
          city: '',
          coords: { lat, lng },
          source: 'geolocation',
        }
      } catch {
        // 用戶拒絕或超時：走備援
      }
    }

    const ipResult = await fetchLocationByIP()
    if (ipResult) {
      return { ...ipResult, source: 'ip' }
    }
  } catch {
    // 定位 API 403 或任何異常：安靜降級，不拋出，避免頁面崩潰
  }
  return {
    country: DEFAULT_COUNTRY,
    city: DEFAULT_CITY,
    coords: { ...DEFAULT_COORDS },
    source: 'ip',
  }
}

/** 是否為 localhost（開發環境常遇 CORS / 429，直接跳過 IP 請求避免控制台刷錯） */
function isLocalhost() {
  if (typeof window === 'undefined') return false
  const host = window.location?.hostname ?? ''
  return host === 'localhost' || host === '127.0.0.1' || host === ''
}

/**
 * 備援：依 IP 取得國家／城市（多源嘗試，避免單一 API 403 導致失敗）。
 * 在 localhost 不請求，直接回傳 null，由上層使用預設值，避免 CORS/429/403 刷屏。
 * @returns {Promise<{ country: string, city: string } | null>}
 */
export async function fetchLocationByIP() {
  if (isLocalhost()) return null
  for (const { url, parse } of IP_API_SOURCES) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.status === 403) return null
      if (res.status === 429 || !res.ok) continue
      const data = await res.json()
      const parsed = parse(data)
      if (parsed) return parsed
    } catch {
      // CORS、網路或解析錯誤，嘗試下一源
    }
  }
  return null
}
