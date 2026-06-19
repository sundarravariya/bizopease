import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { isNative } from '../services/native';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { ThemeProvider } from '../context/ThemeContext';
import Login from '../pages/Login';
import Kiosk from '../components/modules/HR/Kiosk';

function KioskRoot() {
  const { user, logout } = useAuth();

  useEffect(() => {
    if (isNative()) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#0f1422' }).catch(() => {});
      Keyboard.setResizeMode({ mode: 'body' }).catch(() => {});
    }
  }, []);

  if (!user) {
    return <Login />;
  }

  // Full-screen kiosk — no header, no sidebar
  // Long-press the kiosk title area (via onDoubleClick) to log out and reconfigure
  return (
    <div className="min-h-screen" style={{ background: '#0f1422' }}>
      <Kiosk onAdminExit={logout} />
    </div>
  );
}

export default function KioskApp() {
  return (
    <BrowserRouter basename="/kiosk">
      <ThemeProvider>
        <AuthProvider>
          <KioskRoot />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
