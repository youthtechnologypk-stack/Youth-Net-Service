import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  metric?: string;
  metricTone?: 'emerald' | 'amber' | 'rose' | 'sky' | 'cyan' | 'slate';
  keywords?: string;
}

interface SearchableComboboxProps {
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyOptionLabel?: string;
  disabled?: boolean;
  accentColor?: 'cyan' | 'emerald' | 'amber' | 'indigo' | 'sky';
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
}

const METRIC_TONE_CLASS: Record<NonNullable<SearchableOption['metricTone']>, string> = {
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
  sky: 'text-sky-300',
  cyan: 'text-cyan-300',
  slate: 'text-slate-400',
};

const BORDER_ACCENT_CLASS: Record<NonNullable<SearchableComboboxProps['accentColor']>, string> = {
  cyan: 'focus:border-cyan-500 border-slate-700',
  emerald: 'focus:border-emerald-500 border-emerald-700/70',
  amber: 'focus:border-amber-500 border-amber-700/70',
  indigo: 'focus:border-indigo-500 border-indigo-700/70',
  sky: 'focus:border-sky-500 border-sky-700/70',
};

export const SearchableCombobox: React.FC<SearchableComboboxProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search name, area, PON, or dBm...',
  emptyOptionLabel,
  disabled = false,
  accentColor = 'cyan',
  ariaLabel,
  className = '',
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 80);
    const tokens = q.split(/\s+/).filter(Boolean);
    return options
      .filter((opt) => {
        const haystack = `${opt.label} ${opt.sublabel || ''} ${opt.metric || ''} ${
          opt.keywords || ''
        }`.toLowerCase();
        return tokens.every((tok) => haystack.includes(tok));
      })
      .slice(0, 80);
  }, [options, query]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveIdx(0);
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setQuery('');
      return;
    }
    const offset = emptyOptionLabel ? 1 : 0;
    const total = filteredOptions.length + offset;
    if (total === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => (prev + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => (prev - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (emptyOptionLabel && activeIdx === 0) {
        handleSelect('');
      } else {
        const picked = filteredOptions[activeIdx - offset];
        if (picked) handleSelect(picked.value);
      }
    }
  };

  return (
    <div ref={rootRef} className={`relative w-full min-w-0 ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => !prev);
        }}
        className={`w-full ${
          compact ? 'min-h-[34px] px-2.5 py-1 text-[11px]' : 'min-h-[38px] px-2.5 py-1.5 text-xs'
        } bg-slate-950 border ${
          BORDER_ACCENT_CLASS[accentColor]
        } rounded-lg text-left flex items-center justify-between gap-2 transition cursor-pointer disabled:opacity-50`}
      >
        <div className="min-w-0 flex-1 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate">
            {selectedOption ? (
              <span className="text-white font-medium truncate">
                {selectedOption.label}
                {selectedOption.sublabel ? (
                  <span className="text-slate-400 font-normal ml-1.5 text-[10px]">
                    {selectedOption.sublabel}
                  </span>
                ) : null}
              </span>
            ) : (
              <span className="text-slate-400 truncate">
                {emptyOptionLabel || placeholder}
              </span>
            )}
          </div>
          {selectedOption?.metric && (
            <span
              className={`shrink-0 font-mono text-[10px] font-bold tabular-nums ${
                METRIC_TONE_CLASS[selectedOption.metricTone || 'cyan']
              }`}
            >
              {selectedOption.metric}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 z-[1200] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden min-w-[220px]">
          <div className="p-2 border-b border-slate-800 bg-slate-950 flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70">
            {emptyOptionLabel && (
              <button
                type="button"
                onClick={() => handleSelect('')}
                className={`w-full text-left px-3 py-2 text-[11px] font-mono flex items-center justify-between gap-2 cursor-pointer transition ${
                  value === ''
                    ? 'bg-cyan-950/70 text-cyan-200 font-bold'
                    : activeIdx === 0
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800/80'
                }`}
              >
                <span className="truncate">{emptyOptionLabel}</span>
                {value === '' && <Check className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
              </button>
            )}

            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-[11px] font-mono text-slate-500 text-center">
                No matches for &ldquo;{query}&rdquo;
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const rowIndex = idx + (emptyOptionLabel ? 1 : 0);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition ${
                      isSelected
                        ? 'bg-cyan-950/75 text-white'
                        : activeIdx === rowIndex
                        ? 'bg-slate-800 text-white'
                        : 'hover:bg-slate-800/75 text-slate-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="text-[10px] font-mono text-slate-400 truncate">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {opt.metric && (
                        <span
                          className={`text-[10px] font-mono font-bold tabular-nums ${
                            METRIC_TONE_CLASS[opt.metricTone || 'cyan']
                          }`}
                        >
                          {opt.metric}
                        </span>
                      )}
                      {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
