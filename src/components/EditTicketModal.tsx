import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, ShieldCheck, UserCheck, Wrench, Clock } from 'lucide-react';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import { ComplaintTicket } from '../types/isp';

export interface EditTicketModalProps {
  ticket: ComplaintTicket | null;
  isOpen: boolean;
  onClose: () => void;
  onTicketUpdated: () => void;
}

export const EditTicketModal: React.FC<EditTicketModalProps> = ({
  ticket,
  isOpen,
  onClose,
  onTicketUpdated,
}) => {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'>('NORMAL');
  const [status, setStatus] = useState<'OPEN' | 'IN_PROGRESS' | 'RESOLVED'>('OPEN');
  const [assignedAgentId, setAssignedAgentId] = useState<string>('');
  const [assignedAgentName, setAssignedAgentName] = useState<string>('');
  const [agentsList, setAgentsList] = useState<SupabasePortalUser[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch real agents from portal_users
  useEffect(() => {
    if (!isOpen) return;

    const fetchAgents = async () => {
      setIsLoadingAgents(true);
      try {
        const { data, error } = await supabase
          .from('portal_users')
          .select('id, full_name, username, role, area')
          .eq('role', 'AGENT')
          .order('full_name', { ascending: true });

        if (data) {
          setAgentsList(data as SupabasePortalUser[]);
        }
      } catch (err) {
        console.warn('Failed to load agents in EditTicketModal:', err);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    fetchAgents();
  }, [isOpen]);

  // Populate form with ticket values when ticket changes
  useEffect(() => {
    if (ticket) {
      setTitle(ticket.title || ticket.description || '');
      const prio = (ticket.priority || 'NORMAL').toUpperCase();
      if (prio === 'CRITICAL' || prio === 'HIGH' || prio === 'NORMAL' || prio === 'LOW') {
        setPriority(prio as any);
      } else if (prio === 'MEDIUM') {
        setPriority('NORMAL');
      } else {
        setPriority('NORMAL');
      }

      const st = (ticket.status || 'OPEN').toUpperCase();
      if (st === 'RESOLVED') {
        setStatus('RESOLVED');
      } else if (st === 'ASSIGNED' || st === 'IN_PROGRESS') {
        setStatus('IN_PROGRESS');
      } else {
        setStatus('OPEN');
      }

      setAssignedAgentId(ticket.assignedAgentId || '');
      setAssignedAgentName(ticket.assignedAgentName || '');
      setErrorMsg(null);
    }
  }, [ticket]);

  if (!isOpen || !ticket) return null;

  const handleAgentChange = (agentId: string) => {
    setAssignedAgentId(agentId);
    if (!agentId) {
      setAssignedAgentName('');
    } else {
      const found = agentsList.find((a) => a.id === agentId);
      setAssignedAgentName(found?.full_name || found?.username || '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMsg('Please enter ticket issue title');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      // Direct UPDATE to Supabase tickets table
      const { error: sbError } = await supabase
        .from('tickets')
        .update({
          issue: title.trim(),
          priority: priority,
          status: status,
          assigned_agent_id: assignedAgentId || null,
          assigned_agent_name: assignedAgentName || null,
        })
        .or(`id.eq.${ticket.id},ticket_no.eq.${ticket.ticketNumber || ticket.id}`);

      if (sbError) throw sbError;

      onTicketUpdated();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update ticket in Supabase');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden relative">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Edit Ticket {ticket.ticketNumber}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-slate-800 text-slate-300 border border-slate-700">
                  @{ticket.customerName || ticket.customerId}
                </span>
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                Update priority, SLA category, technician assignment &amp; status
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 cursor-pointer rounded-lg hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs font-sans">
          {errorMsg && (
            <div className="p-3 bg-rose-950/80 border border-rose-700 text-rose-300 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Ticket Issue Title */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">Ticket Issue / Fault Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Optical Signal Low, Fiber Cut on Pole 12"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {/* Priority & Status Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">SLA Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="LOW">LOW (Standard)</option>
                <option value="NORMAL">NORMAL (4h SLA)</option>
                <option value="HIGH">HIGH (2h SLA)</option>
                <option value="CRITICAL">CRITICAL (Immediate)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">Ticket Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="OPEN">OPEN (Unassigned/Pending)</option>
                <option value="IN_PROGRESS">IN_PROGRESS (Dispatched)</option>
                <option value="RESOLVED">RESOLVED (Closed)</option>
              </select>
            </div>
          </div>

          {/* Assigned Technician Dropdown */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block flex items-center justify-between">
              <span>Assigned Field Technician</span>
              {isLoadingAgents && <span className="text-[10px] text-cyan-400 font-mono">Loading agents...</span>}
            </label>
            <select
              value={assignedAgentId}
              onChange={(e) => handleAgentChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="">-- No Technician Assigned (Unassigned) --</option>
              <optgroup label="Registered Field Agents:">
                {agentsList.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    👤 {ag.full_name} (@{ag.username}) - {ag.area || 'Field Node'}
                  </option>
                ))}
              </optgroup>
            </select>
            {assignedAgentName && (
              <span className="text-[11px] text-emerald-400 font-mono block">
                ✓ Currently linked to: {assignedAgentName}
              </span>
            )}
          </div>

          {/* Metadata Info Box */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-[11px] font-mono space-y-1 text-slate-400">
            <div className="flex justify-between">
              <span>Subscriber:</span>
              <span className="text-slate-200">@{ticket.customerName || ticket.customerId}</span>
            </div>
            <div className="flex justify-between">
              <span>Node / Area:</span>
              <span className="text-cyan-400">{ticket.areaNode || 'Main Distribution Node'}</span>
            </div>
            <div className="flex justify-between">
              <span>Created At:</span>
              <span>{ticket.createdAt ? new Date(ticket.createdAt).toLocaleString() : 'Recent'}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/40 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : 'Save Ticket Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
