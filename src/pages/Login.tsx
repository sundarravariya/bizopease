import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Lock, Mail, Eye, EyeOff, Zap, Sun, Moon, AlertCircle, Database, RefreshCw } from 'lucide-react';
import { BRAND } from '../config/brand';

export default function Login() {
  const { login, isLoading, error, clearError } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [db, setDb] = useState('robifel');
  const [showPass, setShowPass] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await login(email, password, db);
  };

  return (
    <div className={`min-h-screen flex ${isDark ? 'bg-[#0f1422]' : 'bg-gradient-to-br from-[#f0f4ff] via-[#faf5ff] to-[#f0f4ff]'}`}>
      {/* Left panel — decorative */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-to-br from-[#7367f0] via-[#5a52e0] to-[#3d5af1] items-center justify-center">
        {/* Background blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #fff 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-5%] right-[-5%] w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #3d5af1 0%, transparent 70%)' }} />
        <div className="absolute top-1/2 right-[-15%] w-64 h-64 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #9d95f5 0%, transparent 70%)' }} />

        <div className="relative z-10 text-white text-center px-12">
          <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-md border border-white/30 flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <Zap size={36} className="text-white" />
          </div>
          <h1 className="text-4xl font-black mb-4 leading-tight">BizOpease<br/>Admin Portal</h1>
          <p className="text-white/70 text-lg max-w-sm mx-auto leading-relaxed">
            Complete Odoo 18 management dashboard with Flipkart OS, Settlements, B2B Portal and more.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-4 max-w-sm mx-auto">
            {[
              { label: 'Modules', value: '12+' },
              { label: 'Custom Addons', value: '5' },
              { label: 'Real-time', value: 'Yes' },
            ].map(s => (
              <div key={s.label} className="bg-white/10 backdrop-blur-sm rounded-2xl p-3 border border-white/20">
                <p className="text-2xl font-black">{s.value}</p>
                <p className="text-white/60 text-xs mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className={`flex-1 lg:max-w-[480px] flex flex-col items-center justify-center p-8 relative ${isDark ? 'bg-[#0f1422]' : 'bg-white'}`}>
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className={`absolute top-6 right-6 p-2.5 rounded-xl border transition-all ${isDark ? 'border-[#2a3250] text-amber-400 hover:bg-[#1e2440]' : 'border-gray-200 text-violet-600 hover:bg-gray-50'}`}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <div className="w-full max-w-sm">
          {/* Logo for mobile */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#7367f0] to-[#3d5af1] flex items-center justify-center">
              <Zap size={20} className="text-white" />
            </div>
            <div>
              <p className={`font-black text-lg ${isDark ? 'text-white' : 'text-gray-900'}`}>{BRAND}</p>
              <p className="text-[11px] text-[#7367f0] font-semibold">Admin Portal</p>
            </div>
          </div>

          <h2 className={`text-2xl font-black mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            Welcome back! 👋
          </h2>
          <p className={`text-sm mb-8 ${isDark ? 'text-[#6a7a9a]' : 'text-gray-500'}`}>
            Sign in to your Odoo account to continue
          </p>

          {/* Error */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start gap-2.5">
              <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-400">Authentication failed</p>
                <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email/Username */}
            <div>
              <label className={`label ${isDark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Username or Email</label>
              <div className="relative">
                <Mail size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                <input
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@robifel.in"
                  required
                  className={`input pl-10 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'border-gray-200 focus:border-[#7367f0]'}`}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className={`label ${isDark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Password</label>
              <div className="relative">
                <Lock size={16} className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580]' : 'text-gray-400'}`} />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className={`input pl-10 pr-10 ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white focus:border-[#7367f0]' : 'border-gray-200 focus:border-[#7367f0]'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className={`absolute right-3.5 top-1/2 -translate-y-1/2 ${isDark ? 'text-[#4a5580] hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Advanced: DB selection */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(p => !p)}
                className={`text-xs font-medium flex items-center gap-1.5 ${isDark ? 'text-[#5a6a8a] hover:text-[#7367f0]' : 'text-gray-400 hover:text-violet-600'}`}
              >
                <Database size={12} />
                Advanced settings {showAdvanced ? '▲' : '▼'}
              </button>
              {showAdvanced && (
                <div className="mt-2">
                  <label className={`label ${isDark ? 'text-[#4a5580]' : 'text-gray-500'}`}>Database</label>
                  <select
                    value={db}
                    onChange={e => setDb(e.target.value)}
                    className={`input ${isDark ? 'bg-[#1e2440] border-[#2a3250] text-white' : 'border-gray-200'}`}
                  >
                    <option value="robifel">robifel (Primary)</option>
                    <option value="queen_finger">queen finger</option>
                  </select>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="btn-primary w-full justify-center py-3 text-sm font-bold mt-2"
              style={{ background: 'linear-gradient(135deg, #7367f0, #3d5af1)' }}
            >
              {isLoading ? <RefreshCw size={16} className="animate-spin" /> : <Lock size={16} />}
              {isLoading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          {/* Footer */}
          <p className={`text-center text-xs mt-8 ${isDark ? 'text-[#3a4a6a]' : 'text-gray-400'}`}>
            {BRAND} Admin Portal · Powered by Odoo 18 Community
          </p>
        </div>
      </div>
    </div>
  );
}
