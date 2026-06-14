package in.robifel.portal;

import android.content.Intent;
import android.os.Bundle;
import android.os.Process;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before the bridge initializes.
        registerPlugin(ScreenSecurityPlugin.class);
        registerPlugin(NfcPlugin.class);
        super.onCreate(savedInstanceState);

        // A tag tap may have cold-launched the app — forward it to JS.
        NfcPlugin.handleTagIntent(getIntent());

        // Boost UI thread priority to reduce input event latency
        Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        // Force GPU-composited rendering — eliminates software-draw stalls on keystrokes
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);

        // Stop over-scroll bounce which causes frame drops during fast typing
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);

        // Disable safe-browsing URL checks — each keystroke can trigger a lookup
        settings.setSafeBrowsingEnabled(false);

        // Keep cache warm so network isn't hit for static assets on every interaction
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // DOM storage needed for session state; keep enabled
        settings.setDomStorageEnabled(true);

        // Smooth text rendering
        settings.setTextZoom(100);

        // Allow the page to set its own viewport (already set by the portal, but be explicit)
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // App was already running and a tag was tapped — forward the UID live.
        NfcPlugin.handleTagIntent(intent);
    }
}
