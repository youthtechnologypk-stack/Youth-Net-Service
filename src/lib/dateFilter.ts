export type DateFilterMode = 'month' | 'range' | 'all';

export interface DateFilterState {
  mode: DateFilterMode;
  /** YYYY-MM format, e.g. '2026-11' */
  month: string;
  /** YYYY-MM-DD format */
  startDate: string;
  /** YYYY-MM-DD format */
  endDate: string;
}

export function getTodayDateInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function getMonthStartDateInputValue(monthStr?: string): string {
  const target = monthStr && /^\d{4}-\d{2}$/.test(monthStr) ? monthStr : getCurrentMonthInputValue();
  return `${target}-01`;
}

export function createDefaultDateFilter(mode: DateFilterMode = 'month'): DateFilterState {
  const currentMonth = getCurrentMonthInputValue();
  return {
    mode,
    month: currentMonth,
    startDate: getMonthStartDateInputValue(currentMonth),
    endDate: getTodayDateInputValue(),
  };
}

/**
 * Parses a date string into local Date components safely:
 * - Date-only 'YYYY-MM-DD' is anchored at local noon to prevent UTC timezone day shifts.
 * - Full ISO timestamps are parsed into local Date.
 */
export function parseFlexibleDate(raw?: string | null): Date | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function toLocalYearMonthKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Checks whether a single candidate date string (or any of an array of candidate dates)
 * matches the active DateFilterState.
 */
export function matchesDateFilter(
  candidates: string | null | undefined | Array<string | null | undefined>,
  filter: DateFilterState
): boolean {
  if (filter.mode === 'all') return true;

  const list = Array.isArray(candidates) ? candidates : [candidates];
  const validDates = list
    .map((raw) => ({ raw: raw ? String(raw).trim() : '', parsed: parseFlexibleDate(raw) }))
    .filter((item): item is { raw: string; parsed: Date } => item.parsed !== null);

  if (validDates.length === 0) return false;

  if (filter.mode === 'month') {
    const targetMonth = (filter.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) return true;

    return validDates.some(({ raw, parsed }) => {
      if (raw.startsWith(targetMonth)) return true;
      return toLocalYearMonthKey(parsed) === targetMonth;
    });
  }

  if (filter.mode === 'range') {
    const hasStart = Boolean(filter.startDate && /^\d{4}-\d{2}-\d{2}$/.test(filter.startDate));
    const hasEnd = Boolean(filter.endDate && /^\d{4}-\d{2}-\d{2}$/.test(filter.endDate));
    if (!hasStart && !hasEnd) return true;

    let startMs = -Infinity;
    let endMs = Infinity;

    if (hasStart) {
      const [sy, sm, sd] = filter.startDate.split('-').map(Number);
      startMs = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
    }
    if (hasEnd) {
      const [ey, em, ed] = filter.endDate.split('-').map(Number);
      endMs = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
    }

    return validDates.some(({ parsed }) => {
      const ts = parsed.getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  return true;
}

export function describeDateFilter(filter: DateFilterState): string {
  if (filter.mode === 'all') return 'All Time';
  if (filter.mode === 'month') {
    if (!/^\d{4}-\d{2}$/.test(filter.month)) return 'Selected Month';
    const [y, m] = filter.month.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  const s = filter.startDate || '...';
  const e = filter.endDate || '...';
  return `${s} to ${e}`;
}
