import React, { useState, useEffect } from 'react';
import { X, DollarSign, UserCheck, ShieldCheck, ArrowRight, Building, CheckCircle2 } from 'lucide-react';
import { FieldAgent } from '../types/isp';
import { useISP } from '../context/ISPContext';

interface HandoverCashModalProps {
  agent: FieldAgent;
  isOpen: boolean;
  onClose: () => void;
  onHandoverSuccess?: (handoverNumber: string, amount: number) => void;
}

export const HandoverCashModal: React.FC<HandoverCashModalProps> = ({
  agent,
  isOpen,
  onClose,
  onHandoverSuccess,
}) => {
  const { handoverCashToBoss } = useISP();

  const [handoverAmount, setHandoverAmount] = useState<number>(agent.cashInHand);
  const [receiver, setReceiver] = useState<string>('Boss / CEO Desk (Mr. Farhan)');
  const [notes, setNotes] = useState<string>('Daily field cash collections settlement');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successResult, setSuccessResult] = useState<{ handoverNum: string; amount: number } | null>(null);

  useEffect(() => {
    setHandoverAmount(agent.cashInHand);
    setSuccessResult(null);
  }, [agent, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (handoverAmount <= 0) return;

    setIsSubmitting(true);
    try {
      const result = await handoverCashToBoss(
        agent.id,
        handoverAmount,
        receiver,
        notes
      );
      setSuccessResult({ handoverNum: result.handoverNumber, amount: handoverAmount });
      if (onHandoverSuccess) {
        onHandoverSuccess(result.handoverNumber, handoverAmount);
      }
    } catch (err) {
      console.error('Failed to handover cash:', err);
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
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Handover Cash to Boss</h3>
              <p className="text-[11px] text-slate-400">Field Agent Cash Settlement Desk</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* If successfully handed over */}
        {successResult ? (
          <div className="p-5 text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-950 border border-emerald-600 rounded-full flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-white">Cash Handover Completed!</h4>
              <p className="text-xs text-slate-400 mt-1">
                Successfully deposited <span className="text-emerald-400 font-bold font-mono">${successResult.amount.toFixed(2)}</span> with {receiver}.
              </p>
            </div>

            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono space-y-1.5 text-left">
              <div className="flex justify-between">
                <span className="text-slate-400">Settlement Ref:</span>
                <span className="text-cyan-300 font-bold">{successResult.handoverNum}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Submitting Agent:</span>
                <span className="text-slate-200">{agent.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Remaining in Hand:</span>
                <span className="text-emerald-400 font-bold">${agent.cashInHand.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                <span>WhatsApp Notice:</span>
                <span className="text-emerald-400">Delivered to Boss & Agent</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs transition"
            >
              Done & Return to App
            </button>
          </div>
        ) : (
          /* Handover Form */
          <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
            {/* Agent & Cash in Hand Summary */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block">Submitting Field Agent</span>
                <span className="text-xs font-bold text-white">{agent.name}</span>
                <span className="text-[10px] text-cyan-400 block font-mono">{agent.assignedArea}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block font-mono">Current Cash in Hand</span>
                <span className="text-base font-bold text-emerald-400 font-mono">
                  ${agent.cashInHand.toFixed(2)}
                </span>
              </div>
            </div>

            {agent.cashInHand <= 0 && (
              <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300 text-[11px]">
                ⚠️ You currently have $0.00 cash in hand. Collect subscriber dues before submitting handover.
              </div>
            )}

            {/* Handover Amount Input */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-300 font-medium">Amount to Handover ($)</label>
                {agent.cashInHand > 0 && (
                  <button
                    type="button"
                    onClick={() => setHandoverAmount(agent.cashInHand)}
                    className="text-[10px] text-cyan-400 hover:underline font-mono"
                  >
                    Handover All (${agent.cashInHand.toFixed(2)})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-slate-500 font-mono">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={agent.cashInHand || 9999}
                  required
                  value={handoverAmount}
                  onChange={(e) => setHandoverAmount(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 text-emerald-400 font-mono text-sm pl-7 pr-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 font-bold"
                />
              </div>
            </div>

            {/* Receiver / Boss Selection */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Receiver / Boss Desk</label>
              <select
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              >
                <option value="Boss / CEO Desk (Mr. Farhan)">Boss / CEO Desk (Mr. Farhan)</option>
                <option value="Head of Accounts (Sector G-11)">Head of Accounts (Sector G-11)</option>
                <option value="Central NOC Cashier Desk">Central NOC Cashier Desk</option>
                <option value="Bank Direct Branch Deposit">Bank Direct Branch Deposit</option>
              </select>
            </div>

            {/* Notes / Comment */}
            <div>
              <label className="block text-slate-300 font-medium mb-1">Settlement Notes / Slip Ref</label>
              <input
                type="text"
                placeholder="e.g. Sector G-11 evening recovery cash handover"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>

            {/* Calculation breakdown */}
            <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 text-[11px] font-mono space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Handover Amount:</span>
                <span className="text-white font-bold">${handoverAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Remaining in Hand after Handover:</span>
                <span className="text-cyan-400 font-bold">
                  ${Math.max(0, agent.cashInHand - handoverAmount).toFixed(2)}
                </span>
              </div>
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
                disabled={isSubmitting || agent.cashInHand <= 0 || handoverAmount <= 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold transition shadow-sm flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Confirm Handover to Boss</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
