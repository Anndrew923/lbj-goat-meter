# 清除所有緩存與快取後建置 Debug APK
# Usage: .\scripts\clean-and-build-debug-apk.ps1
# Or: npm run android:apk:clean

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $ProjectRoot "android\gradlew.bat"))) {
    $ProjectRoot = (Get-Location).Path
}

Set-Location $ProjectRoot

Write-Host "=== 1. 清除 npm 快取 ===" -ForegroundColor Cyan
npm cache clean --force 2>$null
Write-Host "npm cache cleaned." -ForegroundColor Green

Write-Host "`n=== 2. 清除 Web 建置產物與快取 ===" -ForegroundColor Cyan
if (Test-Path "dist") { Remove-Item -Recurse -Force dist; Write-Host "Removed dist/" -ForegroundColor Green }
if (Test-Path "node_modules\.cache") { Remove-Item -Recurse -Force node_modules\.cache; Write-Host "Removed node_modules/.cache" -ForegroundColor Green }
if (Test-Path "node_modules\.vite") { Remove-Item -Recurse -Force node_modules\.vite; Write-Host "Removed node_modules/.vite" -ForegroundColor Green }

Write-Host "`n=== 3. 清除 Android 建置緩存 (Gradle clean) ===" -ForegroundColor Cyan
Set-Location (Join-Path $ProjectRoot "android")
& .\gradlew.bat clean --no-daemon 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    & .\gradlew.bat clean
}
Set-Location $ProjectRoot
Write-Host "Gradle clean done." -ForegroundColor Green

Write-Host "`n=== 4. 建置 Debug APK (vite build + cap sync + assembleDebug) ===" -ForegroundColor Cyan
& "$PSScriptRoot\build-android.ps1" assembleDebug
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    $apk = Join-Path $ProjectRoot "android\app\build\outputs\apk\debug\app-debug.apk"
    if (Test-Path $apk) {
        Write-Host "`nDebug APK: $apk" -ForegroundColor Green
    }
}
exit $exitCode
