import React, { useState } from 'react';
import {
  Printer,
  CheckCircle2,
  X,
  Share2,
  ShieldCheck,
  QrCode,
  Layers,
  Wifi,
  Wrench,
  Cable,
  Box,
  Check,
  Copy,
} from 'lucide-react';
import { Invoice } from '../types/isp';
import { useCurrency } from '../context/CurrencyContext';

interface ReceiptModalProps {
  invoice: Invoice | null;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ invoice, onClose }) => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const [copied, setCopied] = useState(false);

  if (!invoice) return null;

  // Separate recurring vs one-time hardware / installation line items
  const recurringItems = (invoice.lineItems || []).filter(
    (item) => item.category === 'monthly_subscription'
  );
  const hardwareAndOnetimeItems = (invoice.lineItems || []).filter(
    (item) => item.category !== 'monthly_subscription'
  );

  // If no explicit line items were saved, treat package base as recurring item
  const hasLineItems = Boolean(invoice.lineItems && invoice.lineItems.length > 0);

  // WhatsApp shareable text
  const shareText = `*YOUTH NET SERVICE - OFFICIAL DIGITAL RECEIPT*
Receipt #: ${invoice.receiptNumber || `RCPT-${invoice.invoiceNumber}`}
Invoice Ref: ${invoice.invoiceNumber}
Customer: ${invoice.customerName}
Billing Cycle: ${invoice.billingMonth}
Package: ${invoice.packageName}

*BREAKDOWN:*
${
  hasLineItems
    ? invoice.lineItems
        ?.map(
          (li) =>
            `- ${li.description}: ${li.quantity} x ${formatCurrency(li.unitPrice)} = ${formatCurrency(li.totalPrice)}`
        )
        .join('\n')
    : `- Monthly Subscription: ${formatCurrency(invoice.baseAmount)}`
}
${invoice.taxAmount > 0 ? `Tax (GST 16%): ${formatCurrency(invoice.taxAmount)}\n` : ''}${
    invoice.discountAmount > 0 ? `Discount: -${formatCurrency(invoice.discountAmount)}\n` : ''
}*TOTAL PAID: ${formatCurrency(invoice.totalAmount)}*
Status: ${invoice.status.toUpperCase()}
Collector: ${invoice.agentName || 'Bilal Khan (Field Staff)'}
Verification: ROS-7-${invoice.id.slice(-6)}

_Thank you for choosing Youth Net Fiber Network!_`;

  const handleShareWhatsApp = () => {
    const encoded = encodeURIComponent(shareText);
    const cleanPhone = invoice.customerPhone.replace(/[^0-9]/g, '');
    const url = `https://wa.me/${cleanPhone}?text=${encoded}`;
    window.open(url, '_blank');
  };

  const handleCopyText = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl my-6">
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
              Official Digital Cash Receipt &amp; Breakdown
            </span>
          </div>
          <h3 className="text-xl font-black text-white uppercase tracking-wider">
            Youth Net Service
          </h3>
          <p className="text-xs text-slate-400">Carrier-Grade Ultra Fast Fiber Network &bull; Markaz Islamabad</p>
        </div>

        {/* Receipt Details Body */}
        <div className="p-4 sm:p-5 space-y-4 text-xs font-mono">
          {/* Top Receipt Badges */}
          <div className="flex justify-between items-center bg-slate-950 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-400 text-[10px] block">Receipt Number</span>
              <span className="text-cyan-300 font-bold text-sm">
                {invoice.receiptNumber || `RCPT-${invoice.invoiceNumber}`}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 text-[10px] block">Invoice Reference</span>
              <span className="text-slate-200">{invoice.invoiceNumber}</span>
            </div>
          </div>

          {/* Customer & Period Metadata */}
          <div className="space-y-1.5 text-slate-300 bg-slate-950/40 p-3 rounded-xl border border-slate-800/80">
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
              <span className="text-cyan-300 font-bold">{invoice.billingMonth}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Package Subscribed:</span>
              <span className="text-cyan-400">{invoice.packageName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Date:</span>
              <span>
                {invoice.paidAt
                  ? new Date(invoice.paidAt).toLocaleString()
                  : new Date().toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Field Recovery Agent:</span>
              <span className="text-emerald-400 font-semibold">
                {invoice.agentName || 'Bilal Khan (Field Staff)'}
              </span>
            </div>
          </div>

          {/* ITEMIZED CHARGES BREAKDOWN TABLE */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between text-slate-400 text-[10px] font-sans uppercase font-bold border-b border-slate-800 pb-1.5">
              <span>Item Description</span>
              <div className="flex items-center gap-4 text-right">
                <span className="w-12">Qty / Rate</span>
                <span className="w-16">Total</span>
              </div>
            </div>

            {hasLineItems ? (
              <div className="space-y-2">
                {/* Recurring Internet Subscriptions Section */}
                {recurringItems.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider mb-1 flex items-center gap-1 font-sans">
                      <Wifi className="w-3 h-3" /> Recurring Monthly Subscription
                    </div>
                    {recurringItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center text-slate-300 py-1 border-b border-slate-900"
                      >
                        <div className="pr-2">
                          <span className="text-slate-200 block">{item.description}</span>
                          <span className="text-[10px] text-slate-500 font-sans">
                            Internet Bandwidth Cycle
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-right shrink-0">
                          <span className="w-12 text-[10px] text-slate-400">
                            {item.quantity} &times; {formatCurrency(item.unitPrice)}
                          </span>
                          <span className="w-16 font-bold text-slate-100">
                            {formatCurrency(item.totalPrice)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* One-Time Hardware & Installation Charges */}
                {hardwareAndOnetimeItems.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1 font-sans">
                      <Layers className="w-3 h-3" /> One-Time Hardware &amp; Installation Charges
                    </div>
                    {hardwareAndOnetimeItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex justify-between items-center text-slate-300 py-1 border-b border-slate-900"
                      >
                        <div className="pr-2">
                          <span className="text-slate-200 block">{item.description}</span>
                          {item.serialNumber && (
                            <span className="text-[10px] text-cyan-400 font-mono block">
                              S/N: {item.serialNumber}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-right shrink-0">
                          <span className="w-12 text-[10px] text-slate-400">
                            {item.quantity} &times; {formatCurrency(item.unitPrice)}
                          </span>
                          <span className="w-16 font-bold text-slate-100">
                            {formatCurrency(item.totalPrice)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Default fallback row
              <div className="flex justify-between items-center text-slate-300 py-1">
                <div>
                  <span className="text-slate-200 block">{invoice.packageName}</span>
                  <span className="text-[10px] text-slate-500 font-sans">
                    Monthly Recurring Subscription
                  </span>
                </div>
                <div className="flex items-center gap-4 text-right">
                  <span className="w-12 text-[10px] text-slate-400">1 &times; Base</span>
                  <span className="w-16 font-bold text-slate-100">
                    {formatCurrency(invoice.baseAmount)}
                  </span>
                </div>
              </div>
            )}

            {/* Calculations Sub-strip */}
            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal (Base Items):</span>
                <span>{formatCurrency(invoice.baseAmount)}</span>
              </div>
              {invoice.taxAmount > 0 && (
                <div className="flex justify-between text-slate-400">
                  <span>Telecom Sales Tax (16% GST):</span>
                  <span>+{formatCurrency(invoice.taxAmount)}</span>
                </div>
              )}
              {invoice.discountAmount > 0 && (
                <div className="flex justify-between text-amber-400">
                  <span>Promotional Discount:</span>
                  <span>-{formatCurrency(invoice.discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-white font-bold text-sm pt-1.5 border-t border-slate-800">
                <span className="text-slate-200">
                  {invoice.status === 'paid' ? 'Total Paid (Cash):' : 'Total Outstanding:'}
                </span>
                <span
                  className={
                    invoice.status === 'paid'
                      ? 'text-emerald-400 font-black'
                      : invoice.status === 'overdue'
                      ? 'text-rose-400 font-black'
                      : 'text-amber-400 font-black'
                  }
                >
                  {formatCurrency(invoice.totalAmount)}
                </span>
              </div>
            </div>
          </div>

          {/* Verification Badge */}
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 font-sans">
            <span className="flex items-center gap-1 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> MikroTik RouterOS Verified Active
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Auth Token: ROS-7-{invoice.id.slice(-6)}
            </span>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="bg-slate-950 p-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleShareWhatsApp}
              className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 text-xs px-3 py-1.5 rounded-lg transition font-medium font-sans"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share WhatsApp</span>
            </button>

            <button
              onClick={handleCopyText}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg transition font-sans"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Text</span>
                </>
              )}
            </button>
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition shadow-md font-sans"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Official Receipt</span>
          </button>
        </div>
      </div>
    </div>
  );
};
