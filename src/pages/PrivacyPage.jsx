import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Shield, ArrowLeft } from 'lucide-react'
import LanguageToggle from '../components/LanguageToggle'
import { triggerHaptic } from '../utils/hapticUtils'

/**
 * 戰區隱私守則 — 公開頁面；內容與 public/privacy-policy*.html 對齊（語系由 i18n 提供）。
 */
export default function PrivacyPage() {
  const { t } = useTranslation('common')

  const { collectionItems, purposeItems, thirdPartyItems, securityRightsItems } = useMemo(() => {
    const c = t('privacyCollectionItems', { returnObjects: true })
    const p = t('privacyPurposeItems', { returnObjects: true })
    const tp = t('privacyThirdPartyItems', { returnObjects: true })
    const sr = t('privacySecurityRightsItems', { returnObjects: true })
    return {
      collectionItems: Array.isArray(c) ? c : [],
      purposeItems: Array.isArray(p) ? p : [],
      thirdPartyItems: Array.isArray(tp) ? tp : [],
      securityRightsItems: Array.isArray(sr) ? sr : [],
    }
  }, [t])

  useEffect(() => {
    document.title = `${t('privacyPageTitle')} | The GOAT Meter`
    return () => {
      document.title = 'The GOAT Meter'
    }
  }, [t])

  return (
    <div className="min-h-screen bg-black text-gray-300">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <Link
            to="/"
            onClick={() => triggerHaptic(10)}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-king-gold transition-colors"
            aria-label={t('backToApp')}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {t('backToApp')}
          </Link>
          <div className="flex items-end">
            <LanguageToggle />
          </div>
        </div>

        <header className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="w-8 h-8 text-king-gold" aria-hidden />
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {t('privacyPageTitle')}
            </h1>
          </div>
          <p className="text-gray-500 text-sm">
            {t('privacyPageSubtitle')}
          </p>
        </header>

        <main className="space-y-8">
          <p className="text-gray-300 text-sm leading-relaxed">
            {t('privacyIntro')}
          </p>

          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionCollectionTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              {t('privacyCollectionLead')}
            </p>
            <ul className="list-disc pl-5 space-y-3 text-gray-300 text-sm leading-relaxed">
              {collectionItems.map((item) => (
                <li key={item.title}>
                  <strong className="text-gray-200">{item.title}</strong>
                  {item.body}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionPurposeTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              {t('privacyPurposeLead')}
            </p>
            <ul className="list-disc pl-5 space-y-2 text-gray-300 text-sm leading-relaxed">
              {purposeItems.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionThirdPartyTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              {t('privacyThirdPartyLead')}
            </p>
            <ul className="list-disc pl-5 space-y-3 text-gray-300 text-sm leading-relaxed">
              {thirdPartyItems.map((item) => (
                <li key={item.title}>
                  <strong className="text-gray-200">{item.title}</strong>
                  {item.body}
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionSecurityRightsTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed mb-3">
              {t('privacySecurityRightsLead')}
            </p>
            <ul className="list-disc pl-5 space-y-2 text-gray-300 text-sm leading-relaxed">
              {securityRightsItems.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionRetentionTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionRetentionContent')}
            </p>
          </section>

          <section className="rounded-xl border border-king-gold/30 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionContactTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionContactContent')}
            </p>
          </section>
        </main>

        <p className="mt-10 text-gray-500 text-xs">
          {t('privacyLastUpdated')}
        </p>

        <footer className="mt-8 pt-6 border-t border-gray-800">
          <Link
            to="/"
            onClick={() => triggerHaptic(10)}
            className="inline-flex items-center gap-2 py-2 px-4 rounded-xl border border-villain-purple/40 text-gray-300 hover:border-king-gold/50 hover:text-king-gold transition-colors"
            aria-label={t('backToApp')}
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {t('backToApp')}
          </Link>
        </footer>
      </div>
    </div>
  )
}
