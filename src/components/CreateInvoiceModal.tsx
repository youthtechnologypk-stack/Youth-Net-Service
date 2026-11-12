import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  CreditCard,
  Search,
  Lock,
  CheckCircle2,
  Calendar,
  DollarSign,
  User,
  RefreshCw,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
  Check,
} from 'lucide-react';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';

export interface PPPoESecretOption {
  name: string;
  profile: string;
  remoteAddress: string;
  displayName: string;
}

export interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCustomerId?: string;
  defaultSubscriberUsername?: string;
  defaultBillingMonth?: string;
  onSuccess?: (invoice?: any) => void;
}

export const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
  defaultCustomerId,
  defaultSubscriberUsername,
  onSuccess,
}) => {
  const { formatCurrency, currencySymbol } = useCurrency();

  // Resolved subscriber identifier
  const lockedSubscriber = defaultSubscriberUsername || defaultCustomerId || '';
  const isLocked = Boolean(lockedSubscriber);

  // Form states
  const [selectedSubscriberUsername, setSelectedSubscriberUsername] = useState<string>(lockedSubscriber);
  const [amount, setAmount] = useState<number | string>(2500);
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');

  // Dropdown & Search states for MikroTik PPPoE secrets
  const [secretOptions, setSecretOptions] = useState<PPPoESecretOption[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const [isLoadingSecrets, setIsLoadingSecrets] = useState<boolean>(false);

  // Agents list from Supabase portal_users
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);

  // Submitting, Feedback & Notifications
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 1. Fetch live PPPoE secrets from MikroTik (/api/mikrotik/ppp/secret & /api/mikrotik/ppp/active) + Supabase
  const loadSubscribersAndSecrets = async () => {
    setIsLoadingSecrets(true);
    const optionsMap = new Map<string, PPPoESecretOption>();

    try {
      // 1.1 Fetch MikroTik secrets from REST proxy
      try {
        const secRes = await fetch('/api/mikrotik/ppp/secret');
        if (secRes.ok) {
          const secretsData = await secRes.json();
          if (Array.isArray(secretsData)) {
            secretsData.forEach((sec: any) => {
              const name = String(sec.name || sec.user || '').trim();
              if (name) {
                const profile = sec.profile || 'Default';
                const remoteAddress = sec['remote-address'] || sec.remoteAddress || sec.address || 'Dynamic';
                optionsMap.set(name.toLowerCase(), {
                  name,
                  profile,
                  remoteAddress,
                  displayName: `${name} (${profile} - ${remoteAddress})`,
                });
              }
            });
          }
        }
      } catch (err) {
        console.warn('Could not query /api/mikrotik/ppp/secret:', err);
      }

      // 1.2 Fetch MikroTik active sessions from REST proxy
      try {
        const actRes = await fetch('/api/mikrotik/ppp/active');
        if (actRes.ok) {
          const activeData = await actRes.json();
          if (Array.isArray(activeData)) {
            activeData.forEach((act: any) => {
              const name = String(act.name || act.user || '').trim();
              if (name && !optionsMap.has(name.toLowerCase())) {
                const profile = act.profile || act.service || 'Default';
                const remoteAddress = act.address || act['caller-id'] || 'Dynamic IP';
                optionsMap.set(name.toLowerCase(), {
                  name,
                  profile,
                  remoteAddress,
                  displayName: `${name} (${profile} - ${remoteAddress})`,
                });
              }
            });
          }
        }
      } catch (err) {
        console.warn('Could not query /api/mikrotik/ppp/active:', err);
      }

      // 1.3 Fetch subscribers from Supabase portal_users (role === 'CLIENT')
      try {
        const { data: dbClients } = await supabase
          .from('portal_users')
          .select('username, full_name, package_speed, monthly_fee')
          .eq('role', 'CLIENT');

        if (dbClients && Array.isArray(dbClients)) {
          dbClients.forEach((client: any) => {
            const name = String(client.username || '').trim();
            if (name && !optionsMap.has(name.toLowerCase())) {
              const profile = client.package_speed || 'Standard';
              const remoteAddress = 'Supabase Client';
              optionsMap.set(name.toLowerCase(), {
                name,
                profile,
                remoteAddress,
                displayName: `${name} (${profile} - ${remoteAddress})`,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Could not query portal_users for clients:', err);
      }

      // 1.4 If lockedSubscriber provided, guarantee it exists in list
      if (lockedSubscriber && !optionsMap.has(lockedSubscriber.toLowerCase())) {
        optionsMap.set(lockedSubscriber.toLowerCase(), {
          name: lockedSubscriber,
          profile: 'Active Subscriber',
          remoteAddress: 'Profile Locked',
          displayName: `${lockedSubscriber} (Active Subscriber - Profile Locked)`,
        });
      }

      const optionsArray = Array.from(optionsMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      setSecretOptions(optionsArray);

      // Default selection
      if (lockedSubscriber) {
        setSelectedSubscriberUsername(lockedSubscriber);
        setSearchQuery(lockedSubscriber);
      } else if (!selectedSubscriberUsername && optionsArray.length > 0) {
        setSelectedSubscriberUsername(optionsArray[0].name);
        setSearchQuery(optionsArray[0].displayName);
      }
    } catch (err) {
      console.error('Error loading subscribers and secrets:', err);
    } finally {
      setIsLoadingSecrets(false);
    }
  };

  // 2. Fetch live agents directly from Supabase portal_users
  const loadPortalAgents = async () => {
    try {
      const { data, error } = await supabase
        .from('portal_users')
        .select('id, full_name, username, area, role')
        .eq('role', 'AGENT');

      if (!error && data) {
        setPortalAgents(data as SupabasePortalUser[]);
      }
    } catch (err) {
      console.warn('Failed to load agents from portal_users:', err);
    }
  };

  // Initialize on open
  useEffect(() => {
    if (isOpen) {
      setToastMessage(null);
      setErrorMessage(null);
      setIsSubmitting(false);

      if (lockedSubscriber) {
        setSelectedSubscriberUsername(lockedSubscriber);
        setSearchQuery(lockedSubscriber);
      }

      loadSubscribersAndSecrets();
      loadPortalAgents();
    }
  }, [isOpen, lockedSubscriber]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Filtered PPPoE secrets for searchable combobox
  const filteredSecretOptions = useMemo(() => {
    if (!searchQuery.trim()) return secretOptions;
    const q = searchQuery.toLowerCase().trim();
    return (secretOptions || []).filter(
      (opt) =>
        (opt?.name || '').toLowerCase().includes(q) ||
        (opt?.profile || '').toLowerCase().includes(q) ||
        (opt?.remoteAddress || '').toLowerCase().includes(q) ||
        (opt?.displayName || '').toLowerCase().includes(q)
    );
  }, [secretOptions, searchQuery]);

  // Handle subscriber selection
  const handleSelectOption = (opt: PPPoESecretOption) => {
    setSelectedSubscriberUsername(opt.name);
    setSearchQuery(opt.displayName);
    setIsDropdownOpen(false);
  };

  // Form submission: Direct Supabase insert
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setToastMessage(null);

    const subUsername = (selectedSubscriberUsername || searchQuery || lockedSubscriber).trim().toLowerCase();
    if (!subUsername) {
      setErrorMessage('Please select a valid subscriber.');
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage('Please specify an invoice amount greater than 0.');
      return;
    }

    if (!dueDate) {
      setErrorMessage('Please select an invoice due date.');
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Auto-generate valid unique invoice number
      const generatedInvoiceNo = `INV-${new Date().getFullYear()}${String(
        new Date().getMonth() + 1
      ).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // 2. Identify assigned agent name
      const selectedAgent = portalAgents.find((a) => a.id === selectedAgentId);

      // 3. Exact database schema payload
      const invoicePayload = {
        invoice_no: generatedInvoiceNo,
        subscriber_username: subUsername,
        assigned_agent_id: selectedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        amount: numAmount,
        paid_amount: 0,
        status: 'DUE',
        due_date: dueDate, // YYYY-MM-DD
        cycle_day: 5,
      };

      // 4. Supabase Insert
      const { data, error } = await supabase
        .from('invoices')
        .insert([invoicePayload])
        .select()
        .single();

      if (error) {
        console.error('Supabase invoice insert error:', error);
        throw new Error(error.message || 'PostgreSQL invoice insert constraint failed');
      }

      // Also persist to localStorage for offline cache
      try {
        const raw = localStorage.getItem('youthnet_invoices');
        const list = raw ? JSON.parse(raw) : [];
        list.unshift({
          id: data.id,
          invoiceNumber: generatedInvoiceNo,
          customerId: subUsername,
          customerName: subUsername,
          totalAmount: numAmount,
          baseAmount: numAmount,
          taxAmount: 0,
          status: 'unpaid',
          dueDate: dueDate,
          issuedAt: new Date().toISOString(),
        });
        localStorage.setItem('youthnet_invoices', JSON.stringify(list));
      } catch {}

      // 5. Success Toast & Trigger Refresh
      setToastMessage('Invoice created successfully');

      if (onSuccess) {
        onSuccess(data);
      }

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Supabase invoice creation error:', err);
      setErrorMessage(err.message || 'Failed to insert invoice into PostgreSQL.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-[#111A2E] to-slate-900 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded-xl shadow-inner">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Generate Subscriber Invoice</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1 font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live PostgreSQL
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Populate subscriber directly from live MikroTik PPPoE secrets (/ppp/secret)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback Messages */}
        {toastMessage && (
          <div className="bg-emerald-950/90 border-b border-emerald-800 px-4 py-2.5 text-emerald-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="bg-rose-950/90 border-b border-rose-800 px-4 py-2.5 text-rose-300 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs font-sans">
          {/* STEP 1: SUBSCRIBER SELECTION (Searchable Combobox from MikroTik Secrets) */}
          <div className="space-y-1.5 relative" ref={dropdownRef}>
            <div className="flex items-center justify-between">
              <label className="text-slate-300 font-bold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span>Subscriber (MikroTik PPPoE Secret) *</span>
              </label>
              <div className="flex items-center gap-2">
                {isLocked ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1 font-bold">
                    <Lock className="w-3 h-3 text-indigo-400" />
                    Locked to @{lockedSubscriber}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-mono">
                    {isLoadingSecrets ? 'Loading secrets...' : `${secretOptions.length} secrets available`}
                  </span>
                )}
              </div>
            </div>

            {isLocked ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900/90 border border-indigo-800/80 text-white font-mono text-xs">
                <Lock className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="font-bold text-cyan-300">@{lockedSubscriber}</span>
                <span className="text-slate-400 text-[11px]">
                  (Pre-selected from Subscriber 360° Profile)
                </span>
              </div>
            ) : (
              <div className="relative">
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                  <input
                    type="text"
                    required
                    placeholder="Search by secret username, profile, or IP address..."
                    value={searchQuery}
                    onFocus={() => setIsDropdownOpen(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setIsDropdownOpen(true);
                    }}
                    className="w-full bg-slate-900 border border-slate-700 text-slate-100 pl-9 pr-8 py-2.5 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen((prev) => !prev)}
                    className="absolute right-2.5 text-slate-400 hover:text-white p-1"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Combobox Dropdown Options */}
                {isDropdownOpen && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-56 overflow-y-auto z-50 divide-y divide-slate-800">
                    {filteredSecretOptions.length === 0 ? (
                      <div className="p-3 text-center text-slate-500 text-xs font-mono">
                        {isLoadingSecrets ? 'Fetching router secrets...' : 'No matching PPPoE secrets found.'}
                      </div>
                    ) : (
                      filteredSecretOptions.map((opt) => {
                        const isSelected = (selectedSubscriberUsername || '').toLowerCase() === (opt?.name || '').toLowerCase();
                        return (
                          <button
                            key={opt.name}
                            type="button"
                            onClick={() => handleSelectOption(opt)}
                            className={`w-full p-2.5 text-left flex items-center justify-between hover:bg-slate-800 transition cursor-pointer ${
                              isSelected ? 'bg-cyan-950/70 border-l-2 border-cyan-400' : ''
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <span className="font-bold text-cyan-300 font-mono text-xs block truncate">
                                {opt.name}
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono block mt-0.5 truncate">
                                {opt.profile} &bull; {opt.remoteAddress}
                              </span>
                            </div>
                            <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px] font-mono shrink-0">
                              /ppp/secret
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* STEP 2: AMOUNT & DUE DATE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-bold mb-1 font-mono">
                Invoice Amount ({currencySymbol}) *
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-3 text-slate-500 font-mono">Rs.</span>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-white font-mono font-bold pl-10 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                Standard monthly broadband charge
              </span>
            </div>

            <div>
              <label className="block text-slate-300 font-bold mb-1 font-mono">
                Due Date *
              </label>
              <div className="relative flex items-center">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="date"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-mono pl-9 pr-3 py-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
                Default: +7 days grace period
              </span>
            </div>
          </div>

          {/* STEP 3: ASSIGNED FIELD RECOVERY AGENT */}
          <div>
            <label className="block text-slate-300 font-bold mb-1 font-mono">
              Assigned Field Recovery Agent (portal_users)
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-slate-200 font-mono p-2 rounded-lg text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="">-- Unassigned (Direct NOC Office Collection) --</option>
              {portalAgents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.full_name} (@{ag.username}) {ag.area ? `• Area: ${ag.area}` : ''}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-slate-500 font-mono mt-0.5 block">
              Directly queried from <code className="text-purple-400">portal_users</code>. Real-time synced to Field Agent Portal tasks.
            </span>
          </div>

          {/* TOTAL SUMMARY CARD */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400 font-mono uppercase block">Total Payable Bill</span>
              <span className="text-xl font-bold font-mono text-cyan-300">
                {formatCurrency(Number(amount) || 0)}
              </span>
            </div>
            <div className="text-right">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">
                Initial Status: DUE
              </span>
              <span className="text-[10px] text-slate-500 font-mono block mt-1">Cycle Day: 5th</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold flex items-center gap-2 shadow-lg shadow-cyan-950/50 transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Inserting...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Insert to PostgreSQL</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateInvoiceModal;
