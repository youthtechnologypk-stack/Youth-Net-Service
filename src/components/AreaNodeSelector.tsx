import React, { useState, useEffect, useCallback } from 'react';
import { MapPin, Plus, Check, X, Server, RefreshCw, Edit3 } from 'lucide-react';
import {
  NetworkAreaNode,
  PARENT_FLEET_ROUTER,
  DEFAULT_NETWORK_AREAS,
  NETWORK_AREAS_UPDATED_EVENT,
  fetchNetworkAreas,
  createChildNetworkArea,
} from '../lib/billingAndNetwork';
import { supabase } from '../services/supabaseClient';
import { AreaNodeManagerModal } from './AreaNodeManagerModal';

export interface AreaNodeSelectorProps {
  value: string;
  onChange: (areaName: string) => void;
  areas?: NetworkAreaNode[];
  onAreasUpdated?: (areas: NetworkAreaNode[]) => void;
  label?: string;
  className?: string;
  compact?: boolean;
}

export const AreaNodeSelector: React.FC<AreaNodeSelectorProps> = ({
  value,
  onChange,
  areas: externalAreas,
  onAreasUpdated,
  label = 'Area / Child Node',
  className = '',
  compact = false,
}) => {
  const [internalAreas, setInternalAreas] = useState<NetworkAreaNode[]>(
    externalAreas && externalAreas.length > 0 ? externalAreas : DEFAULT_NETWORK_AREAS
  );
  const [isAddingArea, setIsAddingArea] = useState(false);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [newAreaName, setNewAreaName] = useState('');
  const [newPrefixCode, setNewPrefixCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const areaList = externalAreas && externalAreas.length > 0 ? externalAreas : internalAreas;

  const refreshAreas = useCallback(() => {
    fetchNetworkAreas()
      .then((rows) => {
        setInternalAreas(rows);
        if (onAreasUpdated) onAreasUpdated(rows);
      })
      .catch(() => {});
  }, [onAreasUpdated]);

  useEffect(() => {
    if (!externalAreas || externalAreas.length === 0) {
      refreshAreas();
    }
  }, [externalAreas, refreshAreas]);

  useEffect(() => {
    const onUpdatedEvent = () => refreshAreas();
    window.addEventListener(NETWORK_AREAS_UPDATED_EVENT, onUpdatedEvent);

    const ch = supabase
      .channel('public:area_node_selector_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_areas' }, () => {
        refreshAreas();
      })
      .subscribe();

    return () => {
      window.removeEventListener(NETWORK_AREAS_UPDATED_EVENT, onUpdatedEvent);
      supabase.removeChannel(ch);
    };
  }, [refreshAreas]);

  const handleAddChildArea = async () => {
    const cleanName = newAreaName.trim();
    if (!cleanName) {
      setErrorMsg('Enter child area name');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);
    const res = await createChildNetworkArea(cleanName, newPrefixCode.trim());
    setIsSaving(false);

    if (!res.success) {
      setErrorMsg(res.error || 'Could not add child area');
      return;
    }

    const updated = [...areaList];
    if (res.data && !updated.some((a) => a.area_name.toLowerCase() === res.data!.area_name.toLowerCase())) {
      updated.push(res.data);
      updated.sort((a, b) => a.area_name.localeCompare(b.area_name));
    }
    setInternalAreas(updated);
    if (onAreasUpdated) onAreasUpdated(updated);
    onChange(res.data?.area_name || cleanName);
    setNewAreaName('');
    setNewPrefixCode('');
    setIsAddingArea(false);
  };

  const hasCurrentValueInList = areaList.some(
    (a) => a.area_name.toLowerCase() === (value || '').trim().toLowerCase()
  );

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-slate-400 font-medium text-xs flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-cyan-400" />
          <span>{label}</span>
        </label>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsManagerOpen(true)}
            className="text-[11px] font-mono text-indigo-300 hover:text-indigo-200 flex items-center gap-1 cursor-pointer"
            title="Open Area & Node Manager to add or edit mohallahs"
          >
            <Edit3 className="w-3 h-3" />
            <span>Manage Areas</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAddingArea((prev) => !prev);
              setErrorMsg(null);
            }}
            className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>{isAddingArea ? 'Cancel' : '+ Add New Child Area'}</span>
          </button>
        </div>
      </div>

      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full bg-slate-950 border border-slate-700 text-slate-100 rounded-lg focus:outline-none focus:border-cyan-500 font-sans cursor-pointer ${
            compact ? 'p-2 text-xs' : 'p-2.5 text-xs'
          }`}
        >
          <optgroup label={`${PARENT_FLEET_ROUTER} (Parent Fleet Node)`}>
            {!hasCurrentValueInList && value && (
              <option value={value}>{value}</option>
            )}
            {areaList.map((area) => (
              <option key={area.id || area.area_name} value={area.area_name}>
                {area.area_name} {area.prefix_code ? `[${area.prefix_code}]` : ''}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
        <Server className="w-3 h-3 text-indigo-400 shrink-0" />
        <span>Parent Fleet: <strong className="text-indigo-300">{PARENT_FLEET_ROUTER}</strong></span>
      </div>

      {isAddingArea && (
        <div className="p-2.5 bg-slate-950 border border-cyan-800/70 rounded-lg space-y-2 animate-fade-in">
          <div className="text-[11px] font-mono text-cyan-300 font-bold">
            New Child Area under {PARENT_FLEET_ROUTER}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Area Name (e.g. Model Town)"
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              className="sm:col-span-2 bg-slate-900 border border-slate-700 text-slate-100 px-2.5 py-1.5 rounded text-xs focus:outline-none focus:border-cyan-500"
            />
            <input
              type="text"
              placeholder="Prefix (e.g. mt)"
              value={newPrefixCode}
              onChange={(e) => setNewPrefixCode(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-100 px-2.5 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>
          {errorMsg && <p className="text-[11px] text-rose-400 font-mono">{errorMsg}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAddingArea(false)}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer"
            >
              <X className="w-3 h-3 inline mr-1" />
              Close
            </button>
            <button
              type="button"
              onClick={handleAddChildArea}
              disabled={isSaving}
              className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>Save Child Area</span>
            </button>
          </div>
        </div>
      )}

      <AreaNodeManagerModal
        isOpen={isManagerOpen}
        onClose={() => setIsManagerOpen(false)}
        onAreasUpdated={(updated) => {
          setInternalAreas(updated);
          if (onAreasUpdated) onAreasUpdated(updated);
        }}
      />
    </div>
  );
};

export default AreaNodeSelector;
