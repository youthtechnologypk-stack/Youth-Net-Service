import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
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
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import { getStoredUser } from '../lib/auth';
import { filterFieldAgentsForUser, isResellerUser } from '../lib/resellerEngine';

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
  const { customers } = useISP();
  const [scopedAgents, setScopedAgents] = useState<SupabasePortalUser[]>([]);

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

  // Fetch strictly scoped field agents for the active Master ISP / Dealer / Sub-Dealer
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const activeUser = getStoredUser();

    supabase
      .from('portal_users')
      .select('*')
      .order('full_name', { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        const allRows = Array.isArray(data) ? (data as SupabasePortalUser[]) : [];
        const filtered = filterFieldAgentsForUser(allRows, activeUser, {
          allPortalUsers: allRows,
        });
        setScopedAgents(filtered);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Sync state whenever selected invoice opens
  useEffect(() => {
    if (invoice) {
      const activeUser = getStoredUser();
      const resellerSession = isResellerUser(activeUser);
      setAmountReceived(invoice.totalAmount);
      setPaymentDate(getInitialDateTime());
      setTransactionRef(`TXN-${Date.now().toString().slice(-6)}`);
      setErrorMessage(null);
      // Pre-fill agent name if assigned, else first scoped agent, else own counter
      if (invoice.agentName) {
        setCollectorName(invoice.agentName);
      } else if (scopedAgents.length > 0) {
        setCollectorName(scopedAgents[0].full_name || scopedAgents[0].username);
      } else if (resellerSession && activeUser) {
        setCollectorName(activeUser.fullName || `@${activeUser.username} (Counter)`);
      } else {
        setCollectorName('Office Counter / Admin');
      }
    }
  }, [invoice, scopedAgents]);

  if (!isOpen || !invoice || typeof document === 'undefined') return null;

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
        style={{ width: '100%', maxWidth: '390px', maxHeight: '88dvh' }}
        className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 box-border mx-auto bg-slate-900 border border-slate-800 shadow-2xl space-y-4 text-base font-sans"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800 w-full min-w-0">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-2 bg-emerald-950 border border-emerald-700/60 rounded-xl text-emerald-400 shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <h3 className="text-base font-bold text-white truncate">Record Payment &amp; Arrears</h3>
                <span className="px-2 py-0.5 rounded font-mono text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800 shrink-0">
                  {invoice.invoiceNumber}
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5 leading-snug">
                Clear invoice balance and update subscriber ledger.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition shrink-0 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs flex items-center gap-2 w-full min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span className="min-w-0 break-words">{errorMessage}</span>
          </div>
        )}

        {/* Subscriber & Invoice Summary Card */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2 font-mono w-full min-w-0">
          <div className="flex items-start justify-between gap-2 w-full min-w-0">
            <div className="min-w-0 flex-1">
              <span className="text-[10px] text-slate-500 uppercase block">Subscriber</span>
              <span className="text-white font-bold text-sm font-sans block truncate">
                {invoice.customerName}
              </span>
              <span className="text-cyan-400 text-xs block truncate">
                @{customer?.pppoeUsername || invoice.customerId}
              </span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-slate-500 uppercase block">Total Due</span>
              <span className="text-emerald-400 font-bold text-base block">
                {formatCurrency(invoice.totalAmount)}
              </span>
              <span className="text-[10px] text-slate-400 block font-sans">
                {invoice.billingMonth}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400 font-sans w-full min-w-0">
            <div className="min-w-0 truncate">
              <span>Package: </span>
              <strong className="text-slate-200">{invoice.packageName}</strong>
            </div>
            <div className="shrink-0">
              <span>Due: </span>
              <strong className="text-amber-400">{invoice.dueDate}</strong>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5 w-full min-w-0">
          <div className="grid grid-cols-1 gap-3 w-full min-w-0">
            {/* Payment Received Date & Time */}
            <div className="w-full min-w-0">
              <label className="block text-slate-400 text-xs mb-1 font-mono flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Payment Date &amp; Time *</span>
              </label>
              <input
                type="datetime-local"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-base focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            {/* Amount Received */}
            <div className="w-full min-w-0">
              <label className="block text-slate-400 text-xs mb-1 font-mono flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Amount Received ({currencySymbol}) *</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={amountReceived}
                onChange={(e) => setAmountReceived(Number(e.target.value))}
                className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-base focus:outline-none focus:border-cyan-500 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 w-full min-w-0">
            {/* Payment Method */}
            <div className="w-full min-w-0">
              <label className="block text-slate-400 text-xs mb-1 font-mono">
                Payment Method / Channel *
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-base focus:outline-none focus:border-cyan-500"
              >
                <option value="agent_cash">Cash Handover to Field Agent</option>
                <option value="easypaisa">EasyPaisa Mobile Account</option>
                <option value="jazzcash">JazzCash Mobile Wallet</option>
                <option value="bank_transfer">Direct Bank Transfer / IBFT</option>
                <option value="online_gateway">Online Self-Service Gateway</option>
              </select>
            </div>

            {/* Collector / Agent Name */}
            <div className="w-full min-w-0">
              <label className="block text-slate-400 text-xs mb-1 font-mono flex items-center gap-1">
                <User className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span>Collector / Officer Name *</span>
              </label>
              <input
                type="text"
                required
                value={collectorName}
                onChange={(e) => setCollectorName(e.target.value)}
                placeholder="e.g. Field Recovery Agent"
                className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-base focus:outline-none focus:border-cyan-500 font-sans"
              />
            </div>
          </div>

          {/* Quick Collector Preset Pills */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs w-full min-w-0">
            <span className="text-slate-500">Quick Fill:</span>
            {scopedAgents.slice(0, 3).map((a) => (
              <button
                type="button"
                key={a.id}
                onClick={() => {
                  setCollectorName(a.full_name || a.username);
                  setPaymentMethod('agent_cash');
                }}
                className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition cursor-pointer"
              >
                {a.full_name || a.username}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setCollectorName('Office Counter Cashier');
                setPaymentMethod('agent_cash');
              }}
              className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-slate-800 transition cursor-pointer"
            >
              Office Counter
            </button>
          </div>

          {/* Transaction / Reference ID */}
          <div className="w-full min-w-0">
            <label className="block text-slate-400 text-xs mb-1 font-mono">
              Transaction Reference (Optional)
            </label>
            <input
              type="text"
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              placeholder="e.g. EP-90481283"
              className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-base focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* WhatsApp Receipt Toggle */}
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-2 w-full min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <span className="font-bold text-white text-xs block truncate">
                  WhatsApp Receipt Dispatch
                </span>
                <span className="text-[11px] text-slate-400 block truncate">
                  To {invoice.customerPhone || 'Subscriber Phone'}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="w-5 h-5 accent-emerald-500 cursor-pointer rounded shrink-0"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex flex-col gap-2 pt-3 border-t border-slate-800 w-full min-w-0">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-w-0 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-950/50"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{isSubmitting ? 'Saving Payment...' : 'Confirm & Save Payment'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="w-full min-w-0 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-base transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default RecordPaymentModal;
