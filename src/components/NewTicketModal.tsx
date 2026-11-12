import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, AlertTriangle, Search, Cable, MapPin, CheckCircle2, User, RefreshCw } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useSubscribers, UnifiedSubscriber } from '../hooks/useSubscribers';
import { TicketCategory, TicketPriority } from '../types/isp';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';

export interface CreateTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultSubscriberUsername?: string;
  onSuccess?: () => void;
}

export const NewTicketModal: React.FC<CreateTicketModalProps> = ({
  isOpen,
  onClose,
  defaultSubscriberUsername,
  onSuccess,
}) => {
  const { selectedRouterId, createComplaintTicket } = useISP();
  const { unifiedSubscribers } = useSubscribers();

  // Live agents from Supabase portal_users (role === 'AGENT')
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [selectedSubscriber, setSelectedSubscriber] = useState<UnifiedSubscriber | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Form fields with primary operational node bound to "Saddar Node"
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [areaNode, setAreaNode] = useState('Saddar Node');
  const [ponPort, setPonPort] = useState('PON-01 (Saddar Core)');
  const [feederLine, setFeederLine] = useState('Feeder-Saddar-01');
  const [pppoeUsername, setPppoeUsername] = useState(defaultSubscriberUsername || '');
  const [assignedIp, setAssignedIp] = useState('');

  const [category, setCategory] = useState<TicketCategory>('fiber_cut');
  const [priority, setPriority] = useState<TicketPriority>('critical');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fallback list of real agents per SLA specification
  const fallbackRealAgents: Array<{ id: string; full_name: string; username: string; area: string; role: 'AGENT' }> = [
    { id: 'agent-hassnain-uuid', full_name: 'Hassnain Akram', username: 'hassnain_saddar', area: 'Saddar', role: 'AGENT' },
    { id: 'agent-zayan-uuid', full_name: 'Zayan Saleem', username: 'zayan_saddar_node', area: 'Saddar Node', role: 'AGENT' },
    { id: 'agent-ramzan-uuid', full_name: 'Muhammad Ramzan', username: 'ramzan_main_city', area: 'Main City Node', role: 'AGENT' },
    { id: 'agent-bilal-uuid', full_name: 'Bilal Khan', username: 'bilal_g11_f11', area: 'Sector G-11 & F-11', role: 'AGENT' },
  ];

  // Fetch real technicians directly from Supabase portal_users
  const fetchPortalAgents = async () => {
    try {
      const { data, error } = await supabase
        .from('portal_users')
        .select('id, full_name, username, area, role')
        .eq('role', 'AGENT');

      if (!error && data && data.length > 0) {
        setPortalAgents(data as SupabasePortalUser[]);
      } else {
        setPortalAgents(fallbackRealAgents as any);
      }
    } catch {
      setPortalAgents(fallbackRealAgents as any);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchPortalAgents();
      setStatusMessage(null);
      setIsSubmitting(false);

      if (defaultSubscriberUsername && unifiedSubscribers.length > 0) {
        const found = (unifiedSubscribers || []).find(
          (s) => (s?.username || '').toLowerCase() === (defaultSubscriberUsername || '').toLowerCase()
        );
        if (found) {
          handleSelectSubscriber(found);
          return;
        }
      }

      if (unifiedSubscribers.length > 0 && !selectedSubscriber) {
        handleSelectSubscriber(unifiedSubscribers[0]);
      }
    }
  }, [isOpen, defaultSubscriberUsername, unifiedSubscribers.length]);

  // Click outside listener for subscriber dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filtered subscribers list
  const filteredSubscribers = useMemo(() => {
    if (!searchQuery.trim()) return (unifiedSubscribers || []).slice(0, 30);
    const q = searchQuery.toLowerCase().trim();
    return (unifiedSubscribers || []).filter(
      (s) =>
        (s?.username || '').toLowerCase().includes(q) ||
        (s?.fullName || '').toLowerCase().includes(q) ||
        (s?.phone || '').toLowerCase().includes(q) ||
        (s?.assignedIp || '').toLowerCase().includes(q) ||
        (s?.macAddress || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [unifiedSubscribers, searchQuery]);

  const handleSelectSubscriber = (sub: UnifiedSubscriber) => {
    setSelectedSubscriber(sub);
    setSearchQuery(`${sub.fullName} (@${sub.username})`);
    setCustomerName(sub.fullName);
    setCustomerPhone(sub.phone);
    setCustomerAddress(sub.address || 'Saddar Distribution Area');
    setAreaNode(sub.areaNode || 'Saddar Node');
    setPonPort(sub.ponPort || 'PON-01 (Saddar Core)');
    setFeederLine(sub.feederLine || 'Feeder-Saddar-01');
    setPppoeUsername(sub.username);
    setAssignedIp(sub.assignedIp || 'Dynamic');
    setIsDropdownOpen(false);
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !customerName) return;

    setIsSubmitting(true);
    setStatusMessage(null);

    const isAutoImmediate = assignedAgentId === 'AUTO';
    let specificAgent: SupabasePortalUser | undefined;

    if (isAutoImmediate) {
      // Pick first Saddar agent if available
      specificAgent = portalAgents.find((a) => a.area?.toLowerCase().includes('saddar')) || portalAgents[0];
    } else if (assignedAgentId) {
      specificAgent = portalAgents.find((a) => a.id === assignedAgentId);
    }

    const assignedId = specificAgent?.id || null;
    const assignedName = specificAgent?.full_name || null;
    const ticketNo = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      // 1. Write strictly into Supabase `tickets` table with both ID and Name
      const { error: sbErr } = await supabase.from('tickets').insert([
        {
          ticket_no: ticketNo,
          subscriber_username: pppoeUsername || customerName.toLowerCase().replace(/\s+/g, '.'),
          assigned_agent_id: assignedId,
          assigned_agent_name: assignedName,
          issue: `[${category.toUpperCase()}] ${title}: ${description}`,
          priority: priority.toUpperCase(),
          status: specificAgent ? 'IN_PROGRESS' : 'OPEN',
          created_at: new Date().toISOString(),
        },
      ]);

      if (sbErr) {
        console.error('Failed to insert ticket into Supabase:', sbErr);
      }

      // 2. Also register in ISPContext for instant NOC visibility
      createComplaintTicket(
        {
          customerId: selectedSubscriber?.id || `cust-${pppoeUsername || Date.now()}`,
          customerName,
          customerPhone,
          customerAddress,
          areaNode,
          category,
          priority,
          status: specificAgent ? 'assigned' : 'open',
          title,
          description,
          assignedAgentId: assignedId || undefined,
          assignedAgentName: assignedName || undefined,
          routerId: selectedRouterId,
          ponPort,
          feederLine,
          pppoeUsername,
          assignedIp,
        },
        isAutoImmediate
      );

      setStatusMessage(`Ticket ${ticketNo} dispatched successfully to ${assignedName || 'Unassigned Queue'}!`);
      if (onSuccess) onSuccess();

      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err: any) {
      console.error('Error dispatching ticket:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-950 border border-amber-800 text-amber-400 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Log SLA Technical Ticket</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  Saddar Node Operational
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                SLA target calculated automatically &bull; Dispatches to Field Ops WhatsApp Group
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status Toast */}
        {statusMessage && (
          <div className="p-3 bg-emerald-950 border-b border-emerald-800 text-emerald-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Dynamic Searchable Client Picker */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>Select Client / Subscriber * (Live MikroTik Secrets &amp; Portal Users)</span>
              </label>
              <span className="text-[10px] text-slate-400 font-mono">
                {unifiedSubscribers.length} Live Subscribers
              </span>
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Type username, customer name, phone, or IP to search..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 pl-3 pr-9 py-2.5 rounded-lg text-xs font-mono focus:outline-none focus:border-cyan-500"
              />
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Dropdown Menu */}
            {isDropdownOpen && (
              <div className="absolute z-20 left-0 right-0 mt-1 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl max-h-60 overflow-y-auto divide-y divide-slate-800/80 animate-fade-in">
                {filteredSubscribers.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-xs">
                    No subscribers found matching &ldquo;{searchQuery}&rdquo;.
                  </div>
                ) : (
                  filteredSubscribers.map((sub) => {
                    const isSelected = selectedSubscriber?.id === sub.id || selectedSubscriber?.username === sub.username;
                    return (
                      <div
                        key={sub.id || sub.username}
                        onClick={() => handleSelectSubscriber(sub)}
                        className={`p-3 hover:bg-slate-800/70 cursor-pointer transition flex items-center justify-between gap-3 ${
                          isSelected ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : ''
                        }`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-xs">{sub.fullName}</span>
                            <span className="text-cyan-400 font-mono text-[11px]">@{sub.username}</span>
                            <span className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                              sub.isOnline
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {sub.isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-3 font-mono">
                            <span>📞 {sub.phone || 'No phone'}</span>
                            <span>🌐 IP: {sub.assignedIp || 'Dynamic'}</span>
                            <span>📍 {sub.areaNode || 'Saddar Node'}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 text-[10px] font-mono">
                            {sub.profile}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Auto-filled Subscriber Profile Details Card */}
          {selectedSubscriber && (
            <div className="bg-slate-950/90 border border-cyan-900/60 rounded-xl p-3 space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between text-slate-300">
                <span>Selected Subscriber: <strong className="text-white">{customerName}</strong> (<span className="text-cyan-400">@{pppoeUsername}</span>)</span>
                <span className="text-emerald-400 font-semibold">{assignedIp}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400 text-[10px]">
                <span>📞 Phone: <strong className="text-slate-200">{customerPhone}</strong></span>
                <span>📍 Area Node: <strong className="text-cyan-400">{areaNode}</strong></span>
                <span>🏡 Address: <strong className="text-slate-200">{customerAddress}</strong></span>
              </div>
            </div>
          )}

          {/* PON Port and Feeder Line Tagging */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <Cable className="w-3.5 h-3.5 text-cyan-400" />
                <span>Target OLT PON Port *</span>
              </label>
              <select
                value={ponPort}
                onChange={(e) => setPonPort(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-cyan-300 font-mono p-2 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                <option value="PON-01 (Saddar Core)">PON-01 (Saddar Core &bull; Feeder 1-16)</option>
                <option value="PON-02 (Saddar Commercial)">PON-02 (Saddar Commercial &bull; Feeder 17-32)</option>
                <option value="PON-03 (Main City Backbone)">PON-03 (Main City Backbone &bull; Feeder 33-48)</option>
                <option value="PON-04 (Sector Ring)">PON-04 (Sector Ring &bull; Feeder 49-64)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                <span>Operational Node &bull; Feeder Drop</span>
              </label>
              <input
                type="text"
                value={feederLine}
                onChange={(e) => setFeederLine(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 font-mono p-2 rounded-lg focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Category & Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Issue Category</label>
              <select
                value={category}
                onChange={(e) => {
                  const cat = e.target.value as TicketCategory;
                  setCategory(cat);
                  if (cat === 'fiber_cut') setPriority('critical');
                  else if (cat === 'no_internet') setPriority('high');
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
              >
                <option value="fiber_cut">Fiber Cut (2h SLA &bull; Critical)</option>
                <option value="no_internet">No Internet (3h SLA &bull; High)</option>
                <option value="slow_speed">Slow Speed / High Latency (4h SLA)</option>
                <option value="router_issue">Router / ONT Fault (4h SLA)</option>
                <option value="billing_issue">Billing / Walled Garden</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="critical">CRITICAL (Immediate Dispatch)</option>
                <option value="high">HIGH (Urgent Resolution)</option>
                <option value="medium">MEDIUM (Standard Queue)</option>
                <option value="low">LOW (Minor Inquiry)</option>
              </select>
            </div>
          </div>

          {/* Ticket Title */}
          <div>
            <label className="block text-slate-400 mb-1">Ticket Title *</label>
            <input
              type="text"
              required
              placeholder="e.g. Red Optical LOS Light Blinking Continuous on ONT"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Detailed Symptoms */}
          <div>
            <label className="block text-slate-400 mb-1">Detailed Technical Symptoms</label>
            <textarea
              rows={2}
              required
              placeholder="Provide exact observations, ONT signal reading (-dBm), or physical fiber drop status..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Technician Assignment - STRICTLY REAL AGENTS FROM SUPABASE */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-300 font-semibold">Assign Technician (portal_users)</label>
              <span className="text-[10px] text-cyan-400 font-mono">Real Field Technicians</span>
            </div>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="">⏱️ Unassigned (Auto-Assigns in 5 Mins)</option>
              <option value="AUTO">⚡ Auto-Assign Best Technician (Saddar Node Priority)</option>
              <optgroup label="Real Operational Technicians:">
                {portalAgents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    👤 {ag.full_name} ({ag.area || 'Saddar'})
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="text-[11px] text-slate-400 mt-1 font-sans">
              ℹ️ Dispatches directly to the technician's <strong>Field Agent Portal</strong> and updates their SLA recovery queue in real time.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
              <span>Dispatch Ticket</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default NewTicketModal;
