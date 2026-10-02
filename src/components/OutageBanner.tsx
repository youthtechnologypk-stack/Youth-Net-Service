import React, { useState } from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  Wrench,
  Radio,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { AreaOutage } from '../types/isp';
import { useISP } from '../context/ISPContext';
import { OutageUpdateModal } from './OutageUpdateModal';
import { ActiveTab } from './Header';

interface OutageBannerProps {
  onNavigateTab?: (tab: ActiveTab) => void;
  className?: string;
}

export const OutageBanner: React.FC<OutageBannerProps> = ({
  onNavigateTab,
  className = '',
}) => {
  const { outages } = useISP();

  // Find the first active outage (not resolved)
  const activeOutage = outages.find(
    (o) =>
      o.status === 'investigating' ||
      o.status === 'active' ||
      o.status === 'splicing' ||
      o.status === 'testing'
  );

  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // If there's no active outage, or if the admin manually dismissed it for this session, render nothing
  if (!activeOutage || isDismissed) {
    return null;
  }

  const formatEta = (isoString?: string) => {
    if (!isoString) return 'Pending assessment';
    try {
      const d = new Date(isoString);
      const diffMs = d.getTime() - Date.now();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${hours > 0 ? `${hours}h ` : ''}${mins}m remaining`;
      }
      return `Overdue (ETA was ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } catch {
      return 'Pending assessment';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'investigating':
        return { text: 'INVESTIGATING', bg: 'bg-amber-950 text-amber-300 border-amber-800' };
      case 'splicing':
        return { text: 'SPLICING IN PROGRESS', bg: 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse' };
      case 'testing':
        return { text: 'OPTICAL LINK TESTING', bg: 'bg-cyan-950 text-cyan-300 border-cyan-700' };
      default:
        return { text: 'ACTIVE DISRUPTION', bg: 'bg-rose-900 text-rose-200 border-rose-700' };
    }
  };

  const statusBadge = getStatusBadge(activeOutage.status);

  // Minimized state: slim bar to save screen real estate while keeping NOC aware
  if (isMinimized) {
    return (
      <>
        <div
          className={`bg-rose-950/90 border border-rose-700/80 px-4 py-2 rounded-xl flex items-center justify-between gap-3 text-xs font-mono shadow-md animate-fade-in ${className}`}
        >
          <div className="flex items-center gap-2.5 truncate">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping shrink-0" />
            <span className="font-bold text-rose-200">
              [Minimized Outage] {activeOutage.title}
            </span>
            <span className="hidden sm:inline text-rose-300/80">
              &bull; {activeOutage.areaNode} ({activeOutage.affectedCustomersCount} subs affected)
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsUpdateModalOpen(true)}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-rose-200 border border-rose-800 font-bold text-[11px] transition cursor-pointer"
            >
              Update Outage
            </button>
            <button
              onClick={() => setIsMinimized(false)}
              className="p-1 rounded bg-rose-900/60 hover:bg-rose-800 text-rose-200 transition cursor-pointer flex items-center gap-1 text-[11px]"
              title="Expand Outage Alert"
            >
              <ChevronDown className="w-4 h-4" />
              <span className="hidden sm:inline">Expand</span>
            </button>
            <button
              onClick={() => setIsDismissed(true)}
              className="p-1 text-rose-400 hover:text-white rounded hover:bg-rose-900/50 transition cursor-pointer"
              title="Dismiss Alert"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <OutageUpdateModal
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
          outage={activeOutage}
        />
      </>
    );
  }

  // Full Expanded Red Banner
  return (
    <>
      <div
        className={`bg-rose-950/85 border border-rose-600/80 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl shadow-rose-950/50 relative overflow-hidden transition-all duration-300 ${className}`}
      >
        {/* Top-Right Control Buttons: Minimize (_) and Dismiss (✕) */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 z-10 font-mono">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 rounded-md text-rose-300/80 hover:text-white hover:bg-rose-900/60 transition cursor-pointer"
            title="Minimize Alert Banner"
            aria-label="Minimize Alert"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsDismissed(true)}
            className="p-1 rounded-md text-rose-300/80 hover:text-white hover:bg-rose-900/60 transition cursor-pointer"
            title="Temporarily Dismiss Alert Banner"
            aria-label="Dismiss Alert"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Left Side: Alert Icon & Incident Details */}
        <div className="flex items-start sm:items-center gap-3.5 pr-14 md:pr-0">
          <div className="p-3 bg-gradient-to-tr from-rose-600 to-red-600 rounded-xl text-white shadow-lg shadow-rose-600/30 shrink-0 animate-pulse">
            <ShieldAlert className="w-6 h-6" />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-rose-200 uppercase tracking-wide text-xs">
                Active Major Network Disruption
              </span>

              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase border ${statusBadge.bg}`}
              >
                {statusBadge.text}
              </span>

              <span className="text-[10px] bg-slate-950 text-cyan-300 px-2 py-0.5 rounded font-mono border border-slate-800">
                {activeOutage.ponPort || activeOutage.areaNode}
              </span>
            </div>

            <h3 className="text-white font-bold text-sm mt-1">
              {activeOutage.title}
            </h3>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-rose-300/90 font-mono mt-1">
              <span>
                Affecting <strong className="text-white">{activeOutage.affectedCustomersCount}</strong> subscribers
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1 text-amber-300">
                <Clock className="w-3 h-3" />
                <span>ETA: {formatEta(activeOutage.estimatedResolutionTime)}</span>
              </span>
              {activeOutage.workNotes && (
                <>
                  <span>&bull;</span>
                  <span className="text-rose-200 truncate max-w-xs md:max-w-md">
                    {activeOutage.workNotes}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Action Buttons */}
        <div className="flex items-center gap-2.5 w-full md:w-auto self-end md:self-auto font-mono text-xs">
          {onNavigateTab && (
            <button
              onClick={() => onNavigateTab('complaints')}
              className="flex-1 md:flex-none bg-rose-600 hover:bg-rose-500 text-white font-bold px-3.5 py-2 rounded-xl transition shadow-md shadow-rose-950/40 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>View Splicing SLA</span>
            </button>
          )}

          <button
            onClick={() => setIsUpdateModalOpen(true)}
            className="flex-1 md:flex-none bg-slate-900 hover:bg-slate-800 text-rose-200 hover:text-white border border-rose-700/70 font-bold px-3.5 py-2 rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Wrench className="w-3.5 h-3.5 text-rose-400" />
            <span>Update Outage Alert</span>
          </button>
        </div>
      </div>

      {/* Outage Management & Update Modal */}
      <OutageUpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => setIsUpdateModalOpen(false)}
        outage={activeOutage}
      />
    </>
  );
};
