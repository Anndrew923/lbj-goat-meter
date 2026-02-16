/**
 * SmartWarzoneSelector — 智能戰區搜尋選單
 * Headless UI Combobox + 頂部搜尋框、中英雙軌過濾、無障礙與鍵盤操作、毛玻璃與自定義捲軸。
 */
import { useState, useMemo, useDeferredValue, useRef, useEffect } from 'react'
import { Combobox, ComboboxButton, ComboboxOptions, ComboboxOption } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import { getCountryOptions, POPULAR_COUNTRY_CODES } from '../data/countries'

/** 選單開啟時自動聚焦的搜尋輸入框（在 ComboboxOptions 內 mount 時聚焦） */
function SearchInput({ value, onChange, placeholder, ariaLabel, inputRef }) {
  useEffect(() => {
    if (inputRef?.current) inputRef.current.focus()
  }, [inputRef])
  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full px-3 py-2 rounded-md bg-gray-800 text-white border border-gray-600 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none placeholder-gray-500 text-sm"
    />
  )
}

/** 熱門國家代碼 → 拼音（中文模式前綴搜尋，如 "t" 對應台灣）；其餘國家僅用 label 匹配 */
const COUNTRY_PINYIN = {
  TW: 'taiwan',
  US: 'meiguo',
  JP: 'riben',
  KR: 'hanguo',
  CN: 'zhongguo',
  HK: 'xianggang',
  CA: 'jianada',
  AU: 'aozhou',
  PH: 'feilvbin',
}

function getOptionKey(value) {
  return `country_${value}`
}

/** 英文：前綴搜尋（prefix），不區分大小寫 */
function matchEnglishPrefix(label, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return String(label ?? '').toLowerCase().startsWith(q)
}

/** 中文：模糊搜尋（label 含關鍵字）+ 拼音前綴（例如 "t" 可匹配 台灣 taiwan） */
function matchChinese(label, pinyin, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const safeLabel = String(label ?? '')
  if (safeLabel.includes(q)) return true
  if (pinyin && typeof pinyin === 'string' && pinyin.toLowerCase().startsWith(q)) return true
  return false
}

/** 將 label 中與 query 匹配的片段用高亮 span 包起來（#FFD700） */
function highlightMatch(label, query, isEnglish) {
  const safeLabel = String(label ?? '')
  const q = (query || '').trim()
  if (!q) return safeLabel
  const lowerLabel = safeLabel.toLowerCase()
  const lowerQ = q.toLowerCase()
  const idx = isEnglish
    ? (lowerLabel.startsWith(lowerQ) ? 0 : -1)
    : lowerLabel.indexOf(lowerQ)
  if (idx >= 0) {
    const before = safeLabel.slice(0, idx)
    const match = safeLabel.slice(idx, idx + q.length)
    const after = safeLabel.slice(idx + q.length)
    return (
      <>
        {before}
        <span style={{ color: '#FFD700' }}>{match}</span>
        {after}
      </>
    )
  }
  return safeLabel
}

/**
 * @param {Object} props
 * @param {string} [props.value] - 目前選中的國家代碼（如 'TW'）
 * @param {(value: string) => void} props.onChange - 選中時回呼
 * @param {{ value: string, label?: string }[]} [props.options] - 選項列表，未傳則用 getCountryOptions(lang) 全球名單
 * @param {(value: string) => string} [props.getOptionKey] - 依 value 回傳 i18n key，預設 country_${value}
 * @param {boolean} [props.disabled]
 * @param {string} [props['aria-label']]
 */
export default function SmartWarzoneSelector({
  value,
  onChange,
  options: optionsProp,
  getOptionKey: getKey = getOptionKey,
  disabled,
  'aria-label': ariaLabel,
}) {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language || 'zh-TW'
  const isZh = language.startsWith('zh')

  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const searchInputRef = useRef(null)

  const options = useMemo(() => {
    const list = optionsProp || getCountryOptions(language)
    const withLabel = list.map((o) => ({
      ...o,
      label: typeof o.label === 'string' ? o.label : t(getKey(o.value)),
    }))
    const sorted = [...withLabel].sort((a, b) => {
      const ai = POPULAR_COUNTRY_CODES.indexOf(a.value)
      const bi = POPULAR_COUNTRY_CODES.indexOf(b.value)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return String(a.label || '').localeCompare(String(b.label || ''), isZh ? 'zh-Hans' : 'en')
    })
    return sorted
  }, [optionsProp, language, t, getKey, isZh])

  const filteredOptions = useMemo(() => {
    if (!deferredQuery.trim()) return options
    return options.filter((opt) => {
      const label = typeof opt.label === 'string' ? opt.label : ''
      const pinyin = COUNTRY_PINYIN[opt.value]
      if (isZh) return matchChinese(label, pinyin, deferredQuery)
      return matchEnglishPrefix(label, deferredQuery)
    })
  }, [options, deferredQuery, isZh])

  const selectedOption = options.find((o) => o.value === value)
  const displayLabel = selectedOption ? selectedOption.label : ''

  const comboboxValue = value === '' || value == null ? undefined : value

  return (
    <Combobox
      value={comboboxValue}
      onChange={(v) => {
        onChange(v ?? '')
        setQuery('')
      }}
      disabled={disabled}
    >
      <div className="relative">
        <ComboboxButton
          className="w-full px-3 py-2 rounded-lg bg-gray-800 text-white border border-gray-600 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none text-left flex items-center justify-between"
          aria-label={ariaLabel || t('countryLabel')}
        >
          <span className={!displayLabel ? 'text-gray-500' : ''}>
            {displayLabel || t('pleaseSelect')}
          </span>
          <span className="pointer-events-none ml-2 shrink-0" aria-hidden>
            ▼
          </span>
        </ComboboxButton>

        {/* Portal：選單渲染到 body，固定置中於螢幕；外層 pointer-events-none，僅面板可點，點選單外可關閉 */}
        <ComboboxOptions
          portal
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none"
        >
          {/* 遮罩僅視覺，不攔截點擊（pointer-events-none 由父層繼承） */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] pointer-events-none" aria-hidden />
          <div
            className="relative z-10 pointer-events-auto w-full min-w-[280px] max-w-[90vw] rounded-xl border border-king-gold/30 overflow-hidden shadow-2xl"
            style={{
              maxHeight: '40vh',
              background: 'rgba(15, 15, 20, 0.95)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div className="p-2 border-b border-gray-600/50 sticky top-0 bg-gray-900/80 backdrop-blur-sm z-10">
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder={t('countrySearchPlaceholder')}
                ariaLabel={t('countrySearchPlaceholder')}
                inputRef={searchInputRef}
              />
            </div>
            <div
              className="overflow-y-auto overflow-x-hidden warzone-selector-list"
              style={{ maxHeight: 'calc(40vh - 52px)' }}
            >
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-4 text-center text-gray-400 text-sm" role="status">
                  {t('countryNoResults')}
                </div>
              ) : (
                filteredOptions.map((opt) => (
                  <ComboboxOption
                    key={opt.value}
                    value={opt.value}
                    className="px-3 py-2.5 text-sm text-gray-200 cursor-pointer hover:bg-king-gold/20 focus:bg-king-gold/20 focus:outline-none data-[selected]:bg-king-gold/30 data-[selected]:text-king-gold"
                  >
                    {highlightMatch(opt.label || '', deferredQuery, !isZh)}
                  </ComboboxOption>
                ))
              )}
            </div>
          </div>
        </ComboboxOptions>
      </div>
    </Combobox>
  )
}
