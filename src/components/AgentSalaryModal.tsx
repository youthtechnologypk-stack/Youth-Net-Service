import React, { useState, useEffect } from 'react';
import { X, DollarSign, ArrowUpRight, ArrowDownLeft, CheckCircle2, ShieldCheck, Wallet, Calendar, FileText } from 'lucide-react';
import { FieldAgent } from '../types/isp';
import { useISP } from '../context/ISPContext';

export type SalaryModalMode = 'disburse_advance' | 'return_advance' | 'pay_salary' | 'edit_salary';

interface AgentSalaryModalProps {
  agent: FieldAgent | null;
  mode: SalaryModalMode;
  isOpen: boolean;
  onClose: () => void;
}

export const AgentSalaryModal: React.FC<AgentSalaryModalProps> = ({
  agent,
  mode,
  isOpen,
  onClose,
}) => {
  const { disburseAdvanceSalary, recordAdvanceReturn, payMonthlySalary, updateAgentSalary } = useISP();

  const [amount, setAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank_transfer' | 'salary_deduction'>('cash');
  const [notes, setNotes] = useState<string>('');
  const [month, setMonth] = useState<string>('September 2026');
  const [deductAdvance, setDeductAdvance] = useState<boolean>(true);
  const [deductFromCashInHand, setDeductFromCashInHand] = useState<boolean>(false);
  const [newBaseSalary, setNewBaseSalary] = useState<number>(agent?.baseSalary || 600);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    setSuccessMessage(null);
    const outstanding = Math.max(0, agent.advanceSalaryTaken - agent.advanceSalaryReturned);

    if (mode === 'disburse_advance') {
      setAmount(100);
      setNotes('Personal emergency / fuel advance');
      setPaymentMethod('cash');
    } else if (mode === 'return_advance') {
      setAmount(outstanding > 0 ? outstanding : 50);
      setNotes('Advance salary repayment installment');
      setPaymentMethod('cash');
    } else if (mode === 'pay_salary') {
      setAmount(Math.max(0, agent.baseSalary - (deductAdvance ? outstanding : 0)));
      setNotes('Monthly field recovery performance payout');
      setPaymentMethod('bank_transfer');
    } else if (mode === 'edit_salary') {
      setNewBaseSalary(agent.baseSalary);
    }
  }, [agent, mode, isOpen, deductAdvance]);

  if (!isOpen || !agent) return null;

  const outstandingAdvance = Math.max(0, agent.advanceSalaryTaken - agent.advanceSalaryReturned);
  const netPayableSalary = Math.max(0, agent.baseSalary - (deductAdvance ? outstandingAdvance : 0));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      if (mode === 'disburse_advance') {
        const res = await disburseAdvanceSalary(
          agent.id,
          amount,
          paymentMethod as 'cash' | 'bank_transfer',
          notes || 'Advance salary disbursed'
        );
        setSuccessMessage(`Advance of $${amount.toFixed(2)} disbursed! Ref: ${res.transactionNumber}`);
      } else if (mode === 'return_advance') {
        const res = await recordAdvanceReturn(
          agent.id,
          amount,
          paymentMethod,
          notes || 'Advance salary returned',
          deductFromCashInHand
        );
        setSuccessMessage(`Advance return of $${amount.toFixed(2)} recorded! Ref: ${res.transactionNumber}`);
      } else if (mode === 'pay_salary') {
        const res = await payMonthlySalary(
          agent.id,
          month,
          deductAdvance,
          paymentMethod as 'cash' | 'bank_transfer',
          notes
        );
        setSuccessMessage(`Salary of $${res.netAmount.toFixed(2)} paid for ${month}! Ref: ${res.transactionNumber}`);
      } else if (mode === 'edit_salary') {
        updateAgentSalary(agent.id, newBaseSalary);
        setSuccessMessage(`Base salary updated to $${newBaseSalary.toFixed(2)}/mo`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${
              mode === 'disburse_advance' ? 'bg-amber-950 border border-amber-800 text-amber-400' :
              mode === 'return_advance' ? 'bg-cyan-950 border border-cyan-800 text-cyan-400' :
              mode === 'pay_salary' ? 'bg-emerald-950 border border-emerald-800 text-emerald-400' :
              'bg-indigo-950 border border-indigo-800 text-indigo-400'
            }`}>
              {mode === 'disburse_advance' && <ArrowUpRight className="w-5 h-5" />}
              {mode === 'return_advance' && <ArrowDownLeft className="w-5 h-5" />}
              {mode === 'pay_salary' && <Wallet className="w-5 h-5" />}
              {mode === 'edit_salary' && <DollarSign className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">
                {mode === 'disburse_advance' && 'Disburse Advance Salary'}
                {mode === 'return_advance' && 'Record Advance Salary Return'}
                {mode === 'pay_salary' && 'Pay Monthly Salary'}
                {mode === 'edit_salary' && 'Configure Agent Base Salary'}
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                Agent: {agent.name} &bull; {agent.assignedArea}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Success View */}
        {successMessage ? (
          <div className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-emerald-950 border border-emerald-600 rounded-full flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-base font-bold text-white">Transaction Recorded!</h4>
              <p className="text-xs text-slate-300 mt-1">{successMessage}</p>
              <p className="text-[11px] text-slate-500 mt-1">
                WhatsApp notification statement sent to {agent.name} ({agent.phone}).
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg text-xs transition"
            >
              Done & Return
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
            {/* Agent Salary Snapshot Card */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Base Monthly Salary:</span>
                <span className="text-white font-bold">${agent.baseSalary.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Advance Taken:</span>
                <span className="text-amber-400 font-bold">${agent.advanceSalaryTaken.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Advance Repaid/Returned:</span>
                <span className="text-cyan-400 font-bold">${agent.advanceSalaryReturned.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-300">Outstanding Advance:</span>
                <span className={`font-bold ${outstandingAdvance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  ${outstandingAdvance.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-300">Current Field Cash in Hand:</span>
                <span className="text-cyan-300 font-bold">${agent.cashInHand.toFixed(2)}</span>
              </div>
            </div>

            {/* MODE 1: Disburse Advance Salary */}
            {mode === 'disburse_advance' && (
              <>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Advance Amount to Disburse ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-mono text-sm p-2 rounded-lg focus:outline-none focus:border-amber-500 font-bold"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">
                    New outstanding advance balance will be: ${(outstandingAdvance + amount).toFixed(2)}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Disbursement Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  >
                    <option value="cash">Office Cash Vault</option>
                    <option value="bank_transfer">Company Bank Transfer / JazzCash</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Purpose / Reason</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Motorcycle repairs & urgent medical advance"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              </>
            )}

            {/* MODE 2: Record Advance Return */}
            {mode === 'return_advance' && (
              <>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-slate-300 font-medium">Return Amount ($)</label>
                    {outstandingAdvance > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(outstandingAdvance)}
                        className="text-[10px] text-cyan-400 hover:underline font-mono"
                      >
                        Return Full (${outstandingAdvance.toFixed(2)})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    max={outstandingAdvance || 9999}
                    required
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono text-sm p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-bold"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">
                    Remaining advance balance will be: ${Math.max(0, outstandingAdvance - amount).toFixed(2)}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Repayment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  >
                    <option value="cash">Direct Cash Handover by Agent</option>
                    <option value="salary_deduction">Deducted from Recovery Collection</option>
                    <option value="bank_transfer">Direct Online Deposit</option>
                  </select>
                </div>

                {agent.cashInHand >= amount && (
                  <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={deductFromCashInHand}
                        onChange={(e) => setDeductFromCashInHand(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0"
                      />
                      <span className="text-[11px]">
                        Also deduct from Agent's current Cash-in-Hand (-${amount.toFixed(2)})
                      </span>
                    </label>
                  </div>
                )}

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Receipt Note</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Returned advance installment in office"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              </>
            )}

            {/* MODE 3: Pay Monthly Salary */}
            {mode === 'pay_salary' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Salary Month</label>
                    <select
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                    >
                      <option value="September 2026">September 2026</option>
                      <option value="August 2026">August 2026</option>
                      <option value="October 2026">October 2026</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Payment Method</label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                    >
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="cash">Office Cash</option>
                    </select>
                  </div>
                </div>

                {outstandingAdvance > 0 && (
                  <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={deductAdvance}
                        onChange={(e) => setDeductAdvance(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                      />
                      <span className="text-[11px] font-semibold text-emerald-400">
                        Automatically Deduct Outstanding Advance (-${outstandingAdvance.toFixed(2)})
                      </span>
                    </label>
                    <p className="text-[10px] text-slate-400 pl-5">
                      Clears the agent's advance balance upon salary disbursement.
                    </p>
                  </div>
                )}

                <div className="bg-slate-950 p-3 rounded-lg border border-emerald-800/80 font-mono text-xs space-y-1.5">
                  <div className="flex justify-between text-slate-400">
                    <span>Base Salary:</span>
                    <span>${agent.baseSalary.toFixed(2)}</span>
                  </div>
                  {deductAdvance && (
                    <div className="flex justify-between text-rose-400">
                      <span>Less Advance Deduction:</span>
                      <span>-${outstandingAdvance.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-white font-bold pt-1 border-t border-slate-800 text-sm">
                    <span>Net Disbursed Salary:</span>
                    <span className="text-emerald-400">${netPayableSalary.toFixed(2)}</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Pay-Slip Remarks</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. Full settlement with complete recovery incentives"
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              </>
            )}

            {/* MODE 4: Edit Base Salary */}
            {mode === 'edit_salary' && (
              <div>
                <label className="block text-slate-300 font-medium mb-1">Monthly Base Salary ($)</label>
                <input
                  type="number"
                  step="10"
                  min="100"
                  required
                  value={newBaseSalary}
                  onChange={(e) => setNewBaseSalary(parseFloat(e.target.value) || 0)}
                  className="w-full bg-slate-950 border border-slate-700 text-white font-mono text-base p-2.5 rounded-lg focus:outline-none focus:border-indigo-500 font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Adjusting base salary updates all monthly payroll projections and future pay-slip calculations.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold transition shadow-sm flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {mode === 'disburse_advance' && 'Disburse Advance'}
                  {mode === 'return_advance' && 'Confirm Advance Return'}
                  {mode === 'pay_salary' && `Disburse Net Salary ($${netPayableSalary.toFixed(2)})`}
                  {mode === 'edit_salary' && 'Save Base Salary'}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
