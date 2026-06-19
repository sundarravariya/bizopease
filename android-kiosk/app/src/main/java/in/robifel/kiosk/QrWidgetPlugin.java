package in.robifel.kiosk;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "QrWidget")
public class QrWidgetPlugin extends Plugin {

    public static final String PREFS_NAME = "kiosk_widget";
    public static final String KEY_QR_URL = "qr_url";

    /** Called from JS: saveQrUrl({ url: '...' }) — persists URL and refreshes widget. */
    @PluginMethod
    public void saveQrUrl(PluginCall call) {
        String url = call.getString("url", "");
        SharedPreferences prefs = getContext()
            .getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_QR_URL, url).apply();

        // Trigger AppWidgetProvider.onUpdate via broadcast
        Intent intent = new Intent(getContext(), QrAppWidget.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(getContext())
            .getAppWidgetIds(new ComponentName(getContext(), QrAppWidget.class));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        getContext().sendBroadcast(intent);

        call.resolve();
    }
}
