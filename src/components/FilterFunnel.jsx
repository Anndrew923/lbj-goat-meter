/**
 * FilterFunnel — 多維度篩選抽屜（精密儀器感）
 * 提供 ageGroup、gender、voterTeam、city 的組合，並將選擇傳給父層以連動 useSentimentData。
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SlidersHorizontal, X } from 'lucide-react'
import { AGE_GROUPS, GENDERS, TEAMS } from '../lib/constants'

const defaultFilters = {
  ageGroup: '',
  gender: '',
  team: '',
  city: '',
}

export default function FilterFunnel({ open, onClose, filters: controlledFilters, onFiltersChange }) {
  const isControlled = controlledFilters != null && onFiltersChange != null
  const [localFilters, setLocalFilters] = useState(defaultFilters)
  const filters = isControlled ? controlledFilters : localFilters
  const setFilters = isControlled ? onFiltersChange : setLocalFilters

  const update = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const clearAll = () => setFilters({ ...defaultFilters })

  const hasAny = Object.values(filters).some((v) => v != null && String(v).trim() !== '')

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm border-l border-villain-purple/40 bg-gray-950 shadow-2xl"
              role="dialog"
              aria-label="多維度篩選"
            >
              <div className="flex items-center justify-between border-b border-villain-purple/30 px-4 py-3">
                <div className="flex items-center gap-2 text-king-gold">
                  <SlidersHorizontal className="w-5 h-5" aria-hidden />
                  <h2 className="font-bold">篩選儀表</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-white rounded-lg"
                  aria-label="關閉"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-5 overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">年齡組別</label>
                  <div className="flex flex-wrap gap-2">
                    {AGE_GROUPS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('ageGroup', filters.ageGroup === value ? '' : value)}
                        className={`px-3 py-1.5 rounded-md text-sm ${
                          filters.ageGroup === value
                            ? 'bg-king-gold/20 text-king-gold border border-king-gold/50'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">性別</label>
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('gender', filters.gender === value ? '' : value)}
                        className={`px-3 py-1.5 rounded-md text-sm ${
                          filters.gender === value
                            ? 'bg-villain-purple/20 text-villain-purple border border-villain-purple/50'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">效忠球隊</label>
                  <select
                    value={filters.team ?? ''}
                    onChange={(e) => update('team', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none"
                    aria-label="選擇球隊"
                  >
                    <option value="">全部</option>
                    {TEAMS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">城市</label>
                  <input
                    type="text"
                    value={filters.city ?? ''}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder="輸入城市名稱"
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none"
                    aria-label="城市"
                  />
                </div>
                {hasAny && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg"
                  >
                    清除全部
                  </button>
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
