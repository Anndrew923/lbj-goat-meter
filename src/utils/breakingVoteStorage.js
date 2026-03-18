/**
 * 突發戰區投票狀態持久化 — 單一來源，供 BreakingVoteContext 與 useGlobalBreakingEvents 共用
 * 確保 localStorage key 與 TTL 一致，避免跨頁／返回首頁時狀態不同步。
 */
export const STORAGE_KEY_VOTED = 'lbj_breaking_voted'
export const STORAGE_KEY_LAST_VOTED = 'lbj_breaking_last_voted'
export const LAST_VOTED_TTL_MS = 60 * 1000

export function loadVotedEventIds() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY_VOTED) : null
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function saveVotedEventIds(ids) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_VOTED, JSON.stringify(ids))
    }
  } catch {
    // ignore
  }
}

export function loadLastVoted() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY_LAST_VOTED)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.eventId !== 'string' ||
      typeof parsed.optionIndex !== 'number' ||
      typeof parsed.timestamp !== 'number'
    ) {
      return null
    }
    const now = Date.now()
    if (now - parsed.timestamp > LAST_VOTED_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY_LAST_VOTED)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveLastVoted(payload) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY_LAST_VOTED, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function clearLastVoted() {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(STORAGE_KEY_LAST_VOTED)
  } catch {
    // ignore
  }
}

/** 僅讀 eventId（無 TTL），供 useGlobalBreakingEvents 補正用 */
export function loadLastVotedSafe() {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(STORAGE_KEY_LAST_VOTED)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.eventId !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}
