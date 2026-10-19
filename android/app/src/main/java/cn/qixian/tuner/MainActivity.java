package cn.qixian.tuner;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/** Small offline host. The tuner, signal processing, and preferences live in bundled web assets. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String APP_URL = "https://" + HOST + "/";
    private static final int MICROPHONE_REQUEST = 41;
    private WebView webView;
    private PermissionRequest pendingMicrophone;
    private boolean reloadOnResume;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 243, 237));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(245, 243, 237));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        // Keep controls out of status, navigation, and cutout areas on Android 15+.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets.consumeSystemWindowInsets();
            }
        });
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setUserAgentString(settings.getUserAgentString() + " QixianAndroid/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri destination = request.getUrl();
                if (isLocalOrigin(destination)) return false;
                // Open only deliberate HTTPS link taps outside this offline WebView.
                if (request.isForMainFrame() && request.hasGesture()
                        && "https".equals(destination.getScheme()) && destination.getHost() != null) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, destination));
                    } catch (ActivityNotFoundException | SecurityException error) {
                        Toast.makeText(MainActivity.this, "未找到可打开此链接的浏览器", Toast.LENGTH_LONG).show();
                    }
                }
                return true;
            }
        });
        // A PWA service worker must use exactly the same offline resource boundary.
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) {
                return serveAsset(request);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() { handleMicrophoneRequest(request); }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMicrophone == request) pendingMicrophone = null;
            }
        });
        webView.loadUrl(APP_URL);
    }

    private static boolean isLocalOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private void handleMicrophoneRequest(PermissionRequest request) {
        if (isFinishing() || isDestroyed() || !isLocalOrigin(request.getOrigin())
                || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (pendingMicrophone != null) pendingMicrophone.deny();
        pendingMicrophone = request;
        requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, MICROPHONE_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_REQUEST || pendingMicrophone == null) return;
        PermissionRequest request = pendingMicrophone;
        pendingMicrophone = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED
                && !isFinishing() && !isDestroyed() && isLocalOrigin(request.getOrigin())) {
            request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
        }
    }

    private WebResourceResponse serveAsset(WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isLocalOrigin(uri) || !"GET".equals(request.getMethod())) return errorResponse(403, "Forbidden");
        String path = uri.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        // AssetManager only receives normalized, app-relative paths.
        if (path.contains("..") || path.contains("\\") || path.contains("\u0000")) return errorResponse(403, "Forbidden");
        String filename = path.substring(1);
        String lower = filename.toLowerCase(Locale.ROOT);
        String mime = "application/octet-stream";
        if (lower.endsWith(".html")) mime = "text/html";
        else if (lower.endsWith(".js") || lower.endsWith(".mjs")) mime = "text/javascript";
        else if (lower.endsWith(".css")) mime = "text/css";
        else if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) mime = "application/json";
        else if (lower.endsWith(".svg")) mime = "image/svg+xml";
        else if (lower.endsWith(".png")) mime = "image/png";
        else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mime = "image/jpeg";
        else if (lower.endsWith(".webp")) mime = "image/webp";
        else if (lower.endsWith(".woff2")) mime = "font/woff2";
        else if (lower.endsWith(".woff")) mime = "font/woff";
        else if (lower.endsWith(".wav")) mime = "audio/wav";
        else if (lower.endsWith(".mp3")) mime = "audio/mpeg";
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Permissions-Policy", "microphone=(self), camera=(), geolocation=()");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("www/" + filename));
        } catch (IOException error) {
            return errorResponse(404, "Not Found");
        }
    }

    private static WebResourceResponse errorResponse(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, new HashMap<>(),
            new ByteArrayInputStream(new byte[0]));
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            // A permission dialog can temporarily pause the Activity; preserve that pending gesture.
            if (pendingMicrophone == null) {
                webView.evaluateJavascript("window.dispatchEvent(new Event('guqin-native-pause'));", null);
            }
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        // Destroy the page's capture context when backgrounded, even if web cleanup fails.
        if (pendingMicrophone != null) {
            pendingMicrophone.deny();
            pendingMicrophone = null;
        }
        if (webView != null) {
            webView.loadUrl("about:blank");
            reloadOnResume = true;
        }
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            if (reloadOnResume) {
                reloadOnResume = false;
                webView.loadUrl(APP_URL);
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (pendingMicrophone != null) pendingMicrophone.deny();
        if (webView != null) {
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
