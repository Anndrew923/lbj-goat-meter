/**
 * 地理定位 — 戰區登錄與投票用。
 * 優先使用瀏覽器原生 geolocation 取得經緯度，再以反向地理編碼取得國家／城市；
 * 若用戶拒絕權限或失敗，則備援使用 ip-api.com。
 */

const IP_API_URL = 'https://ip-api.com/json/?fields=status,countryCode,city,country'
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse'
// Nominatim 使用政策要求提供識別應用程式的 User-Agent
const NOMINATIM_UA = 'GOATMeterLBJ/1.0 (Geolocation for profile setup)'

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
 * 取得當前位置：優先 navigator.geolocation → 反向地理編碼；備援 ip-api。
 * @returns {Promise<{ country: string, city: string, coords?: { lat: number, lng: number }, source: 'geolocation' | 'ip' } | null>}
 */
export async function getLocation() {
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
      // 坐標已鎖定但反向編碼失敗時仍回傳坐標，國家由備援或手選補齊
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
  return null
}

/**
 * 備援：僅依 IP 取得國家／城市（無經緯度）。
 * @returns {Promise<{ country: string, city: string } | null>}
 */
export async function fetchLocationByIP() {
  try {
    const res = await fetch(IP_API_URL, { signal: AbortSignal.timeout(5000) })
    const data = await res.json()
    if (data?.status !== 'success' || !data.countryCode) return null
    return {
      country: data.countryCode,
      city: data.city ?? '',
    }
  } catch {
    return null
  }
}
