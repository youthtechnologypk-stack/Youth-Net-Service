import React from 'react';
import {
  X,
  User,
  Phone,
  Mail,
  MapPin,
  Radio,
  Server,
  CreditCard,
  Layers,
  Send,
  ExternalLink,
  Shield,
  Wifi,
  Activity,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Customer, Invoice } from '../types/isp';
import { useISP } from '../context/ISPContext';
import { ActiveTab } from './Header';

interface CustomerQuickDetailModalProps {
  customer: Customer | null;
  onClose: () => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenPaymentModal?: (invoice: Invoice) => void;
  onOpenReceiptModal?: (invoice: Invoice) => void;
}

export const CustomerQuickDetailModal: React.FC<CustomerQuickDetailModalProps> = ({
  customer,
  onClose,
  onNavigateTab,
  onOpenPaymentModal,
  onOpenReceiptModal,
}) => {
  const { packages, invoices, onus, activeSessions, logWhatsAppNotice } = useISP();

  if (!customer) return null;

  const pkg = packages.find((p) => p.id === customer.packageId);
  const custInvoices = invoices.filter((i) => i.customerId === customer.id);
  const latestInvoice = custInvoices[0];
  const onu = onus.find((o) => o.customerId === customer.id || o.macAddress === customer.macAddress);
  const isOnline = activeSessions.some((s) => s.username === customer.pppoeUsername);

  const handleSendWhatsApp = () => {
    const text =
      `📡 *YOUTH NET FIBER - ACCOUNT NOTICE*\n` +
      `----------------------------------------\n` +
      `Dear *${customer.name}* (Acct: ${customer.accountNumber}),\n` +
      `PPPoE Login: \`${customer.pppoeUsername}\`\n` +
      `Current Plan: ${pkg?.name || 'Standard Package'} (${pkg?.downloadSpeedMbps || 20} Mbps)\n` +
      `Current Balance: $${customer.balanceDue.toFixed(2)}\n` +
      `Status: ${customer.status.toUpperCase()}\n` +
      `Assigned IP: ${customer.assignedIp}\n\n` +
      `For queries or immediate support, reply to this message.\n` +
      `_Youth Net Fiber NOC Team_`;

    logWhatsAppNotice(customer.phone, customer.name, text, 'account_inquiry');
    const cleanPhone = customer.phone.replace(/[^\d+]/g, '').replace('+', '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20 font-bold">
              <User className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">{customer.name}</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold uppercase ${
                    customer.status === 'active'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : customer.status === 'walled_garden'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                  }`}
                >
                  {customer.status.replace('_', ' ')}
                </span>
                {isOnline && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    PPPoE LIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Account: <span className="text-cyan-400">{customer.accountNumber}</span> &bull; Node:{' '}
                {customer.areaNode}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Top Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Assigned IP Address</span>
              <span className="text-cyan-300 font-bold text-sm block mt-0.5">{customer.assignedIp}</span>
              <span className="text-[9px] text-slate-500">MAC: {customer.macAddress}</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Package Plan</span>
              <span className="text-white font-bold text-sm block mt-0.5">{pkg?.name || 'Standard'}</span>
              <span className="text-[9px] text-cyan-400">{pkg?.downloadSpeedMbps || 20} Mbps DL</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Balance Due</span>
              <span
                className={`text-sm font-bold block mt-0.5 ${
                  customer.balanceDue > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                ${customer.balanceDue.toFixed(2)}
              </span>
              <span className="text-[9px] text-slate-500">Bill Cycle: 1st of month</span>
            </div>

            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Fiber Signal (Rx)</span>
              <span
                className={`text-sm font-bold block mt-0.5 ${
                  (onu?.rxPowerDbm || customer.ontSignalDbm || -20) < -27
                    ? 'text-rose-400'
                    : (onu?.rxPowerDbm || customer.ontSignalDbm || -20) < -24
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {onu?.rxPowerDbm ? `${onu.rxPowerDbm} dBm` : customer.ontSignalDbm ? `${customer.ontSignalDbm} dBm` : '-19.4 dBm'}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {onu ? `${onu.ponPort} (ONU #${onu.onuIndex})` : 'Class C+ SFP'}
              </span>
            </div>
          </div>

          {/* Contact & Location Info */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] font-mono flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span>Contact &amp; Physical Installation</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300 font-mono text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px]">Phone (WhatsApp):</span>
                <span className="text-white font-bold">{customer.phone}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Email Address:</span>
                <span className="text-slate-200">{customer.email || 'N/A'}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-slate-500 block text-[10px]">Physical Street Address:</span>
                <span className="text-slate-200">{customer.address}</span>
              </div>
            </div>
          </div>

          {/* Network & PPPoE Credentials */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] font-mono flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>MikroTik PPPoE Authentication</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-[11px]">
              <div>
                <span className="text-slate-500 block text-[10px]">PPPoE Username:</span>
                <span className="text-cyan-300 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 inline-block">
                  {customer.pppoeUsername}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Framed IP:</span>
                <span className="text-white font-bold">{customer.assignedIp}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Installation Date:</span>
                <span className="text-slate-300">{customer.installationDate}</span>
              </div>
            </div>
          </div>

          {/* Recent Invoices Strip */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[11px] font-mono flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                <span>Recent Invoices ({custInvoices.length})</span>
              </h4>
              <button
                onClick={() => {
                  onClose();
                  onNavigateTab('billing');
                }}
                className="text-cyan-400 hover:underline text-[11px] font-mono cursor-pointer"
              >
                View in Billing &rarr;
              </button>
            </div>

            {custInvoices.length === 0 ? (
              <p className="text-slate-500 text-[11px] font-mono">No invoices recorded for this subscriber.</p>
            ) : (
              <div className="space-y-1.5 font-mono">
                {custInvoices.slice(0, 3).map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900 border border-slate-800/80 text-[11px]"
                  >
                    <div>
                      <span className="text-cyan-300 font-bold">{inv.invoiceNumber}</span>
                      <span className="text-slate-400 ml-2">({inv.billingMonth})</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-white font-bold">${inv.totalAmount.toFixed(2)}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          inv.status === 'paid'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {inv.status}
                      </span>
                      {inv.status === 'paid' && onOpenReceiptModal && (
                        <button
                          onClick={() => {
                            onClose();
                            onOpenReceiptModal(inv);
                          }}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded text-[10px] cursor-pointer"
                        >
                          Receipt
                        </button>
                      )}
                      {inv.status !== 'paid' && onOpenPaymentModal && (
                        <button
                          onClick={() => {
                            onClose();
                            onOpenPaymentModal(inv);
                          }}
                          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded text-[10px] cursor-pointer"
                        >
                          Pay
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 bg-slate-950 border-t border-slate-800 font-mono">
          <div className="flex items-center gap-2">
            <button
              onClick={handleSendWhatsApp}
              className="px-3 py-1.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>WhatsApp Notice</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onNavigateTab('mikrotik');
              }}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>MikroTik</span>
            </button>

            <button
              onClick={() => {
                onClose();
                onNavigateTab('olt');
              }}
              className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>OLT Optics</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
