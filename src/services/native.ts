import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Camera, CameraResultType, CameraSource, CameraDirection } from '@capacitor/camera';

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

/** Get current GPS position — native plugin on device, browser API on web. */
export async function getPosition(): Promise<Position | null> {
  try {
    if (isNative()) {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        perm = await Geolocation.requestPermissions({ permissions: ['location'] });
        if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
      }
      const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
    }
    const p: GeolocationPosition = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }));
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy };
  } catch { return null; }
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
