import { Capacitor } from '@capacitor/core';

// ── Priority tone frequencies for Web Audio API (web/browser fallback) ───────
function playTone(priority: string) {
  try {
    const ctx = new AudioContext();
    const play = (freq: number, start: number, dur: number, vol = 0.35) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = 'sine';
      gain.gain.setValueAtTime(vol, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
    };
    if (priority === '3') { play(1046, 0, 0.12, 0.5); play(1046, 0.17, 0.12, 0.5); play(1046, 0.34, 0.12, 0.5); }
    else if (priority === '2') { play(880, 0, 0.18, 0.4); play(880, 0.28, 0.18, 0.4); }
    else if (priority === '1') { play(660, 0, 0.28, 0.3); }
    else { play(440, 0, 0.35, 0.18); }
  } catch { /* AudioContext unavailable */ }
}

// Priority → notification channel / sound name
const PRIORITY_CHANNEL: Record<string, { id: string; name: string; sound: string; importance: number }> = {
  '3': { id: 'tasks_urgent',  name: 'Tasks — Urgent',  sound: 'urgent_alarm',  importance: 5 },
  '2': { id: 'tasks_high',    name: 'Tasks — High',    sound: 'high_alert',    importance: 4 },
  '1': { id: 'tasks_normal',  name: 'Tasks — Normal',  sound: 'default',       importance: 3 },
  '0': { id: 'tasks_low',     name: 'Tasks — Low',     sound: 'default',       importance: 2 },
};

const PRIORITY_LABEL: Record<string, string> = { '3': 'Urgent', '2': 'High', '1': 'Normal', '0': 'Low' };

// ── FCM token ─────────────────────────────────────────────────────────────────
let _fcmToken: string | null = null;
export function getFcmToken() { return _fcmToken; }

// ── Initialise push + local notifications (call once on app start) ────────────
export async function initPushNotifications() {
  if (!Capacitor.isNativePlatform()) return;

  // Local notifications — create channels (Android 8+)
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const channels = Object.values(PRIORITY_CHANNEL).map(c => ({
      id: c.id,
      name: c.name,
      importance: c.importance as any,
      sound: c.sound !== 'default' ? c.sound : undefined,
      vibration: c.importance >= 4,
    }));
    await LocalNotifications.createChannel(channels[0]); // Urgent
    for (const ch of channels.slice(1)) {
      await LocalNotifications.createChannel(ch).catch(() => {});
    }
  } catch { /* plugin not available in web build */ }

  // Push notifications — FCM registration
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive === 'granted') {
      await PushNotifications.register();

      PushNotifications.addListener('registration', ({ value }) => {
        _fcmToken = value;
        // Store locally so odoo service can send it on next API call
        try { localStorage.setItem('biz_fcm_token', value); } catch {}
      });

      PushNotifications.addListener('registrationError', () => {});

      // Foreground push received — also play our priority tone
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const priority = notification.data?.priority || '1';
        playTone(priority);
      });

      // User tapped on a push notification
      PushNotifications.addListener('pushNotificationActionPerformed', () => {});
    }
  } catch { /* plugin not available */ }
}

// ── Send a local in-app task notification ────────────────────────────────────
export async function notifyTask(task: { id: number; name: string; description?: string | false; priority: string }) {
  const priorityLabel = PRIORITY_LABEL[task.priority] || 'Normal';
  const ch = PRIORITY_CHANNEL[task.priority] || PRIORITY_CHANNEL['1'];

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.schedule({
        notifications: [{
          id: task.id,
          title: `New Task — ${priorityLabel} Priority`,
          body: task.name + (task.description ? `\n${String(task.description).slice(0, 80)}` : ''),
          channelId: ch.id,
          smallIcon: 'ic_stat_icon_config_sample',
          iconColor: task.priority === '3' ? '#ef4444' : task.priority === '2' ? '#f59e0b' : '#7367f0',
          schedule: { at: new Date(Date.now() + 100) }, // near-immediate
          extra: { taskId: task.id, priority: task.priority },
        }],
      });
    } catch {
      // Fall through to web fallback
      playTone(task.priority);
    }
  } else {
    // Web: browser Notification API + audio tone
    playTone(task.priority);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(`New Task — ${priorityLabel} Priority`, {
          body: task.name + (task.description ? `\n${task.description}` : ''),
          icon: '/favicon.ico',
          tag: `biz-task-${task.id}`,
          requireInteraction: task.priority === '3',
        });
      } catch { /* blocked */ }
    }
  }
}

// ── Request web notification permission (web-only) ───────────────────────────
export function requestWebNotificationPermission() {
  if (Capacitor.isNativePlatform()) return; // handled by initPushNotifications
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
