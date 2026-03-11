/**
 * RecaptchaDisclosure — reCAPTCHA 隱藏徽章時的合規聲明
 *
 * 依 Google reCAPTCHA 政策：隱藏徽章時須在頁面顯眼處提供聲明與隱私權／服務條款連結。
 * 本元件固定於畫面底部，不遮擋主要內容，滿足法律避險與使用者知情權。
 * z-index 9998 低於 Toast (9999)，確保提示仍覆蓋於聲明之上。
 * 使用 .recaptcha-disclosure-bar（padding-bottom: max(safe-area, 2.5rem)）確保在手機上不被原生導覽列／Home Indicator 遮蔽。
 */
import { Trans, useTranslation } from "react-i18next";

const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const GOOGLE_TERMS = "https://policies.google.com/terms";

export default function RecaptchaDisclosure() {
  const { t } = useTranslation("common");

  return (
    <footer
      className="recaptcha-disclosure-bar fixed bottom-0 left-0 right-0 z-[9998] px-3 py-1.5 text-center text-[10px] text-gray-500 bg-[rgba(0,0,0,0.6)] border-t border-gray-800"
      role="contentinfo"
      aria-label={t("recaptchaDisclosureAria")}
    >
      <Trans
        i18nKey="common:recaptchaDisclosure"
        components={{
          privacy: (
            <a
              href={GOOGLE_PRIVACY}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600/90 underline hover:text-amber-500"
            />
          ),
          terms: (
            <a
              href={GOOGLE_TERMS}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600/90 underline hover:text-amber-500"
            />
          ),
        }}
      />
    </footer>
  );
}
