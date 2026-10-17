import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  DollarSign,
  Calendar,
  Clock,
  User,
  CheckCircle2,
  X,
  FileText,
  AlertCircle,
  Smartphone,
  ShieldCheck,
  Send,
} from 'lucide-react';
import { Invoice, PaymentMethod } from '../types/isp';
import { useCurrency } from '../context/CurrencyContext';
import { useISP } from '../context/ISPContext';

export interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onPaymentRecorded: (
    invoice: Invoice,
    details: {
      paidAt: string;
      amount: number;
      paymentMethod: PaymentMethod | string;
      collectorName: string;
      reference?: string;
      sendWhatsAppReceipt?: boolean;
    }
  ) => void;
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  invoice,
  onPaymentRecorded,
}) => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const { customers, agents } = useISP();

  // Find linked customer for PPPoE username
  const customer = customers.find(
    (c) => c.id === invoice?.customerId || c.name === invoice?.customerName
  );

  // Default to current local datetime in ISO-like YYYY-MM-DDTHH:mm format
  const getInitialDateTime = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  };

  const [paymentDate, setPaymentDate] = useState<string>(getInitialDateTime());
  const [amountReceived, setAmountReceived] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<string>('agent_cash');
  const [collectorName, setCollectorName] = useState<string>('Office Counter / Admin');
  const [transactionRef, setTransactionRef] = useState<string>('');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync state whenever selected invoice opens
  useEffect(() => {
    if (invoice) {
      setAmountReceived(invoice.totalAmount);
      setPaymentDate(getInitialDateTime());
      setTransactionRef(`TXN-${Date.now().toString().slice(-6)}`);
      setErrorMessage(null);
      // Pre-fill agent name if assigned
      if (invoice.agentName) {
        setCollectorName(invoice.agentName);
      } else if (agents.length > 0) {
        setCollectorName(agents[0].name);
      } else {
        setCollectorName('Office Counter / Admin');
      }
    }
  }, [invoice, agents]);

  if (!isOpen || !invoice) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (amountReceived <= 0) {
      setErrorMessage('Please enter a valid amount received greater than 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Format paidAt ISO timestamp
      const paidTimestamp = paymentDate
        ? new Date(paymentDate).toISOString()
        : new Date().toISOString();

      onPaymentRecorded(invoice, {
        paidAt: paidTimestamp,
        amount: Number(amountReceived),
        paymentMethod: paymentMethod as PaymentMethod,
        collectorName: collectorName.trim() || 'Office Counter / Admin',
        reference: transactionRef.trim() || undefined,
        sendWhatsAppReceipt: sendWhatsApp,
      });

      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to record payment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 text-xs font-sans">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-950 border border-emerald-700/60 rounded-xl text-emerald-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">Record Fee Payment</h3>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  {invoice.invoiceNumber}
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5">
                Mark fee as cleared, update subscriber balance to zero, and record timestamp.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Subscriber & Invoice Summary Card */}
        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 font-mono">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Subscriber &amp; Account</span>
              <span className="text-white font-bold text-sm font-sans block">{invoice.customerName}</span>
              <span className="text-cyan-400 text-[11px] block">
                PPPoE: @{customer?.pppoeUsername || invoice.customerId}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 uppercase block">Total Due Balance</span>
              <span className="text-emerald-400 font-bold text-base block">
                {formatCurrency(invoice.totalAmount)}
              </span>
              <span className="text-[10px] text-slate-400 block font-sans">
                Month: {invoice.billingMonth}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-sans">
            <div>
              <span>Package: </span>
              <strong className="text-slate-200">{invoice.packageName}</strong>
            </div>
            <div className="text-right">
              <span>Invoice Due Date: </span>
              <strong className="text-amber-400">{invoice.dueDate}</strong>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Payment Received Date & Time */}
            <div>
              <label className="block text-slate-400 text-[11px] mb-1 font-mono flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                <span>Payment Received Date &amp; Time *</span>
              </label>
              <input
                type="datetime-local"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            {/* Amount Received */}
            <div>
              <label className="block text-slate-400 text-[11px] mb-1 font-mono flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                <span>Amount Received ({currencySymbol}) *</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={amountReceived}
                onChange={(e) => setAmountReceived(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Payment Method */}
            <div>
              <label className="block text-slate-400 text-[11px] mb-1 font-mono">
                Payment Method / Channel *
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="agent_cash">Cash Handover to Field Agent</option>
                <option value="easypaisa">EasyPaisa Mobile Account</option>
                <option value="jazzcash">JazzCash Mobile Wallet</option>
                <option value="bank_transfer">Direct Bank Transfer / IBFT</option>
                <option value="online_gateway">Online Self-Service Gateway</option>
              </select>
            </div>

            {/* Collector / Agent Name */}
            <div>
              <label className="block text-slate-400 text-[11px] mb-1 font-mono flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Collector / Officer Name *</span>
              </label>
              <input
                type="text"
                required
                value={collectorName}
                onChange={(e) => setCollectorName(e.target.value)}
                placeholder="e.g. Bilal Khan / Counter Cashier"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-sans"
              />
            </div>
          </div>

          {/* Quick Collector Preset Pills */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
            <span className="text-slate-500">Quick Fill:</span>
            {agents.slice(0, 3).map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => {
                  setCollectorName(a.name);
                  setPaymentMethod('agent_cash');
                }}
                className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
              >
                {a.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCollectorName('Office Counter Cashier');
                setPaymentMethod('agent_cash');
              }}
              className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-slate-800 transition cursor-pointer"
            >
              Office Counter
            </button>
          </div>

          {/* Transaction / Reference ID */}
          <div>
            <label className="block text-slate-400 text-[11px] mb-1 font-mono">
              Transaction Voucher / Bank Reference (Optional)
            </label>
            <input
              type="text"
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              placeholder="e.g. EP-90481283 or Bank Slip #401"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* WhatsApp Receipt Toggle */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-white block">WhatsApp Digital Receipt</span>
                <span className="text-[10px] text-slate-400">
                  Send instant payment confirmation to {invoice.customerPhone}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="w-4 h-4 accent-emerald-500 cursor-pointer rounded"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Recording Payment...' : 'Confirm Payment & Mark Paid'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RecordPaymentModal;
