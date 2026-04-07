# Artifact Registry 自動清理政策（Cost Control）

本文件的目標是讓 Firebase Gen2 Functions（Cloud Run）部署產生的容器映像（特別是 `gcf-artifacts`）**自動**維持低儲存水位，避免長期累積產生固定儲存費。

## 政策內容（Repository Cleanup Policies）

套用於同一區域（預設 `us-central1`）內所有 **Docker** 類型 Repository：

- **Keep most recent 3 versions**：每個 artifact 保留最新 3 版（用於緊急 rollback / 比對）。
- **Delete untagged older than 7 days**：刪除所有 **超過 7 天**且 **未標記（UNTAGGED）** 的舊版本（通常是舊 digest / 孤兒層）。

政策檔案：`gcp/artifact-registry/cleanup-policy.json`

> Artifact Registry 的 cleanup job 為背景排程，變更通常在 **~1 天內**開始生效，不是即時刪除。

## 套用方式（一次設定，長期自動化）

使用腳本：`scripts/set-artifact-cleanup-policies.sh`

### Dry run（建議先跑）

```bash
DRY_RUN=1 PROJECT_ID=lbj-goat-meter LOCATION=us-central1 ./scripts/set-artifact-cleanup-policies.sh
```

### 正式套用

```bash
PROJECT_ID=lbj-goat-meter LOCATION=us-central1 ./scripts/set-artifact-cleanup-policies.sh
```

## 生效確認（驗證）

腳本會在套用後對每個 repo 執行：

- `gcloud artifacts repositories describe ... --format="yaml(cleanupPolicies)"`

你也可以在 GCP Console 直接查看：

- Artifact Registry → Repositories → 選擇 repo → Cleanup policies

## 安全性 / 不影響 Cloud Functions 與 Rollback 的保證

- **不會刪除仍有 Tag 的映像**：本策略的 Delete 條件限定 `tagState: UNTAGGED`。
- **Keep policy 優先**：即使未來有人加了更激進的 Delete，Keep most recent 3 仍會保住最近版本（相當於保底）。
- **對 rollback 的影響**：
  - Firebase/Cloud Run rollback 依賴你要回退的 revision 對應映像是否仍存在。
  - 本策略保留每個 artifact 最新 3 版，足以涵蓋「立即回退」與「上一版/前兩版」的常見情境。
  - 若你的流程需要更長 rollback 視窗（例如要保留 14 天或保留 10 版），只要調整 `keepCount` / `olderThan` 即可。

## 需要的權限

執行者需要至少：

- `artifactregistry.repositories.update`（更新 repo cleanup policies）
- `artifactregistry.repositories.get`（describe）

若用 `gcloud`，需完成 `gcloud auth login` 並選擇正確 project/account。

