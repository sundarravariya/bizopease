import React from 'react';
import { useTheme } from '../../context/ThemeContext';
import { Construction } from 'lucide-react';

interface ComingSoonProps {
  module: string;
  description?: string;
  icon?: React.ReactNode;
}

export default function ComingSoon({ module, description, icon }: ComingSoonProps) {
  const { isDark } = useTheme();
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 animate-fade-in">
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center ${isDark ? 'bg-[#1e2440]' : 'bg-gray-100'}`}>
        {icon || <Construction size={36} className="text-[#7367f0]" />}
      </div>
      <div className="text-center">
        <h2 className={`text-xl font-black ${isDark ? 'text-white' : 'text-gray-900'}`}>{module}</h2>
        <p className={`text-sm mt-1 max-w-xs ${isDark ? 'text-[#5a6a8a]' : 'text-gray-400'}`}>
          {description || 'This module is being built and will be connected to your Odoo backend.'}
        </p>
      </div>
      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-semibold ${isDark ? 'border-[#2a3250] text-[#5a6a8a]' : 'border-gray-200 text-gray-400'}`}>
        <span className="w-2 h-2 rounded-full bg-[#7367f0] animate-pulse" />
        Connected to Odoo 18 CE
      </div>
    </div>
  );
}
