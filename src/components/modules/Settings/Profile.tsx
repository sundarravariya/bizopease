import React, { useState, useEffect } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { writeRecord } from '../../../services/odoo';
import {
  User, Mail, Phone, Lock, CheckCircle2, Shield,
  Eye, EyeOff, Sun, Moon, Bell, Monitor, Globe,
  Save, RefreshCw,
} from 'lucide-react';

interface ProfileForm {
  name: string;
  email: string;
  phone: string;
  timezone: string;
  language: string;
}

const TIMEZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Asia/Dubai'];
const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Gujarati'];

function getStrengthLevel(pw: string): number {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return score;
}

function StrengthBar({ password }: { password: string }) {
  const { isDark } = useTheme();
  const level = getStrengthLevel(password);
  const colors = ['bg-red-500', 'bg-red-400', 'bg-amber-400', 'bg-green-400', 'bg-green-500'];
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  return (
    <div className='space-y-1.5'>
      <div className='flex gap-1'>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`flex-1 h-1.5 rounded-full transition-colors ${i <= level ? colors[level] : isDark ? 'bg-[#2a3250]' : 'bg-gray-200'}`} />
        ))}
      </div>
      {password && (
        <p className={`text-[10px] font-semibold ${level <= 1 ? 'text-red-400' : level === 2 ? 'text-amber-400' : 'text-green-400'}`}>
          {labels[level]}
        </p>
      )}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  isDark: boolean;
}

function ToggleRow({ label, description, checked, onChange, isDark }: ToggleRowProps) {
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  return (
    <div className='flex items-start justify-between gap-4 py-3'>
      <div>
        <p className={`text-xs font-semibold ${th}`}>{label}</p>
        <p className={`text-[10px] mt-0.5 ${ts}`}>{description}</p>
      </div>
      <button
        role='switch'
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors ${checked ? 'bg-[#7367f0]' : isDark ? 'bg-[#2a3250]' : 'bg-gray-300'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

export default function Profile() {
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();

  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: user?.name || 'Robifel Admin',
    email: user?.email || 'admin@robifel.in',
    phone: '',
    timezone: 'Asia/Kolkata',
    language: 'English',
  });

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);

  const [notifications, setNotifications] = useState({
    email_notifications: true,
    stock_alerts: true,
    order_updates: true,
    leave_approvals: false,
    fbf_reports: true,
  });

  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [notifMsg, setNotifMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);

  // Load phone from localStorage if available
  useEffect(() => {
    try {
      const stored = localStorage.getItem('robifel-user');
      if (stored) {
        const u = JSON.parse(stored);
        setProfileForm(prev => ({
          ...prev,
          name: u.name || prev.name,
          email: u.email || prev.email,
          phone: u.phone || prev.phone,
        }));
      }
    } catch { /* skip */ }
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      if (user?.uid) {
        await writeRecord('res.users', [user.uid], { name: profileForm.name, email: profileForm.email });
      }
      // Update localStorage
      const stored = localStorage.getItem('robifel-user');
      if (stored) {
        const u = JSON.parse(stored);
        localStorage.setItem('robifel-user', JSON.stringify({ ...u, name: profileForm.name, email: profileForm.email }));
      }
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
    } catch {
      setProfileMsg({ type: 'error', text: 'Failed to save profile. Changes saved locally.' });
      const stored = localStorage.getItem('robifel-user');
      if (stored) {
        const u = JSON.parse(stored);
        localStorage.setItem('robifel-user', JSON.stringify({ ...u, name: profileForm.name, email: profileForm.email }));
      }
    } finally {
      setProfileSaving(false);
      setTimeout(() => setProfileMsg(null), 4000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPw || newPw !== confirmPw) {
      setPwMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }
    if (getStrengthLevel(newPw) < 2) {
      setPwMsg({ type: 'error', text: 'Password too weak. Add uppercase, numbers or symbols.' });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    try {
      if (user?.uid) {
        await writeRecord('res.users', [user.uid], { password: newPw });
      }
      setPwMsg({ type: 'success', text: 'Password changed successfully.' });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch {
      setPwMsg({ type: 'error', text: 'Could not update password via Odoo. Please use Odoo backend.' });
    } finally {
      setPwSaving(false);
      setTimeout(() => setPwMsg(null), 4000);
    }
  };

  const handleSaveNotifications = () => {
    setNotifSaving(true);
    setTimeout(() => {
      localStorage.setItem('portal_notif_prefs', JSON.stringify(notifications));
      setNotifSaving(false);
      setNotifMsg({ type: 'success', text: 'Notification preferences saved.' });
      setTimeout(() => setNotifMsg(null), 3500);
    }, 600);
  };

  const initials = (profileForm.name || 'RA').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();

  const gc = isDark ? 'glass' : 'glass-light bg-white/80';
  const inp = `input text-xs ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : ''}`;
  const th = isDark ? 'text-white' : 'text-gray-900';
  const ts = isDark ? 'text-[#5a6a8a]' : 'text-gray-500';
  const bd = isDark ? '#2a3250' : '#e5e7eb';

  const flashCls = (type: 'success' | 'error') =>
    `p-3 rounded-xl flex items-center gap-2 text-xs font-semibold border ${
      type === 'success'
        ? 'bg-green-500/10 border-green-500/20 text-green-400'
        : 'bg-red-500/10 border-red-500/20 text-red-400'
    }`;

  return (
    <div className='space-y-6 animate-fade-in max-w-5xl mx-auto'>

      {/* Header */}
      <div>
        <h1 className={`text-xl font-black ${th}`}>My Profile & Preferences</h1>
        <p className={`text-xs mt-0.5 ${ts}`}>Manage your account settings, security and notification preferences</p>
      </div>

      {/* Profile Card */}
      <div className={`card p-6 ${gc} flex flex-col sm:flex-row items-center gap-5`}>
        <div className='relative'>
          <div className='w-20 h-20 rounded-2xl bg-gradient-to-br from-[#7367f0] to-[#3b82f6] flex items-center justify-center text-white font-black text-3xl shadow-lg shadow-[#7367f0]/30'>
            {initials}
          </div>
          <div className={`absolute -bottom-1 -right-1 text-[9px] font-bold px-2 py-0.5 rounded-full cursor-pointer ${isDark ? 'bg-[#2a3250] text-[#7367f0]' : 'bg-gray-100 text-violet-600'}`}>
            Edit Avatar
          </div>
        </div>
        <div>
          <div className={`text-lg font-black ${th}`}>{profileForm.name}</div>
          <div className={`text-xs ${ts}`}>{user?.is_admin ? 'Administrator' : 'User'} · {user?.company_name || 'Robifel'}</div>
          <div className={`text-xs mt-1 ${ts}`}>{profileForm.email}</div>
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-5'>

        {/* Left: Account Settings */}
        <div className={`card p-6 space-y-5 ${gc}`}>
          <h2 className={`text-sm font-black ${th} border-b pb-3`} style={{ borderColor: bd }}>Account Settings</h2>

          {profileMsg && (
            <div className={flashCls(profileMsg.type)}>
              <CheckCircle2 size={14} className='flex-shrink-0' />
              {profileMsg.text}
            </div>
          )}

          <form onSubmit={handleSaveProfile} className='space-y-4'>
            <div>
              <label className='label'>Full Name</label>
              <input value={profileForm.name} onChange={e => setProfileForm({ ...profileForm, name: e.target.value })} className={`${inp} w-full`} placeholder='Your name' />
            </div>
            <div>
              <label className='label'>Email Address</label>
              <div className='relative'>
                <Mail size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
                <input type='email' value={profileForm.email} onChange={e => setProfileForm({ ...profileForm, email: e.target.value })} className={`${inp} w-full pl-9`} placeholder='email@robifel.in' />
              </div>
            </div>
            <div>
              <label className='label'>Phone Number</label>
              <div className='relative'>
                <Phone size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
                <input type='tel' value={profileForm.phone} onChange={e => setProfileForm({ ...profileForm, phone: e.target.value })} className={`${inp} w-full pl-9`} placeholder='+91 98765 43210' />
              </div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div>
                <label className='label'>Timezone</label>
                <select value={profileForm.timezone} onChange={e => setProfileForm({ ...profileForm, timezone: e.target.value })} className={`${inp} w-full`}>
                  {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className='label'>Language</label>
                <select value={profileForm.language} onChange={e => setProfileForm({ ...profileForm, language: e.target.value })} className={`${inp} w-full`}>
                  {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className='label'>Company</label>
              <input readOnly value={user?.company_name || 'Robifel'} className={`${inp} w-full opacity-60 cursor-not-allowed`} />
            </div>
            <div className='pt-2'>
              <button type='submit' disabled={profileSaving} className='btn-primary text-xs px-5 py-2 flex items-center gap-2'>
                {profileSaving ? <RefreshCw size={13} className='animate-spin' /> : <Save size={13} />}
                Save Changes
              </button>
            </div>
          </form>
        </div>

        {/* Right: Security */}
        <div className='space-y-5'>
          <div className={`card p-6 space-y-4 ${gc}`}>
            <h2 className={`text-sm font-black ${th} border-b pb-3`} style={{ borderColor: bd }}>Security</h2>

            {pwMsg && (
              <div className={flashCls(pwMsg.type)}>
                <Shield size={14} className='flex-shrink-0' />
                {pwMsg.text}
              </div>
            )}

            <form onSubmit={handleChangePassword} className='space-y-3'>
              <div>
                <label className='label'>Current Password</label>
                <div className='relative'>
                  <Lock size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
                  <input
                    type={showCurrentPw ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    className={`${inp} w-full pl-9 pr-9`}
                    placeholder='Current password'
                  />
                  <button type='button' onClick={() => setShowCurrentPw(!showCurrentPw)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${ts} hover:text-white transition-colors`}>
                    {showCurrentPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <label className='label'>New Password</label>
                <div className='relative'>
                  <Lock size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
                  <input
                    type={showNewPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    className={`${inp} w-full pl-9 pr-9`}
                    placeholder='New password'
                  />
                  <button type='button' onClick={() => setShowNewPw(!showNewPw)} className={`absolute right-3 top-1/2 -translate-y-1/2 ${ts} hover:text-white transition-colors`}>
                    {showNewPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {newPw && <div className='mt-2'><StrengthBar password={newPw} /></div>}
              </div>
              <div>
                <label className='label'>Confirm New Password</label>
                <div className='relative'>
                  <Lock size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${ts}`} />
                  <input
                    type='password'
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    className={`${inp} w-full pl-9`}
                    placeholder='Confirm new password'
                  />
                </div>
                {confirmPw && newPw !== confirmPw && (
                  <p className='text-[10px] text-red-400 mt-1'>Passwords do not match</p>
                )}
              </div>
              <div className='pt-1'>
                <button type='submit' disabled={pwSaving} className='btn-secondary text-xs px-5 py-2 flex items-center gap-2'>
                  {pwSaving ? <RefreshCw size={13} className='animate-spin' /> : <Shield size={13} />}
                  Change Password
                </button>
              </div>
            </form>
          </div>

          {/* Active Sessions */}
          <div className={`card p-5 space-y-3 ${gc}`}>
            <h3 className={`text-xs font-bold ${th}`}>Active Sessions</h3>
            <div className={`rounded-xl p-3 space-y-2 ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <Monitor size={14} className='text-[#7367f0]' />
                  <span className={`text-xs font-semibold ${th}`}>Chrome / Windows</span>
                </div>
                <span className='badge badge-green text-[9px]'>Active Now</span>
              </div>
              <div className='flex justify-between text-[10px]'>
                <span className={ts}>IP Address</span>
                <span className={`font-semibold ${th}`}>182.68.xxx.xxx</span>
              </div>
              <div className='flex justify-between text-[10px]'>
                <span className={ts}>Last Active</span>
                <span className={`font-semibold ${th}`}>Just now</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className={`card p-6 space-y-4 ${gc}`}>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className={`text-sm font-black ${th}`}>Notification Preferences</h2>
            <p className={`text-xs mt-0.5 ${ts}`}>Control which alerts and updates you receive</p>
          </div>
          <Bell size={18} className='text-[#7367f0]' />
        </div>

        {notifMsg && (
          <div className={flashCls(notifMsg.type)}>
            <CheckCircle2 size={14} />
            {notifMsg.text}
          </div>
        )}

        <div className='divide-y' style={{ borderColor: bd }}>
          <ToggleRow
            label='Email Notifications'
            description='Receive email summaries for orders, invoices and alerts'
            checked={notifications.email_notifications}
            onChange={v => setNotifications(n => ({ ...n, email_notifications: v }))}
            isDark={isDark}
          />
          <ToggleRow
            label='Stock Alerts'
            description='Get notified when inventory falls below reorder levels'
            checked={notifications.stock_alerts}
            onChange={v => setNotifications(n => ({ ...n, stock_alerts: v }))}
            isDark={isDark}
          />
          <ToggleRow
            label='Order Updates'
            description='Sales and purchase order status change notifications'
            checked={notifications.order_updates}
            onChange={v => setNotifications(n => ({ ...n, order_updates: v }))}
            isDark={isDark}
          />
          <ToggleRow
            label='Leave Approvals'
            description='Notify when employee leave requests require your action'
            checked={notifications.leave_approvals}
            onChange={v => setNotifications(n => ({ ...n, leave_approvals: v }))}
            isDark={isDark}
          />
          <ToggleRow
            label='FBF Reports'
            description='Daily Flipkart FBF replenishment and settlement digests'
            checked={notifications.fbf_reports}
            onChange={v => setNotifications(n => ({ ...n, fbf_reports: v }))}
            isDark={isDark}
          />
        </div>

        <div className='pt-2'>
          <button onClick={handleSaveNotifications} disabled={notifSaving} className='btn-primary text-xs px-5 py-2 flex items-center gap-2'>
            {notifSaving ? <RefreshCw size={13} className='animate-spin' /> : <Save size={13} />}
            Save Preferences
          </button>
        </div>
      </div>

      {/* Theme & Display */}
      <div className={`card p-6 space-y-4 ${gc}`}>
        <div className='flex items-center justify-between'>
          <div>
            <h2 className={`text-sm font-black ${th}`}>Theme & Display</h2>
            <p className={`text-xs mt-0.5 ${ts}`}>Appearance settings for the admin portal</p>
          </div>
          {isDark ? <Moon size={18} className='text-violet-400' /> : <Sun size={18} className='text-amber-400' />}
        </div>
        <div className={`rounded-xl p-4 flex items-center justify-between ${isDark ? 'bg-[#1e2440]' : 'bg-gray-50'}`}>
          <div>
            <p className={`text-xs font-semibold ${th}`}>Current Theme: {isDark ? 'Dark Mode' : 'Light Mode'}</p>
            <p className={`text-[10px] mt-0.5 ${ts}`}>Toggle is managed by the header sun/moon button above</p>
          </div>
          <button onClick={toggleTheme} className='btn-secondary text-xs px-4 py-2 flex items-center gap-2'>
            {isDark ? <><Sun size={13} /> Switch to Light</> : <><Moon size={13} /> Switch to Dark</>}
          </button>
        </div>
        <div className={`rounded-xl p-3 flex items-start gap-2 ${isDark ? 'bg-[#7367f0]/10 border border-[#7367f0]/20' : 'bg-violet-50 border border-violet-200'}`}>
          <Globe size={14} className='text-[#7367f0] mt-0.5 flex-shrink-0' />
          <p className={`text-[10px] leading-relaxed ${ts}`}>
            Theme preference is saved to localStorage and persists across sessions. The toggle in the top header bar also controls this setting.
          </p>
        </div>
      </div>
    </div>
  );
}
