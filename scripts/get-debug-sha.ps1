# 提取 debug.keystore 的 SHA-1 / SHA-256 指紋，供 Firebase Console 與 Google Cloud Credentials 使用。
# 用法：在專案根目錄執行 .\scripts\get-debug-sha.ps1

$keystore = Join-Path $env:USERPROFILE ".android\debug.keystore"
if (-not (Test-Path $keystore)) {
    Write-Host "找不到 debug.keystore: $keystore" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Debug Keystore SHA 指紋 ===" -ForegroundColor Cyan
Write-Host "Keystore: $keystore`n"

$out = & keytool -list -v -keystore $keystore -alias androiddebugkey -storepass android 2>&1
$out | Out-String

# 解析並醒目顯示 SHA-1 / SHA-256（方便複製）
$sha1 = ($out | Select-String "SHA1:\s*([0-9A-F:]+)").Matches.Groups[1].Value
$sha256 = ($out | Select-String "SHA256:\s*([0-9A-F:]+)").Matches.Groups[1].Value

if ($sha1) { Write-Host "`n>>> 請將以下指紋加入 Firebase Console 與 Google Cloud Credentials <<<`n" -ForegroundColor Yellow; Write-Host "SHA-1:   $sha1" -ForegroundColor Green; Write-Host "SHA-256: $sha256" -ForegroundColor Green }
Write-Host "`n替代方式：在 android 目錄執行 .\gradlew.bat signingReport 可取得完整簽署報告。`n"
