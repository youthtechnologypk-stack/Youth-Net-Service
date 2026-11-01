import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, AlertTriangle, UserCheck, Search, Check, Wifi, Globe, MapPin, Cable } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useSubscribers, UnifiedSubscriber } from '../hooks/useSubscribers';
import { TicketCategory, TicketPriority } from '../types/isp';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewTicketModal: React.FC<NewTicketModalProps> = ({ isOpen, onClose }) => {
  const { agents, selectedRouterId, createComplaintTicket } = useISP();
  const { unifiedSubscribers } = useSubscribers();

  const [selectedSubscriber, setSelectedSubscriber] = useState<UnifiedSubscriber | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Form fields
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [areaNode, setAreaNode] = useState('Sector G-11 (North Zone)');
  const [ponPort, setPonPort] = useState('PON-01');
  const [feederLine, setFeederLine] = useState('Feeder-North-01');
  const [pppoeUsername, setPppoeUsername] = useState('');
  const [assignedIp, setAssignedIp] = useState('');

  const [category, setCategory] = useState<TicketCategory>('fiber_cut');
  const [priority, setPriority] = useState<TicketPriority>('critical');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select first subscriber on mount if none selected
  useEffect(() => {
    if (unifiedSubscribers.length > 0 && !selectedSubscriber) {
      const first = unifiedSubscribers[0];
      handleSelectSubscriber(first);
    }
  }, [unifiedSubscribers]);

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
    if (!searchQuery.trim()) return unifiedSubscribers.slice(0, 30);
    const q = searchQuery.toLowerCase().trim();
    return unifiedSubscribers.filter(
      (s) =>
        s.username.toLowerCase().includes(q) ||
        s.fullName.toLowerCase().includes(q) ||
        s.phone.toLowerCase().includes(q) ||
        s.assignedIp.toLowerCase().includes(q) ||
        s.macAddress.toLowerCase().includes(q)
    ).slice(0, 30);
  }, [unifiedSubscribers, searchQuery]);

  const handleSelectSubscriber = (sub: UnifiedSubscriber) => {
    setSelectedSubscriber(sub);
    setSearchQuery(`${sub.fullName} (@${sub.username})`);
    setCustomerName(sub.fullName);
    setCustomerPhone(sub.phone);
    setCustomerAddress(sub.address || 'Central Distribution Area');
    setAreaNode(sub.areaNode || 'Sector G-11 (North Zone)');
    setPonPort(sub.ponPort || 'PON-01');
    setFeederLine(sub.feederLine || 'Feeder-North-01');
    setPppoeUsername(sub.username);
    setAssignedIp(sub.assignedIp || 'Dynamic');
    setIsDropdownOpen(false);
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !customerName) return;

    const isAutoImmediate = assignedAgentId === 'AUTO';
    const specificAgent = !isAutoImmediate && assignedAgentId ? agents.find((a) => a.id === assignedAgentId) : undefined;

    createComplaintTicket(
      {
        customerId: selectedSubscriber?.id || `cust-${pppoeUsername || Date.now()}`,
        customerName,
        customerPhone,
        customerAddress,
        areaNode,
        category,
        priority,
        status: (specificAgent || isAutoImmediate) ? 'assigned' : 'open',
        title,
        description,
        assignedAgentId: specificAgent?.id,
        assignedAgentName: specificAgent?.name,
        routerId: selectedRouterId,
        ponPort,
        feederLine,
        pppoeUsername,
        assignedIp,
      },
      isAutoImmediate
    );

    onClose();
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
                  Live PPPoE Linked
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
                            <span>📍 {sub.areaNode}</span>
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
                <span>📍 Area: <strong className="text-slate-200">{areaNode}</strong></span>
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
                <option value="PON-01">PON-01 (Feeder 1-16 / North)</option>
                <option value="PON-02">PON-02 (Feeder 17-32 / Central)</option>
                <option value="PON-03">PON-03 (Feeder 33-48 / West)</option>
                <option value="PON-04">PON-04 (Feeder 49-64 / East)</option>
                <option value="PON-05">PON-05 (North Splitter Drop)</option>
                <option value="PON-06">PON-06 (Commercial Hub Core)</option>
                <option value="PON-07">PON-07 (West Sector Ring)</option>
                <option value="PON-08">PON-08 (Backup Ring Node)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                <span>Feeder Line / Distribution Drop</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Feeder-North-01"
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

          {/* Technician Assignment */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400">Assign to Technician / Auto-Dispatch</label>
              <span className="text-[10px] text-cyan-400 font-mono">5-Min SLA Policy Active</span>
            </div>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
            >
              <option value="">⏱️ Unassigned (Auto-Assigns in 5 Mins if unhandled)</option>
              <option value="AUTO">⚡ Auto-Assign Best Technician Immediately (Area/Load Match)</option>
              <optgroup label="Or Specify Dedicated Technician:">
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    👤 {a.name} ({a.assignedArea}) - {a.activeTicketsAssigned} active tickets
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="text-[11px] text-slate-400 mt-1 font-sans">
              ℹ️ If left unassigned, NOC engine will automatically match and assign the best sector technician after <strong>5 minutes</strong> and post an escalation alert to the <strong>Field Ops WhatsApp Group</strong>.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition shadow-lg shadow-amber-950/40 cursor-pointer"
            >
              Dispatch Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
