import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';

interface ScreenSecurityPlugin { setSecure(opts: { enabled: boolean }): Promise<void>; }
const ScreenSecurity = registerPlugin<ScreenSecurityPlugin>('ScreenSecurity');

interface NfcPlugin {
  isAvailable(): Promise<{ available: boolean; enabled: boolean }>;
  scan(): Promise<{ uid: string }>;
  cancel(): Promise<void>;
  consumeLaunchTag(): Promise<{ uid: string }>;
  addListener(event: 'tagScanned', cb: (data: { uid: string }) => void): Promise<{ remove: () => void }>;
}
const Nfc = registerPlugin<NfcPlugin>('Nfc');

/** Subscribe to background tag taps (app launched/woken by an NFC tag). */
export async function onTagScanned(cb: (uid: string) => void): Promise<() => void> {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  try {
    const h = await Nfc.addListener('tagScanned', d => cb((d?.uid || '').toUpperCase()));
    return () => { try { h.remove(); } catch { /* ignore */ } };
  } catch { return () => {}; }
}

/** Pick up a tag that cold-launched the app (call once on startup). */
export async function consumeLaunchTag(): Promise<string> {
  if (Capacitor.getPlatform() !== 'android') return '';
  try { const r = await Nfc.consumeLaunchTag(); return (r?.uid || '').toUpperCase(); } catch { return ''; }
}

export const isNative = () => Capacitor.isNativePlatform();

/** Whether this device has NFC hardware and it's switched on. */
export async function nfcStatus(): Promise<{ available: boolean; enabled: boolean }> {
  if (Capacitor.getPlatform() !== 'android') return { available: false, enabled: false };
  try { return await Nfc.isAvailable(); } catch { return { available: false, enabled: false }; }
}

/** Wait for the next NFC tag tap and return its hex UID. Rejects on error/no-NFC. */
export async function scanNfc(): Promise<string> {
  const r = await Nfc.scan();
  return (r?.uid || '').toUpperCase();
}

export async function cancelNfc(): Promise<void> {
  try { await Nfc.cancel(); } catch { /* ignore */ }
}

/** Block screenshots + screen recording for employee accounts (Android only). */
export async function applyScreenSecurity(isEmployee: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try { await ScreenSecurity.setSecure({ enabled: isEmployee }); } catch { /* ignore */ }
}

export interface Position { lat: number; lng: number; accuracy?: number }

/** Get current GPS position — native plugin on device, browser API on web.
 * Tries a fast fix first (low accuracy + a recently cached position) so the UI
 * doesn't stall on a cold high-accuracy lock, then falls back to a fresh
 * high-accuracy fix if the fast path fails. */
export async function getPosition(): Promise<Position | null> {
  try {
    if (isNative()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        perm = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
      }
      try {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 });
        return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      } catch {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
      }
    }
    const p: GeolocationPosition = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }));
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch { return null; }
}

export type LocationStatus = 'ok' | 'permission_denied' | 'gps_off';

/**
 * Check whether location services are available and permitted.
 * Returns 'ok' if a position can be obtained, 'permission_denied' if the user
 * has blocked the app, or 'gps_off' if the device GPS/location is disabled.
 */
export async function checkLocationEnabled(): Promise<LocationStatus> {
  try {
    if (isNative()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        perm = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return 'permission_denied';
      }
      // Permission granted — confirm a fix can be obtained. Accept a recently
      // cached position and allow a generous timeout so a slow first-fix on a
      // device that has GPS *on* is not misreported as "GPS off".
      try {
        await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
        return 'ok';
      } catch (e: any) {
        const msg = String(e?.message || e?.errorMessage || e || '').toLowerCase();
        // Only report GPS-off when the platform explicitly says location
        // services are disabled/unavailable. A plain timeout means GPS is on
        // but couldn't get a fast fix — don't lock the employee out for that.
        if (msg.includes('disabled') || msg.includes('not enabled') ||
            msg.includes('location services') || msg.includes('location unavailable') ||
            msg.includes('go to settings') || msg.includes('location setting')) {
          return 'gps_off';
        }
        return 'ok';
      }
    }
    // Web browser path.
    await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 }));
    return 'ok';
  } catch (e: any) {
    // GeolocationPositionError: 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
    if (e?.code === 1) return 'permission_denied';
    if (e?.code === 3) return 'ok'; // timeout with permission granted — GPS is on, just slow
    return 'gps_off';
  }
}

/**
 * Scan a QR code using ML Kit native camera (no app popup). Returns the raw
 * text value. On web/non-native, falls back to browser-based input prompt so
 * admins can test by pasting the URL.
 */
export async function scanQr(): Promise<string> {
  if (!isNative()) {
    // Non-native fallback: paste the QR URL manually (admin test mode).
    const val = prompt('Paste QR URL (development mode):');
    if (!val) throw new Error('QR scan cancelled.');
    return val;
  }
  // Request camera permission first.
  const perm = await BarcodeScanner.checkPermissions();
  if (perm.camera !== 'granted') {
    const req = await BarcodeScanner.requestPermissions();
    if (req.camera !== 'granted') throw new Error('Camera permission is required for QR scanning.');
  }
  const result = await BarcodeScanner.scan({
    formats: [BarcodeFormat.QrCode],
  });
  const barcode = result.barcodes?.[0];
  if (!barcode?.rawValue) throw new Error('No QR code found. Please try again.');
  return barcode.rawValue;
}

/**
 * Scan any barcode (Code128, Code39, EAN, QR, etc.) using ML Kit native camera.
 * Returns the raw text value. On web/non-native, falls back to a prompt for dev testing.
 */
export async function scanBarcode(): Promise<string> {
  if (!isNative()) {
    const val = prompt('Enter barcode value (development mode):');
    if (!val) throw new Error('Scan cancelled.');
    return val;
  }
  const perm = await BarcodeScanner.checkPermissions();
  if (perm.camera !== 'granted') {
    const req = await BarcodeScanner.requestPermissions();
    if (req.camera !== 'granted') throw new Error('Camera permission is required for barcode scanning.');
  }
  const result = await BarcodeScanner.scan({
    formats: [
      BarcodeFormat.Code128, BarcodeFormat.Code39, BarcodeFormat.Code93,
      BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE,
      BarcodeFormat.QrCode, BarcodeFormat.DataMatrix, BarcodeFormat.Pdf417,
    ],
  });
  const barcode = result.barcodes?.[0];
  if (!barcode?.rawValue) throw new Error('No barcode found. Please try again.');
  return barcode.rawValue;
}

/** Capture a front-camera selfie as base64 (no data: prefix). Best-effort. */
export async function captureSelfie(): Promise<string | false> {
  if (!isNative()) return false;
  try {
    const photo = await Camera.getPhoto({
      quality: 55, width: 600, allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      direction: CameraDirection.Front,
    });
    return photo.base64String || false;
  } catch { return false; }
}
