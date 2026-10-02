import React, { useState } from 'react';
import { X, DollarSign, UserCheck, ShieldCheck } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { Invoice } from '../types/isp';

interface CashPaymentModalProps {
  invoice: Invoice | null;
  onClose: () => void;
  onPaymentSuccess: (inv: Invoice, receiptNum: string) => void;
}

export const CashPaymentModal: React.FC<CashPaymentModalProps> = ({
  invoice,
  onClose,
  onPaymentSuccess,
}) => {
  const { agents, collectAgentCashPayment } = useISP();
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!invoice) return null;

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    try {
      const res = await collectAgentCashPayment(invoice.id, selectedAgentId, invoice.totalAmount);
      setIsProcessing(false);
      onPaymentSuccess(
        {
          ...invoice,
          status: 'paid',
          receiptNumber: res.receiptNumber,
          agentName: agents.find((a) => a.id === selectedAgentId)?.name,
        },
        res.receiptNumber
      );
    } catch {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl space-y-4">
        <div className="bg-emerald-950 p-5 border-b border-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600 text-slate-950 font-bold rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Record Agent Cash Collection</h3>
              <p className="text-xs text-emerald-300">Issue instant receipt & unlock MikroTik line</p>
            </div>
          </div>
          <button onClick={onClose} className="text-emerald-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handlePay} className="p-5 space-y-3.5 text-xs">
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1 font-mono">
            <div className="flex justify-between text-slate-400">
              <span>Invoice Number:</span>
              <span className="text-slate-200">{invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Subscriber:</span>
              <span className="text-white font-bold">{invoice.customerName}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Payable Due:</span>
              <span className="text-emerald-400 font-bold text-sm">
                ${invoice.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Collecting Field Recovery Agent</label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-emerald-500 font-sans"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.assignedArea}) - Current Cash: ${agent.cashInHand.toFixed(2)}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-slate-950 p-2.5 rounded text-[11px] text-slate-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              Once confirmed, customer balance is cleared, agent's cash ledger is credited, and subscriber is restored from Walled Garden.
            </span>
          </div>

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
              disabled={isProcessing}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition disabled:opacity-50"
            >
              {isProcessing ? 'Processing Cash...' : 'Confirm Cash Received'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
