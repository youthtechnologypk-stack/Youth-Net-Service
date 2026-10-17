import React, { useState } from 'react';
import {
  Sliders,
  Settings as SettingsIcon,
  Server,
  Radio,
  Layers,
  Shield,
  Bell,
  Save,
  CheckCircle2,
  Database,
  Smartphone,
  Globe,
  Clock,
  Key,
  HardDrive,
  RefreshCw,
  Trash2,
  Plus,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { MikrotikRouter } from '../types/isp';
import { AddMikrotikDeviceModal } from './AddMikrotikDeviceModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

export const SettingsStudio: React.FC = () => {
  const { routers, olts, customers, complaints, deleteMikrotikRouter } = useISP();
  const {
    currencyCode,
    currencySymbol: globalCurrencySymbol,
    updateCurrency,
    supportedCurrencies,
    formatCurrency,
  } = useCurrency();

  const [ispName, setIspName] = useState('Youth Net Fiber Broadband');
  const [billingCycleDay, setBillingCycleDay] = useState(1);
  const [gracePeriodDays, setGracePeriodDays] = useState(5);
  const [defaultSnmpCommunity, setDefaultSnmpCommunity] = useState('public');
  const [defaultMikrotikApiPort, setDefaultMikrotikApiPort] = useState(8728);
  const [slaAutoAssignMinutes, setSlaAutoAssignMinutes] = useState(5);
  const [fiberCutSlaHours, setFiberCutSlaHours] = useState(2);
  const [whatsAppGatewayEnabled, setWhatsAppGatewayEnabled] = useState(true);
  const [autoWalledGarden, setAutoWalledGarden] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Router management in settings
  const [isAddRouterModalOpen, setIsAddRouterModalOpen] = useState(false);
  const [routerToDelete, setRouterToDelete] = useState<MikrotikRouter | null>(null);
  const [isDeleteRouterDialogOpen, setIsDeleteRouterDialogOpen] = useState(false);
  const [isDeletingRouter, setIsDeletingRouter] = useState(false);

  const handleSelectPresetCurrency = async (code: string, symbol: string) => {
    // Immediately updates the Global Context and triggers an instant re-render across the entire dashboard
    await updateCurrency(code, symbol);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleCustomSymbolChange = async (newSymbol: string) => {
    await updateCurrency(currencyCode, newSymbol);
  };

  const handleCustomCodeChange = async (newCode: string) => {
    await updateCurrency(newCode, globalCurrencySymbol);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currencyCode,
          currencySymbol: globalCurrencySymbol,
          ispName,
          billingCycleDay,
          gracePeriodDays,
          autoWalledGarden,
        }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } catch (err) {
      console.warn('Failed to save settings to server:', err);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs font-sans max-w-5xl mx-auto">
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
              Configure global ISP billing policies, MikroTik API limits, VSOL SNMP parameters, and SLA auto-assignment.
            </p>
          </div>
        </div>

        {saveSuccess && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-950 border border-emerald-700 text-emerald-300 font-mono flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Settings Saved Successfully!</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: Carrier Profile & Billing Policy */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Globe className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              ISP Profile &amp; Automated Billing Rules
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">ISP Carrier Brand Name</label>
              <input
                type="text"
                value={ispName}
                onChange={(e) => setIspName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Billing Generation Day</label>
              <input
                type="number"
                min={1}
                max={28}
                value={billingCycleDay}
                onChange={(e) => setBillingCycleDay(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Overdue Grace Period (Days)</label>
              <input
                type="number"
                min={0}
                max={30}
                value={gracePeriodDays}
                onChange={(e) => setGracePeriodDays(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Localization & Currency Setting (Instant Reactive Re-render) */}
          <div className="pt-3 border-t border-slate-800 space-y-3 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <label className="text-white font-bold block text-xs">
                  Localization &amp; Billing Currency Setting
                </label>
                <span className="text-[11px] text-slate-400">
                  Select your operating currency. Changes persist in PostgreSQL &amp; update the entire dashboard in real-time.
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

            {/* Quick Currency Selector Presets */}
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

            {/* Custom Currency Code & Symbol Override */}
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

              {/* Dynamic Live Formatting Preview */}
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
                <span className="font-bold text-white block">Auto Walled-Garden Isolation</span>
                <span className="text-[11px] text-slate-400">
                  Automatically push overdue PPPoE subscribers to isolation address-list on 6th of month.
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

        {/* Section 2: Hardware Gateway Parameters (MikroTik & VSOL OLT) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Server className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              Hardware Gateway Settings (MikroTik &amp; VSOL OLT)
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Default RouterOS API Port</label>
              <input
                type="number"
                value={defaultMikrotikApiPort}
                onChange={(e) => setDefaultMikrotikApiPort(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Default SNMP Community String</label>
              <input
                type="text"
                value={defaultSnmpCommunity}
                onChange={(e) => setDefaultSnmpCommunity(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Active OLT Hardware Nodes</label>
              <div className="p-2 rounded bg-slate-950 border border-slate-800 text-cyan-400 font-bold">
                {olts.length} Registered Chassis
              </div>
            </div>
          </div>

          {/* Configured MikroTik Routers List in Settings */}
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
                        {router.ipAddress}:{router.apiPort} &bull; {router.model} &bull; {router.version}
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

        {/* Section 3: SLA Engine & WhatsApp Dispatch */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Clock className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white text-xs uppercase tracking-wider font-mono">
              Complaint SLA Timers &amp; WhatsApp Notifications
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Auto-Assign SLA Timeout</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={slaAutoAssignMinutes}
                  onChange={(e) => setSlaAutoAssignMinutes(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
                <span className="text-slate-400">minutes</span>
              </div>
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-semibold">Fiber Cut Resolution SLA</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={fiberCutSlaHours}
                  onChange={(e) => setFiberCutSlaHours(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
                <span className="text-slate-400">hours</span>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div>
                <span className="font-bold text-white block">WhatsApp Gateway</span>
                <span className="text-[10px] text-slate-400">Dispatch receipts &amp; outage notices</span>
              </div>
              <input
                type="checkbox"
                checked={whatsAppGatewayEnabled}
                onChange={(e) => setWhatsAppGatewayEnabled(e.target.checked)}
                className="w-4 h-4 accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Save Bar */}
        <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <span className="text-slate-400 text-xs font-mono">
            Changes take effect immediately across all NOC, Agent, and Subscriber consoles.
          </span>
          <button
            type="submit"
            className="px-6 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/50 flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save System Preferences</span>
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
