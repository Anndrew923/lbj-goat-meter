/**
 * UserProfileSetup — 戰區登錄兩步驟 Modal
 * Step 1：身分定義（年齡組別、性別）
 * Step 2：派系效忠（支持的球隊，以城市+代表色暗示）+ 地理（國家，IP 預填或手選）
 * 寫入 Firestore profiles 集合，與 docs/SCHEMA.md 對齊。
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'framer-motion'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getLocation } from '../lib/geolocation'
import { AGE_GROUPS, GENDERS, TEAMS, COUNTRIES } from '../lib/constants'

function getOptionKey(type, value) {
  if (type === 'ageGroup') return value === '45+' ? 'ageGroup_45_plus' : `ageGroup_${value.replace(/-/g, '_')}`
  if (type === 'gender') return `gender_${value}`
  if (type === 'team') return `team_${value}`
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

export default function UserProfileSetup({ open, onClose, userId, onSaved }) {
  const { t } = useTranslation('common')
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [form, setForm] = useState({
    ...INITIAL_FORM,
  })
  const [geoLoading, setGeoLoading] = useState(true)
  const [locationSource, setLocationSource] = useState(null) // 'geolocation' | 'ip' | null

  useEffect(() => {
    if (!open) return
    setStep(1)
    setForm({ ...INITIAL_FORM })
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
  }, [open])

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const canNextStep1 = form.ageGroup && form.gender
  const canSubmit = form.voterTeam && form.country

  const handleNext = () => {
    if (step === 1 && canNextStep1) setStep(2)
  }

  const handleBack = () => setStep(1)

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

  if (!open) return null

  const countryOptions = COUNTRIES.map((c) => ({ value: c.value, label: t(getOptionKey('country', c.value)) }))
  if (form.country && !COUNTRIES.some((c) => c.value === form.country)) {
    countryOptions.push({ value: form.country, label: t('detectedCountry', { code: form.country }) })
  }

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
        className="w-full max-w-md rounded-xl bg-gray-900 border border-villain-purple/40 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-villain-purple/30">
          <h2 id="profile-setup-title" className="text-xl font-bold text-king-gold">
            {t('profileSetupTitle')}
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            {step === 1 ? t('step1Title') : t('step2Title')}
          </p>
        </div>

        <div className="p-6 min-h-[280px]">
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
                  <div className="grid grid-cols-2 gap-2">
                    {TEAMS.map(({ value, colorHint }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => update('voterTeam', value)}
                        className={`px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                          form.voterTeam === value
                            ? 'bg-villain-purple/60 text-white ring-1 ring-king-gold/50'
                            : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                        }`}
                      >
                        <span className="font-medium">{t(getOptionKey('team', value))}</span>
                        <span className="block text-xs opacity-80" aria-hidden>{colorHint}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('countryLabel')}</label>
                  {geoLoading ? (
                    <p className="text-sm text-gray-500" role="status">{t('gettingLocation')}</p>
                  ) : (
                    <select
                      value={form.country}
                      onChange={(e) => update('country', e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 text-white border border-gray-600 focus:border-king-gold focus:ring-1 focus:ring-king-gold outline-none"
                      aria-label={t('countryLabel')}
                    >
                      <option value="">{t('pleaseSelect')}</option>
                      {countryOptions.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
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

        <div className="p-6 pt-0 flex justify-between gap-3">
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
                {t('next')}
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
