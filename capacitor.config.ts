import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.robifel.portal',
  appName: 'Robifel Admin',
  webDir: 'dist',
  server: {
    // Native shell loads the live app from its own subdomain, which serves the
    // SPA at root and reverse-proxies Odoo (/web, /report, /longpolling) — so
    // session cookies + JSON-RPC work same-origin and stay in sync with deploys.
    url: 'https://dashboard.robifel.in/',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0f1422',
      showSpinner: false,
      spinnerColor: '#7367f0',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0f1422',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'native' as any,
      style: 'DARK',
      resizeOnFullScreen: false,
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0f1422',
    allowsLinkPreview: false,
  },
  android: {
    backgroundColor: '#0f1422',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
