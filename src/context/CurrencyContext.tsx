import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

export interface CurrencyConfig {
  code: string;
  symbol: string;
  label: string;
}

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'PKR', symbol: 'Rs.', label: 'Pakistani Rupee (PKR - Rs.)' },
  { code: 'USD', symbol: '$', label: 'US Dollar (USD - $)' },
  { code: 'EUR', symbol: '€', label: 'Euro (EUR - €)' },
  { code: 'GBP', symbol: '£', label: 'British Pound (GBP - £)' },
  { code: 'INR', symbol: '₹', label: 'Indian Rupee (INR - ₹)' },
  { code: 'AED', symbol: 'AED', label: 'UAE Dirham (AED)' },
  { code: 'SAR', symbol: 'SAR', label: 'Saudi Riyal (SAR)' },
  { code: 'BDT', symbol: '৳', label: 'Bangladeshi Taka (BDT - ৳)' },
];

/**
 * Universal standalone currency formatter function.
 * Matches requested signature:
 * export const formatCurrency = (amount: number, symbol: string = 'Rs.') => `${symbol} ${amount.toLocaleString()}`;
 */
export const formatCurrency = (
  amount: number | string | null | undefined,
  symbol: string = 'Rs.',
  decimals?: number
): string => {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (isNaN(numeric) || amount === null || amount === undefined) {
    return `${symbol} 0.00`;
  }

  if (decimals !== undefined) {
    return `${symbol} ${numeric.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }

  // If already an integer, keep standard 2-decimal display for consistency in financials
  return `${symbol} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export interface CurrencyContextType {
  currencyCode: string;
  currencySymbol: string;
  formatCurrency: (amount: number | string | null | undefined, decimals?: number) => string;
  formatWithSymbol: (amount: number | string | null | undefined, customSymbol?: string, decimals?: number) => string;
  updateCurrency: (code: string, symbol?: string) => Promise<void>;
  supportedCurrencies: CurrencyConfig[];
  isLoading: boolean;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const STORAGE_KEY_CODE = 'isp_currency_code';
const STORAGE_KEY_SYMBOL = 'isp_currency_symbol';

export const CurrencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Initial local state from localStorage or default 'PKR' / 'Rs.'
  const [currencyCode, setCurrencyCode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY_CODE);
      if (stored) return stored;
    }
    return 'PKR';
  });

  const [currencySymbol, setCurrencySymbol] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY_SYMBOL);
      if (stored) return stored;
    }
    return 'Rs.';
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 2. Fetch persisted settings from PostgreSQL system_settings table on mount
  useEffect(() => {
    let isMounted = true;
    const fetchPersistedSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.settings) {
            const serverCode = data.settings.currencyCode || data.settings.currency_code;
            const serverSymbol = data.settings.currencySymbol || data.settings.currency_symbol;

            if (isMounted) {
              if (serverCode) {
                setCurrencyCode(serverCode);
                localStorage.setItem(STORAGE_KEY_CODE, serverCode);
              }
              if (serverSymbol) {
                setCurrencySymbol(serverSymbol);
                localStorage.setItem(STORAGE_KEY_SYMBOL, serverSymbol);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[CurrencyContext] Offline or settings fetch failed, using cached settings:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchPersistedSettings();
    return () => {
      isMounted = false;
    };
  }, []);

  // 3. Update Currency handler: immediately updates state & localStorage, and syncs to PostgreSQL
  const updateCurrency = useCallback(async (newCode: string, newSymbol?: string) => {
    const code = newCode.trim().toUpperCase();
    let symbol = newSymbol?.trim();

    if (!symbol) {
      const matched = SUPPORTED_CURRENCIES.find((c) => c.code === code);
      symbol = matched ? matched.symbol : code;
    }

    // Immediate reactive state update triggers instant re-render across entire dashboard
    setCurrencyCode(code);
    setCurrencySymbol(symbol);

    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CODE, code);
      localStorage.setItem(STORAGE_KEY_SYMBOL, symbol);
    }

    // Persist to PostgreSQL system_settings table
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currencyCode: code,
          currencySymbol: symbol,
        }),
      });
    } catch (err) {
      console.warn('[CurrencyContext] Could not persist to PostgreSQL system_settings table:', err);
    }
  }, []);

  // 4. Formatter helper bound to active currency symbol
  const format = useCallback(
    (amount: number | string | null | undefined, decimals?: number) => {
      return formatCurrency(amount, currencySymbol, decimals);
    },
    [currencySymbol]
  );

  const formatWithSymbol = useCallback(
    (amount: number | string | null | undefined, customSymbol?: string, decimals?: number) => {
      return formatCurrency(amount, customSymbol || currencySymbol, decimals);
    },
    [currencySymbol]
  );

  const value = useMemo(
    () => ({
      currencyCode,
      currencySymbol,
      formatCurrency: format,
      formatWithSymbol,
      updateCurrency,
      supportedCurrencies: SUPPORTED_CURRENCIES,
      isLoading,
    }),
    [currencyCode, currencySymbol, format, formatWithSymbol, updateCurrency, isLoading]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
