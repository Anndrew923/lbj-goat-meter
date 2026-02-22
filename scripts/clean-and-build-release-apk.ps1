# 清除快取及建置產物後，產生最新版 Release APK
# 使用方式: .\scripts\clean-and-build-release-apk.ps1
# 或: npm run android:release-apk（若僅需建置、不先清快取則用 build-android.ps1）

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host "=== 清除快取與建置產物 ===" -ForegroundColor Cyan
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
    Write-Host "  已刪除 dist/" -ForegroundColor Gray
}
if (Test-Path "node_modules\.cache") {
    Remove-Item -Recurse -Force "node_modules\.cache"
    Write-Host "  已刪除 node_modules/.cache" -ForegroundColor Gray
}
if (Test-Path "android\app\build") {
    Remove-Item -Recurse -Force "android\app\build"
    Write-Host "  已刪除 android/app/build" -ForegroundColor Gray
}
if (Test-Path "android\build") {
    Remove-Item -Recurse -Force "android\build"
    Write-Host "  已刪除 android/build" -ForegroundColor Gray
}
Write-Host "  快取清除完成." -ForegroundColor Green
Write-Host ""

Write-Host "=== 建置 Release APK（npm build -> cap sync -> gradlew assembleRelease）===" -ForegroundColor Cyan
& (Join-Path $ProjectRoot "scripts\build-android.ps1") assembleRelease
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    $apk = Join-Path $ProjectRoot "android\app\build\outputs\apk\release\app-release.apk"
    Write-Host ""
    Write-Host "=== 完成 ===" -ForegroundColor Green
    Write-Host "Release APK: $apk" -ForegroundColor Green
}
exit $exitCode
