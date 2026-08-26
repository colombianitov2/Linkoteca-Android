$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { "C:\Program Files (x86)\Android\android-sdk" }
$JavaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { "C:\Program Files\Android\openjdk\jdk-21.0.8" }
$Keystore = Join-Path $ProjectRoot "release-key.jks"
$Password = $env:LINKOTECA_KEYSTORE_PASSWORD
if (-not (Test-Path $Keystore)) { throw "Falta release-key.jks en la raíz del proyecto." }
if ([string]::IsNullOrWhiteSpace($Password)) { throw "Define LINKOTECA_KEYSTORE_PASSWORD antes de firmar." }
if (-not (Test-Path (Join-Path $JavaRoot "bin\java.exe"))) { throw "No se encontró JDK 21 en $JavaRoot." }

$env:JAVA_HOME = $JavaRoot
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:Path = "$JavaRoot\bin;$env:Path"
$Dist = Join-Path $ProjectRoot "dist"
$Version = (Get-Content (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json).version
$Unsigned = Join-Path $ProjectRoot "android\app\build\outputs\apk\release\app-release-unsigned.apk"
$Aligned = Join-Path $Dist "Linkoteca-Android-$Version-aligned.apk"
$Output = Join-Path $Dist "Linkoteca-Android-$Version.apk"
$Zipalign = Join-Path $SdkRoot "build-tools\36.0.0\zipalign.exe"
$Apksigner = Join-Path $SdkRoot "build-tools\36.0.0\apksigner.bat"

New-Item -ItemType Directory -Path $Dist -Force | Out-Null
& (Join-Path $ProjectRoot "android\gradlew.bat") -p (Join-Path $ProjectRoot "android") assembleRelease
if ($LASTEXITCODE -ne 0) { throw "La compilación Android falló." }
& $Zipalign -f 4 $Unsigned $Aligned
& $Apksigner sign --ks $Keystore --ks-key-alias linkoteca --ks-pass "env:LINKOTECA_KEYSTORE_PASSWORD" --key-pass "env:LINKOTECA_KEYSTORE_PASSWORD" --out $Output $Aligned
& $Apksigner verify --verbose $Output
Write-Host "APK firmado: $Output" -ForegroundColor Green
