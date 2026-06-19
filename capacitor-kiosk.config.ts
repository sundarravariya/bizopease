import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.robifel.kiosk',
  appName: 'Attendance Kiosk',
  webDir: 'dist-kiosk',
  server: {
    // Same-origin as Odoo — avoids CORS entirely. Kiosk SPA is served at /kiosk/.
    url: 'https://bizopease.robifel.in/kiosk/',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['bizopease.robifel.in'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0f1422',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f1422',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body' as any,
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
  android: {
    path: 'android-kiosk',
    backgroundColor: '#0f1422',
    allowMixedContent: false,
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
