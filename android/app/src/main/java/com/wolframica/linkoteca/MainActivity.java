package com.wolframica.linkoteca;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_CREATE_EXPORT = 4101;
    private static final int REQUEST_OPEN_IMPORT = 4102;
    private static final String LATEST_RELEASE_URL = "https://api.github.com/repos/colombianitov2/Linkoteca-Android/releases/latest";
    private static final Pattern URL_PATTERN = Pattern.compile("https?://\\S+", Pattern.CASE_INSENSITIVE);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile String pendingExportContent = "";
    private volatile String pendingImportContent = "";
    private volatile String pendingImportName = "";
    private volatile File pendingUpdateFile;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new FileBridge(), "LinkotecaFiles");
            getBridge().getWebView().addJavascriptInterface(new UpdateBridge(), "LinkotecaUpdater");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingUpdateFile != null && canInstallPackages()) {
            File updateFile = pendingUpdateFile;
            pendingUpdateFile = null;
            openPackageInstaller(updateFile);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleSharedIntent(intent);
    }

    private final class FileBridge {
        @JavascriptInterface
        public void saveFile(String fileName, String mimeType, String content) {
            runOnUiThread(() -> {
                pendingExportContent = content == null ? "" : content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
                intent.putExtra(Intent.EXTRA_TITLE, fileName == null || fileName.isEmpty() ? "linkoteca-android.json" : fileName);
                startActivityForResult(intent, REQUEST_CREATE_EXPORT);
            });
        }

        @JavascriptInterface
        public void openFile(String mimeType) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(mimeType == null || mimeType.isEmpty() ? "*/*" : mimeType);
                startActivityForResult(intent, REQUEST_OPEN_IMPORT);
            });
        }

        @JavascriptInterface
        public synchronized String takeImportedContent() {
            String value = pendingImportContent;
            pendingImportContent = "";
            return value;
        }

        @JavascriptInterface
        public synchronized String takeImportedName() {
            String value = pendingImportName;
            pendingImportName = "";
            return value;
        }
    }

    private final class UpdateBridge {
        @JavascriptInterface
        public void checkForUpdate() {
            dispatchUpdateStatus("checking", "Buscando la versión más reciente…", "");
            new Thread(() -> {
                try {
                    JSONObject release = readJson(LATEST_RELEASE_URL);
                    String version = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                    if (version.isEmpty()) throw new IllegalStateException("El release no informa una versión válida");
                    String currentVersion = getCurrentVersion();
                    if (compareVersions(version, currentVersion) <= 0) {
                        dispatchUpdateStatus("up-to-date", "Ya tienes la versión más reciente (" + currentVersion + ").", version);
                        return;
                    }

                    String downloadUrl = "";
                    JSONArray assets = release.optJSONArray("assets");
                    if (assets == null) throw new IllegalStateException("El release más reciente no contiene archivos");
                    for (int index = 0; index < assets.length(); index++) {
                        JSONObject asset = assets.optJSONObject(index);
                        if (asset != null && asset.optString("name", "").toLowerCase().endsWith(".apk")) {
                            downloadUrl = asset.optString("browser_download_url", "");
                            break;
                        }
                    }
                    if (downloadUrl.isEmpty()) throw new IllegalStateException("El release más reciente no contiene un APK");

                    dispatchUpdateStatus("downloading", "Descargando Linkoteca " + version + "…", version);
                    File updateFile = downloadApk(downloadUrl, version);
                    runOnUiThread(() -> requestPackageInstall(updateFile, version));
                } catch (Exception error) {
                    dispatchUpdateStatus("error", "No se pudo actualizar: " + safeMessage(error), "");
                }
            }, "linkoteca-update").start();
        }
    }

    private JSONObject readJson(String sourceUrl) throws Exception {
        HttpURLConnection connection = openConnection(sourceUrl);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        requireSuccessfulResponse(connection);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            copy(input, output);
            return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        } finally {
            connection.disconnect();
        }
    }

    private File downloadApk(String sourceUrl, String version) throws Exception {
        HttpURLConnection connection = openConnection(sourceUrl);
        requireSuccessfulResponse(connection);
        File updateDirectory = new File(getCacheDir(), "updates");
        if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
            throw new IllegalStateException("No se pudo preparar la descarga");
        }
        File outputFile = new File(updateDirectory, "Linkoteca-Android-" + version + ".apk");
        try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(outputFile, false)) {
            copy(input, output);
        } finally {
            connection.disconnect();
        }
        if (outputFile.length() == 0) throw new IllegalStateException("GitHub devolvió un archivo vacío");
        return outputFile;
    }

    private HttpURLConnection openConnection(String sourceUrl) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(sourceUrl).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "Linkoteca-Android/" + getCurrentVersion());
        return connection;
    }

    private void requireSuccessfulResponse(HttpURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("GitHub respondió HTTP " + status);
        }
    }

    private void copy(InputStream input, OutputStream output) throws Exception {
        byte[] buffer = new byte[16384];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
    }

    private int compareVersions(String left, String right) {
        String[] leftParts = left.split("[.-]");
        String[] rightParts = right.split("[.-]");
        int length = Math.max(leftParts.length, rightParts.length);
        for (int index = 0; index < length; index++) {
            int leftValue = index < leftParts.length ? numericVersionPart(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? numericVersionPart(rightParts[index]) : 0;
            if (leftValue != rightValue) return Integer.compare(leftValue, rightValue);
        }
        return 0;
    }

    private String getCurrentVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            return "0.0.0";
        }
    }

    private int numericVersionPart(String value) {
        try {
            String digits = value.replaceAll("[^0-9].*$", "");
            return digits.isEmpty() ? 0 : Integer.parseInt(digits);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private boolean canInstallPackages() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
    }

    private void requestPackageInstall(File updateFile, String version) {
        if (!canInstallPackages()) {
            pendingUpdateFile = updateFile;
            dispatchUpdateStatus("permission", "Autoriza a Linkoteca para instalar la actualización " + version + ".", version);
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
            startActivity(settingsIntent);
            return;
        }
        openPackageInstaller(updateFile);
    }

    private void openPackageInstaller(File updateFile) {
        try {
            Uri apkUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", updateFile);
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            dispatchUpdateStatus("installing", "Descarga lista. Confirma la actualización en Android.", "");
            startActivity(installIntent);
        } catch (Exception error) {
            dispatchUpdateStatus("error", "No se pudo abrir el instalador: " + safeMessage(error), "");
        }
    }

    private String safeMessage(Exception error) {
        return error.getMessage() == null || error.getMessage().trim().isEmpty() ? error.getClass().getSimpleName() : error.getMessage();
    }

    private void dispatchUpdateStatus(String status, String message, String version) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("status", status);
            detail.put("message", message);
            detail.put("version", version);
            String script = "window.dispatchEvent(new CustomEvent('linkoteca:update-status',{detail:" + detail + "}));";
            mainHandler.post(() -> {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(script, null);
                }
            });
        } catch (Exception ignored) {
            // El actualizador no debe impedir el uso normal de Linkoteca.
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try {
            if (requestCode == REQUEST_CREATE_EXPORT) {
                try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IllegalStateException("No se pudo abrir el archivo");
                    output.write(pendingExportContent.getBytes(StandardCharsets.UTF_8));
                }
                pendingExportContent = "";
                dispatchFileEvent("linkoteca:export-complete");
            } else if (requestCode == REQUEST_OPEN_IMPORT) {
                try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new IllegalStateException("No se pudo abrir el archivo");
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                    pendingImportContent = output.toString(StandardCharsets.UTF_8.name());
                    pendingImportName = uri.getLastPathSegment() == null ? "respaldo.json" : uri.getLastPathSegment();
                }
                dispatchFileEvent("linkoteca:import-file");
            }
        } catch (Exception error) {
            dispatchFileError(error.getMessage());
        }
    }

    private void dispatchFileEvent(String eventName) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent(" + JSONObject.quote(eventName) + "));",
            null
        );
    }

    private void dispatchFileError(String message) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        String script = "window.dispatchEvent(new CustomEvent('linkoteca:file-error',{detail:" + JSONObject.quote(message == null ? "Error de archivo" : message) + "}));";
        getBridge().getWebView().evaluateJavascript(script, null);
    }

    private void handleSharedIntent(Intent intent) {
        if (intent == null) return;

        String action = intent.getAction();
        String sharedText = null;

        if (Intent.ACTION_SEND.equals(action)) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            sharedText = text == null ? null : text.toString();
        } else if (Intent.ACTION_VIEW.equals(action) && intent.getDataString() != null) {
            sharedText = intent.getDataString();
        }

        String url = extractFirstUrl(sharedText);
        if (url == null) return;

        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        dispatchSharedLink(url, subject, sharedText);
    }

    private String extractFirstUrl(String value) {
        if (value == null) return null;
        Matcher matcher = URL_PATTERN.matcher(value);
        if (!matcher.find()) return null;
        return matcher.group()
            .replaceAll("[\\s)\\]}>,.;]+$", "");
    }

    private void dispatchSharedLink(String url, String title, String text) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("url", url);
            payload.put("title", title == null ? "" : title);
            payload.put("text", text == null ? "" : text);
            payload.put("source", "android-share");

            String json = payload.toString();
            String script =
                "window.__linkotecaPendingShare = " + json + ";" +
                "window.dispatchEvent(new CustomEvent('linkoteca:shared-link', { detail: " + json + " }));";

            // The page can still be loading when Android opens the app from the share sheet.
            // Run the dispatch a few times; the web app also reads __linkotecaPendingShare on boot.
            for (int delay : new int[] { 150, 700, 1500 }) {
                mainHandler.postDelayed(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().evaluateJavascript(script, null);
                    }
                }, delay);
            }
        } catch (Exception ignored) {
            // Sharing should never prevent Linkoteca from opening normally.
        }
    }
}
