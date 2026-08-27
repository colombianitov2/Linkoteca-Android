$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Program Files (x86)\Android\android-sdk" }
$JavaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Program Files\Android\openjdk\jdk-21.0.8" }
$SigningFile = Join-Path $ProjectRoot "signing.properties"
if (-not (Test-Path $SigningFile)) { throw "Falta signing.properties en la raíz del proyecto." }
$Signing = ConvertFrom-StringData (Get-Content -LiteralPath $SigningFile -Raw)
$Keystore = Join-Path $ProjectRoot $Signing.storeFile
if (-not (Test-Path $Keystore)) { throw "Falta el almacén de firma configurado." }
if ([string]::IsNullOrWhiteSpace($Signing.storePassword) -or [string]::IsNullOrWhiteSpace($Signing.keyAlias) -or [string]::IsNullOrWhiteSpace($Signing.keyPassword)) { throw "La configuración de firma está incompleta." }
if (-not (Test-Path (Join-Path $JavaRoot "bin\java.exe"))) { throw "No se encontró JDK 21 en $JavaRoot." }

$env:JAVA_HOME = $JavaRoot
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$JavaRoot\bin;$env:Path"
$Dist = Join-Path $ProjectRoot "dist"
$Version = (Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$Output = Join-Path $Dist "Linkoteca-Android-$Version.apk"
$Apksigner = Join-Path $SdkRoot "build-tools\36.0.0\apksigner.bat"

New-Item -ItemType Directory -Path $Dist -Force | Out-Null
& (Join-Path $ProjectRoot "android\gradlew.bat") -p (Join-Path $ProjectRoot "android") assembleRelease
if ($LASTEXITCODE -ne 0) { throw "La compilación Android falló." }
$SignedApk = Join-Path $ProjectRoot "android\app\build\outputs\apk\release\app-release.apk"
if (-not (Test-Path $SignedApk)) { throw "Gradle no generó el APK firmado." }
Copy-Item -LiteralPath $SignedApk -Destination $Output -Force
& $Apksigner verify --verbose $Output
Write-Host "APK firmado: $Output" -ForegroundColor Green
