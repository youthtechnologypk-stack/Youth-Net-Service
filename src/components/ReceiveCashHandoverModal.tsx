import React, { useState, useEffect } from 'react';
import { X, DollarSign, ShieldCheck, CheckCircle2, User, Building } from 'lucide-react';
import { FieldAgent } from '../types/isp';
import { useISP } from '../context/ISPContext';

interface ReceiveCashHandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAgentId?: string;
}

export const ReceiveCashHandoverModal: React.FC<ReceiveCashHandoverModalProps> = ({
  isOpen,
  onClose,
  defaultAgentId,
}) => {
  const { agents, receiveDirectHandoverFromAgent } = useISP();

  const [agentId, setAgentId] = useState<string>(defaultAgentId || agents[0]?.id || '');
  const [amount, setAmount] = useState<number>(0);
  const [receiver, setReceiver] = useState<string>('Boss / CEO Desk (Mr. Farhan)');
  const [notes, setNotes] = useState<string>('Direct office cash handover from agent');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === agentId) || agents[0];

  useEffect(() => {
    if (defaultAgentId) {
      setAgentId(defaultAgentId);
    }
    setSuccessMessage(null);
  }, [defaultAgentId, isOpen]);

  useEffect(() => {
    if (selectedAgent) {
      setAmount(selectedAgent.cashInHand);
    }
  }, [selectedAgent]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent || amount <= 0) return;

    setIsSubmitting(true);
    try {
      const res = await receiveDirectHandoverFromAgent(
        selectedAgent.id,
        amount,
        receiver,
        notes
      );
      setSuccessMessage(`Cash Handover ${res.handoverNumber} of $${amount.toFixed(2)} accepted & confirmed!`);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-lg">
              <Building className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Receive & Confirm Agent Cash</h3>
              <p className="text-[11px] text-slate-400">Admin Vault Cash Deposit Desk</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {successMessage ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-950 border border-emerald-600 rounded-full flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-white">Deposit Confirmed into Vault!</h4>
              <p className="text-xs text-slate-300 mt-1">{successMessage}</p>
              <p className="text-[11px] text-slate-500 mt-1">
                WhatsApp settlement receipt sent to {selectedAgent?.name} ({selectedAgent?.phone}).
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs transition"
            >
              Done & Return to Ledger
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
            {/* Agent Select */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Select Field Recovery Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-mono"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} &bull; Cash-in-Hand: ${a.cashInHand.toFixed(2)} ({a.assignedArea})
                  </option>
                ))}
              </select>
            </div>

            {/* Cash in Hand Snapshot */}
            {selectedAgent && (
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs font-mono">
                <div>
                  <span className="text-slate-400 text-[10px] block">Current Cash Held by Agent:</span>
                  <span className="text-cyan-300 font-bold">${selectedAgent.cashInHand.toFixed(2)}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 text-[10px] block">Collected Today:</span>
                  <span className="text-emerald-400 font-bold">${selectedAgent.totalCollectedToday.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Amount Received Input */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-300 font-medium">Physical Cash Amount Received ($)</label>
                {selectedAgent && selectedAgent.cashInHand > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(selectedAgent.cashInHand)}
                    className="text-[10px] text-cyan-400 hover:underline font-mono"
                  >
                    Receive All (${selectedAgent.cashInHand.toFixed(2)})
                  </button>
                )}
              </div>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-base p-2.5 rounded-lg focus:outline-none focus:border-emerald-500 font-bold"
              />
            </div>

            {/* Receiver Desk */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Receiving Desk / Vault</label>
              <select
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              >
                <option value="Boss / CEO Desk (Mr. Farhan)">Boss / CEO Desk (Mr. Farhan)</option>
                <option value="Head of Accounts (Sector G-11)">Head of Accounts (Sector G-11)</option>
                <option value="Central NOC Cashier Desk">Central NOC Cashier Desk</option>
                <option value="Main Office Vault Safe">Main Office Vault Safe</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Verification Remarks / Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Verified and counted cash deposit"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || amount <= 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold transition shadow-sm flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Confirm & Accept Deposit (${amount.toFixed(2)})</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
