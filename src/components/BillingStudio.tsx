import React, { useState } from 'react';
import {
  CreditCard,
  DollarSign,
  Calendar,
  AlertCircle,
  CheckCircle,
  Clock,
  Printer,
  UserCheck,
  Send,
  Plus,
  TrendingDown,
  RotateCw,
  Search,
  Filter,
  Edit3,
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  ShieldCheck,
  Building,
  UserPlus,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { Invoice, InvoiceStatus, IspExpense, FieldAgent } from '../types/isp';
import { EditInvoiceModal } from './EditInvoiceModal';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import { AgentSalaryModal, SalaryModalMode } from './AgentSalaryModal';
import { ReceiveCashHandoverModal } from './ReceiveCashHandoverModal';
import { AddOrEditAgentModal } from './AddOrEditAgentModal';

interface BillingStudioProps {
  onOpenReceiptModal: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
}

export const BillingStudio: React.FC<BillingStudioProps> = ({
  onOpenReceiptModal,
  onOpenPaymentModal,
}) => {
  const {
    invoices,
    customers,
    agents,
    expenses,
    cashHandovers,
    confirmCashHandover,
    salaryTransactions,
    runMonthlyBillingCron,
    runOverdueScanCron,
    addExpense,
    whatsAppLogs,
  } = useISP();

  const [activeTab, setActiveTab] = useState<'invoices' | 'agents' | 'expenses' | 'whatsapp'>('invoices');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCronRunning, setIsCronRunning] = useState<boolean>(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState<boolean>(false);
  const [selectedInvoiceToEdit, setSelectedInvoiceToEdit] = useState<Invoice | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isCreateInvoiceModalOpen, setIsCreateInvoiceModalOpen] = useState<boolean>(false);

  // Agent Salary & Handover modals state
  const [selectedAgentForSalary, setSelectedAgentForSalary] = useState<FieldAgent | null>(null);
  const [salaryModalMode, setSalaryModalMode] = useState<SalaryModalMode>('disburse_advance');
  const [isSalaryModalOpen, setIsSalaryModalOpen] = useState<boolean>(false);
  const [isReceiveCashModalOpen, setIsReceiveCashModalOpen] = useState<boolean>(false);
  const [receiveCashDefaultAgentId, setReceiveCashDefaultAgentId] = useState<string | undefined>(undefined);
  const [isAddOrEditAgentModalOpen, setIsAddOrEditAgentModalOpen] = useState<boolean>(false);
  const [selectedAgentToManage, setSelectedAgentToManage] = useState<FieldAgent | null>(null);

  // New Expense form state
  const [newExpTitle, setNewExpTitle] = useState('');
  const [newExpAmount, setNewExpAmount] = useState('');
  const [newExpCategory, setNewExpCategory] = useState<IspExpense['category']>('upstream_transit');
  const [newExpPaidTo, setNewExpPaidTo] = useState('');

  const filteredInvoices = invoices.filter((inv) => {
    const matchesStatus = filterStatus === 'all' || inv.status === filterStatus;
    const matchesSearch =
      inv.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.customerPhone.includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  const totalBilled = invoices.reduce((s, i) => s + i.totalAmount, 0);
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0);
  const totalOverdue = invoices.filter((i) => i.status === 'overdue').reduce((s, i) => s + i.totalAmount, 0);
  const totalAgentCashInHand = agents.reduce((s, a) => s + a.cashInHand, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const handleRunBilling = async () => {
    setIsCronRunning(true);
    await runMonthlyBillingCron();
    setTimeout(() => setIsCronRunning(false), 600);
  };

  const handleRunOverdue = async () => {
    setIsCronRunning(true);
    await runOverdueScanCron();
    setTimeout(() => setIsCronRunning(false), 600);
  };

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpTitle || !newExpAmount) return;

    addExpense({
      title: newExpTitle,
      amount: parseFloat(newExpAmount),
      category: newExpCategory,
      date: new Date().toISOString().split('T')[0],
      paidTo: newExpPaidTo || 'Vendor Escrow',
      paymentMode: 'bank_transfer',
      receiptReference: `EXP-REF-${Date.now().toString().slice(-5)}`,
    });

    setNewExpTitle('');
    setNewExpAmount('');
    setShowAddExpenseModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Automated CRON Engine & KPI Strip */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white">
                ISP Billing, Cash Recovery & Ledger
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                Automated CRON Engine
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Monthly invoice generation on 1st, daily overdue isolation via MikroTik API, and WhatsApp receipts.
            </p>
          </div>

          {/* CRON simulation buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRunBilling}
              disabled={isCronRunning}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isCronRunning ? 'animate-spin' : ''}`} />
              <span>Run 1st of Month Invoicing CRON</span>
            </button>

            <button
              onClick={handleRunOverdue}
              disabled={isCronRunning}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Run Overdue Walled Garden Scan</span>
            </button>
          </div>
        </div>

        {/* 4 Financial Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-slate-800 text-xs font-mono">
          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400">Total Billed Invoices</span>
            <div className="text-white font-bold text-base mt-1">${totalBilled.toFixed(2)}</div>
            <span className="text-[10px] text-slate-500 font-sans">{invoices.length} invoices generated</span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400">Recovered Cash & Paid</span>
            <div className="text-emerald-400 font-bold text-base mt-1">${totalPaid.toFixed(2)}</div>
            <span className="text-[10px] text-emerald-500/80 font-sans">
              {Math.round((totalPaid / (totalBilled || 1)) * 100)}% recovery rate
            </span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400">Agent Cash in Hand</span>
            <div className="text-cyan-300 font-bold text-base mt-1">
              ${totalAgentCashInHand.toFixed(2)}
            </div>
            <span className="text-[10px] text-cyan-400 font-sans">Across {agents.length} field collectors</span>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
            <span className="text-slate-400">Total ISP Operating Expenses</span>
            <div className="text-rose-400 font-bold text-base mt-1">
              ${totalExpenses.toFixed(2)}
            </div>
            <span className="text-[10px] text-rose-300/70 font-sans">Transit, fiber & salaries</span>
          </div>
        </div>
      </div>

      {/* Sub Tabs */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-2 rounded-lg">
        <div className="flex space-x-1 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('invoices')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              activeTab === 'invoices'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Invoices ({invoices.length})
          </button>

          <button
            onClick={() => setActiveTab('agents')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              activeTab === 'agents'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Agent Cash Recovery ({agents.length})
          </button>

          <button
            onClick={() => setActiveTab('expenses')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              activeTab === 'expenses'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ISP Expenses ({expenses.length})
          </button>

          <button
            onClick={() => setActiveTab('whatsapp')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
              activeTab === 'whatsapp'
                ? 'bg-slate-800 text-cyan-400 border border-cyan-600/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            WhatsApp Logs ({whatsAppLogs.length})
          </button>
        </div>

        {activeTab === 'invoices' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setIsCreateInvoiceModalOpen(true)}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-3 py-1.5 rounded-md text-xs transition shadow-sm whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Create Invoice</span>
            </button>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-300 text-xs px-2.5 py-1.5 rounded-md focus:outline-none"
            >
              <option value="all">All Invoices</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>

            <input
              type="text"
              placeholder="Search invoice or subscriber..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-slate-300 text-xs px-3 py-1.5 rounded-md focus:outline-none focus:border-cyan-500 font-mono w-48"
            />
          </div>
        )}
      </div>

      {/* TAB 1: Invoices Table */}
      {activeTab === 'invoices' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Subscriber</th>
                  <th className="py-3 px-4">Package</th>
                  <th className="py-3 px-4">Base + Tax</th>
                  <th className="py-3 px-4">Total Amount</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-800/50 transition">
                    <td className="py-3 px-4 font-bold text-slate-100">{inv.invoiceNumber}</td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200">{inv.customerName}</div>
                      <div className="text-[11px] text-slate-400 font-sans">{inv.customerPhone}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{inv.packageName}</td>
                    <td className="py-3 px-4 text-slate-400">
                      ${inv.baseAmount.toFixed(2)} + ${inv.taxAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-bold text-cyan-300">
                      ${inv.totalAmount.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          inv.status === 'paid'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : inv.status === 'overdue'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">{inv.dueDate}</td>
                    <td className="py-3 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setSelectedInvoiceToEdit(inv);
                            setIsEditModalOpen(true);
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white border border-slate-700 px-2.5 py-1 rounded text-[11px] flex items-center gap-1 transition"
                          title="Edit Invoice Details"
                        >
                          <Edit3 className="w-3 h-3 text-indigo-400" />
                          <span>Edit</span>
                        </button>

                        {inv.status !== 'paid' ? (
                          <button
                            onClick={() => onOpenPaymentModal(inv)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold px-2.5 py-1 rounded text-[11px] transition shadow-sm"
                          >
                            Collect Cash
                          </button>
                        ) : (
                          <button
                            onClick={() => onOpenReceiptModal(inv)}
                            className="bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 px-2.5 py-1 rounded text-[11px] flex items-center gap-1 transition"
                          >
                            <Printer className="w-3 h-3" />
                            <span>Receipt</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Field Agent Cash Recovery & Salary Management System */}
      {activeTab === 'agents' && (
        <div className="space-y-6">
          {/* Header Banner & Add Agent Action */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Field Recovery & Area Support Team</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-semibold">
                  {agents.length} Enrolled Agents
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Onboard field personnel, assign collection sectors, monitor live physical cash-in-hand, and oversee salary advances.
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedAgentToManage(null);
                setIsAddOrEditAgentModalOpen(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 shrink-0 cursor-pointer active:scale-95"
            >
              <UserPlus className="w-4 h-4" />
              <span>+ Add New Agent</span>
            </button>
          </div>

          {/* Agent Cards Grid with Salaries & Advances */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {agents.map((agent) => {
              const outstandingAdvance = Math.max(0, agent.advanceSalaryTaken - agent.advanceSalaryReturned);
              const netSalary = Math.max(0, agent.baseSalary - outstandingAdvance);

              return (
                <div
                  key={agent.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-lg hover:border-slate-700 transition flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400 font-bold">
                          {agent.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-bold text-white text-sm">{agent.name}</h4>
                          <span className="text-xs text-slate-400">{agent.assignedArea}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase font-mono">
                          {agent.status.replace('_', ' ')}
                        </span>
                        <button
                          onClick={() => {
                            setSelectedAgentToManage(agent);
                            setIsAddOrEditAgentModalOpen(true);
                          }}
                          className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-cyan-300 border border-slate-700 transition cursor-pointer"
                          title="Manage & Edit Agent Profile"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Cash in Hand Snapshot */}
                    <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-2 font-mono text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Cash-in-Hand:</span>
                        <span className="text-cyan-300 font-bold text-sm">
                          ${agent.cashInHand.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Collected Today:</span>
                        <span className="text-emerald-400 font-semibold">
                          ${agent.totalCollectedToday.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Assigned Tickets:</span>
                        <span className="text-slate-200">{agent.activeTicketsAssigned} tickets</span>
                      </div>
                    </div>

                    {/* Salary & Advances Breakdown Box */}
                    <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800 space-y-1.5 font-mono text-[11px]">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 flex items-center gap-1 font-sans">
                          <span>Base Salary:</span>
                          <button
                            onClick={() => {
                              setSelectedAgentForSalary(agent);
                              setSalaryModalMode('edit_salary');
                              setIsSalaryModalOpen(true);
                            }}
                            className="text-slate-500 hover:text-cyan-400 p-0.5"
                            title="Edit Base Salary"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        </span>
                        <span className="text-white font-bold">${agent.baseSalary.toFixed(2)}/mo</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Advance Taken:</span>
                        <span className="text-amber-400 font-semibold">${agent.advanceSalaryTaken.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">Advance Repaid:</span>
                        <span className="text-cyan-400 font-semibold">${agent.advanceSalaryReturned.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-slate-800">
                        <span className="text-slate-300 font-semibold">Outstanding Advance:</span>
                        <span className={`font-bold ${outstandingAdvance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          ${outstandingAdvance.toFixed(2)}
                        </span>
                      </div>

                      <div className="flex justify-between items-center pt-1 border-t border-slate-800/80 bg-slate-900/60 p-1.5 rounded">
                        <span className="text-slate-200 font-sans font-bold">Net Salary Payable:</span>
                        <span className="text-emerald-400 font-bold text-xs">
                          ${netSalary.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Agent Action Buttons */}
                  <div className="space-y-2 pt-2 border-t border-slate-800/80">
                    <button
                      onClick={() => {
                        setReceiveCashDefaultAgentId(agent.id);
                        setIsReceiveCashModalOpen(true);
                      }}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs py-2 rounded-lg transition shadow-sm flex items-center justify-center gap-1.5"
                    >
                      <Building className="w-3.5 h-3.5" />
                      <span>Accept Cash Handover (${agent.cashInHand.toFixed(2)})</span>
                    </button>

                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => {
                          setSelectedAgentForSalary(agent);
                          setSalaryModalMode('disburse_advance');
                          setIsSalaryModalOpen(true);
                        }}
                        className="bg-slate-950 hover:bg-amber-950/40 text-amber-300 border border-amber-800/60 text-[10px] font-bold py-1.5 rounded transition flex items-center justify-center gap-1"
                        title="Disburse Advance Salary"
                      >
                        <ArrowUpRight className="w-3 h-3 text-amber-400" />
                        <span>+ Advance</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedAgentForSalary(agent);
                          setSalaryModalMode('return_advance');
                          setIsSalaryModalOpen(true);
                        }}
                        className="bg-slate-950 hover:bg-cyan-950/40 text-cyan-300 border border-cyan-800/60 text-[10px] font-bold py-1.5 rounded transition flex items-center justify-center gap-1"
                        title="Record Advance Repayment / Return"
                      >
                        <ArrowDownLeft className="w-3 h-3 text-cyan-400" />
                        <span>↩ Return</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedAgentForSalary(agent);
                          setSalaryModalMode('pay_salary');
                          setIsSalaryModalOpen(true);
                        }}
                        className="bg-slate-950 hover:bg-emerald-950/40 text-emerald-300 border border-emerald-800/60 text-[10px] font-bold py-1.5 rounded transition flex items-center justify-center gap-1"
                        title="Disburse Monthly Net Salary"
                      >
                        <Wallet className="w-3 h-3 text-emerald-400" />
                        <span>💵 Salary</span>
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedAgentToManage(agent);
                        setIsAddOrEditAgentModalOpen(true);
                      }}
                      className="w-full bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-[11px] font-semibold py-1.5 rounded transition flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3 h-3 text-cyan-400" />
                      <span>Manage Profile & Sector</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* SECTION A: Cash Handovers to Boss Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>🤝 Field Cash Handovers & Boss Verification Desk</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                    {cashHandovers.length} Records
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Verify and confirm physical cash handovers deposited by field recovery agents into the company vault.
                </p>
              </div>

              <button
                onClick={() => {
                  setReceiveCashDefaultAgentId(undefined);
                  setIsReceiveCashModalOpen(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Receive Cash from Agent</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Handover #</th>
                    <th className="py-3 px-4">Field Agent</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Receiver Desk</th>
                    <th className="py-3 px-4">Submission Time</th>
                    <th className="py-3 px-4">Notes</th>
                    <th className="py-3 px-4 text-right">Verification & Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {cashHandovers.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-800/50 transition">
                      <td className="py-3 px-4 font-bold text-emerald-400">{h.handoverNumber}</td>
                      <td className="py-3 px-4 font-sans font-semibold text-white">{h.agentName}</td>
                      <td className="py-3 px-4 font-bold text-cyan-300 text-sm">${h.amount.toFixed(2)}</td>
                      <td className="py-3 px-4 text-slate-300 font-sans">{h.receiver}</td>
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {new Date(h.timestamp).toLocaleDateString()} {new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3 px-4 text-slate-400 font-sans text-[11px]">{h.notes || '-'}</td>
                      <td className="py-3 px-4 text-right">
                        {h.status === 'pending' ? (
                          <button
                            onClick={() => confirmCashHandover(h.id)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold px-3 py-1 rounded-md text-[11px] flex items-center gap-1 shadow-sm transition ml-auto"
                            title="Verify and confirm amount received into vault"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Confirm Receipt</span>
                          </button>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono uppercase font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>Confirmed</span>
                            </span>
                            <span className="text-[10px] text-slate-400 font-sans mt-0.5">
                              {h.confirmedBy || 'Boss / Admin'}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* SECTION B: Agent Salaries, Advances & Return Ledger */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>💼 Agent Salaries, Advances & Return Ledger</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                    {salaryTransactions.length} Transactions
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Comprehensive audit ledger tracking monthly base salaries, advance salary disbursements, and advance returns.
                </p>
              </div>

              {/* Summary Badges */}
              <div className="flex items-center gap-2 font-mono text-xs">
                <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Base Payroll:</span>
                  <span className="text-white font-bold">
                    ${agents.reduce((s, a) => s + a.baseSalary, 0).toFixed(2)}/mo
                  </span>
                </div>
                <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Outstanding Advances:</span>
                  <span className="text-amber-400 font-bold">
                    ${agents.reduce((s, a) => s + Math.max(0, a.advanceSalaryTaken - a.advanceSalaryReturned), 0).toFixed(2)}
                  </span>
                </div>
                <div className="bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px] block">Advances Repaid:</span>
                  <span className="text-cyan-400 font-bold">
                    ${agents.reduce((s, a) => s + a.advanceSalaryReturned, 0).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Transaction #</th>
                    <th className="py-3 px-4">Field Agent</th>
                    <th className="py-3 px-4">Transaction Type</th>
                    <th className="py-3 px-4">Amount</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Notes & Purpose</th>
                    <th className="py-3 px-4 text-right">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {salaryTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/50 transition">
                      <td className="py-3 px-4 font-bold text-slate-200">{tx.transactionNumber}</td>
                      <td className="py-3 px-4 font-sans font-semibold text-white">{tx.agentName}</td>
                      <td className="py-3 px-4">
                        {tx.type === 'advance_disbursed' && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-sans font-semibold flex items-center gap-1 w-max">
                            <ArrowUpRight className="w-3 h-3" />
                            Advance Disbursed
                          </span>
                        )}
                        {tx.type === 'advance_returned' && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 font-sans font-semibold flex items-center gap-1 w-max">
                            <ArrowDownLeft className="w-3 h-3" />
                            Advance Return
                          </span>
                        )}
                        {tx.type === 'salary_paid' && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-sans font-semibold flex items-center gap-1 w-max">
                            <Wallet className="w-3 h-3" />
                            Salary Paid
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-bold text-sm">
                        <span className={
                          tx.type === 'advance_disbursed' ? 'text-amber-400' :
                          tx.type === 'advance_returned' ? 'text-cyan-400' :
                          'text-emerald-400'
                        }>
                          {tx.type === 'advance_disbursed' ? `-$${tx.amount.toFixed(2)}` :
                           tx.type === 'advance_returned' ? `+$${tx.amount.toFixed(2)}` :
                           `$${tx.amount.toFixed(2)}`}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400 uppercase text-[10px]">
                        {tx.paymentMethod.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-slate-400">{tx.date}</td>
                      <td className="py-3 px-4 text-slate-400 font-sans text-[11px] max-w-xs truncate">{tx.notes}</td>
                      <td className="py-3 px-4 text-right text-slate-300 font-sans text-[11px]">{tx.recordedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ISP Operating Expenses */}
      {activeTab === 'expenses' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg space-y-4">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">ISP Operating Expense Ledger</h3>
              <p className="text-xs text-slate-400">
                Track upstream IP transit commits, metro dark fiber leases, generator diesel, and payroll.
              </p>
            </div>
            <button
              onClick={() => setShowAddExpenseModal(true)}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs px-3 py-1.5 rounded transition flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Record Expense</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Title & Details</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Paid To</th>
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-800/50 transition">
                    <td className="py-3 px-4 font-semibold text-slate-100">{exp.title}</td>
                    <td className="py-3 px-4 capitalize font-sans">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px]">
                        {exp.category.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400">{exp.date}</td>
                    <td className="py-3 px-4 text-slate-300">{exp.paidTo}</td>
                    <td className="py-3 px-4 text-slate-400">{exp.receiptReference}</td>
                    <td className="py-3 px-4 text-right font-bold text-rose-400 text-sm">
                      ${exp.amount.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: WhatsApp Notification Logs */}
      {activeTab === 'whatsapp' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-slate-800">
            <h3 className="text-sm font-bold text-white">
              WhatsApp Cloud API Automated Notifications
            </h3>
            <p className="text-xs text-slate-400">
              Dispatched 1st of month billing statements, payment receipts, and overdue suspension alerts.
            </p>
          </div>

          <div className="divide-y divide-slate-800 text-xs">
            {whatsAppLogs.map((log) => (
              <div key={log.id} className="p-4 hover:bg-slate-800/40 transition space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-200">{log.recipientName}</span>
                    <span className="text-slate-400 font-mono text-[11px]">({log.recipientPhone})</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
                      {log.templateName}
                    </span>
                  </div>
                  <span className="text-slate-500 font-mono text-[11px]">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="bg-slate-950 p-2.5 rounded border border-slate-800/80 text-slate-300 whitespace-pre-wrap font-sans text-xs">
                  {log.messageBody}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Expense Modal */}
      {showAddExpenseModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-base font-bold text-white">Record Operating Expense</h3>
            <form onSubmit={handleCreateExpense} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Expense Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Splicing Machine Electrodes Replacement"
                  value={newExpTitle}
                  onChange={(e) => setNewExpTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Category</label>
                <select
                  value={newExpCategory}
                  onChange={(e) => setNewExpCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
                >
                  <option value="upstream_transit">Upstream IP Transit Commit</option>
                  <option value="dark_fiber_lease">Metro Dark Fiber Lease</option>
                  <option value="staff_salaries">Staff / Splicer Payroll</option>
                  <option value="generator_diesel">Generator Fuel / Power Backup</option>
                  <option value="hardware_maintenance">Hardware & OLT Maintenance</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Amount ($ USD)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="250.00"
                  value={newExpAmount}
                  onChange={(e) => setNewExpAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Paid To / Vendor</label>
                <input
                  type="text"
                  placeholder="Vendor Name"
                  value={newExpPaidTo}
                  onChange={(e) => setNewExpPaidTo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddExpenseModal(false)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Invoice Modal */}
      <EditInvoiceModal
        invoice={selectedInvoiceToEdit}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedInvoiceToEdit(null);
        }}
      />

      {/* Create Invoice Modal */}
      <CreateInvoiceModal
        isOpen={isCreateInvoiceModalOpen}
        onClose={() => setIsCreateInvoiceModalOpen(false)}
      />

      {/* Agent Salary & Advance Modal */}
      <AgentSalaryModal
        agent={selectedAgentForSalary}
        mode={salaryModalMode}
        isOpen={isSalaryModalOpen}
        onClose={() => {
          setIsSalaryModalOpen(false);
          setSelectedAgentForSalary(null);
        }}
      />

      {/* Receive & Confirm Cash Handover Modal */}
      <ReceiveCashHandoverModal
        isOpen={isReceiveCashModalOpen}
        defaultAgentId={receiveCashDefaultAgentId}
        onClose={() => {
          setIsReceiveCashModalOpen(false);
          setReceiveCashDefaultAgentId(undefined);
        }}
      />

      {/* Add or Edit Field Recovery Agent Modal */}
      <AddOrEditAgentModal
        isOpen={isAddOrEditAgentModalOpen}
        onClose={() => {
          setIsAddOrEditAgentModalOpen(false);
          setSelectedAgentToManage(null);
        }}
        agentToEdit={selectedAgentToManage}
      />
    </div>
  );
};
