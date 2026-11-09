import React, { useState } from 'react';
import { BillingManagement, BillingManagementProps } from './BillingManagement';
import { BillingView } from './BillingView';
import { Database, Layers } from 'lucide-react';

export interface BillingStudioProps extends BillingManagementProps {}

export { BillingView };

export const BillingStudio: React.FC<BillingStudioProps> = (props) => {
  const [activeMode, setActiveMode] = useState<'postgresql' | 'carrier'>('postgresql');

  return (
    <div className="space-y-4">
      {/* View Switcher Bar */}
      <div className="flex items-center justify-between bg-[#111A2E] p-2 rounded-xl border border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveMode('postgresql')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeMode === 'postgresql'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Supabase PostgreSQL Invoices</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMode('carrier')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
              activeMode === 'carrier'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>NOC Invoicing Studio</span>
          </button>
        </div>

        <span className="text-[11px] text-slate-500 hidden sm:inline font-mono">
          Connected: youthtechnologypk-stack (PostgreSQL)
        </span>
      </div>

      {activeMode === 'postgresql' ? (
        <BillingView
          currentRole={props.currentRole}
          currentUser={props.currentUser}
          onOpenReceiptModal={props.onOpenReceiptModal}
        />
      ) : (
        <BillingManagement {...props} />
      )}
    </div>
  );
};

export default BillingStudio;
