import React, { useState, useEffect } from 'react';
import { AlertTriangle, Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import {
  FieldAuditLedgerRow,
  updateFieldAuditLedgerEntry,
  VerifiedLedgerUpdateResult,
} from '../lib/ledgerAuditPersistence';

interface EditLedgerEntryModalProps {
  entry: FieldAuditLedgerRow | null;
  agents: SupabasePortalUser[];
  editedBy: string;
  onClose: () => void;
  onVerifiedSuccess: (result: VerifiedLedgerUpdateResult) => Promise<void> | void;
  onErrorToast: (errorMessage: string) => void;
}

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 16);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export const EditLedgerEntryModal: React.FC<EditLedgerEntryModalProps> = ({
  entry,
  agents,
  editedBy,
  onClose,
  onVerifiedSuccess,
  onErrorToast,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash Handover');
  const [collectedAtLocal, setCollectedAtLocal] = useState<string>('');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [remarks, setRemarks] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setAmount(String(entry.amount ?? 0));
    setPaymentMethod(entry.paymentMethod || 'Cash Handover');
    setCollectedAtLocal(toDatetimeLocalValue(entry.collectedAt));
    setSelectedAgentId(entry.agentId || '');
    setRemarks(entry.remarks || '');
    setEditReason(entry.editReason || '');
    setDbError(null);
    setIsSaving(false);
  }, [entry]);

  if (!entry) return null;

  const isCollectionEntry =
    entry.entryType === 'COLLECTION' ||
    entry.sourceTable === 'payment_transactions' ||
    entry.sourceTable === 'recovery_ledger' ||
    entry.sourceTable === 'invoices';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDbError(null);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      const msg = 'Please enter a valid non-negative amount in PKR.';
      setDbError(msg);
      onErrorToast(msg);
      return;
    }

    const chosenAgent = agents.find((a) => a.id === selectedAgentId);
    const resolvedAgentName = chosenAgent?.full_name || entry.agentName || 'Field Agent';
    const collectedAtIso = collectedAtLocal
      ? new Date(collectedAtLocal).toISOString()
      : entry.collectedAt || new Date().toISOString();

    setIsSaving(true);
    try {
      const result = await updateFieldAuditLedgerEntry({
        supabaseClient: supabase,
        entry,
        amount: Math.round(parsedAmount * 100) / 100,
        paymentMethod: paymentMethod.trim() || 'Cash Handover',
        collectedAtIso,
        agentId: selectedAgentId || entry.agentId,
        agentName: resolvedAgentName,
        remarks: remarks.trim(),
        editedBy,
        editReason: editReason.trim(),
      });

      await onVerifiedSuccess(result);
      onClose();
    } catch (err: any) {
      const exactMsg =
        err?.message || 'Supabase database rejected the update. Check RLS UPDATE/SELECT policies.';
      setDbError(exactMsg);
      onErrorToast(exactMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden animate-fadeIn">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-white text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>Edit Field Agent Audit Ledger Entry</span>
            </h3>
            <p className="text-[11px] font-mono text-slate-400 mt-0.5">
              Table: <code className="text-cyan-300">{entry.sourceTable}</code> · ID:{' '}
              <code className="text-slate-300">{entry.recordId.slice(0, 8)}...</code>
              {entry.subscriberUsername ? ` · @${entry.subscriberUsername}` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* Strict Database / RLS Error Banner */}
          {dbError && (
            <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-200 font-mono text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-rose-100">Database Write Failed (Not Saved)</div>
                <div className="mt-0.5 break-all">{dbError}</div>
              </div>
            </div>
          )}

          {/* Previous Audit Trail Snapshot */}
          {(entry.previousAmount !== null && entry.previousAmount !== undefined) || entry.editedBy ? (
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span>
                Previous Amount:{' '}
                <strong className="text-amber-300">
                  Rs. {Math.round(Number(entry.previousAmount ?? entry.amount)).toLocaleString()}
                </strong>
              </span>
              {entry.editedBy && (
                <span className="text-slate-400">
                  Last edited by <strong className="text-cyan-300">{entry.editedBy}</strong>
                </span>
              )}
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">
                Amount (PKR) *
              </label>
              <input
                type="number"
                step="1"
                min="0"
                required
                disabled={isSaving}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">
                {isCollectionEntry ? 'Payment Method' : 'Received By / Channel'}
              </label>
              {isCollectionEntry ? (
                <select
                  disabled={isSaving}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                >
                  <option value="Cash Handover">Cash Handover</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="EasyPaisa">EasyPaisa</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="NOC Cash Desk">NOC Cash Desk</option>
                </select>
              ) : (
                <input
                  type="text"
                  disabled={isSaving}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              )}
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">
                Collection / Entry Date &amp; Time
              </label>
              <input
                type="datetime-local"
                disabled={isSaving}
                value={collectedAtLocal}
                onChange={(e) => setCollectedAtLocal(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">
                Field Agent
              </label>
              <select
                disabled={isSaving}
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="">NOC Desk / Direct</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.full_name} (@{ag.username})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 font-mono">
            <div>
              <label className="block text-slate-400 text-[11px] mb-1">Remarks / Ledger Notes</label>
              <textarea
                rows={2}
                disabled={isSaving}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Collection or handover remarks..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 text-[11px] mb-1">
                Edit Reason (Audit Trail)
              </label>
              <input
                type="text"
                disabled={isSaving}
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="e.g. Corrected cash receipt amount after physical count"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-2 transition cursor-pointer disabled:opacity-60"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving to Database...</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
