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
} from 'lucide-react';
import { useISP } from '../context/ISPContext';

export const SettingsStudio: React.FC = () => {
  const { routers, olts, customers, complaints } = useISP();

  const [ispName, setIspName] = useState('Youth Net Fiber Broadband');
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [billingCycleDay, setBillingCycleDay] = useState(1);
  const [gracePeriodDays, setGracePeriodDays] = useState(5);
  const [defaultSnmpCommunity, setDefaultSnmpCommunity] = useState('public');
  const [defaultMikrotikApiPort, setDefaultMikrotikApiPort] = useState(8728);
  const [slaAutoAssignMinutes, setSlaAutoAssignMinutes] = useState(5);
  const [fiberCutSlaHours, setFiberCutSlaHours] = useState(2);
  const [whatsAppGatewayEnabled, setWhatsAppGatewayEnabled] = useState(true);
  const [autoWalledGarden, setAutoWalledGarden] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3500);
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
              <label className="block text-slate-400 mb-1 font-semibold">Currency Symbol</label>
              <input
                type="text"
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value)}
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

            <div className="sm:col-span-2 flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
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
    </div>
  );
};
