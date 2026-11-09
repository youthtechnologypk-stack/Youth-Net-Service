import React, { useState, useEffect, useMemo } from 'react';
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  DollarSign,
  Download,
  Printer,
  X,
  User,
  Calendar,
  Layers,
  ChevronDown,
  RefreshCw,
  Users,
} from 'lucide-react';
import { supabase, SupabaseInvoice, SupabasePortalUser } from '../services/supabaseClient';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { SystemRole, UserAccount } from '../types/auth';

export interface BillingViewProps {
  currentRole?: SystemRole;
  currentUser?: UserAccount | null;
  onOpenReceiptModal?: (invoice: any) => void;
}

export const BillingView: React.FC<BillingViewProps> = ({
  currentRole = 'ADMIN',
  currentUser,
  onOpenReceiptModal,
}) => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const { customers, agents } = useISP();

  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'PAID'>('ALL');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Modal States
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState<boolean>(false);
  const [isMarkPaidModalOpen, setIsMarkPaidModalOpen] = useState<boolean>(false);
  const [selectedInvoice, setSelectedInvoice] = useState<SupabaseInvoice | null>(null);
  const [collectingAgentId, setCollectingAgentId] = useState<string>('');
  const [paidPaymentMethod, setPaidPaymentMethod] = useState<string>('Cash Handover');

  // New Invoice Form State
  const [newSubUsername, setNewSubUsername] = useState<string>('');
  const [newAmount, setNewAmount] = useState<number>(2500);
  const [newDueDate, setNewDueDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [newAssignedAgentId, setNewAssignedAgentId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // 1. Fetch Invoices and Agents from Supabase
  const fetchInvoices = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error fetching Supabase invoices:', error);
      } else if (data) {
        setInvoices(data as SupabaseInvoice[]);
      }

      // Also fetch portal_users agents
      const { data: agentUsers } = await supabase
        .from('portal_users')
        .select('*')
        .eq('role', 'AGENT');

      if (agentUsers) {
        setPortalAgents(agentUsers as SupabasePortalUser[]);
      }
    } catch (err) {
      console.warn('Supabase fetch invoices failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();

    // 2. Enable Supabase Realtime Subscriptions
    const channel = supabase
      .channel('public:billing_view_invoices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, (payload) => {
        console.log('[Supabase Realtime] Invoices table change detected:', payload);
        fetchInvoices();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, (payload) => {
        console.log('[Supabase Realtime] Portal users table change detected:', payload);
        fetchInvoices();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // 3. "+ Generate Invoice" Direct Supabase INSERT
  const handleGenerateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubUsername.trim()) {
      alert('Please specify a subscriber username.');
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedAgent = portalAgents.find((a) => a.id === newAssignedAgentId);
      const generatedInvoiceNo = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;

      const newInvoicePayload = {
        invoice_no: generatedInvoiceNo,
        subscriber_username: newSubUsername.trim().toLowerCase(),
        assigned_agent_id: newAssignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        amount: Number(newAmount) || 0,
        due_date: newDueDate,
        status: 'DUE',
        cycle_day: 5,
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('invoices')
        .insert([newInvoicePayload])
        .select()
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      setActionNotice(`Invoice ${generatedInvoiceNo} generated successfully for @${newSubUsername}!`);
      setTimeout(() => setActionNotice(null), 5000);
      setIsGenerateModalOpen(false);
      setNewSubUsername('');
      await fetchInvoices();
    } catch (err: any) {
      alert(`Failed to generate invoice: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. "Mark Paid" Direct Supabase UPDATE & Agent cash_in_hand Increment
  const handleConfirmMarkPaid = async () => {
    if (!selectedInvoice) return;

    setIsSubmitting(true);
    try {
      const invoiceId = selectedInvoice.id;
      const amountPaid = Number(selectedInvoice.amount) || 0;

      // Update invoice in Supabase: status -> 'PAID'
      const { error: invError } = await supabase
        .from('invoices')
        .update({ status: 'PAID', paid_at: new Date().toISOString() })
        .eq('id', invoiceId);

      if (invError) {
        throw new Error(invError.message);
      }

      // Update collecting agent's cash_in_hand in portal_users
      const targetAgentId = collectingAgentId || selectedInvoice.assigned_agent_id;
      if (targetAgentId) {
        const { data: agentRecord } = await supabase
          .from('portal_users')
          .select('id, cash_in_hand, full_name')
          .eq('id', targetAgentId)
          .maybeSingle();

        if (agentRecord) {
          const currentCash = Number(agentRecord.cash_in_hand) || 0;
          const updatedCash = currentCash + amountPaid;

          await supabase
            .from('portal_users')
            .update({ cash_in_hand: updatedCash })
            .eq('id', agentRecord.id);

          setActionNotice(
            `Invoice ${selectedInvoice.invoice_no} marked PAID! ${formatCurrency(amountPaid)} added to ${agentRecord.full_name}'s Cash-in-Hand.`
          );
        } else {
          setActionNotice(`Invoice ${selectedInvoice.invoice_no} marked PAID!`);
        }
      } else {
        setActionNotice(`Invoice ${selectedInvoice.invoice_no} marked PAID!`);
      }

      setTimeout(() => setActionNotice(null), 5000);
      setIsMarkPaidModalOpen(false);
      setSelectedInvoice(null);
      await fetchInvoices();
    } catch (err: any) {
      alert(`Failed to mark invoice as paid: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const matchSearch =
        inv.invoice_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        inv.subscriber_username.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (inv.assigned_agent_name && inv.assigned_agent_name.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === 'PAID'
          ? (inv.status || '').toUpperCase() === 'PAID'
          : (inv.status || '').toUpperCase() !== 'PAID';

      return matchSearch && matchStatus;
    });
  }, [invoices, searchTerm, statusFilter]);

  // Aggregate Metrics
  const totalBilled = invoices.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalPaid = invoices
    .filter((i) => (i.status || '').toUpperCase() === 'PAID')
    .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalDue = invoices
    .filter((i) => (i.status || '').toUpperCase() !== 'PAID')
    .reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  const totalAgentCash = portalAgents.reduce((acc, a) => acc + (Number(a.cash_in_hand) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <CreditCard className="w-6 h-6 text-cyan-400" />
              <span>Billing & Invoices (Supabase PostgreSQL)</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Live PostgreSQL
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Realtime invoice lifecycle, automated collections reconciliation, and field agent cash settlement.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchInvoices}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
            title="Refresh Invoices from Supabase"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsGenerateModalOpen(true)}
            className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-cyan-950/50 cursor-pointer active:scale-95"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>+ Generate Invoice</span>
          </button>
        </div>
      </div>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-3.5 bg-emerald-950/80 border border-emerald-800 rounded-xl text-emerald-300 text-sm flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            className="text-emerald-400 hover:text-white transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>TOTAL BILLED</span>
            <FileText className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-white mt-2 font-mono">{formatCurrency(totalBilled)}</div>
          <div className="text-slate-500 text-xs mt-1">{invoices.length} total generated invoices</div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>COLLECTED REVENUE</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 mt-2 font-mono">{formatCurrency(totalPaid)}</div>
          <div className="text-slate-500 text-xs mt-1">
            {invoices.filter((i) => (i.status || '').toUpperCase() === 'PAID').length} invoices settled
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>UNPAID / OUTSTANDING</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 mt-2 font-mono">{formatCurrency(totalDue)}</div>
          <div className="text-slate-500 text-xs mt-1">
            {invoices.filter((i) => (i.status || '').toUpperCase() !== 'PAID').length} pending collection
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111A2E] border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span>FIELD AGENT CASH-IN-HAND</span>
            <Users className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold text-purple-400 mt-2 font-mono">{formatCurrency(totalAgentCash)}</div>
          <div className="text-slate-500 text-xs mt-1">{portalAgents.length} active field collection agents</div>
        </div>
      </div>

      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-[#111A2E] rounded-xl border border-slate-800">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by Invoice #, subscriber username, or agent..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              statusFilter === 'ALL'
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            All ({invoices.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('DUE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              statusFilter === 'DUE'
                ? 'bg-amber-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Due ({invoices.filter((i) => (i.status || '').toUpperCase() !== 'PAID').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('PAID')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              statusFilter === 'PAID'
                ? 'bg-emerald-600 text-slate-950 font-bold'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Paid ({invoices.filter((i) => (i.status || '').toUpperCase() === 'PAID').length})
          </button>
        </div>
      </div>

      {/* Invoices Table */}
      <div className="rounded-xl border border-slate-800 bg-[#111A2E] overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Subscriber</th>
                <th className="py-3 px-4">Assigned Agent</th>
                <th className="py-3 px-4">Due Date</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <FileText className="w-10 h-10 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="text-base font-semibold text-slate-400">No invoices found</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Click "+ Generate Invoice" to create an invoice in Supabase PostgreSQL.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv) => {
                  const isPaid = (inv.status || '').toUpperCase() === 'PAID';
                  return (
                    <tr key={inv.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-4 font-mono font-semibold text-cyan-400">{inv.invoice_no}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-white">@{inv.subscriber_username}</div>
                        <div className="text-xs text-slate-500">Cycle Day: {inv.cycle_day || 5}th</div>
                      </td>
                      <td className="py-3 px-4">
                        {inv.assigned_agent_name ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-purple-950 text-purple-300 border border-purple-800">
                            <User className="w-3 h-3" />
                            <span>{inv.assigned_agent_name}</span>
                          </span>
                        ) : (
                          <span className="text-slate-500 text-xs italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-mono text-xs">{inv.due_date}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-white text-base">
                        {formatCurrency(Number(inv.amount) || 0)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>PAID</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-950 text-amber-300 border border-amber-800">
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>DUE</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {!isPaid ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedInvoice(inv);
                                setCollectingAgentId(inv.assigned_agent_id || (portalAgents[0]?.id ?? ''));
                                setIsMarkPaidModalOpen(true);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition active:scale-95 shadow cursor-pointer"
                              title="1-Click Mark Paid & Credit Field Agent"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Mark Paid</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onOpenReceiptModal?.(inv)}
                              className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-white border border-slate-700 rounded-lg text-xs flex items-center gap-1 transition cursor-pointer"
                              title="View & Print Official Receipt"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Receipt</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field Agents Cash Overview */}
      <div className="p-4 rounded-xl border border-slate-800 bg-[#111A2E]">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-purple-400" />
          <span>Field Agent Cash Recovery Status (portal_users)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
          {portalAgents.map((ag) => (
            <div key={ag.id} className="p-3 bg-slate-900/80 rounded-lg border border-slate-800">
              <div className="font-semibold text-white text-sm">{ag.full_name}</div>
              <div className="text-xs text-slate-500">@{ag.username} • {ag.area}</div>
              <div className="mt-2 text-lg font-mono font-bold text-emerald-400">
                {formatCurrency(Number(ag.cash_in_hand) || 0)}
              </div>
              <div className="text-[10px] text-slate-500">Cash-in-Hand Balance</div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal: + Generate Invoice */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-cyan-400" />
                <span>+ Generate Invoice (Supabase)</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsGenerateModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGenerateInvoice} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Subscriber Username (PPPoE / Client)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. shahzad or pppoe-user_01"
                  value={newSubUsername}
                  onChange={(e) => setNewSubUsername(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Invoice Amount (PKR)</label>
                <input
                  type="number"
                  required
                  min="0"
                  step="50"
                  value={newAmount}
                  onChange={(e) => setNewAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Due Date</label>
                <input
                  type="date"
                  required
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Assigned Field Recovery Agent</label>
                <select
                  value={newAssignedAgentId}
                  onChange={(e) => setNewAssignedAgentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Unassigned --</option>
                  {portalAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.full_name} ({ag.area})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg text-sm transition shadow-lg shadow-cyan-950/50 flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Inserting...</span>
                    </>
                  ) : (
                    <span>Insert to PostgreSQL</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Mark Paid */}
      {isMarkPaidModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#111A2E] border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Mark Invoice as Paid</span>
              </h2>
              <button
                type="button"
                onClick={() => setIsMarkPaidModalOpen(false)}
                className="text-slate-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mt-4">
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 space-y-1">
                <div className="text-xs text-slate-400">Invoice Number: <span className="text-cyan-400 font-mono font-bold">{selectedInvoice.invoice_no}</span></div>
                <div className="text-xs text-slate-400">Subscriber: <span className="text-white font-semibold">@{selectedInvoice.subscriber_username}</span></div>
                <div className="text-sm text-slate-300">Amount Due: <span className="text-emerald-400 font-mono font-bold">{formatCurrency(Number(selectedInvoice.amount) || 0)}</span></div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Collecting Field Recovery Agent (Credits Cash-in-Hand)
                </label>
                <select
                  value={collectingAgentId}
                  onChange={(e) => setCollectingAgentId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- No Agent Credit (Direct NOC Collection) --</option>
                  {portalAgents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.full_name} ({ag.area})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Selected agent's `cash_in_hand` in Supabase `portal_users` will be credited by {formatCurrency(Number(selectedInvoice.amount) || 0)}.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Payment Method</label>
                <select
                  value={paidPaymentMethod}
                  onChange={(e) => setPaidPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="Cash Handover">Cash Handover</option>
                  <option value="JazzCash">JazzCash</option>
                  <option value="EasyPaisa">EasyPaisa</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsMarkPaidModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmMarkPaid}
                  disabled={isSubmitting}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-sm transition shadow-lg shadow-emerald-950/50 flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <span>Confirm & Mark Paid</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingView;
