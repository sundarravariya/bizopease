package in.robifel.kiosk;

import android.os.Bundle;
import android.os.Process;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(QrWidgetPlugin.class);
        super.onCreate(savedInstanceState);

        Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        settings.setSafeBrowsingEnabled(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setDomStorageEnabled(true);
        settings.setTextZoom(100);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // Keep screen on — kiosk is always-on display
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
