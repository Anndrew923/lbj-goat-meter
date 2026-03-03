# The GOAT Meter — 一鍵打包 AAB + Release APK
# 專案需 Java 21，若系統 JAVA_HOME 為 17，此腳本會改用 PATH 中的 JDK 21

$javaCmd = Get-Command java -ErrorAction SilentlyContinue
if ($javaCmd) {
    $jdkRoot = Split-Path (Split-Path $javaCmd.Source -Parent) -Parent
    $versionOutput = & java -version 2>&1
    if ($versionOutput -match "version `"21\.) {
        $env:JAVA_HOME = $jdkRoot
        Write-Host "Using JAVA_HOME=$env:JAVA_HOME (Java 21)" -ForegroundColor Green
    }
}

Set-Location $PSScriptRoot
.\gradlew.bat bundleRelease assembleRelease --no-daemon

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== 建置完成 ===" -ForegroundColor Green
    Write-Host "AAB: app\build\outputs\bundle\release\app-release.aab"
    Write-Host "APK: app\build\outputs\apk\release\app-release.apk"
}
