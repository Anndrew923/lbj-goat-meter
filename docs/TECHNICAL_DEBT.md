# 技術債清單（Technical Debt）

> 正式版上架後再回頭清理。不影響 Firebase Reads 與打包。

---

## React Hooks 依賴陣列（eslint react-hooks/exhaustive-deps）

以下為 **Warning**，非 Error；已確認 **不會造成無限重複讀取**（皆為 useMemo/useCallback，非 useEffect 內之 Firestore 訂閱）。

| 檔案 | 行號 | 說明 | 風險 |
|------|------|------|------|
| **AnalyticsDashboard.jsx** | 139 | `useMemo(() => getReasonLabelMap(), [i18n.language])` — 依賴 `i18n.language` 被標為「多餘」 | 僅依賴宣告爭議；語系切換時仍會因父層 re-render 取得新 labels，不影響 Firebase |
| **BattleCard.jsx** | 173 | `useCallback(..., [battleTitle, ...])` — 缺少依賴 `cardRef` | ref 為穩定引用，補上亦不改變行為；不觸發重複請求 |
| **VotingArena.jsx** | 87 | `useMemo(() => shuffle(getReasonsForStance(...)), [selectedStance, i18n.language])` — `i18n.language` 被標為「多餘」 | 同上，無 Firestore 在該 useMemo 路徑 |

**結論**：三處皆為單純依賴宣告不完整／多餘，不影響效能與 Reads，列為技術債待正式版後清理。
