import React from 'react';
import {
  Shield,
  MapPin,
  Wallet,
  Lock,
  Radio,
  Sparkles,
  Check,
  Briefcase,
  Cpu,
  UserCheck,
} from 'lucide-react';
import {
  BooleanPermissionKey,
  PERMISSION_CATEGORIES,
  STAFF_PERMISSION_PRESETS,
  StaffPermissions,
  StaffPresetKey,
  countEnabledPermissions,
  detectMatchingPreset,
  getPresetPermissions,
} from '../lib/staffPermissions';
import { GIS_PERMISSION_OPTIONS, GisMapPermission } from '../lib/gisAccessControl';

export interface StaffPermissionsEditorProps {
  value: StaffPermissions;
  onChange: (next: StaffPermissions) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const StaffPermissionsEditor: React.FC<StaffPermissionsEditorProps> = ({
  value,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const activePreset = detectMatchingPreset(value);
  const enabledCount = countEnabledPermissions(value);

  const handleApplyPreset = (presetKey: StaffPresetKey) => {
    if (disabled) return;
    onChange(getPresetPermissions(presetKey));
  };

  const handleToggle = (key: BooleanPermissionKey) => {
    if (disabled) return;
    onChange({
      ...value,
      [key]: !value[key],
    });
  };

  const handleGisChange = (gisPerm: GisMapPermission) => {
    if (disabled) return;
    onChange({
      ...value,
      gis_map: gisPerm,
    });
  };

  const getPresetIcon = (key: StaffPresetKey) => {
    if (key === 'field_recovery_agent') return <UserCheck className="w-3.5 h-3.5" />;
    if (key === 'noc_technician') return <Cpu className="w-3.5 h-3.5" />;
    return <Briefcase className="w-3.5 h-3.5" />;
  };

  const getCategoryIcon = (id: string) => {
    if (id === 'network_gis') return <Radio className="w-3.5 h-3.5 text-sky-400" />;
    if (id === 'billing_cash') return <Wallet className="w-3.5 h-3.5 text-emerald-400" />;
    return <Lock className="w-3.5 h-3.5 text-amber-400" />;
  };

  return (
    <div className="space-y-3.5">
      {/* Header + Enabled Counter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/80 text-cyan-400">
            <Shield className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white tracking-tight">
              Granular RBAC Feature Permissions
            </h4>
            <p className="text-[10px] text-slate-400">
              Toggle individual tabs, billing actions &amp; privacy controls ON or OFF for this staff member.
            </p>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-slate-950 border border-slate-700 text-[10px] font-mono font-bold text-cyan-300">
          {enabledCount} / 12 Enabled
        </span>
      </div>

      {/* 1-Click Quick Role Presets */}
      <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-xl space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Quick Role Presets (1-Click Setup)</span>
          </span>
          {!activePreset && (
            <span className="text-[10px] font-mono text-cyan-400">Custom Mix Active</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {STAFF_PERMISSION_PRESETS.map((preset) => {
            const isSelected = activePreset === preset.key;
            const activeClass =
              preset.badgeColor === 'emerald'
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 ring-1 ring-emerald-500/40'
                : preset.badgeColor === 'indigo'
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500/40'
                : 'bg-cyan-950/80 border-cyan-500 text-cyan-200 ring-1 ring-cyan-500/40';
            return (
              <button
                key={preset.key}
                type="button"
                disabled={disabled}
                onClick={() => handleApplyPreset(preset.key)}
                className={`p-2.5 rounded-xl border text-left transition cursor-pointer disabled:opacity-50 ${
                  isSelected
                    ? activeClass
                    : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-bold text-[11px] flex items-center gap-1.5">
                    {getPresetIcon(preset.key)}
                    <span>{preset.label}</span>
                  </span>
                  {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                </div>
                <span className="block text-[10px] text-slate-400 mt-1 leading-snug">
                  {preset.subtitle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3 Grouped Permission Categories */}
      <div className="space-y-3">
        {PERMISSION_CATEGORIES.map((category) => (
          <div
            key={category.id}
            className="bg-slate-950/90 border border-slate-800 rounded-xl overflow-hidden"
          >
            {/* Category Header */}
            <div className="px-3.5 py-2.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {getCategoryIcon(category.id)}
                <div className="min-w-0">
                  <span className="text-[11px] font-bold text-white block truncate">
                    {category.title}
                  </span>
                  {!compact && (
                    <span className="text-[10px] text-slate-400 block truncate">
                      {category.subtitle}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-800/70">
              {/* Special 3-State Selector for Fiber GIS & Map */}
              {category.includesGisSelector && (
                <div className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-xs font-semibold text-slate-100">
                        Fiber GIS &amp; Map Access
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                        value.gis_map === 'edit'
                          ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                          : value.gis_map === 'view'
                          ? 'bg-sky-950/80 border-sky-700 text-sky-300'
                          : 'bg-rose-950/80 border-rose-800 text-rose-300'
                      }`}
                    >
                      {value.gis_map === 'edit'
                        ? 'Full Edit & Splice'
                        : value.gis_map === 'view'
                        ? 'View & Trace Only'
                        : 'Disabled'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {GIS_PERMISSION_OPTIONS.map((opt) => {
                      const active = value.gis_map === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          disabled={disabled}
                          onClick={() => handleGisChange(opt.value)}
                          className={`px-2.5 py-2 rounded-lg border text-left transition cursor-pointer disabled:opacity-50 ${
                            active
                              ? opt.value === 'edit'
                                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
                                : opt.value === 'view'
                                ? 'bg-sky-950/80 border-sky-500 text-sky-200'
                                : 'bg-rose-950/80 border-rose-500 text-rose-200'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                          }`}
                        >
                          <span className="block text-[11px] font-bold leading-tight">
                            {opt.shortLabel}
                          </span>
                          <span className="block text-[9px] text-slate-400 mt-0.5 leading-tight">
                            {opt.value === 'none'
                              ? 'Hidden from nav & routes'
                              : opt.value === 'view'
                              ? 'Field read & trace mode'
                              : 'Place boxes, cables & splice'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Boolean Feature Toggle Switches */}
              {category.toggles.map((item) => {
                const isOn = Boolean(value[item.key]);
                return (
                  <div
                    key={item.key}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-900/50 transition"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-slate-100 block leading-snug">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-slate-400 block leading-snug mt-0.5">
                        {item.description}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOn}
                      aria-label={item.label}
                      disabled={disabled}
                      onClick={() => handleToggle(item.key)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition cursor-pointer disabled:opacity-50 ${
                        isOn
                          ? 'bg-emerald-600 border-emerald-400'
                          : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                          isOn ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default StaffPermissionsEditor;
