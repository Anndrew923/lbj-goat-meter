/**
 * UniversalAdmin — 突發戰區管理後台（PC 主要操作）
 *
 * 設計意圖：
 * - 跨專案通用：撰寫 global_events 文件，target_app 陣列決定哪些 App 顯示。
 * - 動態雙語存儲：標題、描述、選項皆以語系物件 { "zh-TW": "...", "en": "..." } 寫入 Firestore。
 * - 圖片上傳後 URL 與雙語內容一併存入同一 Document。
 */
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc,
} from 'firebase/firestore'
import { db, storage } from '../lib/firebase'
import { GLOBAL_EVENTS_COLLECTION } from '../lib/constants'
import { compressAndConvertToWebP } from '../lib/imageCompression'

const ASPECT_16_9 = 16 / 9

function parseCommaList(str) {
  if (!str || typeof str !== 'string') return []
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 將雙語逗號列表 zip 成選項陣列：options = [{ "zh-TW": a, "en": b }, ...]，長度以較長者為準，短缺處填空字串 */
function zipOptionsToList(zhList, enList) {
  const zh = parseCommaList(zhList)
  const en = parseCommaList(enList)
  const len = Math.max(zh.length, en.length)
  return Array.from({ length: len }, (_, i) => ({
    'zh-TW': zh[i] ?? '',
    en: en[i] ?? '',
  }))
}

/** 從表單狀態組出標題/描述的雙語物件，統一寫入 zh-TW 與 en 兩鍵以利前端依語系 fallback */
function toLocaleObject(zh, en) {
  return {
    'zh-TW': (zh ?? '').trim(),
    en: (en ?? '').trim(),
  }
}

/**
 * 從 Firebase Storage 的 download URL 解析出 Storage 路徑（供刪除用）。
 * 僅在文件無 image_storage_path 時用於舊資料相容。
 */
function getStoragePathFromUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null
  try {
    const u = new URL(imageUrl)
    const pathname = u.pathname || ''
    const match = pathname.match(/\/o\/(.+?)(?:\?|$)/)
    const encoded = match?.[1]
    if (!encoded) return null
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

export default function UniversalAdmin() {
  const { t } = useTranslation('common')
  const [targetAppText, setTargetAppText] = useState('goat_meter')
  const [titleZh, setTitleZh] = useState('')
  const [titleEn, setTitleEn] = useState('')
  const [descriptionZh, setDescriptionZh] = useState('')
  const [descriptionEn, setDescriptionEn] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [optionsZh, setOptionsZh] = useState('')
  const [optionsEn, setOptionsEn] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [message, setMessage] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [allTopics, setAllTopics] = useState([])
  const [topicsLoading, setTopicsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState(null)

  const onFile = useCallback((file) => {
    if (!file?.type?.startsWith('image/')) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = () => setImagePreview(reader.result)
    reader.readAsDataURL(file)
  }, [])

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) onFile(file)
    },
    [onFile]
  )
  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const onDragLeave = useCallback(() => setDragOver(false), [])

  const loadAllTopics = useCallback(async () => {
    if (!db) return
    setTopicsLoading(true)
    try {
      const col = collection(db, GLOBAL_EVENTS_COLLECTION)
      const q = query(col, orderBy('createdAt', 'desc'))
      const snapshot = await getDocs(q)
      const list = (snapshot.docs ?? []).map((d) => ({ id: d.id, ...d.data() }))
      setAllTopics(list)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[UniversalAdmin] loadAllTopics', err)
      setMessage({ type: 'error', text: err?.message || t('adminError') })
    } finally {
      setTopicsLoading(false)
    }
  }, [t])

  useEffect(() => {
    loadAllTopics()
  }, [loadAllTopics])

  const handleDelete = async (ev) => {
    const id = ev?.id
    if (!id) return
    setDeletingId(id)
    setMessage(null)
    try {
      const item = allTopics.find((x) => x.id === id)
      const storagePath =
        item?.image_storage_path ||
        (item?.image_url ? getStoragePathFromUrl(item.image_url) : null)
      if (storagePath && storage) {
        try {
          const storageRef = ref(storage, storagePath)
          await deleteObject(storageRef)
        } catch (storageErr) {
          if (import.meta.env.DEV) console.warn('[UniversalAdmin] deleteObject', storageErr)
          // 仍刪除 Firestore，避免孤兒 Doc 殘留
        }
      }
      await deleteDoc(doc(db, GLOBAL_EVENTS_COLLECTION, id))
      setMessage({ type: 'success', text: t('adminDeleted') })
      setAllTopics((prev) => prev.filter((x) => x.id !== id))
    } catch (err) {
      if (import.meta.env.DEV) console.error('[UniversalAdmin] handleDelete', err)
      setMessage({ type: 'error', text: err?.message || t('adminError') })
    } finally {
      setDeletingId(null)
    }
  }

  const handlePublish = async () => {
    const target_app = parseCommaList(targetAppText)
    if (!target_app.length) {
      setMessage({ type: 'error', text: `${t('adminError')}: ${t('adminErrorTargetAppRequired')}` })
      return
    }
    const titleEnTrim = titleEn.trim()
    if (!titleEnTrim) {
      setMessage({ type: 'error', text: `${t('adminError')}: ${t('adminErrorTitleEnRequired')}` })
      return
    }

    setPublishing(true)
    setMessage(null)
    let imageUploadFailed = false
    let image_url = ''
    let image_storage_path = null
    try {
      if (imageFile && storage) {
        try {
          // 上傳前壓縮：16:9 裁切、寬度 ≤1280px、轉 WebP，目標 150–200KB；長效快取省重複下載流量
          const webpBlob = await compressAndConvertToWebP(imageFile)
          const path = `${GLOBAL_EVENTS_COLLECTION}/${Date.now()}.webp`
          image_storage_path = path
          const storageRef = ref(storage, path)
          const metadata = {
            cacheControl: 'public, max-age=31536000',
            contentType: 'image/webp',
          }
          const uploadTask = uploadBytesResumable(storageRef, webpBlob, metadata)
          const snapshot = await new Promise((resolve, reject) => {
            uploadTask.on(
              'state_changed',
              () => {},
              reject,
              () => resolve(uploadTask.snapshot)
            )
          })
          image_url = await getDownloadURL(snapshot.ref)
        } catch (uploadErr) {
          if (import.meta.env.DEV) console.error('[UniversalAdmin] image upload', uploadErr)
          imageUploadFailed = true
          image_storage_path = null
          // 不阻斷發布：活動仍寫入 Firestore（image_url 為 null），僅提示需設定 Storage CORS
        }
      }

      const title = toLocaleObject(titleZh, titleEn)
      const description = toLocaleObject(descriptionZh, descriptionEn)
      const options = zipOptionsToList(optionsZh, optionsEn)

      // vote_counts：以選項索引為 key 的 Map，供後端 increment 與前端結果條計算百分比；total_votes 總計
      const vote_counts = options.length
        ? Object.fromEntries(options.map((_, i) => [String(i), 0]))
        : {};
      await addDoc(collection(db, GLOBAL_EVENTS_COLLECTION), {
        target_app,
        title,
        description,
        image_url: image_url || null,
        image_storage_path: image_storage_path || null,
        options,
        vote_counts,
        total_votes: 0,
        is_active: !!isActive,
        createdAt: serverTimestamp(),
      })
      setMessage({
        type: 'success',
        text: imageUploadFailed ? t('adminSavedNoImage') : t('adminSaved'),
      })
      loadAllTopics()
      setTitleZh('')
      setTitleEn('')
      setDescriptionZh('')
      setDescriptionEn('')
      setOptionsZh('')
      setOptionsEn('')
      setImageFile(null)
      setImagePreview(null)
    } catch (err) {
      if (import.meta.env.DEV) console.error('[UniversalAdmin]', err)
      setMessage({ type: 'error', text: (err?.message || t('adminError')) })
    } finally {
      setPublishing(false)
    }
  }

  const previewTitle = titleEn.trim() || titleZh.trim() || '—'
  const previewOptions = zipOptionsToList(optionsZh, optionsEn)

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-king-gold">{t('adminTitle')}</h1>
          <Link
            to="/vote"
            className="text-sm text-gray-400 hover:text-king-gold transition-colors"
          >
            ← {t('backToApp')}
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Form */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6 space-y-4"
          >
            <label className="block">
              <span className="text-sm text-gray-400 block mb-1">
                {t('adminTargetApp')}
              </span>
              <input
                type="text"
                value={targetAppText}
                onChange={(e) => setTargetAppText(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
                placeholder="goat_meter"
              />
            </label>

            <div className="space-y-2">
              <span className="text-sm text-gray-400 block">{t('adminTitleLabel')}</span>
              <input
                type="text"
                value={titleZh}
                onChange={(e) => setTitleZh(e.target.value)}
                placeholder={t('adminTitleZh')}
                aria-label={t('adminTitleZh')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
              <input
                type="text"
                value={titleEn}
                onChange={(e) => setTitleEn(e.target.value)}
                placeholder={t('adminTitleEn')}
                aria-label={t('adminTitleEn')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm text-gray-400 block">{t('adminDescriptionLabel')}</span>
              <input
                type="text"
                value={descriptionZh}
                onChange={(e) => setDescriptionZh(e.target.value)}
                placeholder={t('adminDescriptionZh')}
                aria-label={t('adminDescriptionZh')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
              <input
                type="text"
                value={descriptionEn}
                onChange={(e) => setDescriptionEn(e.target.value)}
                placeholder={t('adminDescriptionEn')}
                aria-label={t('adminDescriptionEn')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
            </div>

            <div>
              <span className="text-sm text-gray-400 block mb-1">
                {t('adminImage')}
              </span>
              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  dragOver
                    ? 'border-king-gold/60 bg-king-gold/5'
                    : 'border-villain-purple/30 bg-gray-800/50'
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  id="admin-image"
                  onChange={(e) => onFile(e.target.files?.[0])}
                />
                <label
                  htmlFor="admin-image"
                  className="cursor-pointer text-sm text-gray-400 hover:text-king-gold"
                >
                  {t('adminImageDrop')}
                </label>
                {imagePreview && (
                  <div
                    className="mt-3 mx-auto w-full max-w-xs rounded-lg overflow-hidden bg-black"
                    style={{ aspectRatio: ASPECT_16_9 }}
                  >
                    <img
                      src={imagePreview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm text-gray-400 block">{t('adminOptions')}</span>
              <input
                type="text"
                value={optionsZh}
                onChange={(e) => setOptionsZh(e.target.value)}
                placeholder={t('adminOptionsZh')}
                aria-label={t('adminOptionsZh')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
              <input
                type="text"
                value={optionsEn}
                onChange={(e) => setOptionsEn(e.target.value)}
                placeholder={t('adminOptionsEn')}
                aria-label={t('adminOptionsEn')}
                className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-villain-purple/30 text-white placeholder-gray-500 focus:border-king-gold/50 focus:ring-1 focus:ring-king-gold/30 outline-none"
              />
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-gray-500 text-king-gold focus:ring-king-gold/50"
              />
              <span className="text-sm text-gray-300">{t('adminIsActive')}</span>
            </label>
            {message && (
              <p
                className={`text-sm ${
                  message.type === 'error' ? 'text-red-400' : 'text-king-gold'
                }`}
              >
                {message.text}
              </p>
            )}
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              aria-label={t('adminPublish')}
              className="w-full py-3 rounded-xl font-bold bg-king-gold text-black hover:bg-king-gold/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {publishing ? t('adminPublishing') : t('adminPublish')}
            </button>
            {!storage && (
              <p className="text-xs text-amber-500" role="status">
                VITE_FIREBASE_STORAGE_BUCKET not set; image upload disabled.
              </p>
            )}
          </motion.section>

          {/* 16:9 手機預覽（依當前語系顯示其一，此處用 en 為預覽代表） */}
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6"
          >
            <h2 className="text-sm font-semibold text-king-gold mb-4">
              {t('adminPreview')}
            </h2>
            <div className="max-w-[280px] mx-auto rounded-2xl border-2 border-gray-700 overflow-hidden bg-black shadow-xl">
              <div
                className="w-full overflow-hidden"
                style={{ aspectRatio: ASPECT_16_9 }}
              >
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-king-gold/10 to-villain-purple/10 text-gray-500 text-xs">
                    {t('adminImage')}
                  </div>
                )}
              </div>
              <div className="p-3 bg-gray-900 border-t border-gray-700">
                <p className="text-white font-semibold text-sm line-clamp-2">
                  {previewTitle}
                </p>
                {(descriptionEn.trim() || descriptionZh.trim()) && (
                  <p className="text-gray-400 text-xs line-clamp-2 mt-1">
                    {descriptionEn.trim() || descriptionZh.trim()}
                  </p>
                )}
                {previewOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {previewOptions.slice(0, 3).map((opt, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded text-xs bg-king-gold/20 text-king-gold"
                      >
                        {opt.en || opt['zh-TW'] || '—'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        </div>

        {/* 所有話題清單：可刪除 Doc 與對應 Storage .webp */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border border-villain-purple/30 bg-gray-900/80 p-6"
        >
          <h2 className="text-sm font-semibold text-king-gold mb-4">
            {t('adminAllTopics')}
          </h2>
          {topicsLoading ? (
            <p className="text-sm text-gray-500 animate-pulse">{t('breakingLoading')}</p>
          ) : allTopics.length === 0 ? (
            <p className="text-sm text-gray-500">{t('adminNoTopics')}</p>
          ) : (
            <ul className="space-y-2">
              {allTopics.map((ev) => {
                const titleText =
                  (typeof ev.title === 'object' && ev.title != null
                    ? (ev.title['zh-TW'] || ev.title.en || '—')
                    : String(ev.title ?? '—')) || '—'
                const isDeleting = deletingId === ev.id
                return (
                  <li
                    key={ev.id}
                    className="flex items-center justify-between gap-4 py-2 px-3 rounded-lg bg-gray-800/80 border border-villain-purple/20"
                  >
                    <span className="text-sm text-white truncate flex-1 min-w-0">
                      {titleText}
                    </span>
                    <span
                      className={`text-xs shrink-0 ${
                        ev.is_active ? 'text-king-gold' : 'text-gray-500'
                      }`}
                    >
                      {ev.is_active ? t('adminIsActive') : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDelete(ev)}
                      disabled={isDeleting}
                      aria-label={t('adminDelete')}
                      className="shrink-0 py-1.5 px-3 rounded-lg text-xs font-medium text-red-400 border border-red-500/40 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isDeleting ? t('adminDeleting') : t('adminDelete')}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </motion.section>
      </div>
    </div>
  )
}
