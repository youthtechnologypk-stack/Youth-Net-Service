import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  X,
  User,
  CreditCard,
  Radio,
  Layers,
  ArrowRight,
  ExternalLink,
  Shield,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { Customer, Invoice, ActiveSession } from '../types/isp';
import { OnuDevice } from '../types/olt';
import { ActiveTab } from './Header';
import { CustomerQuickDetailModal } from './CustomerQuickDetailModal';

interface GlobalSearchBarProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenPaymentModal?: (invoice: Invoice) => void;
  onOpenReceiptModal?: (invoice: Invoice) => void;
  className?: string;
}

export const GlobalSearchBar: React.FC<GlobalSearchBarProps> = ({
  onNavigateTab,
  onOpenPaymentModal,
  onOpenReceiptModal,
  className = '',
}) => {
  const { customers, invoices, activeSessions, onus, packages } = useISP();

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'customers' | 'invoices' | 'sessions'>('all');

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Global Ctrl+K / Cmd+K shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      } else if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter Data
  const cleanQ = query.trim().toLowerCase();

  const matchingCustomers: Customer[] = cleanQ
    ? customers.filter((c) => {
        return (
          c.name.toLowerCase().includes(cleanQ) ||
          c.assignedIp.toLowerCase().includes(cleanQ) ||
          c.pppoeUsername.toLowerCase().includes(cleanQ) ||
          c.accountNumber.toLowerCase().includes(cleanQ) ||
          c.phone.toLowerCase().includes(cleanQ) ||
          c.macAddress.toLowerCase().includes(cleanQ) ||
          c.areaNode.toLowerCase().includes(cleanQ)
        );
      })
    : [];

  const matchingInvoices: Invoice[] = cleanQ
    ? invoices.filter((inv) => {
        return (
          inv.invoiceNumber.toLowerCase().includes(cleanQ) ||
          inv.customerName.toLowerCase().includes(cleanQ) ||
          inv.billingMonth.toLowerCase().includes(cleanQ) ||
          (inv.receiptNumber && inv.receiptNumber.toLowerCase().includes(cleanQ))
        );
      })
    : [];

  const matchingSessions: ActiveSession[] = cleanQ
    ? activeSessions.filter((s) => {
        return (
          s.username.toLowerCase().includes(cleanQ) ||
          s.address.toLowerCase().includes(cleanQ) ||
          s.callerId.toLowerCase().includes(cleanQ)
        );
      })
    : [];

  const totalResults =
    matchingCustomers.length + matchingInvoices.length + matchingSessions.length;

  const handleCustomerClick = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsOpen(false);
  };

  const handleInvoiceClick = (invoice: Invoice) => {
    setIsOpen(false);
    if (invoice.status === 'paid' && onOpenReceiptModal) {
      onOpenReceiptModal(invoice);
    } else if (invoice.status !== 'paid' && onOpenPaymentModal) {
      onOpenPaymentModal(invoice);
    } else {
      onNavigateTab('billing');
    }
  };

  const handleSessionClick = () => {
    setIsOpen(false);
    onNavigateTab('mikrotik');
  };

  return (
    <>
      <div ref={containerRef} className={`relative ${className}`}>
        {/* Search Input Bar */}
        <div className="relative flex items-center">
          <div className="absolute left-3 pointer-events-none text-slate-400">
            <Search className="w-4 h-4 text-cyan-400" />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            placeholder="Search by name, IP (192.168...), or invoice # (Ctrl+K)..."
            className="w-full sm:w-64 md:w-80 lg:w-96 bg-slate-950/90 border border-slate-700/80 hover:border-cyan-500/50 focus:border-cyan-500 rounded-xl pl-9 pr-14 py-1.5 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 font-mono transition shadow-inner"
          />

          {/* Right Action Icons: Keyboard Shortcut / Clear */}
          <div className="absolute right-2.5 flex items-center gap-1">
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                className="p-1 text-slate-400 hover:text-white rounded transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-800/80 border border-slate-700 rounded shadow-sm select-none">
                <span className="text-[11px]">⌘</span>K
              </kbd>
            )}
          </div>
        </div>

        {/* Live Search Floating Results Dropdown */}
        {isOpen && query.trim() !== '' && (
          <div className="absolute top-full left-0 right-0 sm:right-auto sm:w-[480px] md:w-[540px] mt-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[80vh] animate-fade-in font-sans">
            {/* Filter Tabs Header */}
            <div className="p-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-[11px] ${
                    activeFilter === 'all'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'text-slate-400 hover:text-white bg-slate-900'
                  }`}
                >
                  All ({totalResults})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('customers')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-[11px] ${
                    activeFilter === 'customers'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'text-slate-400 hover:text-white bg-slate-900'
                  }`}
                >
                  Customers ({matchingCustomers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('invoices')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-[11px] ${
                    activeFilter === 'invoices'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'text-slate-400 hover:text-white bg-slate-900'
                  }`}
                >
                  Invoices ({matchingInvoices.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveFilter('sessions')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition cursor-pointer text-[11px] ${
                    activeFilter === 'sessions'
                      ? 'bg-cyan-600 text-slate-950'
                      : 'text-slate-400 hover:text-white bg-slate-900'
                  }`}
                >
                  Live IPs ({matchingSessions.length})
                </button>
              </div>

              <span className="text-[10px] text-slate-400">Esc to close</span>
            </div>

            {/* Scrollable Results List */}
            <div className="overflow-y-auto p-3 space-y-3.5 text-xs font-mono max-h-[60vh] scrollbar-thin scrollbar-thumb-slate-800">
              {totalResults === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  <Search className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                  <p className="font-bold text-slate-300">No matching records found</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Try searching by subscriber name, IP address (e.g. 192.168...), or invoice # (INV-...)
                  </p>
                </div>
              ) : (
                <>
                  {/* Category 1: Customers */}
                  {(activeFilter === 'all' || activeFilter === 'customers') &&
                    matchingCustomers.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-cyan-400">
                            <User className="w-3.5 h-3.5" />
                            <span>Subscribers &amp; Customers ({matchingCustomers.length})</span>
                          </span>
                        </div>

                        <div className="space-y-1">
                          {matchingCustomers.slice(0, 5).map((cust) => {
                            const isLive = activeSessions.some(
                              (s) => s.username === cust.pppoeUsername
                            );

                            return (
                              <div
                                key={cust.id}
                                onClick={() => handleCustomerClick(cust)}
                                className="p-2.5 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800/80 hover:border-cyan-500/50 transition cursor-pointer flex items-center justify-between gap-3 group"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className="w-8 h-8 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800 flex items-center justify-center font-bold text-xs shrink-0">
                                    {cust.name.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="truncate">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-white text-xs truncate group-hover:text-cyan-300 transition">
                                        {cust.name}
                                      </span>
                                      <span
                                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                          cust.status === 'active'
                                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                            : cust.status === 'walled_garden'
                                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                                        }`}
                                      >
                                        {cust.status.replace('_', ' ')}
                                      </span>
                                      {isLive && (
                                        <span className="text-[8px] px-1 rounded bg-cyan-950 text-cyan-300 font-bold border border-cyan-800">
                                          ONLINE
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                      <span className="text-cyan-400 font-bold">
                                        IP: {cust.assignedIp}
                                      </span>
                                      <span>&bull;</span>
                                      <span>Login: {cust.pppoeUsername}</span>
                                      <span>&bull;</span>
                                      <span className="text-slate-500">{cust.areaNode}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right shrink-0 flex items-center gap-2">
                                  <div>
                                    <span
                                      className={`text-xs font-bold block ${
                                        cust.balanceDue > 0 ? 'text-rose-400' : 'text-emerald-400'
                                      }`}
                                    >
                                      ${cust.balanceDue.toFixed(2)}
                                    </span>
                                    <span className="text-[9px] text-slate-500">
                                      {cust.balanceDue > 0 ? 'Due' : 'Paid'}
                                    </span>
                                  </div>
                                  <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition" />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                  {/* Category 2: Invoices */}
                  {(activeFilter === 'all' || activeFilter === 'invoices') &&
                    matchingInvoices.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-indigo-400">
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Billing Invoices ({matchingInvoices.length})</span>
                          </span>
                        </div>

                        <div className="space-y-1">
                          {matchingInvoices.slice(0, 5).map((inv) => (
                            <div
                              key={inv.id}
                              onClick={() => handleInvoiceClick(inv)}
                              className="p-2.5 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800/80 hover:border-indigo-500/50 transition cursor-pointer flex items-center justify-between gap-3 group"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800 flex items-center justify-center shrink-0">
                                  <CreditCard className="w-4 h-4" />
                                </div>
                                <div className="truncate">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-cyan-300 text-xs group-hover:underline">
                                      {inv.invoiceNumber}
                                    </span>
                                    <span className="text-white text-xs font-semibold truncate">
                                      {inv.customerName}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                    <span>Month: {inv.billingMonth}</span>
                                    <span>&bull;</span>
                                    <span>Due: {inv.dueDate}</span>
                                    {inv.receiptNumber && (
                                      <>
                                        <span>&bull;</span>
                                        <span className="text-emerald-400">Rcpt: {inv.receiptNumber}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 flex items-center gap-2">
                                <div>
                                  <span className="text-white font-bold text-xs block">
                                    ${inv.totalAmount.toFixed(2)}
                                  </span>
                                  <span
                                    className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                                      inv.status === 'paid'
                                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                        : 'bg-rose-950 text-rose-300 border border-rose-800'
                                    }`}
                                  >
                                    {inv.status}
                                  </span>
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Category 3: Active PPPoE Sessions & Live IPs */}
                  {(activeFilter === 'all' || activeFilter === 'sessions') &&
                    matchingSessions.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1 flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-emerald-400">
                            <Radio className="w-3.5 h-3.5" />
                            <span>Active MikroTik IP Leases ({matchingSessions.length})</span>
                          </span>
                        </div>

                        <div className="space-y-1">
                          {matchingSessions.slice(0, 4).map((sess) => (
                            <div
                              key={sess.id}
                              onClick={handleSessionClick}
                              className="p-2.5 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800/80 hover:border-emerald-500/50 transition cursor-pointer flex items-center justify-between gap-3 group"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center justify-center shrink-0">
                                  <Activity className="w-4 h-4 animate-pulse" />
                                </div>
                                <div className="truncate">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-emerald-300 text-xs">
                                      {sess.address}
                                    </span>
                                    <span className="text-white text-xs font-semibold truncate">
                                      {sess.username}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                    <span>MAC: {sess.callerId}</span>
                                    <span>&bull;</span>
                                    <span>Uptime: {sess.uptime}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="text-right shrink-0 flex items-center gap-2">
                                <span className="text-[10px] text-cyan-400 font-bold group-hover:underline">
                                  MikroTik NOC &rarr;
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </>
              )}
            </div>

            {/* Footer Quick Nav */}
            <div className="p-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span className="flex items-center gap-1 text-slate-500">
                <span>Select result to view subscriber profile or invoice receipt</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateTab('noc');
                }}
                className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Full NOC Dashboard &rarr;</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Customer Quick Detail Modal */}
      <CustomerQuickDetailModal
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
        onNavigateTab={onNavigateTab}
        onOpenPaymentModal={onOpenPaymentModal}
        onOpenReceiptModal={onOpenReceiptModal}
      />
    </>
  );
};
