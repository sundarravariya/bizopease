/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f4ff',
          100: '#dde8ff',
          200: '#c0d2ff',
          300: '#94b0ff',
          400: '#6082ff',
          500: '#3d5af1',
          600: '#2b3de7',
          700: '#2230cc',
          800: '#212ba5',
          900: '#212983',
        },
        violet: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
        },
        surface: {
          // Light mode
          light: '#f8f9fc',
          'light-card': '#ffffff',
          'light-border': '#e2e8f0',
          'light-hover': '#f1f5f9',
          // Dark mode
          dark: '#161b2e',
          'dark-card': '#1e2440',
          'dark-border': '#2a3250',
          'dark-hover': '#252d4a',
        },
        brand: {
          violet: '#8b5cf6',
          blue: '#3d5af1',
          cyan: '#06b6d4',
          green: '#10b981',
          gold: '#f59e0b',
          red: '#ef4444',
          pink: '#ec4899',
          orange: '#f97316',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Outfit', 'Plus Jakarta Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-violet': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-blue': '0 0 20px rgba(61, 90, 241, 0.3)',
        'glow-green': '0 0 20px rgba(16, 185, 129, 0.3)',
        'card-light': '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)',
        'card-dark': '0 1px 3px rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.2)',
        'sidebar': '4px 0 24px rgba(0,0,0,0.15)',
      },
      backgroundImage: {
        'gradient-brand': 'linear-gradient(135deg, #8b5cf6, #3d5af1)',
        'gradient-cyan': 'linear-gradient(135deg, #06b6d4, #3d5af1)',
        'gradient-green': 'linear-gradient(135deg, #10b981, #06b6d4)',
        'gradient-gold': 'linear-gradient(135deg, #f59e0b, #ef4444)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.25s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideIn: { from: { transform: 'translateX(-10px)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        slideUp: { from: { transform: 'translateY(10px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(139, 92, 246, 0.3)' },
          '50%': { boxShadow: '0 0 30px rgba(139, 92, 246, 0.6)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        }
      },
    },
  },
  plugins: [],
}
