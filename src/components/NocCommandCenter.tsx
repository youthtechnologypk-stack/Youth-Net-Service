import React, { useState } from 'react';
import { Activity, Gauge, MapPin } from 'lucide-react';
import { NocOverview } from './NocOverview';
import { CapacityPlannerView } from './CapacityPlannerView';
import { AreaNodeManagerModal } from './AreaNodeManagerModal';
import { ActiveTab } from './Header';

export interface NocCommandCenterProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  onOpenAddRouterModal?: () => void;
  initialSection?: 'overview' | 'capacity';
}

export const NocCommandCenter: React.FC<NocCommandCenterProps> = ({
  initialSection = 'overview',
  ...props
}) => {
  const [section, setSection] = useState<'overview' | 'capacity'>(initialSection);
  const [isAreaManagerOpen, setIsAreaManagerOpen] = useState<boolean>(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setSection('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              section === 'overview'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>NOC Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setSection('capacity')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap ${
              section === 'capacity'
                ? 'bg-cyan-600 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gauge className="w-3.5 h-3.5" />
            <span>Capacity &amp; Pools (1:6 CIR)</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsAreaManagerOpen(true)}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
        >
          <MapPin className="w-3.5 h-3.5 text-cyan-400" />
          <span>Area &amp; Node Manager</span>
        </button>
      </div>

      {section === 'capacity' ? (
        <CapacityPlannerView />
      ) : (
        <NocOverview {...props} />
      )}

      <AreaNodeManagerModal
        isOpen={isAreaManagerOpen}
        onClose={() => setIsAreaManagerOpen(false)}
      />
    </div>
  );
};

export default NocCommandCenter;
