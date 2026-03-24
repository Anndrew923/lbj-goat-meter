#!/usr/bin/env bash
# GOAT Meter Supernova — 萬人防線部署順序（Bruce / CI 手動執行）
# 前置：已安裝 firebase-tools、已 firebase login、.firebaserc 指向正確專案
#
# 1) 後端秘密：`submitVote` 已 `defineSecret("GOAT_FINGERPRINT_PEPPER")` 綁定 Secret Manager。
#    輪替：openssl rand -hex 32 | npx firebase-tools functions:secrets:set GOAT_FINGERPRINT_PEPPER --data-file=-
#    然後重新 deploy functions。本機 Emulator 可改以環境變數 GOAT_FINGERPRINT_PEPPER 後備。
#
# 2) 前端：.env / Netlify 建置變數設定
#    VITE_FIREBASE_FUNCTIONS_REGION=us-central1  （須與 FUNCTIONS_REGION / setGlobalOptions 一致）
#
# 3) 首次從 1st Gen Callable 遷到 2nd Gen：Firebase 不支援就地升級，需先刪除舊 Callable，再 deploy：
#    for fn in submitVote resetPosition deleteUserAccount submitBreakingVote issueAdRewardToken; do
#      npx firebase-tools functions:delete "$fn" --region us-central1 --project lbj-goat-meter --force --non-interactive
#    done

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 使用 npx 鎖定 firebase-tools 版本，避免全域未安裝 firebase CLI
FIREBASE="npx --yes firebase-tools@13.35.1"

echo "==> [1/3] firestore:indexes + firestore:rules"
# --force：非互動模式下 Firebase 會同步「索引檔 ↔ 遠端」，可能刪除未寫入 firestore.indexes.json 的遠端索引。
$FIREBASE deploy --only firestore:indexes,firestore:rules --non-interactive --force

echo "==> [2/3] functions (v2 Callable + v1 triggers)"
$FIREBASE deploy --only functions --non-interactive

echo "==> 完成。請於 Console 確認 Gen2：512MiB、timeout 60s、concurrency 64、minInstances 0"
echo "==> 壓測 KPI 請填入 docs/STRESS_TEST_REPORT.md（Supernova 部署後小節）"
