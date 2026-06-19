package in.robifel.kiosk;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.widget.RemoteViews;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.qrcode.QRCodeWriter;

import java.util.HashMap;
import java.util.Map;

public class QrAppWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        SharedPreferences prefs = ctx.getSharedPreferences(
            QrWidgetPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String qrUrl = prefs.getString(QrWidgetPlugin.KEY_QR_URL, "");

        for (int id : ids) {
            RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_qr);

            if (!qrUrl.isEmpty()) {
                Bitmap bmp = generateQr(qrUrl, 300);
                if (bmp != null) views.setImageViewBitmap(R.id.widgetQrImage, bmp);
                views.setTextViewText(R.id.widgetStatus, "Tap to open kiosk");
            } else {
                views.setTextViewText(R.id.widgetStatus, "Open Kiosk app first");
            }

            // Tap → open kiosk app
            Intent launch = new Intent(ctx, MainActivity.class);
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(ctx, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            views.setOnClickPendingIntent(R.id.widgetQrImage, pi);

            mgr.updateAppWidget(id, views);
        }
    }

    private static Bitmap generateQr(String url, int size) {
        try {
            Map<EncodeHintType, Object> hints = new HashMap<>();
            hints.put(EncodeHintType.MARGIN, 1);
            var matrix = new QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, size, size, hints);
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            for (int x = 0; x < size; x++)
                for (int y = 0; y < size; y++)
                    bmp.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
            return bmp;
        } catch (Exception e) { return null; }
    }
}
