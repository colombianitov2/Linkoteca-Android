# Linkoteca Android

Aplicación Android de Linkoteca basada en Capacitor. La biblioteca se guarda localmente en el almacenamiento privado del dispositivo; no requiere servidor Node, LAN, OAuth ni sincronización en la nube.

## Desarrollo y compilación

```powershell
npm install
npx cap sync android
$env:JAVA_HOME = "C:\Program Files\Android\openjdk\jdk-21.0.8"
npm run android:debug
npm run android:release
```

El APK firmado se publica como artefacto del release Android. La clave privada de firma se conserva únicamente en el entorno local y no se incluye en GitHub.

## Funciones locales

- Crear, editar, mover, restaurar y eliminar enlaces.
- Selección múltiple y Papelera sin confirmación para enlaces.
- Confirmación conservada para borrar grupos y carpetas.
- Importar y exportar datos JSON/CSV/TXT desde el dispositivo.
- Buscar, descargar e instalar actualizaciones publicadas en GitHub sin desinstalar la app.
- Compartir enlaces hacia Linkoteca desde Android.
