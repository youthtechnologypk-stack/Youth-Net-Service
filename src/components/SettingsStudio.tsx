import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Save,
  CheckCircle2,
  Globe,
  Clock,
  Trash2,
  Plus,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  MessageSquare,
  Phone,
  Power,
  Users,
  PlugZap,
  RefreshCw,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { MikrotikRouter } from '../types/isp';
import { AddMikrotikDeviceModal } from './AddMikrotikDeviceModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import {
  DEFAULT_GLOBAL_SYSTEM_SETTINGS,
  getCachedGlobalSystemSettings,
  loadGlobalSystemSettings,
  saveGlobalSystemSettings,
  SYSTEM_SETTINGS_MIGRATION_SQL,
} from '../lib/systemSettings';
import {
  getDisplayWhatsAppGatewayUrl,
  normalizeWhatsAppGatewayUrl,
  safeWhatsAppApiFetch,
} from '../lib/whatsappRouting';

export const SettingsStudio: React.FC = () => {
  const { routers, olts, deleteMikrotikRouter } = useISP();
  const {
    currencyCode,
    currencySymbol: globalCurrencySymbol,
    updateCurrency,
    supportedCurrencies,
    formatCurrency,
  } = useCurrency();

  const initialCached = getCachedGlobalSystemSettings();

  const [companyDisplayName, setCompanyDisplayName] = useState(initialCached.companyDisplayName);
  const [supportHelpline, setSupportHelpline] = useState(initialCached.supportHelpline);
  const [baileysGatewayUrl, setBaileysGatewayUrl] = useState(initialCached.baileysGatewayUrl);
  const [autoSendMasterSwitch, setAutoSendMasterSwitch] = useState(
    initialCached.autoSendMasterSwitch
  );
  const [teamWhatsAppGroupName, setTeamWhatsAppGroupName] = useState(
    initialCached.teamWhatsAppGroupName
  );
  const [teamWhatsAppGroupJid, setTeamWhatsAppGroupJid] = useState(
    initialCached.teamWhatsAppGroupJid
  );
  const [billingCycleMode, setBillingCycleMode] = useState<'fixed_day' | 'rolling_31'>(
    initialCached.billingCycleMode
  );
  const [billingCycleDay, setBillingCycleDay] = useState(initialCached.billingCycleDay);
  const [autoInvoiceDaysBeforeExpiry, setAutoInvoiceDaysBeforeExpiry] = useState(
    initialCached.autoInvoiceDaysBeforeExpiry
  );
  const [gracePeriodDays, setGracePeriodDays] = useState(initialCached.gracePeriodDays);
  const [expiryPppProfile, setExpiryPppProfile] = useState(initialCached.expiryPppProfile);
  const [defaultSnmpCommunity, setDefaultSnmpCommunity] = useState(
    initialCached.defaultSnmpCommunity
  );
  const [defaultMikrotikApiPort, setDefaultMikrotikApiPort] = useState(
    initialCached.defaultMikrotikApiPort
  );
  const [slaAutoAssignMinutes, setSlaAutoAssignMinutes] = useState(
    initialCached.slaAutoAssignMinutes
  );
  const [fiberCutSlaHours, setFiberCutSlaHours] = useState(initialCached.fiberCutSlaHours);
  const [autoWalledGarden, setAutoWalledGarden] = useState(initialCached.autoWalledGarden);

  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [tableMissingWarning, setTableMissingWarning] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [gatewayCheck, setGatewayCheck] = useState<{
    state: 'idle' | 'testing' | 'online' | 'offline';
    message: string;
  }>({ state: 'idle', message: '' });

  // Router management in settings
  const [isAddRouterModalOpen, setIsAddRouterModalOpen] = useState(false);
  const [routerToDelete, setRouterToDelete] = useState<MikrotikRouter | null>(null);
  const [isDeleteRouterDialogOpen, setIsDeleteRouterDialogOpen] = useState(false);
  const [isDeletingRouter, setIsDeletingRouter] = useState(false);

  const showToast = (type: 'success' | 'error', message: string, durationMs = 5000) => {
    setToast({ type, message });
    window.setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, durationMs);
  };

  const hydrateFromDatabase = async () => {
    setIsLoadingSettings(true);
    try {
      const res = await loadGlobalSystemSettings();
      const s = res.settings || DEFAULT_GLOBAL_SYSTEM_SETTINGS;
      setCompanyDisplayName(s.companyDisplayName);
      setSupportHelpline(s.supportHelpline);
      setBaileysGatewayUrl(s.baileysGatewayUrl);
      setAutoSendMasterSwitch(s.autoSendMasterSwitch);
      setTeamWhatsAppGroupName(s.teamWhatsAppGroupName);
      setTeamWhatsAppGroupJid(s.teamWhatsAppGroupJid);
      setBillingCycleMode(s.billingCycleMode);
      setBillingCycleDay(s.billingCycleDay);
      setAutoInvoiceDaysBeforeExpiry(s.autoInvoiceDaysBeforeExpiry);
      setGracePeriodDays(s.gracePeriodDays);
      setExpiryPppProfile(s.expiryPppProfile);
      setAutoWalledGarden(s.autoWalledGarden);
      setDefaultMikrotikApiPort(s.defaultMikrotikApiPort);
      setDefaultSnmpCommunity(s.defaultSnmpCommunity);
      setSlaAutoAssignMinutes(s.slaAutoAssignMinutes);
      setFiberCutSlaHours(s.fiberCutSlaHours);
      setLastSyncedAt(res.updatedAt);

      if (res.tableMissing) {
        setTableMissingWarning(
          res.error || 'Supabase table "system_settings" has not been created yet.'
        );
      } else {
        setTableMissingWarning(null);
      }
    } finally {
      setIsLoadingSettings(false);
    }
  };

  useEffect(() => {
    void hydrateFromDatabase();
  }, []);

  const handleSelectPresetCurrency = async (code: string, symbol: string) => {
    await updateCurrency(code, symbol);
    showToast('success', `Currency updated to ${code} (${symbol}) and saved to database.`);
  };

  const handleCustomSymbolChange = async (newSymbol: string) => {
    await updateCurrency(currencyCode, newSymbol);
  };

  const handleCustomCodeChange = async (newCode: string) => {
    await updateCurrency(newCode, globalCurrencySymbol);
  };

  const handleTestGateway = async () => {
    const check = normalizeWhatsAppGatewayUrl(baileysGatewayUrl);
    if (!check.valid) {
      setGatewayCheck({ state: 'offline', message: check.error || 'Invalid URL' });
      return;
    }
    setGatewayCheck({ state: 'testing', message: 'Checking gateway...' });
    const res = await safeWhatsAppApiFetch<any>(
      '/api/whatsapp/health',
      { method: 'GET', headers: { Accept: 'application/json' } },
      check.normalized
    );
    if (res.ok && res.data?.success) {
      const count = Number(res.data?.connectedSessionsCount ?? 0);
      setGatewayCheck({
        state: 'online',
        message: `Online (${count} linked session${count === 1 ? '' : 's'})`,
      });
    } else {
      setGatewayCheck({
        state: 'offline',
        message: `Unreachable at ${getDisplayWhatsAppGatewayUrl(check.normalized)}`,
      });
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SYSTEM_SETTINGS_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const result = await saveGlobalSystemSettings({
        companyDisplayName: companyDisplayName.trim() || DEFAULT_GLOBAL_SYSTEM_SETTINGS.companyDisplayName,
        ispName: companyDisplayName.trim() || DEFAULT_GLOBAL_SYSTEM_SETTINGS.ispName,
        supportHelpline: supportHelpline.trim(),
        baileysGatewayUrl: baileysGatewayUrl.trim(),
        autoSendMasterSwitch,
        whatsAppGatewayEnabled: autoSendMasterSwitch,
        teamWhatsAppGroupName: teamWhatsAppGroupName.trim(),
        teamWhatsAppGroupJid: teamWhatsAppGroupJid.trim(),
        billingCycleMode,
        billingCycleDay,
        autoInvoiceDaysBeforeExpiry,
        gracePeriodDays,
        expiryPppProfile: expiryPppProfile.trim() || DEFAULT_GLOBAL_SYSTEM_SETTINGS.expiryPppProfile,
        autoWalledGarden,
        currencyCode,
        currencySymbol: globalCurrencySymbol,
        defaultMikrotikApiPort,
        defaultSnmpCommunity: defaultSnmpCommunity.trim() || 'public',
        slaAutoAssignMinutes,
        fiberCutSlaHours,
      });

      if (!result.ok) {
        if (result.tableMissing) {
          setTableMissingWarning(result.error || 'Table public.system_settings does not exist.');
        }
        showToast(
          'error',
          result.error || 'Failed to save System Settings & Carrier Configuration to Supabase.',
          8000
        );
        return;
      }

      setTableMissingWarning(null);
      setBaileysGatewayUrl(result.settings.baileysGatewayUrl);
      setCompanyDisplayName(result.settings.companyDisplayName);
      setLastSyncedAt(result.updatedAt || new Date().toISOString());
      showToast('success', 'System Settings & Carrier Configuration saved to database.');
    } catch (err: any) {
      showToast(
        'error',
        err?.message || 'Unexpected error saving System Settings & Carrier Configuration.',
        8000
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs font-sans max-w-5xl mx-auto pb-8">
      {/* Floating Confirmation / Error Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-xl border shadow-2xl flex items-start gap-2.5 text-xs font-semibold backdrop-blur-md transition-all ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500/60 text-emerald-200 shadow-emerald-950/60'
              : 'bg-rose-950/95 border-rose-500/60 text-rose-200 shadow-rose-950/60'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Settings Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 text-white shadow-lg shadow-cyan-500/20">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              System Settings &amp; Carrier Configuration
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Persisted globally in Supabase PostgreSQL (<code className="text-cyan-300">system_settings</code>) for all Admins, Dealers, and browser sessions.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {lastSyncedAt && !isLoadingSettings && (
            <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
              Synced: {new Date(lastSyncedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            onClick={hydrateFromDatabase}
            disabled={isLoadingSettings}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingSettings ? 'animate-spin' : ''}`} />
            <span>Reload DB</span>
          </button>
        </div>
      </div>

      {/* Missing Table / RLS Warning Banner with 1-Click SQL */}
      {tableMissingWarning && (
        <div className="bg-amber-950/60 border border-amber-500/40 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-amber-200">
                Supabase Table Migration Needed: public.system_settings
              </p>
              <p className="text-[11px] text-amber-200/80">{tableMissingWarning}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-100 text-xs font-bold shrink-0 cursor-pointer"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedSql ? 'SQL Copied!' : 'Copy system_settings SQL'}
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: Company Branding, WhatsApp Gateway & Team Group */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
                Company Branding, Baileys Gateway &amp; Team Work Group
              </h4>
            </div>
            {isLoadingSettings && (
              <span className="text-[11px] text-cyan-400 flex items-center gap-1 font-mono">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading from Supabase...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold">
                Company Display Name (Carrier Brand)
              </label>
              <input
                type="text"
                value={companyDisplayName}
                onChange={(e) => setCompanyDisplayName(e.target.value)}
                placeholder="e.g. Youth Net Service"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <Phone className="w-3 h-3 text-cyan-400" />
                <span>Support Helpline Number</span>
              </label>
              <input
                type="text"
                value={supportHelpline}
                onChange={(e) => setSupportHelpline(e.target.value)}
                placeholder="e.g. +92 323 4193599"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Baileys Gateway Server URL */}
          <div className="font-mono space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-slate-300 font-semibold">
                Baileys Gateway Server URL
              </label>
              {gatewayCheck.state !== 'idle' && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                    gatewayCheck.state === 'online'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : gatewayCheck.state === 'testing'
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-700'
                      : 'bg-rose-950 text-rose-300 border-rose-700'
                  }`}
                >
                  {gatewayCheck.message}
                </span>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={baileysGatewayUrl}
                onChange={(e) => setBaileysGatewayUrl(e.target.value)}
                placeholder="https://your-baileys-server.up.railway.app or http://localhost:3001 (blank = built-in)"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleTestGateway}
                disabled={gatewayCheck.state === 'testing'}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 font-bold flex items-center gap-1.5 transition cursor-pointer shrink-0 disabled:opacity-50"
              >
                {gatewayCheck.state === 'testing' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PlugZap className="w-3.5 h-3.5" />
                )}
                <span>Test Gateway</span>
              </button>
            </div>
          </div>

          {/* Team WhatsApp Work Group */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <Users className="w-3 h-3 text-emerald-400" />
                <span>Team WhatsApp Work Group Name</span>
              </label>
              <input
                type="text"
                value={teamWhatsAppGroupName}
                onChange={(e) => setTeamWhatsAppGroupName(e.target.value)}
                placeholder="e.g. Youth Net Field Technicians"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold">
                Team WhatsApp Work Group JID
              </label>
              <input
                type="text"
                value={teamWhatsAppGroupJid}
                onChange={(e) => setTeamWhatsAppGroupJid(e.target.value)}
                placeholder="e.g. 120363012345678901@g.us"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Auto-Send Master Switch */}
          <div className="flex items-center justify-between p-3.5 rounded-lg bg-slate-950 border border-slate-800">
            <div className="flex items-start gap-2.5">
              <Power
                className={`w-4 h-4 mt-0.5 ${
                  autoSendMasterSwitch ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
              <div>
                <span className="font-bold text-white block">
                  Auto-Send Master Switch (WhatsApp Background Automation)
                </span>
                <span className="text-[11px] text-slate-400">
                  Automatically dispatch Welcome Credentials, 5-Day Pre-Expiry Invoices, Grace Warnings, Auto-Suspension Notices, Complaints, and Paid Receipts via Baileys.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAutoSendMasterSwitch((prev) => !prev)}
              className={`relative w-12 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${
                autoSendMasterSwitch ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
              aria-label="Toggle Auto-Send Master Switch"
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  autoSendMasterSwitch ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Section 2: Billing, Grace Period & Currency Rules */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              Billing, Grace Rules &amp; Localization Currency
            </h4>
          </div>

          {/* Monthly Billing Cycle Policy (Global Default) */}
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-white block">
                  Monthly Billing Cycle Policy (Global Default)
                </span>
                <span className="text-[11px] text-slate-400 font-sans">
                  Controls how auto-generated invoices (5 days before expiry) and Shift +1M renewals align due dates for subscribers using the global default.
                </span>
              </div>
              <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setBillingCycleMode('fixed_day')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer ${
                    billingCycleMode === 'fixed_day'
                      ? 'bg-cyan-600 text-slate-950 shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Fixed Day (1–31)
                </button>
                <button
                  type="button"
                  onClick={() => setBillingCycleMode('rolling_31')}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition cursor-pointer ${
                    billingCycleMode === 'rolling_31'
                      ? 'bg-indigo-500 text-white shadow'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Rolling 31-Day Cycle
                </button>
              </div>
            </div>

            {billingCycleMode === 'fixed_day' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Fixed Monthly Billing Cycle Day (1–31)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={billingCycleDay}
                      onChange={(e) =>
                        setBillingCycleDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))
                      }
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-bold focus:outline-none focus:border-cyan-500"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      {[1, 5, 10, 15, 25].map((day) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => setBillingCycleDay(day)}
                          className={`px-2 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                            billingCycleDay === day
                              ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                              : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
                          }`}
                        >
                          {day === 1 ? '1st' : `${day}th`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Auto-Invoice Lead Time (Days Before Expiry)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={autoInvoiceDaysBeforeExpiry}
                    onChange={(e) =>
                      setAutoInvoiceDaysBeforeExpiry(
                        Math.max(1, Math.min(15, Number(e.target.value) || 5))
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 items-center">
                <p className="text-[11px] text-indigo-300 font-sans bg-indigo-950/40 border border-indigo-800/60 rounded-lg p-2.5">
                  Rolling 31-Day Cycle active: each renewal and Shift +1M advances due dates by exactly +31 days from the prior cycle date.
                </p>
                <div>
                  <label className="block text-slate-400 mb-1 font-semibold">
                    Auto-Invoice Lead Time (Days Before Expiry)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={autoInvoiceDaysBeforeExpiry}
                    onChange={(e) =>
                      setAutoInvoiceDaysBeforeExpiry(
                        Math.max(1, Math.min(15, Number(e.target.value) || 5))
                      )
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Post-Due Grace Period (Days)
              </label>
              <input
                type="number"
                min={0}
                max={30}
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                MikroTik Expiry Pool Profile
              </label>
              <input
                type="text"
                value={expiryPppProfile}
                onChange={(e) => setExpiryPppProfile(e.target.value)}
                placeholder="EXPIRED-16-POOL"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Localization & Currency Setting */}
          <div className="pt-3 border-t border-slate-800 space-y-3 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-white font-bold block text-xs">
                  Localization &amp; Billing Currency Setting
                </label>
                <span className="text-[11px] text-slate-400">
                  Changes persist to Supabase <code className="text-cyan-300">system_settings</code> &amp; update the entire dashboard immediately.
                </span>
              </div>
              <div className="flex items-center gap-2 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px]">
                <span className="text-slate-400">Current:</span>
                <span className="text-cyan-400 font-bold">{currencyCode}</span>
                <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                  {globalCurrencySymbol}
                </span>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400 block mb-1.5 uppercase tracking-wider">
                Quick Preset Selection (Click to apply immediately):
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                {supportedCurrencies.map((c) => {
                  const isActive = currencyCode === c.code && globalCurrencySymbol === c.symbol;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => handleSelectPresetCurrency(c.code, c.symbol)}
                      className={`px-2.5 py-2 rounded-lg border text-xs font-bold transition flex flex-col items-center justify-center cursor-pointer ${
                        isActive
                          ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-md shadow-cyan-950/50'
                          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <span className="text-sm font-extrabold">{c.symbol}</span>
                      <span className="text-[10px] opacity-80">{c.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-[11px]">
                  Custom Currency ISO Code
                </label>
                <input
                  type="text"
                  value={currencyCode}
                  onChange={(e) => handleCustomCodeChange(e.target.value.toUpperCase())}
                  placeholder="e.g. PKR, USD"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500 font-bold uppercase"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold text-[11px]">
                  Custom Currency Symbol
                </label>
                <input
                  type="text"
                  value={globalCurrencySymbol}
                  onChange={(e) => handleCustomSymbolChange(e.target.value)}
                  placeholder="e.g. Rs., $, €"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-cyan-500 font-bold"
                />
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex flex-col justify-center">
                <span className="text-[10px] text-slate-400 block mb-1">Live Format Preview:</span>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-emerald-400">{formatCurrency(2500)}</span>
                  <span className="text-slate-500 text-[10px]">|</span>
                  <span className="text-amber-400">{formatCurrency(52.2)}</span>
                  <span className="text-slate-500 text-[10px]">|</span>
                  <span className="text-cyan-300">{formatCurrency(145000, 0)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 mt-2">
              <div>
                <span className="font-bold text-white block">Auto Expiry-Pool Isolation</span>
                <span className="text-[11px] text-slate-400">
                  Automatically move unpaid PPPoE subscribers to the Expiry Pool once their grace period expires.
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoWalledGarden}
                onChange={(e) => setAutoWalledGarden(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Hardware Gateway & Carrier Defaults (MikroTik & VSOL OLT) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Server className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              Router &amp; Carrier Defaults (MikroTik &amp; VSOL OLT)
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Default RouterOS API Port
              </label>
              <input
                type="number"
                value={defaultMikrotikApiPort}
                onChange={(e) => setDefaultMikrotikApiPort(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Default SNMP Community String
              </label>
              <input
                type="text"
                value={defaultSnmpCommunity}
                onChange={(e) => setDefaultSnmpCommunity(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Active OLT Hardware Nodes
              </label>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-400 font-bold">
                {olts.length} Registered Chassis
              </div>
            </div>
          </div>

          {/* Configured MikroTik Routers List */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-bold font-mono text-xs flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-cyan-400" />
                <span>Configured MikroTik BNG Routers ({routers.length})</span>
              </span>

              <button
                type="button"
                onClick={() => setIsAddRouterModalOpen(true)}
                className="px-2.5 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-bold font-mono flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>+ Add Router</span>
              </button>
            </div>

            <div className="space-y-2">
              {routers.map((router) => (
                <div
                  key={router.id}
                  className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-3 text-xs font-mono"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        router.status === 'online' ? 'bg-emerald-400' : 'bg-rose-400'
                      }`}
                    />
                    <div>
                      <span className="text-white font-bold block">{router.name}</span>
                      <span className="text-[11px] text-slate-400">
                        {router.ipAddress}:{router.apiPort} &bull; {router.model} &bull;{' '}
                        {router.version}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                      {router.location}
                    </span>

                    {routers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setRouterToDelete(router);
                          setIsDeleteRouterDialogOpen(true);
                        }}
                        className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white transition cursor-pointer flex items-center gap-1 text-[11px]"
                        title="Delete Router configuration from database"
                      >
                        <Trash2 className="w-3 h-3 text-rose-400" />
                        <span>Delete Router</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Complaint SLA Timers */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Clock className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              Complaint SLA Timers
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Auto-Assign SLA Timeout
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={slaAutoAssignMinutes}
                  onChange={(e) => setSlaAutoAssignMinutes(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
                <span className="text-slate-400">minutes</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">
                Fiber Cut Resolution SLA
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={fiberCutSlaHours}
                  onChange={(e) => setFiberCutSlaHours(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
                <span className="text-slate-400">hours</span>
              </div>
            </div>
          </div>
        </div>

        {/* Save Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-xs font-mono">
            Saves directly to Supabase <code className="text-cyan-300">system_settings</code> (id: &apos;global&apos;) and syncs across all Admin, Dealer &amp; browser sessions.
          </span>
          <button
            type="submit"
            disabled={isSaving || isLoadingSettings}
            className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-60 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/50 flex items-center gap-2 cursor-pointer shrink-0"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>{isSaving ? 'Saving Configuration...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>

      {/* Add MikroTik Router Modal */}
      <AddMikrotikDeviceModal
        isOpen={isAddRouterModalOpen}
        onClose={() => setIsAddRouterModalOpen(false)}
      />

      {/* Delete Router Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteRouterDialogOpen}
        onClose={() => {
          setIsDeleteRouterDialogOpen(false);
          setRouterToDelete(null);
        }}
        onConfirm={async () => {
          if (!routerToDelete) return;
          setIsDeletingRouter(true);
          try {
            await deleteMikrotikRouter(routerToDelete.id);
          } finally {
            setIsDeletingRouter(false);
            setIsDeleteRouterDialogOpen(false);
            setRouterToDelete(null);
          }
        }}
        title="Delete MikroTik Router"
        itemName={routerToDelete ? routerToDelete.name : ''}
        itemType="router"
        description={
          routerToDelete
            ? `Are you sure you want to remove router "${routerToDelete.name}" (${routerToDelete.ipAddress}:${routerToDelete.apiPort})? This deletes the router configuration from PostgreSQL and terminates live polling workers.`
            : undefined
        }
        confirmText="Confirm Delete Router"
        isLoading={isDeletingRouter}
      />
    </div>
  );
};
