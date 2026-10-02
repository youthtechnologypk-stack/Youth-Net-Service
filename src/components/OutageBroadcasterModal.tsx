import React, { useState } from 'react';
import { X, Megaphone, ShieldAlert, Send } from 'lucide-react';
import { useISP } from '../context/ISPContext';

interface OutageBroadcasterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OutageBroadcasterModal: React.FC<OutageBroadcasterModalProps> = ({ isOpen, onClose }) => {
  const { customers, broadcastAreaOutage } = useISP();

  const [areaNode, setAreaNode] = useState('Sector-G11-PON-02');
  const [title, setTitle] = useState('Sector G-11 Feeder Cable Fiber Cut');
  const [cause, setCause] = useState('Road construction machinery severed 48-core armoring drop.');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('critical');
  const [estimatedHours, setEstimatedHours] = useState(2);

  if (!isOpen) return null;

  const affectedSubscribers = customers.filter((c) => c.areaNode === areaNode).length || 24;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    broadcastAreaOutage(areaNode, title, cause, severity, estimatedHours);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4">
        <div className="bg-rose-950 p-5 border-b border-rose-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-600 text-white rounded-lg">
              <Megaphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Broadcast Area Outage Notice</h3>
              <p className="text-xs text-rose-200">One-click automated mass WhatsApp alerts to affected subscribers</p>
            </div>
          </div>
          <button onClick={onClose} className="text-rose-300 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">Target Area / PON Node</label>
            <select
              value={areaNode}
              onChange={(e) => setAreaNode(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-rose-500 font-mono"
            >
              <option value="Sector-G11-PON-02">Sector-G11-PON-02 (Feeder Splitter)</option>
              <option value="Sector-F10-PON-04">Sector-F10-PON-04 (Distribution Core)</option>
              <option value="Sector-I8-PON-01">Sector-I8-PON-01 (Markaz Hub)</option>
              <option value="Blue-Area-Core-01">Blue-Area-Core-01 (Metro Transit Ring)</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Severity Level</label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-rose-500"
              >
                <option value="critical">Critical (Complete Blackout)</option>
                <option value="major">Major (High Packet Loss)</option>
                <option value="minor">Minor (Scheduled Maintenance)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Estimated Restoration (Hours)</label>
              <input
                type="number"
                min="1"
                max="24"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(parseInt(e.target.value, 10))}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-rose-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Incident Headline</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Root Cause / Restoration Status</label>
            <textarea
              rows={2}
              required
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-rose-500"
            />
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex justify-between text-slate-300 font-semibold">
              <span>Audience Reach:</span>
              <span className="text-rose-400 font-mono">{affectedSubscribers} Subscribers</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Triggering this alert will automatically dispatch broadcast WhatsApp templates to all customer contact numbers in this PON node and log an outage event in the NOC console.
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
              className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition flex items-center gap-1.5"
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
