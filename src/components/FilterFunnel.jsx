/**
 * FilterFunnel — 多維度篩選抽屜（精密儀器感）
 * 提供 ageGroup、gender、voterTeam、city 的組合，並將選擇傳給父層以連動 useSentimentData。
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { SlidersHorizontal, X } from 'lucide-react'
import { AGE_GROUPS, GENDERS, TEAMS } from '../lib/constants'

const defaultFilters = {
  ageGroup: '',
  gender: '',
  team: '',
  city: '',
}

function getOptionKey(type, value) {
  if (type === 'ageGroup') return value === '45+' ? 'ageGroup_45_plus' : `ageGroup_${value.replace(/-/g, '_')}`
  if (type === 'gender') return `gender_${value}`
  if (type === 'team') return `team_${value}`
  return value
}

export default function FilterFunnel({ open, onClose, filters: controlledFilters, onFiltersChange }) {
  const { t } = useTranslation('common')
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
              aria-label={t('filterDrawerAria')}
            >
              <div className="flex items-center justify-between border-b border-villain-purple/30 px-4 py-3">
                <div className="flex items-center gap-2 text-king-gold">
                  <SlidersHorizontal className="w-5 h-5" aria-hidden />
                  <h2 className="font-bold">{t('filterPanelTitle')}</h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-white rounded-lg"
                  aria-label={t('close')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 space-y-5 overflow-y-auto">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{t('ageGroupLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {AGE_GROUPS.map(({ value }) => (
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
                        {t(getOptionKey('ageGroup', value))}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{t('genderLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map(({ value }) => (
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
                        {t(getOptionKey('gender', value))}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{t('teamLabel')}</label>
                  <select
                    value={filters.team ?? ''}
                    onChange={(e) => update('team', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none"
                    aria-label={t('selectTeam')}
                  >
                    <option value="">{t('all')}</option>
                    {TEAMS.map(({ value }) => (
                      <option key={value} value={value}>{t(getOptionKey('team', value))}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">{t('cityLabel')}</label>
                  <input
                    type="text"
                    value={filters.city ?? ''}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder={t('cityPlaceholder')}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm placeholder-gray-500 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none"
                    aria-label={t('cityLabel')}
                  />
                </div>
                {hasAny && (
                  <button
                    type="button"
                    onClick={clearAll}
                    className="w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg"
                  >
                    {t('clearAll')}
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
