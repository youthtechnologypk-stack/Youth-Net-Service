import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className = '',
  showLabel = false,
}) => {
  const { theme, toggleTheme, isDark } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative inline-flex items-center justify-center p-2 rounded-xl border transition-all duration-200 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
        isDark
          ? 'bg-slate-900/90 hover:bg-slate-800 text-amber-300 border-slate-800 hover:border-amber-500/40 shadow-sm'
          : 'bg-white hover:bg-slate-100 text-indigo-600 border-slate-200 hover:border-indigo-300 shadow-sm'
      } ${className}`}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      <span className="sr-only">
        {isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      </span>

      {isDark ? (
        <Sun className="w-4 h-4 transition-transform duration-300 group-hover:rotate-45 text-amber-400 group-hover:text-amber-300" />
      ) : (
        <Moon className="w-4 h-4 transition-transform duration-300 group-hover:-rotate-12 text-indigo-600 group-hover:text-indigo-500" />
      )}

      {showLabel && (
        <span className="ml-2 text-xs font-semibold font-sans">
          {isDark ? 'Light Mode' : 'Dark Mode'}
        </span>
      )}
    </button>
  );
};
