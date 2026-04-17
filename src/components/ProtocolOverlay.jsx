import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";

const STEP_INDEX_SCAN = 2;
const STEP_INDEX_WARZONE = 4;
const STEP4_GLITCH_DURATION_MS = 500;
const PURGE_SCAN_LINES = [
  "DETECTION: BIASED SIGNAL...",
  "PURGING BOTS...",
  "FRAUDULENT DATA BLOCKED.",
  "VERIFYING HUMAN EMOTION...",
];
const CROWN_KEYWORDS = ["LEBRON", "加冕", "GOAT", "傳奇", "crown", "crowns", "legend"];
const JUDGMENT_KEYWORDS = [
  "非官方",
  "獨立評測",
  "unofficial",
  "independent evaluation",
  "審判",
  "FRAUD",
  "謊言",
  "崩塌",
  "lie",
  "Collapse",
  "collapse",
];

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default function ProtocolOverlay({ open, onComplete }) {
  const { t, i18n } = useTranslation(["brand", "common"]);
  const prefersReducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [isStep4BurstActive, setIsStep4BurstActive] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setIsStep4BurstActive(false);
  }, [open]);

  useEffect(() => {
    if (!open || step !== STEP_INDEX_WARZONE || prefersReducedMotion) {
      setIsStep4BurstActive(false);
      return undefined;
    }
    setIsStep4BurstActive(true);
    const timer = window.setTimeout(() => {
      setIsStep4BurstActive(false);
    }, STEP4_GLITCH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [open, step, prefersReducedMotion]);

  const protocolSteps = useMemo(
    () => [
      {
        title: t("brand:protocol.step_0_title"),
        desc: t("brand:protocol.step_0_desc"),
        legalDisclaimer: t("brand:protocol.legal_disclaimer"),
        color: "text-cyan-300",
      },
      {
        title: t("brand:protocol.step_1_title"),
        desc: t("brand:protocol.step_1_desc"),
        color: "text-cyan-300",
      },
      {
        title: t("brand:protocol.step_2_title"),
        desc: t("brand:protocol.step_2_desc"),
        color: "text-blue-300",
        scan: true,
      },
      {
        title: t("brand:protocol.step_3_title"),
        desc: t("brand:protocol.step_3_desc"),
        color: "text-sky-200",
      },
      {
        title: t("brand:protocol.step_4_title"),
        desc: t("brand:protocol.step_4_desc"),
        color: "text-blue-200",
        alert: true,
      },
    ],
    [t],
  );
  const totalSteps = protocolSteps.length;

  const keywordRegex = useMemo(() => {
    const allKeywords = [...CROWN_KEYWORDS, ...JUDGMENT_KEYWORDS].sort(
      (left, right) => right.length - left.length,
    );
    return new RegExp(`(${allKeywords.map(escapeRegex).join("|")})`, "gi");
  }, []);

  const renderHighlightedText = (text) => {
    if (!text || typeof text !== "string") return text;
    const segments = text.split(keywordRegex);
    if (segments.length <= 1) return text;

    return segments.map((segment, index) => {
      if (!segment) return null;
      const lowerSegment = segment.toLowerCase();
      const isCrownKeyword = CROWN_KEYWORDS.some((keyword) => keyword.toLowerCase() === lowerSegment);
      const isJudgmentKeyword = JUDGMENT_KEYWORDS.some(
        (keyword) => keyword.toLowerCase() === lowerSegment,
      );

      if (isCrownKeyword) {
        return (
          <span
            key={`token-${index}-${segment}`}
            className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,.45)]"
          >
            {segment}
          </span>
        );
      }

      if (isJudgmentKeyword) {
        if (prefersReducedMotion) {
          return (
            <span key={`token-${index}-${segment}`} className="text-rose-400">
              {segment}
            </span>
          );
        }
        return (
          <motion.span
            key={`token-${index}-${segment}`}
            className="inline-block text-rose-400"
            animate={{ x: [0, -1, 1, 0] }}
            transition={{ duration: 0.5, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.4 }}
          >
            {segment}
          </motion.span>
        );
      }

      return <span key={`token-${index}-${segment}`}>{segment}</span>;
    });
  };

  const handleAdvance = () => {
    if (step < totalSteps - 1) {
      setStep((prev) => prev + 1);
      return;
    }
    onComplete?.();
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleAdvance();
    }
  };

  const stepTitleId = "protocol-overlay-title";
  const activeStep = protocolSteps[step];
  const isPrologueStep = step === 0;
  const isScanStep = step === STEP_INDEX_SCAN;
  const isWarzoneStep = step === STEP_INDEX_WARZONE;
  const isEnglish = i18n.language === "en";
  const ctaButtonClassName = `absolute bottom-[calc(var(--safe-bottom)+1.5rem)] left-1/2 z-10 -translate-x-1/2 rounded-full border border-blue-500/50 bg-blue-500/10 py-4 text-sm font-bold text-blue-300 transition-all hover:bg-blue-500/20 active:scale-95 whitespace-nowrap ${
    isEnglish ? "px-12 tracking-[0.24em]" : "px-10 tracking-[0.08em]"
  }`;
  const contentAnimate = prefersReducedMotion
    ? { opacity: 1 }
    : {
        y: 0,
        opacity: isWarzoneStep && isStep4BurstActive ? [1, 0.88, 1] : 1,
        x: isWarzoneStep && isStep4BurstActive ? [0, -2, 2, 0] : 0,
      };
  const contentTransition = prefersReducedMotion
    ? { duration: 0.15 }
    : {
        duration: isWarzoneStep && isStep4BurstActive ? 0.5 : 0.28,
        ease: "easeInOut",
      };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0.15 : 0.28 }}
          className="framer-motion-stabilizer fixed inset-0 z-[10000] flex flex-col items-center justify-center p-8 overflow-hidden bg-black/95"
          style={{ backdropFilter: "blur(20px) saturate(0.95)" }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={stepTitleId}
          onKeyDown={handleKeyDown}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none opacity-[0.07]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, rgba(34,211,238,.9) 1px, transparent 0)",
              backgroundSize: "30px 30px",
            }}
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={prefersReducedMotion ? { opacity: 0 } : { y: 20, opacity: 0 }}
              animate={contentAnimate}
              exit={prefersReducedMotion ? { opacity: 0 } : { y: -20, opacity: 0 }}
              transition={contentTransition}
              className="relative z-10 flex max-h-[65vh] max-w-md flex-col items-center overflow-y-auto pb-28 text-center"
            >
              <p className="mb-4 text-xs tracking-[0.26em] uppercase text-blue-200/80">
                {t("brand:protocol.title")}
              </p>
              <div className="mb-10 flex gap-2" aria-hidden="true">
                {Array.from({ length: totalSteps }, (_, index) => (
                  <div
                    key={index}
                    className={`h-1.5 w-12 rounded-full transition-all duration-500 ${
                      index <= step
                        ? "bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,.7)]"
                        : "bg-gray-800"
                    }`}
                  />
                ))}
              </div>

              <h2
                id={stepTitleId}
                className={`mb-5 text-3xl font-black tracking-widest drop-shadow-[0_0_10px_rgba(56,189,248,.35)] ${activeStep.color}`}
              >
                {isPrologueStep
                  ? activeStep.title.split(/(LEBRON)/i).map((segment, index) => {
                      if (!segment) return null;
                      if (segment.toUpperCase() === "LEBRON") {
                        return (
                          <span
                            key={`title-${index}-${segment}`}
                            className="text-cyan-400 drop-shadow-[0_0_12px_rgba(34,211,238,.55)]"
                          >
                            {segment}
                          </span>
                        );
                      }
                      return <span key={`title-${index}-${segment}`}>{segment}</span>;
                    })
                  : activeStep.title}
              </h2>
              <p className="text-lg font-light leading-relaxed text-gray-300">
                {renderHighlightedText(activeStep.desc)}
              </p>
              {isPrologueStep && activeStep.legalDisclaimer && (
                <p className="mt-6 max-w-md text-[10px] leading-relaxed text-gray-700">
                  {activeStep.legalDisclaimer}
                </p>
              )}

              {activeStep.scan && !prefersReducedMotion && (
                <motion.div
                  initial={{ top: "-10%" }}
                  animate={{ top: "110%" }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="pointer-events-none absolute -inset-x-20 h-px bg-cyan-300/60 shadow-[0_0_18px_rgba(34,211,238,.95)]"
                />
              )}

              {isScanStep && !prefersReducedMotion && (
                <div className="pointer-events-none absolute inset-0">
                  {PURGE_SCAN_LINES.map((line, index) => (
                    <motion.p
                      key={line}
                      className="absolute text-[10px] tracking-[0.2em] text-cyan-200/10 whitespace-nowrap"
                      style={{
                        top: `${14 + index * 18}%`,
                        left: `${index % 2 === 0 ? 8 : 46}%`,
                      }}
                      animate={{ opacity: [0.03, 0.12, 0.03] }}
                      transition={{
                        duration: 1.25,
                        ease: "easeInOut",
                        repeat: Infinity,
                        repeatDelay: 0.75,
                        delay: index * 0.18,
                      }}
                    >
                      {line}
                    </motion.p>
                  ))}
                </div>
              )}

              {activeStep.alert && !prefersReducedMotion && (
                <motion.div
                  initial={{ opacity: 0.5 }}
                  animate={
                    isStep4BurstActive
                      ? {
                          borderColor: [
                            "rgba(59,130,246,.65)",
                            "rgba(251,113,133,.85)",
                            "rgba(59,130,246,.65)",
                            "rgba(251,113,133,.85)",
                            "rgba(59,130,246,.65)",
                          ],
                          boxShadow: [
                            "0 0 10px rgba(59,130,246,.38)",
                            "0 0 16px rgba(251,113,133,.45)",
                            "0 0 10px rgba(59,130,246,.38)",
                            "0 0 16px rgba(251,113,133,.45)",
                            "0 0 12px rgba(59,130,246,.4)",
                          ],
                        }
                      : {
                          borderColor: "rgba(59,130,246,.58)",
                          boxShadow: "0 0 12px rgba(59,130,246,.34)",
                        }
                  }
                  transition={{ duration: isStep4BurstActive ? 0.5 : 0.22, ease: "easeInOut" }}
                  className="pointer-events-none absolute -inset-6 rounded-3xl border"
                />
              )}
            </motion.div>
          </AnimatePresence>

          <button
            type="button"
            onClick={handleAdvance}
            className={ctaButtonClassName}
          >
            {step === totalSteps - 1 ? t("common:protocolComplete") : t("common:protocolNext")}
          </button>
          <p className="absolute bottom-[calc(var(--safe-bottom)+0.35rem)] left-1/2 z-10 -translate-x-1/2 text-xs text-blue-100/60">
            {t("common:protocolStepCounter", { current: step + 1, total: totalSteps })}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
