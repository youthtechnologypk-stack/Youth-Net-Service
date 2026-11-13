import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Landmark,
  Smartphone,
  Plus,
  Copy,
  Check,
  Edit2,
  Trash2,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Globe,
} from 'lucide-react';
import {
  PaymentAccountType,
  SupabasePaymentAccount,
  SupabaseWhatsappBillingConfig,
  supabase,
} from '../services/supabaseClient';
import {
  DEFAULT_SUPPORT_WHATSAPP,
  PAYMENT_ACCOUNT_TYPES,
  buildPreExpiryReminderMessage,
  fetchWhatsappBillingConfig,
  saveWhatsappBillingConfig,
} from '../lib/whatsappBilling';

export interface WhatsAppBillingCenterProps {
  isOpen: boolean;
  onClose: () => void;
  initialAccounts?: SupabasePaymentAccount[];
  initialConfig?: SupabaseWhatsappBillingConfig;
  onAccountsOrConfigChanged?: (
    accounts: SupabasePaymentAccount[],
    config: SupabaseWhatsappBillingConfig
  ) => void;
}

interface AccountFormState {
  account_type: PaymentAccountType;
  provider_name: string;
  account_title: string;
  account_number_or_iban: string;
  is_active: boolean;
}

const createEmptyAccountForm = (): AccountFormState => ({
  account_type: 'BANK',
  provider_name: '',
  account_title: '',
  account_number_or_iban: '',
  is_active: true,
});

const getTypeBadgeStyle = (typeUpper: string): string => {
  switch (typeUpper) {
    case 'JAZZCASH':
      return 'bg-rose-950/90 text-rose-300 border-rose-700/70';
    case 'EASYPAISA':
      return 'bg-emerald-950/90 text-emerald-300 border-emerald-700/70';
    case 'RAST':
      return 'bg-purple-950/90 text-purple-300 border-purple-700/70';
    case 'BANK':
    default:
      return 'bg-cyan-950/90 text-cyan-300 border-cyan-700/70';
  }
};

export const WhatsAppBillingCenter: React.FC<WhatsAppBillingCenterProps> = ({
  isOpen,
  onClose,
  initialAccounts,
  initialConfig,
  onAccountsOrConfigChanged,
}) => {
  const [accounts, setAccounts] = useState<SupabasePaymentAccount[]>(
    () => initialAccounts || []
  );
  const [config, setConfig] = useState<SupabaseWhatsappBillingConfig>(
    () =>
      initialConfig || {
        support_whatsapp: DEFAULT_SUPPORT_WHATSAPP,
        cloud_api_enabled: false,
        webhook_url: '',
        phone_number_id: '',
        auto_remind_days_before: 3,
      }
  );

  const [isLoadingAccounts, setIsLoadingAccounts] = useState<boolean>(false);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);
  const [isSavingAccount, setIsSavingAccount] = useState<boolean>(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add / Edit Account Form state
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingAccount, setEditingAccount] = useState<SupabasePaymentAccount | null>(null);
  const [formState, setFormState] = useState<AccountFormState>(() =>
    createEmptyAccountForm()
  );

  // Delete confirmation state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Feedback banner state
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Refs to avoid unstable parent callback props re-triggering useEffect infinitely
  const onAccountsChangedRef = useRef(onAccountsOrConfigChanged);
  onAccountsChangedRef.current = onAccountsOrConfigChanged;
  const configRef = useRef(config);
  configRef.current = config;
  const formSectionRef = useRef<HTMLFormElement | null>(null);

  // Sync initial props when drawer opens
  useEffect(() => {
    if (isOpen && initialAccounts && initialAccounts.length > 0) {
      setAccounts((prev) => (prev.length === 0 ? initialAccounts : prev));
    }
  }, [isOpen, initialAccounts]);

  useEffect(() => {
    if (isOpen && initialConfig) {
      setConfig(initialConfig);
    }
  }, [isOpen, initialConfig]);

  const showBanner = (type: 'success' | 'error', text: string) => {
    setBanner({ type, text });
  };

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  const fetchPaymentAccountsList = useCallback(async () => {
    setIsLoadingAccounts(true);
    try {
      const [{ data, error }, loadedConfig] = await Promise.all([
        supabase
          .from('payment_accounts')
          .select('*')
          .order('created_at', { ascending: true }),
        fetchWhatsappBillingConfig(),
      ]);

      if (error) {
        throw new Error(error.message);
      }

      const loadedAccounts = (data as SupabasePaymentAccount[]) || [];
      setAccounts(loadedAccounts);
      setConfig(loadedConfig);
      onAccountsChangedRef.current?.(loadedAccounts, loadedConfig);
    } catch (err: any) {
      console.error('[WhatsAppBillingCenter] fetchPaymentAccountsList error:', err);
      showBanner('error', err?.message || 'Failed to load payment accounts.');
    } finally {
      setIsLoadingAccounts(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchPaymentAccountsList();

    const channel = supabase
      .channel('public:whatsapp_billing_center_accounts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payment_accounts' },
        () => {
          void fetchPaymentAccountsList();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isOpen, fetchPaymentAccountsList]);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active !== false),
    [accounts]
  );

  const liveSamplePreview = useMemo(() => {
    return buildPreExpiryReminderMessage({
      fullName: 'Muhammad Ali',
      username: 'bzmali01',
      packageSpeed: '20 Mbps',
      daysRemaining: 2,
      expiryDate: '2026-11-15',
      invoiceNo: 'INV-202611-4821',
      amountDue: 2500,
      activePaymentAccounts: activeAccounts,
      supportWhatsapp: config.support_whatsapp || DEFAULT_SUPPORT_WHATSAPP,
    });
  }, [activeAccounts, config.support_whatsapp]);

  if (!isOpen) return null;

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = (config.support_whatsapp || '').trim();
    if (!cleanPhone) {
      showBanner('error', 'Please enter an official NOC Support WhatsApp number.');
      return;
    }

    setIsSavingConfig(true);
    try {
      const result = await saveWhatsappBillingConfig(config);
      setConfig(result.config);
      onAccountsChangedRef.current?.(accounts, result.config);
      showBanner(
        'success',
        `Saved NOC Support WhatsApp (${result.config.support_whatsapp}). All reminder & receipt templates updated.`
      );
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to save WhatsApp settings.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleOpenAddForm = () => {
    setEditingAccount(null);
    setConfirmDeleteId(null);
    setFormState(createEmptyAccountForm());
    setIsFormOpen(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  };

  const handleOpenEditForm = (acc: SupabasePaymentAccount) => {
    setEditingAccount(acc);
    setConfirmDeleteId(null);
    setFormState({
      account_type: (acc.account_type as PaymentAccountType) || 'BANK',
      provider_name: acc.provider_name || '',
      account_title: acc.account_title || '',
      account_number_or_iban: acc.account_number_or_iban || '',
      is_active: acc.is_active !== false,
    });
    setIsFormOpen(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 40);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const provider = formState.provider_name.trim();
    const title = formState.account_title.trim();
    const numberOrIban = formState.account_number_or_iban.trim();

    if (!provider || !title || !numberOrIban) {
      showBanner('error', 'Provider name, account title, and account number/IBAN are required.');
      return;
    }

    setIsSavingAccount(true);
    try {
      const nowIso = new Date().toISOString();
      if (editingAccount?.id) {
        const { data: updatedRow, error } = await supabase
          .from('payment_accounts')
          .update({
            account_type: formState.account_type,
            provider_name: provider,
            account_title: title,
            account_number_or_iban: numberOrIban,
            is_active: formState.is_active,
            updated_at: nowIso,
          })
          .eq('id', editingAccount.id)
          .select()
          .maybeSingle();

        if (error) throw error;

        if (updatedRow) {
          const nextList = accounts.map((a) =>
            a.id === editingAccount.id ? (updatedRow as SupabasePaymentAccount) : a
          );
          setAccounts(nextList);
          onAccountsChangedRef.current?.(nextList, configRef.current);
        }
        showBanner('success', `Updated payment account "${provider}" (${title}).`);
      } else {
        const { data: insertedRow, error } = await supabase
          .from('payment_accounts')
          .insert([
            {
              account_type: formState.account_type,
              provider_name: provider,
              account_title: title,
              account_number_or_iban: numberOrIban,
              is_active: formState.is_active,
              updated_at: nowIso,
            },
          ])
          .select()
          .maybeSingle();

        if (error) throw error;

        if (insertedRow) {
          const nextList = [...accounts, insertedRow as SupabasePaymentAccount];
          setAccounts(nextList);
          onAccountsChangedRef.current?.(nextList, configRef.current);
        }
        showBanner('success', `Added new payment account "${provider}" (${title}).`);
      }

      setIsFormOpen(false);
      setEditingAccount(null);
      await fetchPaymentAccountsList();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to save payment account.');
    } finally {
      setIsSavingAccount(false);
      setIsLoadingAccounts(false);
    }
  };

  const handleToggleAccountActive = async (acc: SupabasePaymentAccount) => {
    setTogglingId(acc.id);
    try {
      const nextActive = !(acc.is_active !== false);
      const { error } = await supabase
        .from('payment_accounts')
        .update({
          is_active: nextActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', acc.id);

      if (error) throw error;

      const updatedList = accounts.map((a) =>
        a.id === acc.id ? { ...a, is_active: nextActive } : a
      );
      setAccounts(updatedList);
      onAccountsChangedRef.current?.(updatedList, configRef.current);
      showBanner(
        'success',
        `${acc.provider_name} marked ${nextActive ? 'Active (shown in WhatsApp reminders)' : 'Inactive (hidden from reminders)'}.`
      );
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to toggle account status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteAccount = async (account: SupabasePaymentAccount) => {
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('payment_accounts')
        .delete()
        .eq('id', account.id);

      if (error) throw error;

      const remaining = accounts.filter((a) => a.id !== account.id);
      setAccounts(remaining);
      setConfirmDeleteId(null);
      if (editingAccount?.id === account.id) {
        setIsFormOpen(false);
        setEditingAccount(null);
      }
      onAccountsChangedRef.current?.(remaining, configRef.current);
      showBanner('success', `Deleted payment account "${account.provider_name}".`);
      await fetchPaymentAccountsList();
    } catch (err: any) {
      showBanner('error', err?.message || 'Failed to delete payment account.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopyAccountNumber = (acc: SupabasePaymentAccount) => {
    navigator.clipboard?.writeText(acc.account_number_or_iban);
    setCopiedId(acc.id);
    setTimeout(() => setCopiedId((prev) => (prev === acc.id ? null : prev)), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end">
      {/* Backdrop click closes drawer */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      {/* Slide-over Management Drawer */}
      <div className="w-full max-w-3xl bg-[#0B111E] border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Drawer Header */}
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-800/70 text-emerald-400 shrink-0">
              <Landmark className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">
                Payment Accounts &amp; WhatsApp Billing Config
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Manage Bank / Wallet IBANs and NOC WhatsApp support details for automated billing templates
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
            aria-label="Close Payment Accounts Drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Feedback Banner */}
          {banner && (
            <div
              className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
                banner.type === 'success'
                  ? 'bg-emerald-950/80 border-emerald-700/60 text-emerald-200'
                  : 'bg-rose-950/80 border-rose-700/60 text-rose-200'
              }`}
            >
              <span className="flex items-center gap-2">
                {banner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{banner.text}</span>
              </span>
              <button
                type="button"
                onClick={() => setBanner(null)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* 1. NOC Support WhatsApp & Cloud API Settings */}
          <form
            onSubmit={handleSaveConfig}
            className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400 shrink-0" />
                <h3 className="text-sm font-bold text-white">
                  NOC Support WhatsApp &amp; Cloud API Config
                </h3>
              </div>
              <button
                type="submit"
                disabled={isSavingConfig}
                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingConfig ? 'Saving...' : 'Save WhatsApp Config'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Official NOC Support WhatsApp *
                </label>
                <input
                  type="text"
                  required
                  value={config.support_whatsapp}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      support_whatsapp: e.target.value,
                    }))
                  }
                  placeholder="+923234193599"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Embedded into all pre-expiry reminders &amp; receipts (default: +923234193599).
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Pre-Expiry Reminder Window (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  max="14"
                  value={config.auto_remind_days_before ?? 3}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      auto_remind_days_before: Number(e.target.value) || 3,
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono tabular-nums focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Subscribers expiring within 0–{config.auto_remind_days_before ?? 3} days appear in the queue.
                </p>
              </div>
            </div>

            {/* Optional Cloud API Webhook Settings */}
            <div className="pt-3 border-t border-slate-800/80 space-y-3 text-xs">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-semibold text-slate-200">
                    Enable Optional WhatsApp Cloud API Webhook Dispatch
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(config.cloud_api_enabled)}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      cloud_api_enabled: e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-emerald-500 cursor-pointer"
                />
              </label>

              {config.cloud_api_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-slate-400 mb-1">
                      Webhook / Graph Endpoint URL
                    </label>
                    <input
                      type="url"
                      value={config.webhook_url || ''}
                      onChange={(e) =>
                        setConfig((prev) => ({ ...prev, webhook_url: e.target.value }))
                      }
                      placeholder="https://graph.facebook.com/v20.0/.../messages"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">
                      WhatsApp Business Phone Number ID
                    </label>
                    <input
                      type="text"
                      value={config.phone_number_id || ''}
                      onChange={(e) =>
                        setConfig((prev) => ({
                          ...prev,
                          phone_number_id: e.target.value,
                        }))
                      }
                      placeholder="e.g., 10492817239182"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </form>

          {/* 2. Dynamic Bank & Mobile Wallet Accounts Manager */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Bank &amp; Mobile Wallet Accounts ({accounts.length})</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                  {activeAccounts.length} active account{activeAccounts.length === 1 ? '' : 's'} synced to Supabase `payment_accounts`
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void fetchPaymentAccountsList()}
                  disabled={isLoadingAccounts}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  title="Refresh accounts from Supabase"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAccounts ? 'animate-spin text-cyan-400' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={handleOpenAddForm}
                  className="px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>Add New Account</span>
                </button>
              </div>
            </div>

            {/* Add / Edit Account Form */}
            {isFormOpen && (
              <form
                ref={formSectionRef}
                onSubmit={handleSaveAccount}
                className="bg-slate-950 border border-cyan-700/70 rounded-xl p-4 space-y-3.5 text-xs shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-cyan-300">
                    {editingAccount
                      ? `Edit Account: ${editingAccount.provider_name}`
                      : 'Add New Bank / Mobile Wallet Account'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false);
                      setEditingAccount(null);
                    }}
                    className="text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Account Type *
                    </label>
                    <select
                      value={formState.account_type}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          account_type: e.target.value as PaymentAccountType,
                        }))
                      }
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                    >
                      {PAYMENT_ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.value} — {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Bank / Wallet Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formState.provider_name}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          provider_name: e.target.value,
                        }))
                      }
                      placeholder="e.g., Bank Alfalah, Meezan Bank, JazzCash"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Account Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={formState.account_title}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          account_title: e.target.value,
                        }))
                      }
                      placeholder="e.g., Youth Technology / Ahsan Amin"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">
                      Account Number / IBAN *
                    </label>
                    <input
                      type="text"
                      required
                      value={formState.account_number_or_iban}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          account_number_or_iban: e.target.value,
                        }))
                      }
                      placeholder="e.g., PK00ALFH... or 0300-1234567"
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formState.is_active}
                      onChange={(e) =>
                        setFormState((prev) => ({
                          ...prev,
                          is_active: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 accent-emerald-500 cursor-pointer"
                    />
                    <span>Active (include in WhatsApp reminders &amp; receipts)</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFormOpen(false);
                        setEditingAccount(null);
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingAccount}
                      className="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold cursor-pointer"
                    >
                      {isSavingAccount
                        ? 'Saving...'
                        : editingAccount
                        ? 'Update Account'
                        : 'Save Account'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Accounts List — NEVER hide existing accounts behind loading state */}
            {isLoadingAccounts && accounts.length === 0 ? (
              <div className="py-10 text-center text-xs font-mono text-slate-400 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                <span>Loading payment_accounts from Supabase...</span>
              </div>
            ) : accounts.length === 0 ? (
              <div className="py-10 text-center bg-slate-950 border border-slate-800 rounded-xl space-y-2 p-6">
                <p className="text-sm font-semibold text-slate-300">
                  No bank or mobile wallet accounts configured yet
                </p>
                <p className="text-xs text-slate-500">
                  Add Bank Alfalah, Meezan Bank, JazzCash, EasyPaisa, or Raast IDs to populate WhatsApp payment reminders.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {accounts.map((acc) => {
                  const isActive = acc.is_active !== false;
                  const typeUpper = (acc.account_type || 'BANK').toUpperCase();
                  const isConfirmingDelete = confirmDeleteId === acc.id;

                  return (
                    <div
                      key={acc.id}
                      className={`p-3.5 rounded-xl border transition space-y-2.5 ${
                        isActive
                          ? 'bg-slate-950 border-slate-800'
                          : 'bg-slate-950/60 border-slate-800/60 opacity-75'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span
                              className={`px-2 py-0.5 rounded border font-mono font-bold text-[10px] tracking-wide ${getTypeBadgeStyle(
                                typeUpper
                              )}`}
                            >
                              {typeUpper}
                            </span>
                            <span className="font-bold text-white text-sm">
                              {acc.provider_name}
                            </span>
                            <span className="text-slate-500">&middot;</span>
                            <span className="text-slate-300">
                              Title: <strong className="text-white">{acc.account_title}</strong>
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-emerald-300 select-all break-all">
                              {acc.account_number_or_iban}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyAccountNumber(acc)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-mono flex items-center gap-1 cursor-pointer shrink-0"
                              title="Copy Account Number / IBAN"
                            >
                              {copiedId === acc.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {/* Active / Inactive Switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isActive}
                            onClick={() => handleToggleAccountActive(acc)}
                            disabled={togglingId === acc.id}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border flex items-center gap-2 transition cursor-pointer whitespace-nowrap ${
                              isActive
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60 hover:bg-emerald-900/60'
                                : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                            }`}
                            title={
                              isActive
                                ? 'Active — click to disable in WhatsApp reminders'
                                : 'Inactive — click to enable in WhatsApp reminders'
                            }
                          >
                            <span
                              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                                isActive ? 'bg-emerald-500' : 'bg-slate-700'
                              }`}
                            >
                              <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                  isActive ? 'translate-x-3.5' : 'translate-x-0.5'
                                }`}
                              />
                            </span>
                            <span>{isActive ? 'Active' : 'Inactive'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditForm(acc)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 text-xs font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                            title="Edit Account"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              setConfirmDeleteId((prev) => (prev === acc.id ? null : acc.id))
                            }
                            className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/70 text-xs font-semibold flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline per-card Delete Confirmation (immediately visible on click) */}
                      {isConfirmingDelete && (
                        <div className="pt-2.5 border-t border-rose-900/60 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-rose-200 font-medium">
                            Delete &ldquo;{acc.provider_name}&rdquo; ({acc.account_number_or_iban}) permanently?
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isDeleting}
                              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(acc)}
                              disabled={isDeleting}
                              className="px-3 py-1 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold cursor-pointer"
                            >
                              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Live WhatsApp Template Preview */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Live 3-Day Pre-Expiry Message Preview
              </h3>
              <span className="text-[11px] font-mono text-emerald-400">
                {activeAccounts.length} active account{activeAccounts.length === 1 ? '' : 's'} injected
              </span>
            </div>
            <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 whitespace-pre-wrap leading-relaxed">
              {liveSamplePreview}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppBillingCenter;
