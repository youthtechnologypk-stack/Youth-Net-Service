import React, { useState } from 'react';
import { BillingManagement, BillingManagementProps } from './BillingManagement';
import { BillingView } from './BillingView';
import { ExpiryAutomationView } from './ExpiryAutomationView';
import { Database, Layers, ShieldAlert } from 'lucide-react';

export interface BillingStudioProps extends BillingManagementProps {}

export { BillingView };

export const BillingStudio: React.FC<BillingStudioProps> = (props) => {
  const [activeMode, setActiveMode] = useState<'postgresql' | 'carrier' | 'expiry'>('postgresql');

  return (
    <div className="w-full max-w-full min-w-0 box-border space-y-4">
      {/* View Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#111A2E] p-2 rounded-xl border border-slate-200 dark:border-slate-800 min-w-0">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 w-full sm:w-auto min-w-0">
          <button
            type="button"
            onClick={() => setActiveMode('postgresql')}
            className={`px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-lg text-xs font-semibold flex items-center justify-center sm:justify-start gap-1.5 transition cursor-pointer text-center leading-tight min-w-0 ${
              activeMode === 'postgresql'
                ? 'bg-sky-600 text-white border border-sky-600 font-bold shadow-sm dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60 dark:shadow-[0_0_15px_rgba(56,189,248,0.18)]'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 bg-slate-50 border border-slate-200 sm:border-transparent sm:bg-transparent dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60 dark:bg-slate-950/60 dark:border-slate-800/80 dark:sm:border-transparent dark:sm:bg-transparent'
            }`}
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">PostgreSQL Invoices</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode('carrier')}
            className={`px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-lg text-xs font-semibold flex items-center justify-center sm:justify-start gap-1.5 transition cursor-pointer text-center leading-tight min-w-0 ${
              activeMode === 'carrier'
                ? 'bg-sky-600 text-white border border-sky-600 font-bold shadow-sm dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60 dark:shadow-[0_0_15px_rgba(56,189,248,0.18)]'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 bg-slate-50 border border-slate-200 sm:border-transparent sm:bg-transparent dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60 dark:bg-slate-950/60 dark:border-slate-800/80 dark:sm:border-transparent dark:sm:bg-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Invoicing Studio</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode('expiry')}
            className={`col-span-2 sm:col-span-1 px-3 py-2 sm:py-1.5 rounded-xl sm:rounded-lg text-xs font-semibold flex items-center justify-center sm:justify-start gap-1.5 transition cursor-pointer text-center leading-tight min-w-0 ${
              activeMode === 'expiry'
                ? 'bg-emerald-600 text-white border border-emerald-600 font-bold shadow-sm dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-400/60 dark:shadow-[0_0_15px_rgba(16,185,129,0.18)]'
                : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100 bg-slate-50 border border-slate-200 sm:border-transparent sm:bg-transparent dark:text-slate-300 dark:hover:text-white dark:hover:bg-slate-800/60 dark:bg-slate-950/60 dark:border-slate-800/80 dark:sm:border-transparent dark:sm:bg-transparent'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Auto-Expiry &amp; Grace</span>
          </button>
        </div>

        <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline font-mono">
          Connected: youthtechnologypk-stack (PostgreSQL)
        </span>
      </div>

      {activeMode === 'postgresql' ? (
        <BillingView
          currentRole={props.currentRole}
          currentUser={props.currentUser}
          onOpenReceiptModal={props.onOpenReceiptModal}
        />
      ) : activeMode === 'expiry' ? (
        <ExpiryAutomationView />
      ) : (
        <BillingManagement {...props} />
      )}
    </div>
  );
};

export default BillingStudio;
