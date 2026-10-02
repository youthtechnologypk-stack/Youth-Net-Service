import React, { useState, useEffect } from 'react';
import { X, Edit3, DollarSign, Calendar, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Invoice, InvoiceStatus } from '../types/isp';
import { useISP } from '../context/ISPContext';

interface EditInvoiceModalProps {
  invoice: Invoice | null;
  isOpen: boolean;
  onClose: () => void;
}

export const EditInvoiceModal: React.FC<EditInvoiceModalProps> = ({
  invoice,
  isOpen,
  onClose,
}) => {
  const { updateInvoice, packages } = useISP();

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [packageName, setPackageName] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [baseAmount, setBaseAmount] = useState<number>(0);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [status, setStatus] = useState<InvoiceStatus>('unpaid');
  const [dueDate, setDueDate] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');

  useEffect(() => {
    if (invoice) {
      setInvoiceNumber(invoice.invoiceNumber);
      setCustomerName(invoice.customerName);
      setCustomerPhone(invoice.customerPhone);
      setPackageName(invoice.packageName);
      setBillingMonth(invoice.billingMonth);
      setBaseAmount(invoice.baseAmount);
      setTaxAmount(invoice.taxAmount);
      setDiscountAmount(invoice.discountAmount || 0);
      setTotalAmount(invoice.totalAmount);
      setStatus(invoice.status);
      setDueDate(invoice.dueDate);
      setReceiptNumber(invoice.receiptNumber || '');
    }
  }, [invoice]);

  if (!isOpen || !invoice) return null;

  // Auto calculate total when base, tax, discount changes
  const handleBaseChange = (val: number) => {
    setBaseAmount(val);
    const tax = Math.round(val * 0.16);
    setTaxAmount(tax);
    setTotalAmount(Math.max(0, val + tax - discountAmount));
  };

  const handleTaxChange = (val: number) => {
    setTaxAmount(val);
    setTotalAmount(Math.max(0, baseAmount + val - discountAmount));
  };

  const handleDiscountChange = (val: number) => {
    setDiscountAmount(val);
    setTotalAmount(Math.max(0, baseAmount + taxAmount - val));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateInvoice(invoice.id, {
      invoiceNumber,
      customerName,
      customerPhone,
      packageName,
      billingMonth,
      baseAmount,
      taxAmount,
      discountAmount,
      totalAmount,
      status,
      dueDate,
      receiptNumber: receiptNumber || undefined,
      paidAt: status === 'paid' && !invoice.paidAt ? new Date().toISOString() : invoice.paidAt,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-950 border border-indigo-800 text-indigo-400 rounded-lg">
              <Edit3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Edit Billing Invoice</h3>
              <p className="text-xs text-slate-400 font-mono">Invoice Ref: {invoice.invoiceNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSave} className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-mono">Invoice Number</label>
              <input
                type="text"
                required
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Billing Month / Period</label>
              <input
                type="text"
                required
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Subscriber Name</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Phone Number</label>
              <input
                type="text"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Package Plan</label>
              <select
                value={packageName}
                onChange={(e) => {
                  setPackageName(e.target.value);
                  const pkg = packages.find((p) => p.name === e.target.value);
                  if (pkg) {
                    handleBaseChange(pkg.priceMonthly);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                {packages.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name} (${p.priceMonthly}/mo)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Payment Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 capitalize"
              >
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 block">Financial Adjustment</span>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Base Fee ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={baseAmount}
                  onChange={(e) => handleBaseChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-1.5 rounded font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Tax 16% ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => handleTaxChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-1.5 rounded font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Discount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={discountAmount}
                  onChange={(e) => handleDiscountChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-1.5 rounded font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-800 text-xs">
              <span className="text-slate-400 font-mono">Adjusted Total Due:</span>
              <span className="text-emerald-400 font-bold font-mono text-sm">
                ${totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Due Date</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Receipt Reference (Optional)</label>
              <input
                type="text"
                placeholder="e.g. RCPT-2026-904"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
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
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-sm"
            >
              Save Invoice Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
