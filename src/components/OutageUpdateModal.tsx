import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Clock,
  MapPin,
  FileText,
  Send,
  CheckCircle2,
  Radio,
  Layers,
  Wrench,
  Check,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { AreaOutage, OutageStatus } from '../types/isp';
import { useISP } from '../context/ISPContext';

interface OutageUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  outage?: AreaOutage | null;
  onIncidentClosed?: () => void;
}

export const OutageUpdateModal: React.FC<OutageUpdateModalProps> = ({
  isOpen,
  onClose,
  outage,
  onIncidentClosed,
}) => {
  const { outages, updateOutage, resolveOutage, olts } = useISP();

  const targetOutage =
    outage ||
    outages.find((o) => o.status === 'investigating' || o.status === 'active' || o.status === 'splicing' || o.status === 'testing') ||
    outages[0];

  const [status, setStatus] = useState<OutageStatus>('splicing');
  const [areaNode, setAreaNode] = useState('');
  const [ponPort, setPonPort] = useState('GPON0/2');
  const [estimatedResolutionTime, setEstimatedResolutionTime] = useState('');
  const [workNotes, setWorkNotes] = useState('');
  const [broadcastWhatsApp, setBroadcastWhatsApp] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (targetOutage) {
      setStatus(targetOutage.status);
      setAreaNode(targetOutage.areaNode || 'Sector-G11-PON-02');
      setPonPort(targetOutage.ponPort || 'GPON0/2');
      setWorkNotes(
        targetOutage.workNotes ||
          'Splicing crew has re-pulled 48-core ribbon fiber. Fusion splicing in progress on core 1-12.'
      );

      if (targetOutage.estimatedResolutionTime) {
        try {
          const d = new Date(targetOutage.estimatedResolutionTime);
          const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
          setEstimatedResolutionTime(iso);
        } catch {
          setEstimatedResolutionTime('');
        }
      } else {
        const defaultEta = new Date(Date.now() + 2 * 60 * 60 * 1000);
        const iso = new Date(defaultEta.getTime() - defaultEta.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setEstimatedResolutionTime(iso);
      }
    }
  }, [targetOutage, isOpen]);

  if (!isOpen || !targetOutage) return null;

  const handleQuickEta = (hours: number) => {
    const d = new Date(Date.now() + hours * 60 * 60 * 1000);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setEstimatedResolutionTime(iso);
  };

  const handleSaveUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (status === 'resolved') {
      // Close incident path
      resolveOutage(targetOutage.id, workNotes || 'Incident resolved and verified by NOC.', broadcastWhatsApp);
      if (onIncidentClosed) onIncidentClosed();
    } else {
      updateOutage(
        targetOutage.id,
        {
          status,
          areaNode,
          ponPort,
          workNotes,
          estimatedResolutionTime: estimatedResolutionTime
            ? new Date(estimatedResolutionTime).toISOString()
            : targetOutage.estimatedResolutionTime,
        },
        broadcastWhatsApp
      );
    }

    setIsSubmitting(false);
    onClose();
  };

  const handleDirectCloseIncident = () => {
    if (!confirm('Are you sure you want to mark this network disruption as RESOLVED? This will immediately dismiss the alert banner and dispatch a "Network Restored" WhatsApp broadcast to subscribers.')) {
      return;
    }
    setIsSubmitting(true);
    resolveOutage(
      targetOutage.id,
      workNotes || 'Fiber link spliced, optical signal measured at -19.2 dBm, all subscriber PPPoE sessions verified.',
      broadcastWhatsApp
    );
    setIsSubmitting(false);
    if (onIncidentClosed) onIncidentClosed();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-600 text-white shadow-md shadow-rose-600/20">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">Manage &amp; Update Outage Incident</h3>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase bg-rose-950 text-rose-300 border border-rose-800">
                  {targetOutage.severity}
                </span>
              </div>
              <p className="text-slate-400 text-xs mt-0.5 font-mono">
                Incident ID: {targetOutage.id} &bull; Affected: {targetOutage.affectedCustomersCount} Subscribers
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSaveUpdate} className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
          {/* Incident Headline Notice */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Incident Title</span>
              <span className="text-white font-bold text-xs">{targetOutage.title}</span>
            </div>
            <span className="text-rose-400 text-[11px] font-bold">
              {targetOutage.affectedCustomersCount} Subs Affected
            </span>
          </div>

          {/* 1. Status Dropdown */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1">
              Incident Remediation Status *
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'investigating', label: 'Investigating', color: 'border-amber-700 text-amber-300 bg-amber-950/40' },
                { id: 'splicing', label: 'In Progress / Splicing', color: 'border-rose-700 text-rose-300 bg-rose-950/40' },
                { id: 'testing', label: 'Testing Optical Link', color: 'border-cyan-700 text-cyan-300 bg-cyan-950/40' },
                { id: 'resolved', label: 'Resolved / Cleared', color: 'border-emerald-700 text-emerald-300 bg-emerald-950/40' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatus(s.id as OutageStatus)}
                  className={`p-2 rounded-xl text-center border font-bold text-xs transition cursor-pointer ${
                    status === s.id
                      ? `${s.color} ring-1 ring-white/20 shadow-md`
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Affected Area / PON Port Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Affected Area / Node
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  value={areaNode}
                  onChange={(e) => setAreaNode(e.target.value)}
                  placeholder="e.g. Sector-G11-PON-02"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Fiber PON SFP Port
              </label>
              <div className="relative">
                <Layers className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <select
                  value={ponPort}
                  onChange={(e) => setPonPort(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  <option value="GPON0/1">GPON0/1 - Sector F-10 Main Feeder</option>
                  <option value="GPON0/2">GPON0/2 - Sector G-11 Primary Hub</option>
                  <option value="GPON0/3">GPON0/3 - Sector G-10 Sub Distribution</option>
                  <option value="EPON0/1">EPON0/1 - Sector I-8 Commercial</option>
                  <option value="EPON0/2">EPON0/2 - Sector H-9 Mixed Loop</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. Estimated Resolution Time (ETA) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-slate-400 font-semibold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Estimated Resolution Time (ETA)</span>
              </label>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="text-slate-500">Quick:</span>
                <button
                  type="button"
                  onClick={() => handleQuickEta(1)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  +1h
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickEta(2)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  +2h
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickEta(4)}
                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                >
                  +4h
                </button>
              </div>
            </div>
            <input
              type="datetime-local"
              value={estimatedResolutionTime}
              onChange={(e) => setEstimatedResolutionTime(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 text-xs focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>

          {/* 4. Work Notes / Splicing Progress */}
          <div>
            <label className="block text-slate-400 font-semibold mb-1 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>NOC Work Notes &amp; Field Progress</span>
            </label>
            <textarea
              rows={3}
              value={workNotes}
              onChange={(e) => setWorkNotes(e.target.value)}
              placeholder="e.g. Splicing crew has re-pulled 48-core ribbon fiber. 12 fibers spliced so far."
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white text-xs focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          {/* 5. WhatsApp Broadcast Checkbox */}
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-950 text-emerald-400 border border-emerald-800">
                <Send className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="font-bold text-white block">
                  Broadcast update to affected customers via WhatsApp
                </span>
                <span className="text-[10px] text-slate-400">
                  {status === 'resolved'
                    ? 'Dispatches "Network Restored - Optical Link Cleared" notice to subscribers'
                    : `Dispatches current status (${status.toUpperCase()}) & ETA to ${targetOutage.affectedCustomersCount} subscribers`}
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={broadcastWhatsApp}
              onChange={(e) => setBroadcastWhatsApp(e.target.checked)}
              className="w-4 h-4 accent-cyan-500 cursor-pointer"
            />
          </div>

          {/* If status is "resolved", show prominent Close Incident Callout */}
          {status === 'resolved' && (
            <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-600/70 text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Ready to Clear Disruption Banner</span>
              </div>
              <p className="text-[11px] text-emerald-300/80">
                Clicking <strong>"Close Incident"</strong> will immediately remove the red alert banner from all dashboards and notify subscribers that service has resumed.
              </p>
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-800">
            {/* Direct Close Button if already in resolved status or quick action */}
            {status === 'resolved' ? (
              <button
                type="button"
                onClick={handleDirectCloseIncident}
                disabled={isSubmitting}
                className="px-5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-emerald-950/50 flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Close Incident &amp; Clear Banner</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStatus('resolved')}
                className="px-3 py-1.5 bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-emerald-800 rounded-xl font-bold transition flex items-center gap-1.5 text-xs cursor-pointer"
                title="Mark incident as cleared"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Mark as Resolved</span>
              </button>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/50 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Wrench className="w-3.5 h-3.5" />
                <span>{status === 'resolved' ? 'Save Resolution' : 'Save & Update Outage'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
