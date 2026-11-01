import React, { useState, useMemo } from 'react';
import { X, Megaphone, ShieldAlert, Send, Cable, MapPin, Tag } from 'lucide-react';
import { useISP } from '../context/ISPContext';

interface OutageBroadcasterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OutageBroadcasterModal: React.FC<OutageBroadcasterModalProps> = ({ isOpen, onClose }) => {
  const { customers, complaints, broadcastAreaOutage } = useISP();

  const [areaNode, setAreaNode] = useState('Sector G-11 (North Zone)');
  const [ponPort, setPonPort] = useState('PON-01');
  const [feederLine, setFeederLine] = useState('Feeder-North-01');
  const [title, setTitle] = useState('Sector G-11 Feeder Cable Fiber Cut');
  const [cause, setCause] = useState('Road construction machinery severed 48-core armoring distribution cable.');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('critical');
  const [estimatedHours, setEstimatedHours] = useState(2);
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);

  // Open complaint tickets that can be linked
  const openTickets = useMemo(() => {
    return complaints.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  }, [complaints]);

  // Dynamically calculate affected subscribers from customers on this node/PON port
  const affectedSubscribers = useMemo(() => {
    const list = customers.filter(
      (c) => c.areaNode === areaNode || (c as any).ponPort === ponPort || (c as any).feederLine === feederLine
    );
    return list.length || 24;
  }, [customers, areaNode, ponPort, feederLine]);

  if (!isOpen) return null;

  const handleToggleTicket = (ticketId: string) => {
    setSelectedTicketIds((prev) =>
      prev.includes(ticketId) ? prev.filter((id) => id !== ticketId) : [...prev, ticketId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    broadcastAreaOutage(
      areaNode,
      title,
      cause,
      severity,
      estimatedHours,
      ponPort,
      selectedTicketIds.length > 0 ? selectedTicketIds : undefined
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-rose-950 p-5 border-b border-rose-900 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-rose-600 text-white rounded-xl">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>Broadcast Area Outage Notice</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900 text-rose-200 border border-rose-700 font-mono">
                  Optical PON Linkage
                </span>
              </h3>
              <p className="text-xs text-rose-200">
                Mass automated WhatsApp alerts to affected subscribers &bull; Links active SLA tickets
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-rose-300 hover:text-white p-1 rounded-lg transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs font-sans">
          {/* Target Area and PON Port */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold">Target Sector / Node</label>
              <select
                value={areaNode}
                onChange={(e) => setAreaNode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-rose-500 font-sans"
              >
                <option value="Sector G-11 (North Zone)">Sector G-11 (North Zone)</option>
                <option value="Sector F-10 (Commercial Zone)">Sector F-10 (Commercial Zone)</option>
                <option value="Sector I-8 (East Zone)">Sector I-8 (East Zone)</option>
                <option value="Blue Area (Main Business Hub)">Blue Area (Main Business Hub)</option>
                <option value="Sector F-11 (West Zone)">Sector F-11 (West Zone)</option>
                <option value="Sector G-10 (South Zone)">Sector G-10 (South Zone)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center gap-1.5">
                <Cable className="w-3.5 h-3.5 text-rose-400" />
                <span>Impacted OLT PON Port *</span>
              </label>
              <select
                value={ponPort}
                onChange={(e) => setPonPort(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-rose-300 font-mono p-2.5 rounded-lg focus:outline-none focus:border-rose-500"
              >
                <option value="PON-01">PON-01 (Feeder 1-16 / North)</option>
                <option value="PON-02">PON-02 (Feeder 17-32 / Central)</option>
                <option value="PON-03">PON-03 (Feeder 33-48 / West)</option>
                <option value="PON-04">PON-04 (Feeder 49-64 / East)</option>
                <option value="PON-05">PON-05 (North Splitter Drop)</option>
                <option value="PON-06">PON-06 (Commercial Hub Core)</option>
                <option value="ALL-PORTS">ALL PON PORTS (Complete Sector Blackout)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Severity Level</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-rose-500"
              >
                <option value="critical">Critical (Complete Fiber Blackout)</option>
                <option value="major">Major (High Packet Loss / Upstream Glitch)</option>
                <option value="minor">Minor (Scheduled Splitter Maintenance)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Estimated Restoration (Hours)</label>
              <input
                type="number"
                min="1"
                max="48"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(parseInt(e.target.value, 10))}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-rose-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Incident Headline *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Root Cause &amp; Technical Update *</label>
            <textarea
              rows={2}
              required
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-rose-500"
            />
          </div>

          {/* Link Active SLA Complaint Tickets */}
          {openTickets.length > 0 && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Link Active Complaint Tickets to this Outage:</span>
                </span>
                <span className="text-[10px] text-cyan-400 font-mono">
                  {selectedTicketIds.length} Linked
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Selected tickets will be automatically tagged with this outage incident, updating their NOC status.
              </p>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-800/60 pr-1">
                {openTickets.map((t) => {
                  const isChecked = selectedTicketIds.includes(t.id);
                  return (
                    <label
                      key={t.id}
                      className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                        isChecked ? 'bg-rose-950/40 text-rose-200' : 'hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTicket(t.id)}
                          className="rounded border-slate-700 text-rose-600 focus:ring-0"
                        />
                        <div>
                          <span className="font-mono font-bold text-xs">{t.ticketNumber}</span>
                          <span className="text-slate-400 ml-2 font-sans">{t.title}</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {t.customerName} ({t.areaNode})
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Audience Reach Banner */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex justify-between text-slate-300 font-semibold">
              <span>Subscribers on this Optical Path:</span>
              <span className="text-rose-400 font-mono font-bold">{affectedSubscribers} Subscribers</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Triggering this alert will automatically dispatch broadcast WhatsApp templates to all customer contact numbers connected to {ponPort} in {areaNode} and register an outage incident in the NOC console.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition flex items-center gap-1.5 shadow-lg shadow-rose-950/40 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Broadcast Now</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
