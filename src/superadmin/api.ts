// Superadmin API client. Uses a Bearer JWT stored separately from tenant sessions.
const TOKEN_KEY = 'bizopease-sa-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function call<T = any>(path: string, method: string, body?: any, auth = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && getToken()) headers.Authorization = 'Bearer ' + getToken();
  const res = await fetch('/api/superadmin' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && auth) { clearToken(); throw new Error('Session expired -- please sign in again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export const sa = {
  login: (username: string, password: string, twoFactorCode?: string) =>
    call<{ token?: string; twoFactorRequired?: boolean }>('/login', 'POST', { username, password, twoFactorCode }, false),
  stats: () => call<any>('/stats', 'GET'),
  workspaces: () => call<any[]>('/workspaces', 'GET'),
  createWorkspace: (b: { workspaceName: string; adminEmail: string; adminPassword: string; days: number; planType: string }) =>
    call('/workspaces', 'POST', b),
  activate: (id: string, days: number) => call(`/workspaces/${id}/activate`, 'POST', { days }),
  deactivate: (id: string) => call(`/workspaces/${id}/deactivate`, 'POST', {}),
  extend: (id: string, days: number) => call(`/workspaces/${id}/extend`, 'POST', { days }),
  setPlan: (id: string, planType: string) => call(`/workspaces/${id}/set-plan`, 'POST', { planType }),
  deleteWorkspace: (id: string) => call(`/workspaces/${id}`, 'DELETE'),
  workspaceUsers: (id: string) => call<{ odooDb: string; adminEmail: string; note: string }>(`/workspaces/${id}/users`, 'GET'),
  backups: () => call<any[]>('/backups', 'GET'),
  runBackup: () => call('/backups/run', 'POST', {}),
  restoreBackup: (date: string, db: string) => call('/backups/restore', 'POST', { date, db }),
  logs: () => call<{ stdout: string; stderr: string }>('/logs', 'GET'),
  getConfig: () => call<Record<string, string>>('/config', 'GET'),
  saveConfig: (updates: Record<string, string>) => call('/config', 'POST', updates),
  restart: () => call('/restart', 'POST', {}),
  twoFaStatus: () => call<{ enabled: boolean }>('/2fa/status', 'GET'),
  twoFaSetup: () => call<{ secret: string; qrUrl: string }>('/2fa/setup', 'GET'),
  twoFaVerify: (code: string, secret: string) => call('/2fa/verify', 'POST', { code, secret }),
  twoFaDisable: (code: string) => call('/2fa/disable', 'POST', { code }),
};

export const backupDownloadUrl = (date: string, file: string) =>
  `/api/superadmin/backups/download?date=${encodeURIComponent(date)}&file=${encodeURIComponent(file)}`;
