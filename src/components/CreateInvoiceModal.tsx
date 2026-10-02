import React, { useState, useEffect } from 'react';
import { X, PlusCircle, DollarSign, Calendar, Send, ShieldCheck, User } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { InvoiceStatus } from '../types/isp';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { customers, packages, createInvoice } = useISP();

  const now = new Date();
  const currentMonthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const defaultDueDate = new Date(now.getFullYear(), now.getMonth(), 10).toISOString().split('T')[0];

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(customers[0]?.id || '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [packageId, setPackageId] = useState(packages[1]?.id || packages[0]?.id || '');
  const [packageName, setPackageName] = useState('');
  const [billingMonth, setBillingMonth] = useState(currentMonthName);
  const [baseAmount, setBaseAmount] = useState<number>(45);
  const [taxAmount, setTaxAmount] = useState<number>(7.2);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [totalAmount, setTotalAmount] = useState<number>(52.2);
  const [status, setStatus] = useState<InvoiceStatus>('unpaid');
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // When selected customer changes, auto-populate details
  useEffect(() => {
    const cust = customers.find((c) => c.id === selectedCustomerId) || customers[0];
    if (cust) {
      setCustomerName(cust.name);
      setCustomerPhone(cust.phone);
      const pkg = packages.find((p) => p.id === cust.packageId) || packages[0];
      if (pkg) {
        setPackageId(pkg.id);
        setPackageName(pkg.name);
        setBaseAmount(pkg.priceMonthly);
        const tax = Math.round(pkg.priceMonthly * 0.16 * 10) / 10;
        setTaxAmount(tax);
        setTotalAmount(pkg.priceMonthly + tax);
      }
      const invNum = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${cust.accountNumber.slice(-4)}`;
      setInvoiceNumber(invNum);
    }
  }, [selectedCustomerId, customers, packages]);

  if (!isOpen) return null;

  const handlePackageChange = (pkgId: string) => {
    setPackageId(pkgId);
    const pkg = packages.find((p) => p.id === pkgId);
    if (pkg) {
      setPackageName(pkg.name);
      setBaseAmount(pkg.priceMonthly);
      const tax = Math.round(pkg.priceMonthly * 0.16 * 10) / 10;
      setTaxAmount(tax);
      setTotalAmount(Math.max(0, pkg.priceMonthly + tax - discountAmount));
    }
  };

  const handleBaseChange = (val: number) => {
    setBaseAmount(val);
    const tax = Math.round(val * 0.16 * 10) / 10;
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !invoiceNumber) return;

    createInvoice({
      invoiceNumber,
      customerId: selectedCustomerId,
      customerName,
      customerPhone,
      packageId,
      packageName,
      billingMonth,
      baseAmount,
      taxAmount,
      discountAmount,
      totalAmount,
      status,
      dueDate,
      issuedAt: new Date().toISOString(),
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      whatsappNoticeSent: sendWhatsApp,
      whatsappNoticeTimestamp: sendWhatsApp ? new Date().toISOString() : undefined,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded-lg">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Create New Invoice</h3>
              <p className="text-xs text-slate-400 font-mono">Youth Net Service Billing Engine</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Invoice Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          {/* Subscriber Selector */}
          <div>
            <label className="block text-slate-400 mb-1">Select Subscriber Account</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.accountNumber} &bull; {c.areaNode})
                </option>
              ))}
            </select>
          </div>

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
              <label className="block text-slate-400 mb-1">Billing Month</label>
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
              <label className="block text-slate-400 mb-1">Subscriber Full Name</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">WhatsApp / Contact Phone</label>
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
              <label className="block text-slate-400 mb-1">Service / Package Plan</label>
              <select
                value={packageId}
                onChange={(e) => handlePackageChange(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} (${pkg.priceMonthly}/mo)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 capitalize"
              >
                <option value="unpaid">Unpaid (Add to Balance)</option>
                <option value="paid">Paid (Mark Received)</option>
                <option value="overdue">Overdue (Immediate Notice)</option>
              </select>
            </div>
          </div>

          {/* Financial Calculation Box */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 block">Amount Calculation</span>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Base Rate ($)</label>
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
              <span className="text-slate-400 font-mono">Net Payable Amount:</span>
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

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={sendWhatsApp}
                  onChange={(e) => setSendWhatsApp(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
                />
                <span className="flex items-center gap-1.5 text-xs">
                  <Send className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Send WhatsApp Statement</span>
                </span>
              </label>
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
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition shadow-sm flex items-center gap-1.5"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Generate & Save Invoice</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
