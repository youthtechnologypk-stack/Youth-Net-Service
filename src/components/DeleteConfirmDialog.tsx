import React from 'react';
import { AlertTriangle, Trash2, X, ShieldAlert, Loader2 } from 'lucide-react';

export interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  itemName: string;
  itemType?: 'user' | 'router' | 'item';
  description?: string;
  confirmText?: string;
  isLoading?: boolean;
  cleanupSteps?: string[];
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  itemName,
  itemType = 'user',
  description,
  confirmText = 'Confirm Delete',
  isLoading = false,
  cleanupSteps,
}) => {
  if (!isOpen) return null;

  const defaultCleanupSteps =
    itemType === 'user'
      ? [
          'Terminate active PPPoE session on physical MikroTik router (/ppp/active/remove)',
          'Permanently delete user secret from RouterOS credentials list (/ppp/secret/remove)',
          'Archive / soft-delete customer record in PostgreSQL database',
        ]
      : [
          'Remove router connection profile and credentials from PostgreSQL database',
          'Terminate background sync polling and live telemetry streaming',
          'Preserve historical network log records for Carrier SLA audits',
        ];

  const stepsToDisplay = cleanupSteps || defaultCleanupSteps;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-rose-800/60 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl shadow-rose-950/40">
        {/* Header */}
        <div className="bg-rose-950/40 border-b border-rose-800/40 p-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-900/40 border border-rose-700/60 text-rose-400 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">{title}</h3>
              <p className="text-xs text-rose-300 font-mono mt-0.5">
                Target: <strong className="text-white underline">{itemName}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-xs">
          <p className="text-slate-300 leading-relaxed">
            {description || (
              <>
                Are you sure you want to permanently delete{' '}
                <strong className="text-white font-mono">{itemName}</strong>? This triggers immediate
                dual-cleanup across the physical MikroTik router hardware and the database.
              </>
            )}
          </p>

          {/* Action Checklist */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-2 font-mono text-[11px]">
            <span className="text-slate-400 font-semibold block uppercase tracking-wider text-[10px]">
              Dual-Cleanup Pipeline:
            </span>
            <ul className="space-y-1.5 text-slate-300">
              {stepsToDisplay.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-rose-400 font-bold shrink-0">&bull;</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-rose-950/20 border border-rose-900/50 rounded-lg p-3 text-[11px] text-rose-300/90 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>This action cannot be undone. Any active PPPoE tunnel will drop instantly.</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800/80 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs transition disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-rose-950/50 disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Executing Dual-Cleanup...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>{confirmText}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
