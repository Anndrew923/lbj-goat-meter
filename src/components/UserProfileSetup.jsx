/**
 * UserProfileSetup — 戰區登錄兩步驟 Modal
 * Step 1：身分定義（年齡組別、性別）
 * Step 2：派系效忠（支持的球隊，以城市+代表色暗示）+ 地理（國家，IP 預填或手選）
 * 寫入 Firestore profiles 集合，與 docs/SCHEMA.md 對齊。
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getLocation } from '../lib/geolocation'
import { AGE_GROUPS, GENDERS, TEAMS, getTeamCityKey } from '../lib/constants'
import { getCountryOptions } from '../data/countries'
import SmartWarzoneSelector from './SmartWarzoneSelector'

function getOptionKey(type, value) {
  if (type === 'ageGroup') return value === '45+' ? 'ageGroup_45_plus' : `ageGroup_${value.replace(/-/g, '_')}`
  if (type === 'gender') return `gender_${value}`
  if (type === 'team') return getTeamCityKey(value)
  if (type === 'country') return `country_${value}`
  return value
}

const STAR_ID = 'lbj'

const INITIAL_FORM = {
  ageGroup: '',
  gender: '',
  voterTeam: '',
  country: '',
  city: '',
}

export default function UserProfileSetup({ open, onClose, userId, onSaved, initialStep = 1, initialProfile }) {
  const { t, i18n } = useTranslation('common')
  const [step, setStep] = useState(initialStep)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [form, setForm] = useState({
    ...INITIAL_FORM,
  })
  const [geoLoading, setGeoLoading] = useState(true)
  const [locationSource, setLocationSource] = useState(null) // 'geolocation' | 'ip' | null

  // 僅在 open 變為 true 時初始化 step/form，避免 initialProfile 參考變動時重置表單；有 initialProfile 時預填全部欄位
  useEffect(() => {
    if (!open) return
    const stepVal = initialStep ?? 1
    setStep(stepVal)
    const base = { ...INITIAL_FORM }
    if (initialProfile) {
      base.ageGroup = initialProfile.ageGroup ?? ''
      base.gender = initialProfile.gender ?? ''
      base.voterTeam = initialProfile.voterTeam ?? ''
      base.country = initialProfile.country ?? ''
      base.city = initialProfile.city ?? ''
    }
    setForm(base)
    setGeoLoading(true)
    setLocationSource(null)
    getLocation()
      .then((loc) => {
        if (loc) {
          setLocationSource(loc.source)
          setForm((prev) => ({
            ...prev,
            country: loc.country || prev.country,
            city: loc.city || prev.city,
          }))
        }
      })
      .finally(() => setGeoLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在 open 時初始化，避免 profile 參考變動重置表單
  }, [open])

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const canNextStep1 = form.ageGroup && form.gender
  const canSubmit = form.voterTeam && form.country

  const handleNext = () => {
    if (step === 1 && canNextStep1) setStep(2)
  }

  const handleBack = () => setStep(1)

  /** Step 1 資料暫存於 form state，僅在 Step 2 完成後一次性寫入 Firestore，保證原子性 */
  const handleSubmit = async () => {
    if (!userId || !canSubmit) return
    setSaving(true)
    setSaveError(null)
    try {
      const profileRef = doc(db, 'profiles', userId)
      await setDoc(
        profileRef,
        {
          userId,
          starId: STAR_ID,
          ageGroup: form.ageGroup,
          gender: form.gender,
          voterTeam: form.voterTeam,
          country: form.country,
          city: form.city.trim() || '',
          hasProfile: true,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      )
      onSaved?.()
      onClose?.()
    } catch (err) {
      setSaveError(err?.message ?? t('saveError'))
      console.error('[UserProfileSetup]', err)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const getCountryOptionKey = useCallback((v) => getOptionKey('country', v), [])

  const countryOptions = useMemo(() => {
    const list = [...getCountryOptions(i18n.language || 'en')]
    const code = (form.country || '').toString().trim()
    const normalized = code === 'OTHER' ? 'OTHER' : code.toUpperCase().slice(0, 2)
    if (normalized && !list.some((c) => c.value === normalized)) {
      const label = normalized === 'OTHER' ? t('other') : t('detectedCountry', { code: normalized })
      list.push({ value: normalized, label })
    }
    return list
  }, [form.country, t, i18n.language])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-setup-title"
      onClick={() => onClose?.()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-xl bg-gray-900 border border-villain-purple/40 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-villain-purple/30 flex-shrink-0">
          <h2 id="profile-setup-title" className="text-xl font-bold text-king-gold">
            {step === 1 ? t('profileSetupTitleStep1') : t('profileSetupTitleStep2')}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {step === 1 ? t('step1Title') : t('step2Title')}
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-behavior-contain relative">
          {/* 頂部漸層：提示上方無更多內容 */}
          <div className="sticky top-0 left-0 right-0 h-5 bg-gradient-to-b from-gray-900 to-transparent pointer-events-none z-10" aria-hidden />
          <div className="p-6 pt-2 min-h-[280px] pb-10">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('ageGroup')}</label>
                  <div className="flex flex-wrap gap-2">
                    {AGE_GROUPS.map(({ value }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('ageGroup', value)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          form.ageGroup === value
                            ? 'bg-king-gold text-black'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        {t(getOptionKey('ageGroup', value))}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('gender')}</label>
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map(({ value }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('gender', value)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          form.gender === value
                            ? 'bg-king-gold text-black'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        {t(getOptionKey('gender', value))}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('supportTeamLabel')}</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {TEAMS.map(({ value, cityKey, colorKey }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('voterTeam', value)}
                        className={`px-2 py-2 rounded-lg text-left transition-colors min-w-0 flex flex-col min-h-[3.25rem] justify-center ${
                          form.voterTeam === value
                            ? 'bg-villain-purple/60 text-white ring-1 ring-king-gold/50'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="font-medium block truncate text-xs md:text-sm" title={t(cityKey)}>
                          {t(cityKey)}
                        </span>
                        <span className="block text-[10px] md:text-xs opacity-80 truncate break-words line-clamp-2" aria-hidden>
                          {t(colorKey)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('countryLabel')}</label>
                  {geoLoading ? (
                    <p className="text-sm text-gray-500" role="status">{t('gettingLocation')}</p>
                  ) : (
                    <SmartWarzoneSelector
                      value={form.country}
                      onChange={(v) => update('country', v)}
                      options={countryOptions}
                      getOptionKey={getCountryOptionKey}
                      aria-label={t('countryLabel')}
                    />
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('cityOptional')}</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder={t('cityPlaceholderExample')}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 text-white border border-gray-600 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none placeholder-gray-500"
                    aria-label={t('cityLabel')}
                  />
                  {locationSource === 'geolocation' && (
                    <p className="mt-1 text-xs text-king-gold" role="status">{t('coordinatesLocked')}</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {saveError && (
            <p className="mt-4 text-sm text-red-400" role="alert">
              {saveError}
            </p>
          )}
          </div>
          {/* 底部漸層：提示下方還有內容，引導向下捲動 */}
          <div className="sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none z-10" aria-hidden />
        </div>

        <div className="p-6 pt-0 flex justify-between gap-3 flex-shrink-0 border-t border-villain-purple/20">
          {step === 1 ? (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">
                {t('later')}
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={!canNextStep1}
                className="px-4 py-2 rounded-lg bg-king-gold text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('nextSelectWarzone')}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={handleBack} className="px-4 py-2 text-gray-400 hover:text-white">
                {t('back')}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || saving}
                className="px-4 py-2 rounded-lg bg-king-gold text-black font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? t('saving') : t('completeProfile')}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
