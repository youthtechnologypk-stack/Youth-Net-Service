import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { CheckCircle2, DollarSign, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';

export interface BulkReceivePreviewRow {
  key: string;
  username: string;
  label: string;
  amount: number;
}

export interface BulkReceiveAgentOption {
  id: string;
  full_name: string;
  area?: string;
  role?: string;
}

export interface BulkReceiveAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  itemLabel?: string;
  previewRows: BulkReceivePreviewRow[];
  totalAmount: number;
  agents: BulkReceiveAgentOption[];
  isProcessing: boolean;
  progressLabel?: string | null;
  onConfirm: (payload: {
    paymentMethod: string;
    agentId: string;
    agentName: string;
    referenceNote: string;
  }) => Promise<void> | void;
}

export const BulkReceiveAmountModal: React.FC<BulkReceiveAmountModalProps> = ({
  isOpen,
  onClose,
  title = 'Bulk Receive Amount & Auto-Restore',
  itemLabel = 'Items',
  previewRows,
  totalAmount,
  agents,
  isProcessing,
  progressLabel,
  onConfirm,
}) => {
  const { formatCurrency } = useCurrency();
  const [paymentMethod, setPaymentMethod] = useState<string>('Cash');
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [referenceNote, setReferenceNote] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setPaymentMethod('Cash');
      setSelectedAgentId('');
      setReferenceNote('');
    }
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isProcessing || previewRows.length === 0) return;
    await onConfirm({
      paymentMethod,
      agentId: selectedAgentId,
      agentName: selectedAgent ? selectedAgent.full_name : 'Direct NOC / Office Account',
      referenceNote: referenceNote.trim(),
    });
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 999999,
      }}
      className="bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
    >
      <div
        style={{ width: '100%', maxWidth: '460px', maxHeight: '88dvh' }}
        className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 sm:p-5 box-border mx-auto bg-[#111A2E] border border-emerald-700/60 shadow-2xl relative"
      >
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 shrink-0">
              <DollarSign className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">{title}</h2>
              <p className="text-xs font-mono text-emerald-300">
                {previewRows.length} {itemLabel} Selected • Total {formatCurrency(totalAmount, 0)}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 shrink-0 cursor-pointer disabled:opacity-40"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Selected Items Preview */}
          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800 pb-1.5">
              <span>SELECTED LEDGER BREAKDOWN</span>
              <span className="text-emerald-400 font-bold">{formatCurrency(totalAmount, 0)}</span>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {previewRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-2 text-xs font-mono py-1 border-b border-slate-900 last:border-b-0"
                >
                  <div className="min-w-0 truncate">
                    <span className="text-cyan-300 font-bold">@{row.username}</span>
                    {row.label && (
                      <span className="text-slate-500 ml-1.5 text-[11px]">{row.label}</span>
                    )}
                  </div>
                  <span className="text-white font-bold shrink-0">
                    {formatCurrency(row.amount, 0)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Payment Method
            </label>
            <div className="grid grid-cols-2 gap-2">
              {['Cash', 'JazzCash', 'EasyPaisa', 'Bank Transfer'].map((method) => (
                <button
                  key={method}
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setPaymentMethod(method)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer ${
                    paymentMethod === method
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* Receiving Agent */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-purple-400" />
              <span>Receiving Field Agent / Account</span>
            </label>
            <select
              value={selectedAgentId}
              disabled={isProcessing}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- Direct NOC / Office Account --</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.full_name}
                  {ag.area ? ` (${ag.area})` : ''}
                  {ag.role ? ` · ${ag.role}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {selectedAgentId
                ? `Credits ${selectedAgent?.full_name}'s Cash-in-Hand & ledger by ${formatCurrency(
                    totalAmount,
                    0
                  )}.`
                : `Posts ${formatCurrency(totalAmount, 0)} directly to Direct NOC / ${paymentMethod} Ledger.`}
            </p>
          </div>

          {/* Reference Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Reference / Receipt Note (Optional)
            </label>
            <input
              type="text"
              disabled={isProcessing}
              value={referenceNote}
              onChange={(e) => setReferenceNote(e.target.value)}
              placeholder="e.g. Evening batch recovery handover"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Auto-Restore Guarantee Banner */}
          <div className="p-2.5 rounded-xl bg-cyan-950/50 border border-cyan-800/70 text-[11px] text-cyan-200 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <span>
              All selected invoices will be marked <strong>PAID</strong>, posted to ledger, and every subscriber whose due balance reaches <strong>Rs. 0</strong> will immediately restore to their exact MikroTik profile (<code>ORIG_PKG</code>).
            </span>
          </div>

          {/* Live Progress Bar if Running */}
          {isProcessing && progressLabel && (
            <div className="p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700/60 text-xs font-mono text-emerald-300 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{progressLabel}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              disabled={isProcessing}
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isProcessing || previewRows.length === 0}
              className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{progressLabel || 'Processing Bulk Receive...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    Confirm Bulk Receive ({formatCurrency(totalAmount, 0)})
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
