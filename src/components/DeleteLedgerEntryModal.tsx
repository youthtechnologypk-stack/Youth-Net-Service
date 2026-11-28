import React, { useState, useEffect } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import {
  deleteFieldAuditLedgerEntry,
  FieldAuditLedgerRow,
  formatLedgerTransactionTypeLabel,
  VerifiedLedgerDeleteResult,
} from '../lib/ledgerAuditPersistence';
import { useCurrency } from '../context/CurrencyContext';

interface DeleteLedgerEntryModalProps {
  entry: FieldAuditLedgerRow | null;
  actorRole: string;
  onClose: () => void;
  onVerifiedDelete: (result: VerifiedLedgerDeleteResult, deletedEntry: FieldAuditLedgerRow) => Promise<void> | void;
  onErrorToast: (errorMessage: string) => void;
}

export const DeleteLedgerEntryModal: React.FC<DeleteLedgerEntryModalProps> = ({
  entry,
  actorRole,
  onClose,
  onVerifiedDelete,
  onErrorToast,
}) => {
  const { formatCurrency } = useCurrency();
  const [isDeleting, setIsDeleting] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setIsDeleting(false);
    setDbError(null);
  }, [entry]);

  if (!entry) return null;

  const txLabel = formatLedgerTransactionTypeLabel(entry.entryType);
  const formattedTimestamp = entry.collectedAt
    ? new Date(entry.collectedAt).toLocaleString()
    : 'Recent';
  const isCashHandover =
    entry.entryType?.toUpperCase() === 'CASH_HANDOVER' ||
    entry.entryType?.toUpperCase() === 'HANDOVER';
  const isAdvanceTaken = entry.entryType?.toUpperCase() === 'ADVANCE_TAKEN';

  const handleConfirmDelete = async () => {
    setDbError(null);
    setIsDeleting(true);
    try {
      const result = await deleteFieldAuditLedgerEntry({
        supabaseClient: supabase,
        entry,
        actorRole,
      });
      await onVerifiedDelete(result, entry);
      onClose();
    } catch (err: any) {
      const exactMsg =
        err?.message || 'Failed to delete ledger entry from Supabase database.';
      setDbError(exactMsg);
      onErrorToast(exactMsg);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto font-sans animate-fadeIn">
      <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-rose-800/80 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-950 border border-rose-800 text-rose-400 shrink-0">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">Delete Ledger Entry?</h3>
              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                Permanent PostgreSQL delete &amp; instant balance recalculation
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs">
          {dbError && (
            <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-200 font-mono text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-100">Database Delete Failed</div>
                <div className="mt-0.5 break-all">{dbError}</div>
              </div>
            </div>
          )}

          <p className="text-slate-300 leading-relaxed">
            Are you sure you want to permanently delete this entry for{' '}
            <strong className="text-white">{entry.agentName || 'this Field Agent'}</strong>? The
            agent&apos;s <strong className="text-emerald-300">Cash Handover</strong>,{' '}
            <strong className="text-amber-300">Advance Taken</strong>, and{' '}
            <strong className="text-cyan-300">Net Cash-in-Hand Balance</strong> will be
            recalculated immediately.
          </p>

          {/* Transaction Details Card */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 font-mono text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Transaction Type:</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                  isCashHandover
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : isAdvanceTaken
                    ? 'bg-amber-950 text-amber-300 border-amber-800'
                    : entry.entryType === 'COLLECTION'
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-800'
                    : 'bg-purple-950 text-purple-300 border-purple-800'
                }`}
              >
                {txLabel}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Amount:</span>
              <span className="font-bold text-rose-300 text-sm tabular-nums">
                {formatCurrency(Number(entry.amount) || 0)}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Timestamp:</span>
              <span className="text-slate-200">{formattedTimestamp}</span>
            </div>

            {entry.subscriberUsername ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Client Username:</span>
                <span className="text-cyan-300 font-bold">@{entry.subscriberUsername}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Handed Over To / Received By:</span>
                <span className="text-slate-200">{entry.paymentMethod || 'Admin'}</span>
              </div>
            )}

            <div className="pt-2 border-t border-slate-800/80 space-y-1">
              <span className="text-slate-400 block">Audit Notes:</span>
              <p className="text-slate-200 font-sans text-xs break-words whitespace-pre-wrap">
                {entry.remarks || '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              disabled={isDeleting}
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-2 transition cursor-pointer shadow-lg shadow-rose-950/50 disabled:opacity-60"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Confirm Delete</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
