#!/usr/bin/env node
/**
 * 套用 storage-cors.json 到 Firebase Storage 儲存貯體。
 * 需要任一認證方式：
 *   - gcloud auth application-default login（本機已安裝 gcloud）
 *   - 或設定 GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰 JSON
 *
 * 執行：node scripts/apply-storage-cors.mjs
 * 或：  GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json node scripts/apply-storage-cors.mjs
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUCKET_NAME = process.env.STORAGE_BUCKET || 'lbj-goat-meter.firebasestorage.app'
const CORS_PATH = join(__dirname, '..', 'storage-cors.json')

async function main() {
  const corsJson = readFileSync(CORS_PATH, 'utf8')
  const cors = JSON.parse(corsJson)

  const { Storage } = await import('@google-cloud/storage')
  const storage = new Storage({ projectId: 'lbj-goat-meter' })

  const bucket = storage.bucket(BUCKET_NAME)
  await bucket.setMetadata({ cors })
  console.log('CORS 已套用到 gs://' + BUCKET_NAME)
}

main().catch((err) => {
  console.error('套用失敗:', err.message)
  if (err.code === 403 || err.message?.includes('Permission'))
    console.error('請先設定認證：gcloud auth application-default login 或 GOOGLE_APPLICATION_CREDENTIALS')
  if (err.code === 404 || err.message?.includes('does not exist'))
    console.error('儲存貯體名稱可能錯誤。請到 Firebase Console > Storage 查看實際名稱，並設定 STORAGE_BUCKET=名稱 後再執行。或改用 docs/STORAGE-CORS-SETUP.md 的 Cloud Shell 方式。')
  process.exit(1)
})
