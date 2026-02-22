import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Shield, ArrowLeft } from 'lucide-react'
import LanguageToggle from '../components/LanguageToggle'
import { triggerHaptic } from '../utils/hapticUtils'

/**
 * 戰區隱私守則 (Warzone Privacy Protocol) — 公開頁面，不需登入即可查看。
 * 符合 Google 政策與用戶信任需求。
 */
export default function PrivacyPage() {
  const { t } = useTranslation('common')

  useEffect(() => {
    document.title = `${t('privacyPageTitle')} | The GOAT Meter`
    return () => {
      document.title = 'The GOAT Meter'
    }
  }, [t])

  return (
    <div className="min-h-screen bg-black text-gray-300">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* 頂列：返回 + 語言切換（公開頁可切語系閱讀） */}
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

        {/* 標題：戰區隱私守則 */}
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
          {/* 1. 資訊收集 */}
          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionInfoTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionInfoContent')}
            </p>
          </section>

          {/* 2. 數據用途 */}
          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionDataTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionDataContent')}
            </p>
          </section>

          {/* 3. 第三方服務 */}
          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionThirdPartyTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionStorage')}
            </p>
            <p className="text-gray-300 text-sm leading-relaxed mt-3">
              {t('privacySectionAds')}
            </p>
          </section>

          {/* 4. 數據安全與公平性（首發過審：透明化 deviceId / App Check，符合 GDPR 與平台隱私規範） */}
          <section className="rounded-xl border border-villain-purple/20 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionSecurityTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionSecurityContent')}
            </p>
          </section>

          {/* 5. 用戶權利 */}
          <section className="rounded-xl border border-king-gold/30 bg-gray-900/50 p-5 sm:p-6">
            <h2 className="text-king-gold font-semibold text-lg mb-3">
              {t('privacySectionRightsTitle')}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              {t('privacySectionRightsContent')}
            </p>
          </section>
        </main>

        <footer className="mt-12 pt-6 border-t border-gray-800">
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
