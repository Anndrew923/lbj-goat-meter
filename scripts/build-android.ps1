# Android build: use JDK 21 so Gradle does not fail when JAVA_HOME is JDK 17.
# Usage: .\scripts\build-android.ps1 assembleDebug | assembleRelease | bundleRelease
# Or: npm run android:apk | android:release-apk | android:aab

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("assembleDebug", "assembleRelease", "bundleRelease")]
    [string]$Task,
    [switch]$SkipSync
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $ProjectRoot "android\gradlew.bat"))) {
    $ProjectRoot = (Get-Location).Path
}
$AndroidDir = Join-Path $ProjectRoot "android"

$Jdk21Paths = @(
    "C:\Program Files\Microsoft\jdk-21*",
    "C:\Program Files\Eclipse Adoptium\jdk-21*",
    "C:\Program Files\Java\jdk-21*",
    "C:\Program Files\Amazon Corretto\jdk21*"
)
$Jdk21 = $null
if ($env:JAVA_HOME -and (Test-Path $env:JAVA_HOME)) {
    $v = cmd /c "`"$env:JAVA_HOME\bin\java`" -version 2>&1"
    if ($v -match "21\.") { $Jdk21 = $env:JAVA_HOME }
}
if (-not $Jdk21) {
    foreach ($pattern in $Jdk21Paths) {
        $dirs = Get-Item $pattern -ErrorAction SilentlyContinue | Sort-Object Name -Descending
        if ($dirs) { $Jdk21 = $dirs[0].FullName; break }
    }
}
if (-not $Jdk21) {
    Write-Host "ERROR: JDK 21 not found. Set JAVA_HOME to JDK 21 or install to Program Files\Microsoft\jdk-21.x" -ForegroundColor Red
    exit 1
}
$env:JAVA_HOME = $Jdk21
Write-Host "Using JAVA_HOME=$env:JAVA_HOME" -ForegroundColor Cyan

if (-not $SkipSync) {
    Set-Location $ProjectRoot
    Write-Host "Running npm run build ..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Running npx cap sync android ..." -ForegroundColor Cyan
    npx cap sync android
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Set-Location $AndroidDir
Write-Host "Running gradlew.bat $Task ..." -ForegroundColor Cyan
& .\gradlew.bat $Task
$exitCode = $LASTEXITCODE
Set-Location $ProjectRoot

if ($exitCode -eq 0) {
    if ($Task -eq "assembleDebug") {
        $apk = Join-Path $AndroidDir "app\build\outputs\apk\debug\app-debug.apk"
        if (Test-Path $apk) { Write-Host ""; Write-Host "Debug APK: $apk" -ForegroundColor Green }
    }
    if ($Task -eq "assembleRelease") {
        $apk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
        if (Test-Path $apk) { Write-Host ""; Write-Host "Release APK: $apk" -ForegroundColor Green }
    }
    if ($Task -eq "bundleRelease") {
        $aab = Join-Path $AndroidDir "app\build\outputs\bundle\release\app-release.aab"
        if (Test-Path $aab) { Write-Host ""; Write-Host "AAB: $aab" -ForegroundColor Green }
    }
}
exit $exitCode
