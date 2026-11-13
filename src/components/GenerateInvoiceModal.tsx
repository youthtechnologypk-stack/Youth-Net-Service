import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  FileText,
  Search,
  CheckCircle2,
  Calendar,
  DollarSign,
  User,
  Phone,
  Wifi,
  Sparkles,
  ShieldCheck,
  Send,
  Plus,
  Trash2,
  Layers,
  ArrowRight,
  Clock,
  Check,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { Invoice, InvoiceStatus, InvoiceLineItem, InvoiceItemCategory } from '../types/isp';
import { useSubscribers, UnifiedSubscriber, appendStoredBillingLedger } from '../hooks/useSubscribers';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';

export interface GenerateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSubscriberUsername?: string;
  onSuccess?: (invoice: Invoice) => void;
}

export const GenerateInvoiceModal: React.FC<GenerateInvoiceModalProps> = ({
  isOpen,
  onClose,
  defaultSubscriberUsername,
  onSuccess,
}) => {
  const { setInvoices, packages, bandwidthProfiles, provisionedSecrets, activeSessions } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();
  const { unifiedSubscribers } = useSubscribers();

  // Search & subscriber picker state
  const [subscriberSearch, setSubscriberSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState<UnifiedSubscriber | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Form Fields
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [billingMonth, setBillingMonth] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [baseAmount, setBaseAmount] = useState<number>(2500);
  const [taxAmount, setTaxAmount] = useState<number>(0);
  const [taxPercent, setTaxPercent] = useState<number>(0);
  const [applyGst, setApplyGst] = useState(false);
  const [status, setStatus] = useState<InvoiceStatus>('unpaid');
  const [paymentMethod, setPaymentMethod] = useState<string>('agent_cash');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [packageName, setPackageName] = useState('Standard-Broadband');
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [notes, setNotes] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState<string>('');
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);

  // Fetch live agents directly from Supabase portal_users (single source of truth)
  useEffect(() => {
    const fetchPortalAgents = async () => {
      try {
        const { data } = await supabase
          .from('portal_users')
          .select('id, full_name, username, area, role')
          .eq('role', 'AGENT');

        if (data) {
          setPortalAgents(data as SupabasePortalUser[]);
        }
      } catch (err) {
        console.warn('Failed to query portal_users for agents:', err);
      }
    };

    fetchPortalAgents();

    // Listen for realtime changes on portal_users
    const ch = supabase
      .channel('public:gen_inv_agents')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchPortalAgents();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Toast notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Initialize date & auto-invoice # helpers
  const generateNewInvoiceNumber = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const rand4 = Math.floor(1000 + Math.random() * 9000);
    return `INV-${year}${month}-${rand4}`;
  };

  const getSevenDaysLater = () => {
    const d = new Date();
    d.setDate(d.getDate() + 31);
    return d.toISOString().split('T')[0];
  };

  const getCurrentMonthName = () => {
    return new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setInvoiceNumber(generateNewInvoiceNumber());
      setBillingMonth(getCurrentMonthName());
      setDueDate(getSevenDaysLater());
      setStatus('unpaid');
      setToastMessage(null);

      // Check if defaultSubscriberUsername matches
      if (defaultSubscriberUsername && unifiedSubscribers.length > 0) {
        const found = (unifiedSubscribers || []).find(
          (s) => (s?.username || '').toLowerCase() === (defaultSubscriberUsername || '').toLowerCase()
        );
        if (found) {
          selectSubscriber(found);
          return;
        }
      }

      // Default to first subscriber if available and none selected yet
      if (!selectedSub && unifiedSubscribers.length > 0) {
        selectSubscriber(unifiedSubscribers[0]);
      }
    }
  }, [isOpen, defaultSubscriberUsername, unifiedSubscribers.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered subscribers list
  const filteredSubscribers = useMemo(() => {
    if (!subscriberSearch.trim()) return (unifiedSubscribers || []).slice(0, 30);
    const q = subscriberSearch.toLowerCase().trim();
    return (unifiedSubscribers || [])
      .filter(
        (s) =>
          (s?.username || '').toLowerCase().includes(q) ||
          Boolean(s?.fullName && (s.fullName || '').toLowerCase().includes(q)) ||
          Boolean(s?.name && (s.name || '').toLowerCase().includes(q)) ||
          Boolean(s?.phone && s.phone.includes(q)) ||
          Boolean(s?.assignedIp && s.assignedIp.includes(q)) ||
          Boolean(s?.profile && (s.profile || '').toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [unifiedSubscribers, subscriberSearch]);

  // Handler when selecting a subscriber
  const selectSubscriber = (sub: UnifiedSubscriber) => {
    setSelectedSub(sub);
    setSubscriberSearch(sub.username);
    setIsDropdownOpen(false);

    // Auto-fill customer details
    const displayName = sub.fullName || sub.name || sub.username;
    setCustomerName(displayName);
    setCustomerPhone(sub.phone && sub.phone !== '+92 ' ? sub.phone : '+92 300 0000000');

    // Auto-fill profile
    const planProfile = sub.profile || 'Standard-Broadband';
    setPackageName(planProfile);

    // Auto-fill recommended price from package, profile, or subscriber
    let recommendedPrice = sub.priceMonthly;
    if (!recommendedPrice || recommendedPrice <= 0) {
      // Try to find matching package
      const matchedPkg = (packages || []).find(
        (p) =>
          (p?.name || '').toLowerCase() === (planProfile || '').toLowerCase() ||
          (planProfile || '').toLowerCase().includes((p?.name || '').toLowerCase())
      );
      if (matchedPkg) {
        recommendedPrice = matchedPkg.priceMonthly;
      } else {
        // Extract number from profile (e.g. "10M" -> 1500, "20M" -> 2500)
        const speedMatch = planProfile.match(/(\d+)\s*M/i);
        if (speedMatch) {
          const speed = parseInt(speedMatch[1], 10);
          recommendedPrice = speed >= 50 ? 4500 : speed >= 30 ? 3500 : speed >= 20 ? 2500 : 1800;
        } else {
          recommendedPrice = 2500;
        }
      }
    }

    setBaseAmount(recommendedPrice);

    // Auto tax calculation
    if (applyGst) {
      setTaxAmount(Math.round(recommendedPrice * 0.16));
    } else {
      setTaxAmount(0);
    }
  };

  // Recalculate tax when baseAmount or applyGst toggles
  useEffect(() => {
    if (applyGst) {
      setTaxAmount(Math.round(baseAmount * 0.16));
    }
  }, [baseAmount, applyGst]);

  const totalAmount = Math.max(0, baseAmount + taxAmount);

  // Form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedSub && !customerName) {
      alert('Please select a subscriber or enter subscriber details.');
      return;
    }

    const subUsername = selectedSub ? selectedSub.username : customerName.toLowerCase().replace(/\s+/g, '.');
    const finalCustName = customerName || subUsername;
    const finalCustPhone = customerPhone || '+92 300 0000000';
    const finalInvoiceNumber = invoiceNumber.trim() || generateNewInvoiceNumber();

    const newInvoice: Invoice = {
      id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      invoiceNumber: finalInvoiceNumber,
      customerId: selectedSub?.id || `cust-${subUsername}`,
      customerName: finalCustName,
      customerPhone: finalCustPhone,
      packageId: selectedSub?.packageId || selectedSub?.profile || 'pkg-broadband',
      packageName: packageName,
      billingMonth: billingMonth,
      baseAmount: Number(baseAmount),
      taxAmount: Number(taxAmount),
      discountAmount: 0,
      totalAmount: Number(totalAmount),
      status: status,
      dueDate: dueDate,
      issuedAt: new Date().toISOString(),
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      paymentMethod: status === 'paid' ? paymentMethod : undefined,
      receiptNumber: status === 'paid' ? `RCPT-${finalInvoiceNumber.replace('INV-', '')}` : undefined,
      whatsappNoticeSent: Boolean(sendWhatsApp),
      whatsappNoticeTimestamp: sendWhatsApp ? new Date().toISOString() : undefined,
      lineItems: [
        {
          id: `li-${Date.now()}-1`,
          category: 'monthly_subscription',
          description: `Broadband Monthly Subscription (${packageName})`,
          quantity: 1,
          unitPrice: Number(baseAmount),
          totalPrice: Number(baseAmount),
          unit: 'month',
        },
        ...(taxAmount > 0
          ? [
              {
                id: `li-${Date.now()}-2`,
                category: 'custom_hardware' as InvoiceItemCategory,
                description: 'Telecom GST / Regulatory Tax (16%)',
                quantity: 1,
                unitPrice: Number(taxAmount),
                totalPrice: Number(taxAmount),
                unit: 'tax',
              },
            ]
          : []),
      ],
    };

    // 1. Save directly into localStorage('youthnet_invoices')
    try {
      const rawInvoices = localStorage.getItem('youthnet_invoices');
      let invoicesArr: Invoice[] = [];
      if (rawInvoices) {
        try {
          invoicesArr = JSON.parse(rawInvoices);
        } catch {}
      }
      const updatedList = [newInvoice, ...invoicesArr.filter((i) => i.id !== newInvoice.id)];
      localStorage.setItem('youthnet_invoices', JSON.stringify(updatedList));
    } catch (err) {
      console.warn('Error persisting invoice to localStorage:', err);
    }

    // 2. Update React context state so Invoices table immediately renders it at the top
    setInvoices((prev) => [newInvoice, ...prev.filter((i) => i.id !== newInvoice.id)]);

    // 3. Persist directly to Supabase PostgreSQL invoices table
    const selectedAgent = portalAgents.find((a) => a.id === assignedAgentId);
    (async () => {
      try {
        const { error: sbErr } = await supabase
          .from('invoices')
          .insert([
            {
              invoice_no: finalInvoiceNumber,
              subscriber_username: subUsername,
              assigned_agent_id: assignedAgentId || null,
              assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
              amount: Number(totalAmount) || 0,
              due_date: dueDate,
              status: status === 'paid' ? 'PAID' : 'DUE',
              cycle_day: 31,
              paid_at: status === 'paid' ? new Date().toISOString() : null,
              created_at: new Date().toISOString(),
            },
          ]);
        if (sbErr) console.warn('Supabase invoice insert notice:', sbErr);
      } catch (err: any) {
        console.warn('Supabase invoice network notice:', err);
      }
    })();

    // 4. Record in double-entry ledger history
    appendStoredBillingLedger({
      id: `led-${Date.now()}`,
      date: new Date().toISOString(),
      subscriberUsername: subUsername,
      subscriberName: finalCustName,
      type: status === 'paid' ? 'payment_received' : 'invoice_issued',
      referenceNumber: finalInvoiceNumber,
      description: `Monthly subscription invoice for ${billingMonth} (${packageName})`,
      debit: status === 'unpaid' ? totalAmount : 0,
      credit: status === 'paid' ? totalAmount : 0,
      balanceAfter: totalAmount,
      paymentMethod: status === 'paid' ? paymentMethod : undefined,
      recordedBy: 'Admin / NOC Desk',
    });

    // 4. Trigger callback & show success
    if (onSuccess) {
      onSuccess(newInvoice);
    }

    setToastMessage(`Invoice ${finalInvoiceNumber} generated successfully for @${subUsername}!`);
    setTimeout(() => {
      onClose();
    }, 900);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl my-6">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 rounded-xl shadow-inner">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Generate Subscriber Invoice</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-700/40">
                  Live Router Synced
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-sans">
                Create monthly billing invoice linked directly to live MikroTik PPPoE subscribers
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success Banner */}
        {toastMessage && (
          <div className="bg-emerald-950 border-b border-emerald-800 p-3 text-emerald-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs font-sans">
          {/* STEP 1: SUBSCRIBER SELECTION (Searchable from live MikroTik secrets) */}
          <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-2 relative" ref={dropdownRef}>
            <div className="flex items-center justify-between">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Select Subscriber (MikroTik PPPoE) *</span>
              </label>
              <span className="text-[11px] text-slate-500 font-mono">
                {unifiedSubscribers.length} Live Subscribers Available
              </span>
            </div>

            {/* Custom Searchable Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Type username, full name, phone number or IP to search..."
                value={subscriberSearch}
                onFocus={() => setIsDropdownOpen(true)}
                onChange={(e) => {
                  setSubscriberSearch(e.target.value);
                  setIsDropdownOpen(true);
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 pl-9 pr-8 py-2 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500"
              />
              {subscriberSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setSubscriberSearch('');
                    setIsDropdownOpen(true);
                  }}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Dropdown Options */}
            {isDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-800">
                {filteredSubscribers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-xs font-mono">
                    No matching PPPoE subscribers found.
                  </div>
                ) : (
                  filteredSubscribers.map((sub) => {
                    const isSelected = selectedSub?.username === sub.username;
                    return (
                      <button
                        key={sub.id || sub.username}
                        type="button"
                        onClick={() => selectSubscriber(sub)}
                        className={`w-full p-2.5 text-left flex items-center justify-between hover:bg-slate-800 transition cursor-pointer ${
                          isSelected ? 'bg-cyan-950/60 border-l-2 border-cyan-400' : ''
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-cyan-300 font-mono text-xs truncate">
                              @{sub.username}
                            </span>
                            {sub.isOnline ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Online
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 text-[10px]">
                                Offline
                              </span>
                            )}
                          </div>
                          <div className="text-slate-300 text-[11px] font-sans truncate mt-0.5">
                            {sub.fullName || sub.name || 'Broadband Customer'}
                            {sub.phone && sub.phone !== '+92 ' && (
                              <span className="text-slate-500 ml-2 font-mono">{sub.phone}</span>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono font-bold block">
                            {sub.profile || 'Default'}
                          </span>
                          <span className="text-slate-400 text-[10px] font-mono mt-0.5 block">
                            {formatCurrency(sub.priceMonthly || 2500)}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            )}

            {/* Selected Subscriber Pill */}
            {selectedSub && (
              <div className="mt-2 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/60 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span className="font-bold font-mono text-cyan-300">@{selectedSub.username}</span>
                  <span className="text-slate-300 font-sans">&bull; {selectedSub.fullName || selectedSub.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 font-mono text-[11px]">{selectedSub.phone}</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-200 font-mono text-[10px] font-bold">
                    {selectedSub.profile}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* STEP 2: INVOICE IDENTIFICATION & BILLING CYCLE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-300 font-medium font-mono">Invoice Number *</label>
                <button
                  type="button"
                  onClick={() => setInvoiceNumber(generateNewInvoiceNumber())}
                  className="text-cyan-400 hover:text-cyan-300 text-[10px] font-mono underline cursor-pointer"
                >
                  Regenerate
                </button>
              </div>
              <input
                type="text"
                required
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono p-2 rounded-lg text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1 font-mono">Billing Cycle / Month *</label>
              <input
                type="text"
                required
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                placeholder="e.g. November 2026"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* STEP 3: FINANCIAL BREAKDOWN (Base Amount, Tax, Due Date) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div>
              <label className="block text-slate-300 font-medium mb-1 font-mono">
                Base Fee ({currencySymbol}) *
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={baseAmount}
                onChange={(e) => setBaseAmount(Number(e.target.value) || 0)}
                className="w-full bg-slate-900 border border-slate-700 text-white font-mono p-2 rounded-lg text-xs font-bold focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">Package Plan Fee</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-slate-300 font-medium font-mono">Govt GST / Fee</label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyGst}
                    onChange={(e) => setApplyGst(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-cyan-500 w-3 h-3 cursor-pointer"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">16% GST</span>
                </label>
              </div>
              <input
                type="number"
                min="0"
                step="any"
                value={taxAmount}
                onChange={(e) => {
                  setApplyGst(false);
                  setTaxAmount(Number(e.target.value) || 0);
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 font-mono p-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">Telecom Regulatory Tax</span>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1 font-mono">Invoice Due Date *</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-200 font-mono p-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
              />
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">Default +7 days grace</span>
            </div>
          </div>

          {/* STEP 4: STATUS & PAYMENT DETAILS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1 font-mono">Initial Fee Status *</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 p-2 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="unpaid">Due / Unpaid (Default)</option>
                <option value="paid">Paid / Cleared (Instant Receipt)</option>
              </select>
            </div>

            {status === 'paid' ? (
              <div>
                <label className="block text-slate-300 font-medium mb-1 font-mono">Payment Channel *</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-emerald-400 font-mono p-2 rounded-lg text-xs font-bold focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="agent_cash">Area Agent Cash Collection</option>
                  <option value="easypaisa">EasyPaisa Digital Transfer</option>
                  <option value="jazzcash">JazzCash Mobile Wallet</option>
                  <option value="bank_transfer">Bank Wire / IBFT Online</option>
                  <option value="online_gateway">Online Broadband Portal Gateway</option>
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-slate-300 font-medium mb-1 font-mono">Package Profile Link</label>
                <input
                  type="text"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-300 font-mono p-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            )}
          </div>

          {/* Assigned Field Recovery Agent */}
          <div>
            <label className="block text-slate-300 font-medium mb-1 font-mono">
              Assigned Field Recovery Agent (portal_users)
            </label>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-200 font-mono p-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="">-- Unassigned --</option>
              {portalAgents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.full_name} (@{ag.username}) {ag.area ? `• ${ag.area}` : ''}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
              Directly queried from PostgreSQL <code className="text-purple-400 font-mono">portal_users</code>. Real-time synced to Agent Portal.
            </span>
          </div>

          {/* TOTAL SUMMARY CARD */}
          <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-slate-400 text-xs font-mono block">Total Net Bill Payable</span>
              <span className="text-2xl font-bold font-mono text-cyan-300">
                {formatCurrency(totalAmount)}
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
                Base: {formatCurrency(baseAmount)} + Tax: {formatCurrency(taxAmount)}
              </span>
            </div>

            <label className="flex items-center gap-2 p-2 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-emerald-500 w-4 h-4 cursor-pointer"
              />
              <div className="text-left font-sans">
                <span className="text-xs font-bold text-white block flex items-center gap-1">
                  <Send className="w-3 h-3 text-emerald-400" />
                  <span>WhatsApp Notice</span>
                </span>
                <span className="text-[10px] text-slate-400 block font-mono">
                  Dispatch billing alert to {customerPhone || 'phone'}
                </span>
              </div>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 transition active:scale-95 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Generate &amp; Save Invoice</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GenerateInvoiceModal;
