import React, { useState } from 'react';
import { X, AlertTriangle, UserCheck } from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { TicketCategory, TicketPriority } from '../types/isp';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewTicketModal: React.FC<NewTicketModalProps> = ({ isOpen, onClose }) => {
  const { customers, agents, selectedRouterId, createComplaintTicket } = useISP();

  const [customerId, setCustomerId] = useState(customers[0]?.id || '');
  const [category, setCategory] = useState<TicketCategory>('fiber_cut');
  const [priority, setPriority] = useState<TicketPriority>('critical');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');

  if (!isOpen) return null;

  const targetCust = customers.find((c) => c.id === customerId) || customers[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !targetCust) return;

    const isAutoImmediate = assignedAgentId === 'AUTO';
    const specificAgent = !isAutoImmediate && assignedAgentId ? agents.find((a) => a.id === assignedAgentId) : undefined;

    createComplaintTicket(
      {
        customerId: targetCust.id,
        customerName: targetCust.name,
        customerPhone: targetCust.phone,
        customerAddress: targetCust.address,
        areaNode: targetCust.areaNode,
        category,
        priority,
        status: (specificAgent || isAutoImmediate) ? 'assigned' : 'open',
        title,
        description,
        assignedAgentId: specificAgent?.id,
        assignedAgentName: specificAgent?.name,
        routerId: selectedRouterId,
      },
      isAutoImmediate
    );

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4">
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-950 border border-amber-800 text-amber-400 rounded-lg">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Log Technical Complaint Ticket</h3>
              <p className="text-xs text-slate-400">SLA target will be calculated automatically</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Subscriber Account</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.accountNumber} - {c.areaNode})
                </option>
              ))}
            </select>
          </div>

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
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                <option value="fiber_cut">Fiber Cut (2h SLA)</option>
                <option value="no_internet">No Internet (3h SLA)</option>
                <option value="slow_speed">Slow Speed (4h SLA)</option>
                <option value="router_issue">Router/ONT Fault (4h SLA)</option>
                <option value="billing_issue">Billing/Walled Garden</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                <option value="critical">Critical (Immediate Dispatch)</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Ticket Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Red Optical LOS Light Blinking Continuous"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Detailed Symptoms</label>
            <textarea
              rows={2}
              required
              placeholder="Provide exact observations or OTDR distance readings..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400">Assign to Technician / Auto-Dispatch</label>
              <span className="text-[10px] text-cyan-400 font-mono">5-Min SLA Policy Active</span>
            </div>
            <select
              value={assignedAgentId}
              onChange={(e) => setAssignedAgentId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-sans"
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
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition"
            >
              Dispatch Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
