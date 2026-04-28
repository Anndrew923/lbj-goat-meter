/**
 * ModalShell — 靜態全螢幕遮罩 + 動畫面板（CSS-first）
 *
 * 設計意圖：背景色掛在一般 div，掛載即繪製；Framer Motion 僅負責面板 transform/opacity，
 * 降低 WebView/APK 將遮罩與動畫引擎綁在同一合成層造成的閃爍。
 *
 * pointer-events：外層對話區為 none，僅面板與遮罩可點，避免 Flex 對齊層挡住 backdrop 點擊。
 */
import { motion } from "framer-motion";

export default function ModalShell({
  children,
  /** 遮罩色（Tailwind），預設與全專案設定彈窗一致 */
  backdropClassName = "bg-black/90",
  /** 固定層：z-index、overflow、對齊方式；禁止含背景半透明色 */
  rootClassName = "fixed inset-0 z-50 overflow-y-auto",
  shellClassName = "",
  /** 置中容器；維持 pointer-events-none，點擊由遮罩與面板承接 */
  contentAlignClassName = "relative z-10 flex min-h-full w-full items-center justify-center p-4 pointer-events-none",
  panelClassName = "",
  /** 傳給內層 motion.div（面板動畫）；animatePanel=false 時忽略 */
  panelMotionProps = {},
  /** false 時內層為一般 div（無進出動畫），例如純載入文案 */
  animatePanel = true,
  onBackdropClick,
  backdropAriaHidden = true,
  backdropProps = {},
  /** 覆寫根層 motion（role、aria、initial/exit 等）；勿傳 className — 請用 shellClassName */
  rootMotionProps = {},
}) {
  const {
    className: rootMotionClassName = "",
    ...rootMotionRest
  } = rootMotionProps;

  const {
    className: panelMotionClassName = "",
    ...panelMotionRest
  } = panelMotionProps;

  const rootClassMerged = [
    rootClassName,
    shellClassName,
    rootMotionClassName,
  ]
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

  const panelClassMerged = [
    "framer-motion-stabilizer",
    "pointer-events-auto",
    panelClassName,
    panelMotionClassName,
  ]
    .join(" ")
    .trim()
    .replace(/\s+/g, " ");

  const panelBody = animatePanel ? (
    <motion.div className={panelClassMerged} {...panelMotionRest}>
      {children}
    </motion.div>
  ) : (
    <div
      className={[
        "pointer-events-auto",
        "relative",
        "z-[11]",
        panelClassName,
        panelMotionClassName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim()
        .replace(/\s+/g, " ")}
    >
      {children}
    </div>
  );

  return (
    <motion.div
      className={rootClassMerged}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      {...rootMotionRest}
    >
      <div
        className={`absolute inset-0 ${backdropClassName}`}
        aria-hidden={backdropAriaHidden}
        onClick={onBackdropClick}
        {...backdropProps}
      />
      <div className={contentAlignClassName}>{panelBody}</div>
    </motion.div>
  );
}
