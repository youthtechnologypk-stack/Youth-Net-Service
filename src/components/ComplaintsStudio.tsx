import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Clock,
  UserCheck,
  CheckCircle2,
  ShieldAlert,
  Megaphone,
  Plus,
  Radio,
  FileText,
  Camera,
  Layers,
  Zap,
  Send,
  Users,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { ComplaintTicket, TicketCategory, TicketPriority } from '../types/isp';

interface ComplaintsStudioProps {
  onOpenTicketModal: () => void;
  onOpenOutageModal: () => void;
}

export const ComplaintsStudio: React.FC<ComplaintsStudioProps> = ({
  onOpenTicketModal,
  onOpenOutageModal,
}) => {
  const {
    complaints,
    agents,
    outages,
    onus,
    assignTicketToAgent,
    autoAssignTicket,
    run5MinComplaintAutoAssignEngine,
    resolveTicket,
  } = useISP();

  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedTicketForResolve, setSelectedTicketForResolve] = useState<ComplaintTicket | null>(null);
  const [resolutionText, setResolutionText] = useState('');
  const [now, setNow] = useState<number>(Date.now());
  const [engineStatusMsg, setEngineStatusMsg] = useState<string | null>(null);
  const [isRunningEngine, setIsRunningEngine] = useState<boolean>(false);
  const [pendingAgentSelection, setPendingAgentSelection] = useState<Record<string, string>>({});
  const [assignmentFeedback, setAssignmentFeedback] = useState<Record<string, string>>({});

  const handleConfirmAssignment = async (ticketId: string) => {
    const selected = pendingAgentSelection[ticketId];
    if (selected === 'AUTO' || !selected) {
      // Auto-assign best technician
      const res = await autoAssignTicket(ticketId, 'Auto-assigned via Submit button');
      if (res) {
        setAssignmentFeedback((prev) => ({
          ...prev,
          [ticketId]: `✓ Auto-assigned to ${res.agent.name} & WhatsApp Group alerted!`,
        }));
        setTimeout(() => {
          setAssignmentFeedback((prev) => {
            const next = { ...prev };
            delete next[ticketId];
            return next;
          });
        }, 4000);
      }
    } else {
      assignTicketToAgent(ticketId, selected);
      const agentObj = agents.find((a) => a.id === selected);
      setAssignmentFeedback((prev) => ({
        ...prev,
        [ticketId]: `✓ Assigned to ${agentObj?.name || 'Technician'} & WhatsApp sent!`,
      }));
      setTimeout(() => {
        setAssignmentFeedback((prev) => {
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });
      }, 4000);
    }
  };

  // Update SLA & 5-minute auto-assign countdown second-by-second
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredTickets = complaints.filter((tkt) => {
    if (categoryFilter === 'all') return true;
    return tkt.category === categoryFilter;
  });

  const formatRemainingSla = (deadlineIso: string, isResolved: boolean) => {
    if (isResolved) return 'Resolved (SLA Met)';

    const deadline = new Date(deadlineIso).getTime();
    const diffMs = deadline - now;
    const isOverdue = diffMs < 0;
    const absDiff = Math.abs(diffMs);

    const hours = Math.floor(absDiff / (1000 * 60 * 60));
    const mins = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60));

    if (isOverdue) {
      return `⚠️ BREACHED by ${hours}h ${mins}m`;
    }
    return `⏳ ${hours}h ${mins}m remaining`;
  };

  const handleResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketForResolve) return;

    resolveTicket(
      selectedTicketForResolve.id,
      resolutionText || 'Fiber re-spliced with 0.02dB loss. Optical power restored to -18.5dBm.',
      'https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=400&q=80'
    );

    setSelectedTicketForResolve(null);
    setResolutionText('');
  };

  return (
    <div className="space-y-6">
      {/* Header & Outage Emergency Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white">
                SLA Ticket Dispatch & Area Outage Control
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono">
                Real-Time SLA Tracking
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Auto/Manual allocation to field technicians based on PON node and automated WhatsApp outage broadcasts.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onOpenTicketModal}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs px-3.5 py-2 rounded-lg transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Raise Ticket</span>
            </button>

            <button
              onClick={onOpenOutageModal}
              className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition"
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span>Broadcast Area Outage</span>
            </button>
          </div>
        </div>

        {/* Outage status ticker */}
        {outages.length > 0 && (
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              <span className="font-bold text-rose-300">Active Area Node Outage:</span>
              <span className="text-slate-300">{outages[0].title}</span>
              <span className="text-slate-500 font-mono">({outages[0].areaNode})</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="text-slate-400">
                Affected: <strong className="text-rose-400">{outages[0].affectedCustomersCount} subscribers</strong>
              </span>
              <span className="text-emerald-400">
                WhatsApp Sent: {outages[0].broadcastSentToWhatsAppCount}
              </span>
            </div>
          </div>
        )}

        {/* 5-Minute Auto-Assignment & WhatsApp Group Escalation Engine Banner */}
        <div className="bg-slate-950 p-3.5 rounded-xl border border-cyan-800/60 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs shadow-inner">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-950 text-cyan-400 border border-cyan-800 shrink-0">
              <Zap className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white">5-Minute Complaint Auto-Assignment Engine</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
                  ACTIVE POLICY
                </span>
              </div>
              <p className="text-slate-400 text-[11px] mt-0.5">
                If unassigned for &gt;5 mins, system automatically allocates the best sector technician &amp; dispatches an escalation broadcast to the <strong>Field Ops WhatsApp Group</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end md:self-auto shrink-0 font-mono">
            <span className="text-slate-400 text-[11px]">
              Unassigned Queue: <strong className="text-amber-300 font-bold">{complaints.filter(c => !c.assignedAgentId && c.status !== 'resolved').length}</strong>
            </span>
            <button
              onClick={async () => {
                setIsRunningEngine(true);
                const res = await run5MinComplaintAutoAssignEngine(true);
                setEngineStatusMsg(res.message);
                setIsRunningEngine(false);
                setTimeout(() => setEngineStatusMsg(null), 6000);
              }}
              disabled={isRunningEngine}
              className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1.5 shadow-md shadow-cyan-950/40 cursor-pointer active:scale-95"
              title="Force scan and auto-assign all unassigned tickets now"
            >
              <Zap className="w-3.5 h-3.5 text-slate-950" />
              <span>{isRunningEngine ? 'Scanning Queue...' : 'Run 5-Min SLA Auto-Assign Engine'}</span>
            </button>
          </div>
        </div>

        {engineStatusMsg && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl text-emerald-300 text-xs font-mono flex items-center gap-2 animate-fade-in shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{engineStatusMsg}</span>
          </div>
        )}
      </div>

      {/* Category Filter Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs scrollbar-none">
        <span className="text-slate-400 font-semibold pr-1">Filter Category:</span>
        {[
          { id: 'all', label: 'All Tickets' },
          { id: 'fiber_cut', label: 'Fiber Cut (2h SLA)' },
          { id: 'no_internet', label: 'No Internet (3h SLA)' },
          { id: 'slow_speed', label: 'Slow Speed (4h SLA)' },
          { id: 'router_issue', label: 'Router/ONT (4h SLA)' },
          { id: 'billing_issue', label: 'Billing/Walled Garden' },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setCategoryFilter(item.id)}
            className={`px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition ${
              categoryFilter === item.id
                ? 'bg-cyan-600 text-slate-950 font-bold'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* SLA Ticket Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredTickets.map((ticket) => {
          const isResolved = ticket.status === 'resolved';
          const deadline = new Date(ticket.slaDeadline).getTime();
          const isBreached = !isResolved && deadline < now;

          return (
            <div
              key={ticket.id}
              className={`bg-slate-900 border rounded-xl p-5 space-y-4 shadow-lg transition flex flex-col justify-between ${
                isBreached
                  ? 'border-rose-600/80 bg-rose-950/20'
                  : isResolved
                  ? 'border-emerald-800/60 opacity-80'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                {/* Top Badge Strip */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-slate-200 text-xs">
                      {ticket.ticketNumber}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase font-bold ${
                        ticket.priority === 'critical'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : ticket.priority === 'high'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {ticket.priority}
                    </span>
                    {ticket.autoAssigned ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold flex items-center gap-1">
                        <Zap className="w-2.5 h-2.5 text-cyan-400" />
                        AUTO-ASSIGNED
                      </span>
                    ) : !ticket.assignedAgentId && !isResolved ? (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono font-bold">
                        UNASSIGNED (5m SLA)
                      </span>
                    ) : null}
                  </div>

                  {/* SLA Status Chip */}
                  <span
                    className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded ${
                      isResolved
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        : isBreached
                        ? 'bg-rose-900 text-white animate-pulse'
                        : 'bg-slate-800 text-cyan-300 border border-slate-700'
                    }`}
                  >
                    {formatRemainingSla(ticket.slaDeadline, isResolved)}
                  </span>
                </div>

                {/* Category & Title */}
                <div>
                  <span className="text-[10px] uppercase font-mono tracking-wider text-cyan-400">
                    {ticket.category.replace('_', ' ')}
                  </span>
                  <h4 className="text-sm font-bold text-white leading-snug mt-0.5">
                    {ticket.title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{ticket.description}</p>
                </div>

                {/* Subscriber & Location details */}
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 text-xs font-mono space-y-1">
                  <div className="text-slate-300 font-bold">{ticket.customerName}</div>
                  <div className="text-slate-400 text-[11px]">{ticket.customerAddress}</div>
                  <div className="text-cyan-400 text-[11px]">Node: {ticket.areaNode}</div>
                </div>

                {/* Live VSOL OLT / ONU Optical Signal Telemetry */}
                {(() => {
                  const customerOnu = onus.find(
                    (o) => o.customerId === ticket.customerId || o.customerName === ticket.customerName
                  );
                  if (!customerOnu) return null;

                  return (
                    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800/80 text-xs font-mono flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Radio className="w-3.5 h-3.5 text-cyan-400" />
                          <span className="text-[10px] text-slate-400">ONT Optical Rx:</span>
                          <span className={`font-bold ${
                            customerOnu.opticalQuality === 'good'
                              ? 'text-emerald-400'
                              : customerOnu.opticalQuality === 'warning'
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}>
                            {customerOnu.rxPowerDbm.toFixed(1)} dBm
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 block">
                          {customerOnu.ponPort} #{customerOnu.onuIndex} ({customerOnu.distanceMeters}m from OLT)
                        </span>
                      </div>

                      <span className={`text-[9px] px-2 py-0.5 rounded uppercase font-bold border ${
                        customerOnu.opticalQuality === 'good'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : customerOnu.opticalQuality === 'warning'
                          ? 'bg-amber-950 text-amber-300 border-amber-800'
                          : 'bg-rose-950 text-rose-300 border-rose-800'
                      }`}>
                        {customerOnu.status === 'dying_gasp' ? 'Dying Gasp' : customerOnu.opticalQuality}
                      </span>
                    </div>
                  );
                })()}

                {/* 5-Min Auto-Assignment Countdown & 1-Click Trigger */}
                {!isResolved && !ticket.assignedAgentId && (() => {
                  const elapsedMs = now - new Date(ticket.createdAt).getTime();
                  const remainingMs = Math.max(0, 5 * 60 * 1000 - elapsedMs);
                  const remSecTotal = Math.floor(remainingMs / 1000);
                  const remM = Math.floor(remSecTotal / 60);
                  const remS = remSecTotal % 60;
                  const is5MinPassed = elapsedMs >= 5 * 60 * 1000;

                  return (
                    <div
                      className={`p-2.5 rounded-lg border text-xs font-mono space-y-1.5 ${
                        is5MinPassed
                          ? 'bg-rose-950/60 border-rose-700/80 text-rose-300 shadow-sm'
                          : 'bg-amber-950/40 border-amber-700/60 text-amber-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-bold">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          {is5MinPassed ? (
                            <span className="text-rose-300">⚠️ &gt;5m Unassigned (Escalation Trigger Ready)</span>
                          ) : (
                            <span>Auto-Assigning in: <strong className="text-white">{remM}m {String(remS).padStart(2, '0')}s</strong></span>
                          )}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300">
                          WhatsApp Group Alert
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-[11px]">
                        <span className="text-slate-400 font-sans">5-Min SLA: Auto-allocates best area tech</span>
                        <button
                          onClick={() => autoAssignTicket(ticket.id, 'Manual 1-Click Auto-Assignment Triggered by Dispatcher')}
                          className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition flex items-center gap-1 cursor-pointer active:scale-95 shadow-sm"
                          title="Auto-Assign best sector agent now & send WhatsApp Group broadcast"
                        >
                          <Zap className="w-3 h-3 text-slate-950" />
                          <span>Auto-Assign Now</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* If Auto-Assigned Badge Banner */}
                {ticket.autoAssigned && (
                  <div className="p-2 rounded-lg bg-cyan-950/70 border border-cyan-800/80 text-cyan-300 text-[11px] font-mono flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span>Auto-Assigned by 5-Min SLA Policy &amp; Group Alerted</span>
                    </span>
                    <span className="text-[10px] text-cyan-400/80 font-sans">
                      {ticket.autoAssignedAt ? new Date(ticket.autoAssignedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Verified'}
                    </span>
                  </div>
                )}

                {/* Technician Assignment with Aligned Submit Button */}
                <div className="text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Assigned Field Technician:</span>
                    {ticket.assignedAgentName ? (
                      <span className="text-[11px] text-emerald-400 font-mono font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span>Assigned: {ticket.assignedAgentName}</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-400 font-mono">Unassigned</span>
                    )}
                  </div>

                  {!isResolved ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <select
                          value={
                            pendingAgentSelection[ticket.id] !== undefined
                              ? pendingAgentSelection[ticket.id]
                              : (ticket.assignedAgentId || '')
                          }
                          onChange={(e) => {
                            setPendingAgentSelection((prev) => ({
                              ...prev,
                              [ticket.id]: e.target.value,
                            }));
                          }}
                          className="flex-1 min-w-0 bg-slate-950 border border-slate-700 text-slate-100 text-xs p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
                        >
                          <option value="">-- Select Field Technician --</option>
                          <option value="AUTO">⚡ Auto-Assign Best Technician (Area/Load Match)</option>
                          <optgroup label="Or Specific Technician:">
                            {agents.map((agent) => (
                              <option key={agent.id} value={agent.id}>
                                👤 {agent.name} ({agent.assignedArea}) - {agent.activeTicketsAssigned} active
                              </option>
                            ))}
                          </optgroup>
                        </select>

                        <button
                          type="button"
                          onClick={() => handleConfirmAssignment(ticket.id)}
                          className="bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition flex items-center gap-1.5 shrink-0 shadow-md shadow-cyan-950/40 cursor-pointer"
                          title="Submit & Assign Selected Technician"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
                          <span>Submit</span>
                        </button>
                      </div>

                      {assignmentFeedback[ticket.id] && (
                        <div className="p-1.5 rounded-lg bg-emerald-950/90 border border-emerald-700 text-emerald-300 text-[11px] font-mono flex items-center gap-1.5 animate-fade-in shadow-sm">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>{assignmentFeedback[ticket.id]}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 font-mono text-xs flex items-center justify-between">
                      <span>Technician: {ticket.assignedAgentName || 'NOC Central Desk'}</span>
                      <span className="text-emerald-400 text-[10px] font-bold">Resolved</span>
                    </div>
                  )}
                </div>

                {ticket.resolutionNotes && (
                  <div className="bg-emerald-950/40 border border-emerald-800 p-2 rounded text-xs text-emerald-300">
                    <strong>Resolution:</strong> {ticket.resolutionNotes}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">
                  Reported: {new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {!isResolved ? (
                  <button
                    onClick={() => setSelectedTicketForResolve(ticket)}
                    className="bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition shadow-sm"
                  >
                    Mark Resolved
                  </button>
                ) : (
                  <span className="text-emerald-400 text-xs flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ticket Closed
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Resolution Modal */}
      {selectedTicketForResolve && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Resolve Ticket: {selectedTicketForResolve.ticketNumber}
              </h3>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                SLA Compliance
              </span>
            </div>

            <p className="text-xs text-slate-400">
              {selectedTicketForResolve.customerName} - {selectedTicketForResolve.title}
            </p>

            <form onSubmit={handleResolveSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Technician Splicing / Resolution Notes</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Spliced 2-fiber drop core. Cleaved and fusion-spliced with 0.02dB loss. ONT optical power measured at -18.5dBm."
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="p-3 bg-slate-950 rounded border border-slate-800 flex items-center gap-3">
                <Camera className="w-5 h-5 text-cyan-400" />
                <div>
                  <span className="text-slate-300 font-semibold block">Field Proof Photo Attached</span>
                  <span className="text-[11px] text-slate-500">Optical Power Meter & Splicer Display</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedTicketForResolve(null)}
                  className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold"
                >
                  Submit & Close Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
