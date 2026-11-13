import React from 'react';
import { Calendar, CalendarRange, RotateCcw } from 'lucide-react';
import {
  DateFilterMode,
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  getCurrentMonthInputValue,
  getMonthStartDateInputValue,
  getTodayDateInputValue,
} from '../lib/dateFilter';

export interface DateFilterToolbarProps {
  value: DateFilterState;
  onChange: (next: DateFilterState) => void;
  totalCount?: number;
  filteredCount?: number;
  recordLabel?: string;
  compact?: boolean;
  className?: string;
}

export const DateFilterToolbar: React.FC<DateFilterToolbarProps> = ({
  value,
  onChange,
  totalCount,
  filteredCount,
  recordLabel = 'records',
  compact = false,
  className = '',
}) => {
  const handleModeChange = (mode: DateFilterMode) => {
    const currentMonth = value.month || getCurrentMonthInputValue();
    const startDate = value.startDate || getMonthStartDateInputValue(currentMonth);
    const endDate = value.endDate || getTodayDateInputValue();
    onChange({
      mode,
      month: currentMonth,
      startDate,
      endDate,
    });
  };

  const handleClear = () => {
    onChange({
      ...createDefaultDateFilter('all'),
      mode: 'all',
    });
  };

  const hasCountSummary =
    typeof totalCount === 'number' && typeof filteredCount === 'number';

  return (
    <div
      className={`bg-slate-900/90 border border-slate-800 rounded-xl ${
        compact ? 'p-3' : 'p-3.5'
      } flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs ${className}`}
    >
      {/* Left: Mode Toggle */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1.5 text-slate-400 font-medium shrink-0">
          <Calendar className="w-3.5 h-3.5 text-cyan-400" />
          <span>Period Filter:</span>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-950 border border-slate-800 rounded-lg">
          <button
            type="button"
            onClick={() => handleModeChange('month')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
              value.mode === 'month'
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Month-Wise
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('range')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
              value.mode === 'range'
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Custom Date Range
          </button>
          <button
            type="button"
            onClick={() => handleModeChange('all')}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer whitespace-nowrap shrink-0 ${
              value.mode === 'all'
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All Time
          </button>
        </div>

        {hasCountSummary && (
          <span className="text-[11px] font-mono tabular-nums text-slate-400">
            Showing <strong className="text-slate-200">{filteredCount}</strong> of{' '}
            <strong className="text-slate-200">{totalCount}</strong> {recordLabel} ·{' '}
            <span className="text-cyan-400">{describeDateFilter(value)}</span>
          </span>
        )}
      </div>

      {/* Right: Date Pickers + Clear Reset */}
      <div className="flex flex-wrap items-center gap-2.5">
        {value.mode === 'month' && (
          <label className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5">
            <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">Month:</span>
            <input
              type="month"
              value={value.month}
              onChange={(e) =>
                onChange({
                  ...value,
                  mode: 'month',
                  month: e.target.value || getCurrentMonthInputValue(),
                })
              }
              className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
            />
          </label>
        )}

        {value.mode === 'range' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <CalendarRange className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">Start:</span>
              <input
                type="date"
                aria-label="Start Date"
                value={value.startDate}
                onChange={(e) =>
                  onChange({
                    ...value,
                    mode: 'range',
                    startDate: e.target.value,
                  })
                }
                className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
              />
            </label>

            <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5">
              <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">End:</span>
              <input
                type="date"
                aria-label="End Date"
                value={value.endDate}
                onChange={(e) =>
                  onChange({
                    ...value,
                    mode: 'range',
                    endDate: e.target.value,
                  })
                }
                className="bg-transparent text-white font-mono text-xs focus:outline-none cursor-pointer"
              />
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={handleClear}
          disabled={value.mode === 'all'}
          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
          title="Reset period filter to All Time"
        >
          <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
          <span>Clear Filter</span>
        </button>
      </div>
    </div>
  );
};

export default DateFilterToolbar;
