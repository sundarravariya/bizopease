import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'in.robifel.portal',
  appName: 'BizOpease',
  webDir: 'dist',
  server: {
    // Native shell loads the live app from the canonical domain, which serves the
    // SPA at root and reverse-proxies Odoo (/web, /report, /longpolling) — so
    // session cookies + JSON-RPC work same-origin and stay in sync with deploys.
    // NOTE: must be the FINAL domain. dashboard.robifel.in 301-redirects here, and
    // a redirect to a host outside this origin makes Capacitor eject to the system
    // browser — which is why the old build "opened in Chrome" on launch.
    url: 'https://bizopease.robifel.in/',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    // Keep these hosts INSIDE the webview instead of bouncing to the browser.
    allowNavigation: ['bizopease.robifel.in', 'dashboard.robifel.in', '*.robifel.in'],
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
      resize: 'body' as any,
      style: 'DARK',
      resizeOnFullScreen: true,
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
    captureInput: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
