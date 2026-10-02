import React from 'react';
import { Printer, CheckCircle2, X, Share2, ShieldCheck, QrCode } from 'lucide-react';
import { Invoice } from '../types/isp';

interface ReceiptModalProps {
  invoice: Invoice | null;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ invoice, onClose }) => {
  if (!invoice) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl space-y-4">
        {/* Receipt Header */}
        <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 p-5 border-b border-slate-800 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg bg-slate-800/60"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span className="font-mono text-xs uppercase tracking-wider text-emerald-400 font-bold">
              Official Digital Cash Receipt
            </span>
          </div>
          <h3 className="text-xl font-black text-white uppercase tracking-wider">
            Youth Net Service
          </h3>
          <p className="text-xs text-slate-400">Carrier-Grade Ultra Fast Fiber Network</p>
        </div>

        {/* Receipt Details Body */}
        <div className="p-5 space-y-4 text-xs font-mono">
          <div className="flex justify-between items-center bg-slate-950 p-3 rounded-lg border border-slate-800">
            <div>
              <span className="text-slate-400 text-[10px] block">Receipt Number</span>
              <span className="text-cyan-300 font-bold text-sm">
                {invoice.receiptNumber || `RCPT-${invoice.invoiceNumber}`}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[10px] block">Invoice Ref</span>
              <span className="text-slate-200">{invoice.invoiceNumber}</span>
            </div>
          </div>

          <div className="space-y-2 text-slate-300 pt-1">
            <div className="flex justify-between">
              <span className="text-slate-400">Customer Name:</span>
              <span className="text-white font-bold">{invoice.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Mobile Phone:</span>
              <span>{invoice.customerPhone}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Billing Period:</span>
              <span>{invoice.billingMonth}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Package Subscribed:</span>
              <span className="text-cyan-400">{invoice.packageName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Paid On:</span>
              <span>{invoice.paidAt ? new Date(invoice.paidAt).toLocaleString() : new Date().toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Field Recovery Agent:</span>
              <span className="text-emerald-400 font-semibold">{invoice.agentName || 'Bilal Khan (Field Staff)'}</span>
            </div>
          </div>

          {/* Amount Calculation */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1.5 pt-2">
            <div className="flex justify-between text-slate-400">
              <span>Base Package Fee:</span>
              <span>${invoice.baseAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Telecom Sales Tax (16%):</span>
              <span>${invoice.taxAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-white font-bold text-sm pt-1 border-t border-slate-800">
              <span>Total Paid (Cash):</span>
              <span className="text-emerald-400">${invoice.totalAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Verification Badge */}
          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 font-sans">
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> MikroTik Line 100% Unlocked
            </span>
            <span className="text-[10px] text-slate-500 font-mono">Auth Token: ROS-7-{invoice.id.slice(-6)}</span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex items-center justify-between">
          <button
            onClick={() => alert(`Receipt ${invoice.receiptNumber || invoice.invoiceNumber} shared to customer's WhatsApp: ${invoice.customerPhone}`)}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-medium font-sans"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Send to WhatsApp</span>
          </button>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Official Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
