import React, { useState, useEffect, useMemo } from 'react';
import { X, Edit3, RefreshCw, Wifi, CheckCircle2 } from 'lucide-react';
import { Invoice, InvoiceStatus } from '../types/isp';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { supabase } from '../services/supabaseClient';
import {
  fetchLiveMikrotikProfilesAndSecrets,
  safeUpdateInvoiceInSupabase,
  syncSubscriberPackageAndRestoreIfPaid,
} from '../lib/billingAndNetwork';
import {
  buildLiveMikrotikPlanOptions,
  resolvePreselectedInvoiceProfile,
} from '../lib/mikrotikProfileSync';

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
  const { updateInvoice, packages, profilePriceMap, routers, selectedRouterId, customers } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const activeRouter = useMemo(
    () => routers.find((r) => r.id === selectedRouterId) || routers[0],
    [routers, selectedRouterId]
  );

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

  // Live MikroTik RouterOS state
  const [liveMikrotikProfiles, setLiveMikrotikProfiles] = useState<
    Array<{ name: string; rateLimit?: string }>
  >([]);
  const [liveMikrotikSecrets, setLiveMikrotikSecrets] = useState<Array<Record<string, any>>>([]);
  const [portalClients, setPortalClients] = useState<Array<Record<string, any>>>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
  const [detectedMkProfile, setDetectedMkProfile] = useState<string | null>(null);
  const [resolvedUsername, setResolvedUsername] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !invoice) return;

    setInvoiceNumber(invoice.invoiceNumber);
    setCustomerName(invoice.customerName);
    setCustomerPhone(invoice.customerPhone);
    setPackageName(invoice.packageName || '');
    setBillingMonth(invoice.billingMonth);
    setBaseAmount(invoice.baseAmount);
    setTaxAmount(invoice.taxAmount);
    setDiscountAmount(invoice.discountAmount || 0);
    setTotalAmount(invoice.totalAmount);
    setStatus(invoice.status);
    setDueDate(invoice.dueDate);
    setReceiptNumber(invoice.receiptNumber || '');

    const custMatch = customers.find(
      (c) =>
        c.id === invoice.customerId ||
        (c.pppoeUsername &&
          c.pppoeUsername.toLowerCase() === (invoice.customerName || '').trim().toLowerCase()) ||
        (c.name && c.name.toLowerCase() === (invoice.customerName || '').trim().toLowerCase())
    );
    const initialUsername = custMatch?.pppoeUsername || invoice.customerName || '';
    setResolvedUsername(initialUsername);

    let cancelled = false;
    setIsLoadingProfiles(true);

    Promise.all([
      fetchLiveMikrotikProfilesAndSecrets(activeRouter),
      supabase
        .from('portal_users')
        .select(
          'id, username, full_name, phone, original_package_profile, package_name, package_profile_name, package_speed, monthly_fee'
        )
        .eq('role', 'CLIENT'),
    ])
      .then(([mk, usersRes]) => {
        if (cancelled) return;
        const clients = Array.isArray(usersRes?.data) ? (usersRes.data as Array<Record<string, any>>) : [];
        setPortalClients(clients);
        if (mk.profiles.length > 0) setLiveMikrotikProfiles(mk.profiles);
        if (mk.secrets.length > 0) setLiveMikrotikSecrets(mk.secrets);

        const cleanName = (invoice.customerName || '').trim().toLowerCase();
        const clientMatch =
          clients.find(
            (c) =>
              String(c.username || '').trim().toLowerCase() === initialUsername.trim().toLowerCase() ||
              c.id === invoice.customerId ||
              String(c.full_name || '').trim().toLowerCase() === cleanName ||
              (invoice.customerPhone && c.phone === invoice.customerPhone)
          ) || null;

        const effectiveUser = String(clientMatch?.username || initialUsername).trim();
        setResolvedUsername(effectiveUser);

        const preselected = resolvePreselectedInvoiceProfile({
          username: effectiveUser,
          invoicePackage: invoice.packageName,
          secrets: mk.secrets,
          subscriber: clientMatch,
          mikrotikProfiles: mk.profiles,
        });

        if (preselected.selectedProfile) {
          setPackageName(preselected.selectedProfile);
        }
        setDetectedMkProfile(
          preselected.origPkgFromComment || preselected.liveSecretProfile || null
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingProfiles(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, invoice, activeRouter, customers]);

  const planOptions = useMemo(() => {
    return buildLiveMikrotikPlanOptions({
      mikrotikProfiles: liveMikrotikProfiles,
      secrets: liveMikrotikSecrets,
      portalClients,
      assignedProfileName: packageName || invoice?.packageName || null,
      profilePriceMap,
      packages,
    });
  }, [
    liveMikrotikProfiles,
    liveMikrotikSecrets,
    portalClients,
    packageName,
    invoice?.packageName,
    profilePriceMap,
    packages,
  ]);

  if (!isOpen || !invoice) return null;

  // Auto calculate total when base, tax, discount changes
  const handleBaseChange = (val: number, recalculateTax = false) => {
    setBaseAmount(val);
    const nextTax = recalculateTax ? Math.round(val * 0.16) : taxAmount;
    if (recalculateTax) setTaxAmount(nextTax);
    setTotalAmount(Math.max(0, val + nextTax - discountAmount));
  };

  const handleTaxChange = (val: number) => {
    setTaxAmount(val);
    setTotalAmount(Math.max(0, baseAmount + val - discountAmount));
  };

  const handleDiscountChange = (val: number) => {
    setDiscountAmount(val);
    setTotalAmount(Math.max(0, baseAmount + taxAmount - val));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const cleanProfile = (packageName || '').trim();
      const paidTimestamp =
        status === 'paid' && !invoice.paidAt ? new Date().toISOString() : invoice.paidAt;

      updateInvoice(invoice.id, {
        invoiceNumber,
        customerName,
        customerPhone,
        packageId: cleanProfile || invoice.packageId,
        packageName: cleanProfile || invoice.packageName,
        billingMonth,
        baseAmount,
        taxAmount,
        discountAmount,
        totalAmount,
        status,
        dueDate,
        receiptNumber: receiptNumber || undefined,
        paidAt: paidTimestamp,
      });

      await safeUpdateInvoiceInSupabase(
        { id: invoice.id, invoiceNo: invoiceNumber || invoice.invoiceNumber },
        {
          amount: totalAmount,
          due_date: dueDate,
          status: status === 'paid' ? 'PAID' : status === 'overdue' ? 'OVERDUE' : 'DUE',
          ...(cleanProfile ? { package_profile: cleanProfile, package_name: cleanProfile } : {}),
          ...(status === 'paid'
            ? {
                paid_at: paidTimestamp || new Date().toISOString(),
                paid_amount: totalAmount,
              }
            : {}),
        }
      ).catch(() => {});

      const targetUser = (resolvedUsername || customerName || '').trim();
      if (cleanProfile && targetUser) {
        await syncSubscriberPackageAndRestoreIfPaid({
          username: targetUser,
          selectedProfile: cleanProfile,
          isPaid: status === 'paid',
          invoiceNo: invoiceNumber || invoice.invoiceNumber,
          triggeredBy: 'ADMIN',
          activeRouter,
          preloadedSecrets: liveMikrotikSecrets,
        });
      }

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in">
      <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
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
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
          >
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
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-400 flex items-center gap-1">
                  <Wifi className="w-3 h-3 text-cyan-400" />
                  <span>Package Plan</span>
                </label>
                <span className="text-[10px] font-mono text-cyan-400">
                  {isLoadingProfiles ? 'Syncing MikroTik...' : `${planOptions.length} RouterOS`}
                </span>
              </div>
              <select
                value={packageName}
                onChange={(e) => {
                  const nextProf = e.target.value;
                  setPackageName(nextProf);
                  const opt = planOptions.find((o) => o.profileName === nextProf);
                  if (opt && opt.pricePkr > 0) {
                    handleBaseChange(opt.pricePkr, taxAmount > 0);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-200 font-mono p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                {planOptions.length === 0 ? (
                  <option value={packageName || ''}>
                    {isLoadingProfiles
                      ? 'Loading live MikroTik profiles...'
                      : packageName || 'No MikroTik profiles detected'}
                  </option>
                ) : (
                  planOptions.map((opt) => (
                    <option key={opt.profileName} value={opt.profileName}>
                      {opt.profileName} ({formatCurrency(opt.pricePkr, 0)}/mo)
                      {opt.rateLimit ? ` • ${opt.rateLimit}` : ''}
                    </option>
                  ))
                )}
              </select>
              {detectedMkProfile && (
                <p className="text-[10px] text-emerald-400 font-mono mt-1 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  MikroTik Secret: {detectedMkProfile}
                </p>
              )}
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
              {status === 'paid' && packageName && (
                <p className="text-[10px] text-emerald-400 font-mono mt-1">
                  On Save: sets MikroTik secret to "{packageName}" &amp; kicks 16.x session
                </p>
              )}
            </div>
          </div>

          {/* Financial Breakdown */}
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 block">Financial Adjustment</span>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Base Fee ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  value={baseAmount}
                  onChange={(e) => handleBaseChange(parseFloat(e.target.value) || 0, taxAmount > 0)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-1.5 rounded font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Tax ({currencySymbol})</label>
                <input
                  type="number"
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => handleTaxChange(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-1.5 rounded font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-[10px] mb-1 font-mono">Discount ({currencySymbol})</label>
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
                {formatCurrency(totalAmount)}
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
              disabled={isSaving}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSaving ? 'Syncing & Saving...' : 'Save Invoice Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
