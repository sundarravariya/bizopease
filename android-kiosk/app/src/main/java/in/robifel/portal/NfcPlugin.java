package in.robifel.portal;

import android.content.Intent;
import android.nfc.NfcAdapter;
import android.nfc.Tag;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NFC support:
 *  - scan()/cancel(): reader mode for the foreground kiosk / check-in screens.
 *  - Tag dispatch: when a tag is tapped while the app is backgrounded/closed,
 *    Android launches the app (manifest intent-filters) and we forward the UID
 *    to JS via the "tagScanned" event (or consumeLaunchTag() on cold start).
 */
@CapacitorPlugin(name = "Nfc")
public class NfcPlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private static final int READER_FLAGS =
            NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B |
            NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V |
            NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

    private static NfcPlugin instance;
    private static String pendingLaunchUid;

    private PluginCall pendingCall;

    @Override
    public void load() {
        instance = this;
    }

    static String bytesToHex(byte[] id) {
        StringBuilder sb = new StringBuilder();
        for (byte b : id) sb.append(String.format("%02X", b));
        return sb.toString();
    }

    /** Called by MainActivity for NFC launch/new intents. */
    public static void handleTagIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        if (!NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)) return;
        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        if (tag == null) return;
        String uid = bytesToHex(tag.getId());
        pendingLaunchUid = uid;
        if (instance != null) {
            JSObject d = new JSObject();
            d.put("uid", uid);
            instance.notifyListeners("tagScanned", d);
        }
    }

    /** JS calls this on startup to pick up a tag that cold-launched the app. */
    @PluginMethod
    public void consumeLaunchTag(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("uid", pendingLaunchUid == null ? "" : pendingLaunchUid);
        pendingLaunchUid = null;
        call.resolve(ret);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        JSObject ret = new JSObject();
        ret.put("available", adapter != null);
        ret.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (adapter == null) { call.reject("NFC is not available on this device"); return; }
        if (!adapter.isEnabled()) { call.reject("NFC is turned off. Enable NFC in settings."); return; }
        pendingCall = call;
        bridge.saveCall(call);
        getActivity().runOnUiThread(() ->
                adapter.enableReaderMode(getActivity(), this, READER_FLAGS, null));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        stopReader();
        pendingCall = null;
        call.resolve();
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        String uid = bytesToHex(tag.getId());
        stopReader();
        if (pendingCall != null) {
            JSObject ret = new JSObject();
            ret.put("uid", uid);
            pendingCall.resolve(ret);
            pendingCall = null;
        }
    }

    private void stopReader() {
        NfcAdapter adapter = NfcAdapter.getDefaultAdapter(getContext());
        if (adapter != null && getActivity() != null) {
            getActivity().runOnUiThread(() -> adapter.disableReaderMode(getActivity()));
        }
    }
}
