import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Search,
  Filter,
  Users,
  Smartphone,
  Briefcase,
  Layers,
  Database,
  Sliders,
  Sparkles,
  Info,
  UserCheck,
  Check,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { SystemRole, UserAccount } from '../types/auth';
import {
  FeatureKey,
  FEATURE_CATALOG,
  FeatureDefinition,
  DEFAULT_ROLE_PERMISSIONS,
} from '../types/permissions';
import { usePermissions } from '../context/PermissionContext';
import { INITIAL_USER_ACCOUNTS } from '../data/initialUsers';

interface PermissionMatrixStudioProps {
  currentSimulatedRole?: SystemRole;
  onSwitchSimulatedRole?: (role: SystemRole) => void;
  onNavigateToUser?: (userId: string) => void;
}

export const PermissionMatrixStudio: React.FC<PermissionMatrixStudioProps> = ({
  currentSimulatedRole = 'ADMIN',
  onSwitchSimulatedRole,
  onNavigateToUser,
}) => {
  const {
    permissions,
    userOverrides,
    isLoading,
    lastSync,
    hasPermission,
    updateRolePermission,
    batchUpdateRolePermissions,
    resetRolePermissions,
    updateUserPermissionOverride,
    refreshPermissions,
  } = usePermissions();

  const [activeRoleTab, setActiveRoleTab] = useState<'ALL' | 'MANAGER' | 'AGENT' | 'CLIENT'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Active view: 'matrix' or 'user_overrides'
  const [activeView, setActiveView] = useState<'matrix' | 'user_overrides'>('matrix');

  // Selected user for overrides view
  const [selectedUserForOverride, setSelectedUserForOverride] = useState<UserAccount | null>(null);

  // Local users list
  const [userList] = useState<UserAccount[]>(() => {
    try {
      const stored = localStorage.getItem('netpulse_user_accounts_v1');
      return stored ? JSON.parse(stored) : INITIAL_USER_ACCOUNTS;
    } catch {
      return INITIAL_USER_ACCOUNTS;
    }
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Toggle single permission for a role
  const handleToggle = async (role: SystemRole, key: FeatureKey, currentStatus: boolean) => {
    const nextStatus = !currentStatus;
    await updateRolePermission(role, key, nextStatus);
    showToast(
      `${nextStatus ? 'Enabled' : 'Disabled'} "${FEATURE_CATALOG.find((f) => f.key === key)?.name}" for ${role}. Synced to database.`
    );
  };

  // Enable all in filtered/target role
  const handleEnableAllForRole = async (targetRole: SystemRole) => {
    const roleFeatures = FEATURE_CATALOG.filter((f) => f.role === targetRole);
    const updates: Record<string, boolean> = {};
    roleFeatures.forEach((f) => {
      updates[f.key] = true;
    });
    await batchUpdateRolePermissions(targetRole, updates);
    showToast(`All features enabled for ${targetRole} role.`);
  };

  // Disable all in filtered/target role
  const handleDisableAllForRole = async (targetRole: SystemRole) => {
    const roleFeatures = FEATURE_CATALOG.filter((f) => f.role === targetRole);
    const updates: Record<string, boolean> = {};
    roleFeatures.forEach((f) => {
      updates[f.key] = false;
    });
    await batchUpdateRolePermissions(targetRole, updates);
    showToast(`All optional features disabled for ${targetRole} role.`);
  };

  // Reset to default
  const handleReset = async (targetRole?: SystemRole) => {
    await resetRolePermissions(targetRole);
    showToast(
      targetRole
        ? `Reset ${targetRole} permissions to system default.`
        : 'Reset all role permissions to factory defaults.'
    );
  };

  // Filter features
  const filteredFeatures = FEATURE_CATALOG.filter((feat) => {
    if (activeRoleTab !== 'ALL' && feat.role !== activeRoleTab) return false;
    if (selectedCategory !== 'ALL' && feat.category !== selectedCategory) return false;

    // Check status
    const isCurrentlyEnabled = permissions[feat.role]?.[feat.key] ?? feat.defaultEnabled;
    if (statusFilter === 'ENABLED' && !isCurrentlyEnabled) return false;
    if (statusFilter === 'DISABLED' && isCurrentlyEnabled) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      feat.name.toLowerCase().includes(q) ||
      feat.description.toLowerCase().includes(q) ||
      feat.module.toLowerCase().includes(q) ||
      feat.key.toLowerCase().includes(q) ||
      feat.role.toLowerCase().includes(q)
    );
  });

  // Calculate statistics
  const managerFeatures = FEATURE_CATALOG.filter((f) => f.role === 'MANAGER');
  const agentFeatures = FEATURE_CATALOG.filter((f) => f.role === 'AGENT');
  const clientFeatures = FEATURE_CATALOG.filter((f) => f.role === 'CLIENT');

  const managerEnabledCount = managerFeatures.filter(
    (f) => permissions.MANAGER?.[f.key] ?? f.defaultEnabled
  ).length;
  const agentEnabledCount = agentFeatures.filter(
    (f) => permissions.AGENT?.[f.key] ?? f.defaultEnabled
  ).length;
  const clientEnabledCount = clientFeatures.filter(
    (f) => permissions.CLIENT?.[f.key] ?? f.defaultEnabled
  ).length;

  const totalTracked = FEATURE_CATALOG.length;
  const totalEnabled = managerEnabledCount + agentEnabledCount + clientEnabledCount;

  return (
    <div className="space-y-6 text-xs font-sans max-w-7xl mx-auto pb-12">
      {/* 1. Header & Controls Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-600 via-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-extrabold text-white tracking-tight">
                    Feature &amp; Permission Management Matrix
                  </h1>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                    PostgreSQL RBAC Engine
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dynamically govern system capabilities, financial visibility, and self-service toggles across Managers, Field Agents, and Client Portals.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto justify-end">
            <button
              onClick={() => refreshPermissions()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition cursor-pointer"
              title="Refresh permissions from PostgreSQL"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={() => handleReset(activeRoleTab === 'ALL' ? undefined : activeRoleTab)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-900/40 text-xs font-bold transition cursor-pointer"
              title="Reset selected role to recommended ISP defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>
            <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveView('matrix')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeView === 'matrix' ? 'bg-cyan-600 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Role Matrix
              </button>
              <button
                onClick={() => setActiveView('user_overrides')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  activeView === 'user_overrides'
                    ? 'bg-cyan-600 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                User Overrides ({Object.keys(userOverrides).length})
              </button>
            </div>
          </div>
        </div>

        {/* Sync & Live Simulation Strip */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-slate-400">Persistence Target:</span>
            <span className="text-emerald-400 font-bold">role_permissions</span>
            <span className="text-slate-500 text-[11px]">(PostgreSQL JSONB + Local Fallback)</span>
            {lastSync && (
              <span className="text-slate-500 text-[10px]">
                &bull; Synced {lastSync.toLocaleTimeString()}
              </span>
            )}
          </div>

          {onSwitchSimulatedRole && (
            <div className="flex items-center gap-2 self-end md:self-auto">
              <span className="text-slate-400">Live Preview As:</span>
              <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                {(['ADMIN', 'MANAGER', 'AGENT', 'CLIENT'] as SystemRole[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => onSwitchSimulatedRole(r)}
                    className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                      currentSimulatedRole === r
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Toast Banner */}
      {toastMessage && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-600 rounded-xl text-emerald-200 text-xs font-mono flex items-center justify-between shadow-xl animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-emerald-400 hover:text-white">
            &times;
          </button>
        </div>
      )}

      {/* 2. Top Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <span className="text-[11px] text-slate-400 font-medium block">All System Features</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-2xl font-bold font-mono text-white">{totalTracked}</span>
            <span className="text-[11px] text-emerald-400 font-mono font-bold">
              {totalEnabled} active ({Math.round((totalEnabled / totalTracked) * 100)}%)
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-indigo-300 font-medium block">Manager Role</span>
            <Briefcase className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono text-indigo-300">
              {managerEnabledCount}/{managerFeatures.length}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {managerFeatures.length - managerEnabledCount} disabled
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-cyan-300 font-medium block">Field Agent Role</span>
            <UserCheck className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono text-cyan-300">
              {agentEnabledCount}/{agentFeatures.length}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {agentFeatures.length - agentEnabledCount} disabled
            </span>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-emerald-300 font-medium block">Client Portal Role</span>
            <Smartphone className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-300">
              {clientEnabledCount}/{clientFeatures.length}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {clientFeatures.length - clientEnabledCount} disabled
            </span>
          </div>
        </div>
      </div>

      {activeView === 'matrix' ? (
        <>
          {/* 3. Filter Bar & Quick Actions */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
              {/* Role Filter Pills */}
              <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 overflow-x-auto">
                <button
                  onClick={() => setActiveRoleTab('ALL')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap cursor-pointer ${
                    activeRoleTab === 'ALL'
                      ? 'bg-slate-800 text-white shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All Roles ({totalTracked})
                </button>
                <button
                  onClick={() => setActiveRoleTab('MANAGER')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    activeRoleTab === 'MANAGER'
                      ? 'bg-indigo-600 text-white shadow'
                      : 'text-indigo-400 hover:text-indigo-200'
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  <span>Manager ({managerFeatures.length})</span>
                </button>
                <button
                  onClick={() => setActiveRoleTab('AGENT')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    activeRoleTab === 'AGENT'
                      ? 'bg-cyan-600 text-slate-950 shadow'
                      : 'text-cyan-400 hover:text-cyan-200'
                  }`}
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Field Agent ({agentFeatures.length})</span>
                </button>
                <button
                  onClick={() => setActiveRoleTab('CLIENT')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                    activeRoleTab === 'CLIENT'
                      ? 'bg-emerald-600 text-slate-950 shadow'
                      : 'text-emerald-400 hover:text-emerald-200'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Client Portal ({clientFeatures.length})</span>
                </button>
              </div>

              {/* Search & Status Controls */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search feature or module..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      &times;
                    </button>
                  )}
                </div>

                <select
                  value={statusFilter}
                  onChange={(e: any) => setStatusFilter(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-xs text-slate-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value="ALL">All Status</option>
                  <option value="ENABLED">Only Enabled</option>
                  <option value="DISABLED">Only Disabled</option>
                </select>
              </div>
            </div>

            {/* Quick Bulk Action Buttons for Active Role */}
            {activeRoleTab !== 'ALL' && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                <span className="text-slate-400">
                  Bulk control for <strong className="text-white">{activeRoleTab}</strong> features:
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEnableAllForRole(activeRoleTab)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900 transition font-bold cursor-pointer"
                  >
                    Enable All {activeRoleTab}
                  </button>
                  <button
                    onClick={() => handleDisableAllForRole(activeRoleTab)}
                    className="px-2.5 py-1 rounded-lg bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900 transition font-bold cursor-pointer"
                  >
                    Disable All {activeRoleTab}
                  </button>
                  <button
                    onClick={() => handleReset(activeRoleTab)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition cursor-pointer"
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 4. Granular Feature Toggle Cards Grid */}
          <div className="space-y-4">
            {/* Group by Role if ALL is selected, or show single role group */}
            {(['MANAGER', 'AGENT', 'CLIENT'] as const)
              .filter((role) => activeRoleTab === 'ALL' || activeRoleTab === role)
              .map((role) => {
                const roleFeats = filteredFeatures.filter((f) => f.role === role);
                if (roleFeats.length === 0) return null;

                const roleMeta = {
                  MANAGER: {
                    title: 'Manager Feature Toggles',
                    subtitle: 'Operational authority, billing figures, OLT telemetry, and subscriber edit controls',
                    badgeBg: 'bg-indigo-950 text-indigo-300 border-indigo-800',
                    border: 'border-indigo-900/40',
                  },
                  AGENT: {
                    title: 'Field Agent Feature Toggles',
                    subtitle: 'Doorstep recovery, WhatsApp receipts, optical diagnostics, and directory restrictions',
                    badgeBg: 'bg-cyan-950 text-cyan-300 border-cyan-800',
                    border: 'border-cyan-900/40',
                  },
                  CLIENT: {
                    title: 'Client / Subscriber Portal Toggles',
                    subtitle: 'Self-service billing checkout, speed test, support tickets, and Wi-Fi credential management',
                    badgeBg: 'bg-emerald-950 text-emerald-300 border-emerald-800',
                    border: 'border-emerald-900/40',
                  },
                }[role];

                return (
                  <div key={role} className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold ${roleMeta.badgeBg}`}>
                          {role}
                        </span>
                        <div>
                          <h2 className="text-sm font-bold text-white">{roleMeta.title}</h2>
                          <p className="text-[11px] text-slate-400">{roleMeta.subtitle}</p>
                        </div>
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {roleFeats.filter((f) => permissions[role]?.[f.key] ?? f.defaultEnabled).length} of {roleFeats.length} active
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {roleFeats.map((feat) => {
                        const isEnabled = permissions[role]?.[feat.key] ?? feat.defaultEnabled;

                        return (
                          <div
                            key={feat.key}
                            className={`bg-slate-900 rounded-2xl p-4 border transition-all duration-200 shadow-lg flex flex-col justify-between ${
                              isEnabled
                                ? 'border-slate-800 hover:border-slate-700'
                                : 'border-rose-950/60 bg-slate-900/80 opacity-90'
                            }`}
                          >
                            <div className="space-y-3">
                              {/* Header: Module & Toggle Switch */}
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 font-bold block w-fit mb-1">
                                    {feat.module}
                                  </span>
                                  <h3 className="font-bold text-white text-xs leading-snug">
                                    {feat.name}
                                  </h3>
                                </div>

                                {/* Custom Accessible Toggle Switch */}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isEnabled}
                                  onClick={() => handleToggle(role, feat.key, isEnabled)}
                                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                                    isEnabled ? 'bg-emerald-500' : 'bg-slate-700'
                                  }`}
                                  title={isEnabled ? 'Click to disable' : 'Click to enable'}
                                >
                                  <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                      isEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                </button>
                              </div>

                              {/* Description */}
                              <p className="text-[11px] text-slate-300 leading-relaxed">
                                {feat.description}
                              </p>

                              {/* Impact Notice */}
                              <div
                                className={`p-2.5 rounded-xl text-[10px] font-mono leading-tight flex items-start gap-1.5 ${
                                  isEnabled
                                    ? 'bg-slate-950/60 border border-slate-800 text-slate-400'
                                    : 'bg-rose-950/40 border border-rose-900/60 text-rose-300'
                                }`}
                              >
                                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                                <span>{feat.impactSummary}</span>
                              </div>
                            </div>

                            {/* Status Footer */}
                            <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
                              <span className="text-slate-500">ID: {feat.key}</span>
                              <div className="flex items-center gap-1.5">
                                {isEnabled ? (
                                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                                    <Check className="w-3 h-3" /> ENABLED
                                  </span>
                                ) : (
                                  <span className="text-rose-400 font-bold flex items-center gap-1">
                                    <Lock className="w-3 h-3" /> RESTRICTED
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

            {filteredFeatures.length === 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-2">
                <Sliders className="w-8 h-8 mx-auto text-slate-600" />
                <span className="font-bold text-sm text-white block">No features match your query</span>
                <p className="text-xs text-slate-500">Try adjusting your search keywords or clear the filters.</p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setActiveRoleTab('ALL');
                    setStatusFilter('ALL');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-mono font-bold mt-2"
                >
                  Clear All Filters
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        /* 5. User-Level Overrides Tab */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white">Individual User Permission Overrides</h2>
              <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono text-[10px] font-bold">
                Granular Exceptions
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Apply per-user feature exceptions that override the default role matrix. For example, grant a specific trusted Field Agent full directory lookup, or restrict a specific subscriber from online payments.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Users list selector */}
            <div className="space-y-2 border-r border-slate-800 pr-0 md:pr-4">
              <span className="text-[11px] font-mono text-slate-400 block font-bold">
                Select Account to Manage Overrides:
              </span>
              <div className="space-y-1.5 max-h-[460px] overflow-y-auto">
                {userList.map((u) => {
                  const hasOverrides = userOverrides[u.id] && Object.keys(userOverrides[u.id]).length > 0;
                  const isSelected = selectedUserForOverride?.id === u.id;

                  return (
                    <div
                      key={u.id}
                      onClick={() => setSelectedUserForOverride(u)}
                      className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-slate-800 border-cyan-500 shadow-md'
                          : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-white truncate text-xs">
                            {u.displayName || u.fullName}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-slate-900 text-slate-300 border border-slate-700">
                            {u.role}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 block truncate">
                          @{u.username} &bull; {u.phone}
                        </span>
                      </div>

                      {hasOverrides && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[9px] font-mono font-bold shrink-0">
                          {Object.keys(userOverrides[u.id]).length} override(s)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Overrides control editor */}
            <div className="md:col-span-2 space-y-4">
              {selectedUserForOverride ? (
                <div className="space-y-4">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-white block">
                        Overrides for: {selectedUserForOverride.displayName || selectedUserForOverride.fullName} (@{selectedUserForOverride.username})
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        Base Role: <strong className="text-cyan-400">{selectedUserForOverride.role}</strong> &bull; User ID: {selectedUserForOverride.id}
                      </span>
                    </div>

                    {userOverrides[selectedUserForOverride.id] && (
                      <button
                        onClick={async () => {
                          const overrides = userOverrides[selectedUserForOverride.id] || {};
                          for (const k of Object.keys(overrides)) {
                            await updateUserPermissionOverride(selectedUserForOverride.id, k as FeatureKey, null);
                          }
                          showToast(`Cleared all custom overrides for ${selectedUserForOverride.username}.`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900 text-xs font-mono font-bold transition cursor-pointer"
                      >
                        Clear User Overrides
                      </button>
                    )}
                  </div>

                  {/* Feature overrides rows for this user's role */}
                  <div className="space-y-2">
                    {FEATURE_CATALOG.filter((f) => f.role === selectedUserForOverride.role).map((f) => {
                      const userOverrideVal = userOverrides[selectedUserForOverride.id]?.[f.key];
                      const roleDefaultVal = permissions[selectedUserForOverride.role]?.[f.key] ?? f.defaultEnabled;
                      const effectiveVal = typeof userOverrideVal === 'boolean' ? userOverrideVal : roleDefaultVal;

                      return (
                        <div
                          key={f.key}
                          className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white">{f.name}</span>
                              <span className="text-[10px] font-mono text-slate-500">[{f.module}]</span>
                              {typeof userOverrideVal === 'boolean' && (
                                <span className="px-1.5 py-0.2 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[9px] font-mono font-bold">
                                  Custom Override Active
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 block mt-0.5">
                              Role Default: <code className="text-slate-300">{roleDefaultVal ? 'Enabled' : 'Disabled'}</code>
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 font-mono text-[11px]">
                            <button
                              onClick={() => updateUserPermissionOverride(selectedUserForOverride.id, f.key, true)}
                              className={`px-2 py-1 rounded-lg border font-bold transition cursor-pointer ${
                                effectiveVal && userOverrideVal === true
                                  ? 'bg-emerald-600 text-slate-950 border-emerald-500 font-extrabold'
                                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                              }`}
                            >
                              Grant (Force ON)
                            </button>
                            <button
                              onClick={() => updateUserPermissionOverride(selectedUserForOverride.id, f.key, false)}
                              className={`px-2 py-1 rounded-lg border font-bold transition cursor-pointer ${
                                !effectiveVal && userOverrideVal === false
                                  ? 'bg-rose-600 text-white border-rose-500 font-extrabold'
                                  : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-white'
                              }`}
                            >
                              Revoke (Force OFF)
                            </button>
                            {typeof userOverrideVal === 'boolean' && (
                              <button
                                onClick={() => updateUserPermissionOverride(selectedUserForOverride.id, f.key, null)}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 hover:text-white transition cursor-pointer text-[10px]"
                                title="Reset to Role Default"
                              >
                                Inherit Role
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-12 text-center text-slate-500 space-y-2">
                  <UserCheck className="w-8 h-8 mx-auto text-slate-600" />
                  <span className="font-bold text-white text-sm block">Select a user account on the left</span>
                  <p className="text-xs text-slate-400">
                    Choose any Manager, Field Agent, or Client to configure individual override permissions.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
