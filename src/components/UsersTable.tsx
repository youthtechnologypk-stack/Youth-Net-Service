import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Send,
  Lock,
  Unlock,
  RefreshCw,
  Trash2,
  Edit,
  Eye,
  Smartphone,
  UserCheck,
  Shield,
  ShieldCheck,
  Wallet,
  MapPin,
  Database,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import { buildStandardWhatsAppCredentialText, getPortalUrlForRole } from '../services/authUtils';
import {
  GIS_PERMISSION_OPTIONS,
  GisMapPermission,
  isStaffRoleEligibleForGisControl,
  resolveUserGisAccess,
  updatePortalUserGisPermission,
} from '../lib/gisAccessControl';
import {
  STAFF_PERMISSIONS_MIGRATION_SQL,
  countEnabledPermissions,
  resolveStaffPermissions,
} from '../lib/staffPermissions';

export type TabType = 'ALL' | 'CLIENT' | 'AGENT' | 'MANAGER' | 'ADMIN';

export interface PortalUserRow {
  id: string;
  username: string;
  full_name?: string;
  fullName?: string;
  displayName?: string;
  phone?: string;
  role: string;
  area?: string;
  assignedArea?: string;
  department?: string;
  account_status?: string;
  isActive?: boolean;
  created_at?: string;
  createdAt?: string;
  password?: string;
  email?: string;
  package_speed?: string;
  monthly_fee?: number;
  package_volume_gb?: number;
  cnic?: string;
  address?: string;
  cash_in_hand?: number;
  advance_balance?: number;
  base_salary?: number;
  can_access_gis_map?: boolean | null;
  gis_map_permission?: GisMapPermission | string | null;
  permissions?: Record<string, any> | null;
}

export interface UsersTableProps {
  onSelectSubscriber?: (username: string) => void;
  onSelectAgent?: (agentIdOrUsername: string) => void;
  onEditUser?: (user: PortalUserRow) => void;
  onResetPassword?: (user: PortalUserRow) => void;
  onToggleStatus?: (user: PortalUserRow) => void;
  onDeleteUser?: (user: PortalUserRow) => void;
  onWhatsAppDispatch?: (user: PortalUserRow) => void;
  onRefresh?: () => void;
  refreshTrigger?: number;
}

export const UsersTable: React.FC<UsersTableProps> = ({
  onSelectSubscriber,
  onSelectAgent,
  onEditUser,
  onResetPassword,
  onToggleStatus,
  onDeleteUser,
  onWhatsAppDispatch,
  onRefresh,
  refreshTrigger = 0,
}) => {
  // 1. Strict Role Tabs State
  const [activeTab, setActiveTab] = useState<TabType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<PortalUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [updatingGisUserId, setUpdatingGisUserId] = useState<string | null>(null);
  const [gisSchemaNotice, setGisSchemaNotice] = useState<string | null>(null);
  const [copiedGisSql, setCopiedGisSql] = useState(false);

  // 2. Fetch Users strictly from Supabase PostgreSQL portal_users table (No Mock Fallbacks)
  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      // Purge stale/prototype arrays from localStorage immediately
      try {
        localStorage.removeItem('portal_users');
        localStorage.removeItem('isp_users');
        localStorage.removeItem('youthnet_portal_users');
        localStorage.removeItem('youthnet_db_portal_users');
        localStorage.removeItem('netpulse_user_accounts_v1');
      } catch {}

      const { data, error } = await supabase
        .from('portal_users')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        // Direct state replacement - Never append or merge with dummy data
        setUsers(data as PortalUserRow[]);
      } else if (error) {
        console.error('Error fetching portal_users from Supabase:', error);
      }
    } catch (err) {
      console.error('Failed to load portal_users from Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 3. Supabase Realtime Listener (Replace / update by unique ID, never duplicate)
  useEffect(() => {
    fetchUsers();

    const channel = supabase
      .channel('portal_users_realtime_users_table')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'portal_users' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setUsers((prev) => {
              const newRow = payload.new as PortalUserRow;
              const exists = prev.some((u) => u.id === newRow?.id || (u?.username || '').toLowerCase() === (newRow?.username || '').toLowerCase());
              if (exists) {
                return prev.map((u) => (u.id === newRow?.id ? newRow : u));
              }
              return [newRow, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            setUsers((prev) => {
              const updatedRow = payload.new as PortalUserRow;
              return prev.map((u) => (u.id === updatedRow?.id ? updatedRow : u));
            });
          } else if (payload.eventType === 'DELETE') {
            setUsers((prev) => {
              const deletedRow = payload.old as { id: string };
              return prev.filter((u) => u.id !== deletedRow?.id);
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchUsers, refreshTrigger]);

  // 4. Strict Filter Evaluation
  const cleanSearch = (searchQuery || '').trim().toLowerCase();
  const filteredUsers = (users || []).filter((u) => {
    // Search filter
    const displayName = (u?.full_name || u?.fullName || u?.displayName || '').toLowerCase();
    const username = (u?.username || '').toLowerCase();
    const phone = u?.phone || '';

    const matchesSearch =
      !cleanSearch ||
      displayName.includes(cleanSearch) ||
      username.includes(cleanSearch) ||
      phone.includes(cleanSearch);

    // Strict Role filter (exact match)
    const userRole = (u?.role || '').toUpperCase();
    const matchesRole =
      activeTab === 'ALL' ||
      userRole === (activeTab || '').toUpperCase();

    return matchesSearch && matchesRole;
  });

  // Dynamic Badge Counts based on live data
  const totalCount = users.length;
  const clientCount = users.filter((u) => (u.role || '').toUpperCase() === 'CLIENT').length;
  const agentCount = users.filter((u) => (u.role || '').toUpperCase() === 'AGENT').length;
  const managerCount = users.filter((u) => (u.role || '').toUpperCase() === 'MANAGER').length;
  const adminCount = users.filter((u) => (u.role || '').toUpperCase() === 'ADMIN').length;

  // Status toggle handler directly updating Supabase
  const handleToggleStatus = async (user: PortalUserRow) => {
    if (onToggleStatus) {
      onToggleStatus(user);
      return;
    }

    const currentStatus = (user.account_status || (user.isActive === false ? 'SUSPENDED' : 'ACTIVE')).toUpperCase();
    const nextStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

    try {
      const { error } = await supabase
        .from('portal_users')
        .update({
          account_status: nextStatus,
        })
        .eq('id', user.id);

      if (!error) {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, account_status: nextStatus, isActive: nextStatus === 'ACTIVE' } : u))
        );
        setActionNotice(`Account @${user.username} is now ${nextStatus}.`);
        setTimeout(() => setActionNotice(null), 3500);
      }
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  // Update per-user Fiber GIS & Map access directly in Supabase portal_users
  const handleUpdateGisPermission = async (user: PortalUserRow, nextPermission: GisMapPermission) => {
    setUpdatingGisUserId(user.id);
    try {
      const res = await updatePortalUserGisPermission({
        userId: user.id,
        username: user.username,
        permission: nextPermission,
      });

      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === user.id
              ? {
                  ...u,
                  can_access_gis_map: res.can_access_gis_map,
                  gis_map_permission: res.gis_map_permission,
                }
              : u
          )
        );
        const label =
          GIS_PERMISSION_OPTIONS.find((o) => o.value === nextPermission)?.label || nextPermission;
        setActionNotice(`Fiber GIS & Map access for @${user.username} set to "${label}".`);
        setTimeout(() => setActionNotice(null), 4000);
        if (res.schemaMissing) {
          setGisSchemaNotice(
            res.error || 'Run the portal_users GIS permission SQL migration in Supabase.'
          );
        } else {
          setGisSchemaNotice(null);
        }
      } else {
        setActionNotice(res.error || 'Failed to update Fiber GIS permission.');
        setTimeout(() => setActionNotice(null), 5000);
      }
    } finally {
      setUpdatingGisUserId(null);
    }
  };

  // One-click copy credentials
  const handleCopyCredentials = (user: PortalUserRow) => {
    const displayName = user.full_name || user.fullName || user.displayName || user.username;
    const text = buildStandardWhatsAppCredentialText(
      displayName,
      user.username,
      user.password || '•••••••• (Existing)',
      getPortalUrlForRole(user.role as any)
    );
    navigator.clipboard.writeText(text);
    setCopiedId(user.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="space-y-4">
      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="p-3 bg-emerald-950/90 border border-emerald-700 rounded-xl text-emerald-300 text-xs font-mono flex items-center gap-2.5 animate-fadeIn shadow-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Optional SQL Column Migration Banner if portal_users columns are not yet added */}
      {gisSchemaNotice && (
        <div className="p-3 bg-amber-950/80 border border-amber-700/80 rounded-xl text-amber-200 text-xs font-mono flex flex-wrap items-center justify-between gap-2.5 shadow-lg">
          <div className="flex items-center gap-2 min-w-0">
            <Database className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{gisSchemaNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(STAFF_PERMISSIONS_MIGRATION_SQL);
              setCopiedGisSql(true);
              setTimeout(() => setCopiedGisSql(false), 3000);
            }}
            className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] flex items-center gap-1.5 shrink-0 cursor-pointer transition"
          >
            {copiedGisSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedGisSql ? 'SQL Copied!' : 'Copy ALTER TABLE SQL'}</span>
          </button>
        </div>
      )}

      {/* Role Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl shadow-md">
        {/* Strict Role Filtering Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL' as TabType, label: 'All Users', count: totalCount },
            { id: 'CLIENT' as TabType, label: 'Clients', count: clientCount },
            { id: 'AGENT' as TabType, label: 'Field Agents', count: agentCount },
            { id: 'MANAGER' as TabType, label: 'Managers', count: managerCount },
            { id: 'ADMIN' as TabType, label: 'Administrators', count: adminCount },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer flex items-center gap-1.5 ${
                activeTab === tab.id
                  ? 'bg-cyan-600 text-slate-950 font-bold shadow-md shadow-cyan-950/40'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                  activeTab === tab.id
                    ? 'bg-slate-950 text-cyan-300 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search Input & Refresh Button */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search full name, @username, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full sm:w-64 pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
            />
          </div>
          <button
            onClick={() => {
              fetchUsers();
              if (onRefresh) onRefresh();
            }}
            disabled={isLoading}
            className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:text-white transition cursor-pointer disabled:opacity-50"
            title="Refresh from Supabase"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4">Full Name</th>
                <th className="py-3.5 px-4">Username / Account ID</th>
                <th className="py-3.5 px-4">Role Badge</th>
                <th className="py-3.5 px-4">RBAC &amp; Fiber GIS</th>
                <th className="py-3.5 px-4">Phone Number</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-sans">
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-mono">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
                      <span>Loading records from Supabase PostgreSQL...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-mono">
                    <div className="space-y-1">
                      <p className="text-slate-400 font-medium">No user records found in Supabase.</p>
                      <p className="text-[11px] text-slate-500">
                        {activeTab !== 'ALL'
                          ? `No records found with role "${activeTab}".`
                          : 'Zero records in portal_users database table.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const targetName = user.full_name || user.fullName || user.displayName || user.username || 'System User';
                  const userRole = (user.role || '').toUpperCase();
                  const isClient = userRole === 'CLIENT';
                  const isAgent = userRole === 'AGENT';
                  const isSuspended =
                    user.account_status?.toUpperCase() === 'SUSPENDED' ||
                    user.isActive === false;

                  return (
                    <tr
                      key={user.id}
                      className={`hover:bg-slate-950/50 transition ${
                        isClient || isAgent ? 'cursor-pointer' : ''
                      }`}
                    >
                      {/* 1. Full Name */}
                      <td
                        className="py-3.5 px-4"
                        onClick={() => {
                          if (isClient && onSelectSubscriber) {
                            onSelectSubscriber(user.username);
                          } else if (isAgent && onSelectAgent) {
                            onSelectAgent(user.username);
                          }
                        }}
                      >
                        <div className="flex items-center gap-3 group">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              userRole === 'ADMIN'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : userRole === 'MANAGER'
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                : userRole === 'AGENT'
                                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {targetName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span
                              className={`font-bold text-white block ${
                                isClient ? 'group-hover:text-cyan-400 transition' : ''
                              }`}
                            >
                              {targetName}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              {user.area || user.assignedArea || user.department || (isClient ? 'Youth Net FTTH Client' : 'Standard Tier')}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Username / Account ID */}
                      <td
                        className="py-3.5 px-4 font-mono text-[11px]"
                        onClick={() => {
                          if (isClient && onSelectSubscriber) {
                            onSelectSubscriber(user.username);
                          }
                        }}
                      >
                        <span className={`text-cyan-400 font-bold block ${isClient ? 'hover:underline' : ''}`}>
                          @{user.username}
                        </span>
                        <span className="text-slate-400">{user.email || `${user.username}@youthnet.pk`}</span>
                      </td>

                      {/* 3. Role Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] px-2.5 py-1 rounded-full font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                            userRole === 'ADMIN'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : userRole === 'MANAGER'
                              ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                              : userRole === 'AGENT'
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          {userRole === 'ADMIN' && <ShieldCheck className="w-3 h-3 text-rose-400" />}
                          {userRole === 'MANAGER' && <Shield className="w-3 h-3 text-indigo-400" />}
                          {userRole === 'AGENT' && <UserCheck className="w-3 h-3 text-cyan-400" />}
                          {userRole === 'CLIENT' && <Smartphone className="w-3 h-3 text-emerald-400" />}
                          <span>{userRole || 'CLIENT'}</span>
                        </span>
                      </td>

                      {/* 3b. Fiber GIS & Map Access (Quick 1-Click Toggle + 3-State Selector) */}
                      <td
                        className="py-3.5 px-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {userRole === 'ADMIN' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-950/80 border border-sky-800/80 text-sky-300 font-mono text-[10px] font-bold">
                            <MapPin className="w-3 h-3 text-sky-400" />
                            <span>Always Full Access</span>
                          </span>
                        ) : isStaffRoleEligibleForGisControl(userRole) ? (() => {
                          const resolvedGis = resolveUserGisAccess(user, userRole);
                          const resolvedPerms = resolveStaffPermissions(user, userRole);
                          const enabledFeaturesCount = countEnabledPermissions(resolvedPerms);
                          const isBusy = updatingGisUserId === user.id;
                          return (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                {/* Quick 1-Click Enable / Disable Switch */}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={resolvedGis.canAccess}
                                  disabled={isBusy}
                                  onClick={() =>
                                    handleUpdateGisPermission(
                                      user,
                                      resolvedGis.canAccess ? 'none' : 'view'
                                    )
                                  }
                                  title={
                                    resolvedGis.canAccess
                                      ? `Click to immediately disable Fiber GIS & Map for @${user.username}`
                                      : `Click to enable Fiber GIS & Map (View & Trace Only) for @${user.username}`
                                  }
                                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition cursor-pointer disabled:opacity-50 ${
                                    resolvedGis.canAccess
                                      ? resolvedGis.canEdit
                                        ? 'bg-emerald-600 border-emerald-400'
                                        : 'bg-sky-600 border-sky-400'
                                      : 'bg-slate-800 border-slate-700'
                                  }`}
                                >
                                  <span
                                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
                                      resolvedGis.canAccess ? 'translate-x-4' : 'translate-x-0.5'
                                    }`}
                                  />
                                </button>

                                {/* Granular 3-State Selector */}
                                <select
                                  value={resolvedGis.permission}
                                  disabled={isBusy}
                                  aria-label={`Fiber GIS & Map access for ${user.username}`}
                                  onChange={(e) =>
                                    handleUpdateGisPermission(
                                      user,
                                      e.target.value as GisMapPermission
                                    )
                                  }
                                  className={`text-[10px] font-mono font-bold rounded-lg px-2 py-1 border focus:outline-none cursor-pointer transition disabled:opacity-50 ${
                                    resolvedGis.permission === 'edit'
                                      ? 'bg-emerald-950/90 border-emerald-700 text-emerald-300'
                                      : resolvedGis.permission === 'view'
                                      ? 'bg-sky-950/90 border-sky-700 text-sky-300'
                                      : 'bg-rose-950/80 border-rose-800 text-rose-300'
                                  }`}
                                >
                                  <option value="none">GIS: Disabled</option>
                                  <option value="view">GIS: View &amp; Trace</option>
                                  <option value="edit">GIS: Full Edit</option>
                                </select>
                              </div>
                              {onEditUser && (
                                <button
                                  type="button"
                                  onClick={() => onEditUser(user)}
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-950 hover:bg-cyan-950/70 border border-slate-800 hover:border-cyan-700 text-[10px] font-mono text-cyan-300 transition cursor-pointer"
                                  title="Configure all 12 granular feature switches & presets"
                                >
                                  <Shield className="w-2.5 h-2.5 text-cyan-400" />
                                  <span>{enabledFeaturesCount}/12 Switches</span>
                                  <span className="text-slate-500">&bull; Edit</span>
                                </button>
                              )}
                            </div>
                          );
                        })() : (
                          <span className="text-[10px] font-mono text-slate-600">N/A (Subscriber)</span>
                        )}
                      </td>

                      {/* 4. Phone Number */}
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {user.phone || '+92 300 0000000'}
                      </td>

                      {/* 5. Status Badge */}
                      <td className="py-3.5 px-4">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleStatus(user);
                          }}
                          className={`px-2.5 py-1 rounded-lg font-mono text-[10px] font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
                            !isSuspended
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900'
                              : 'bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900'
                          }`}
                          title="Click to toggle account status"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              !isSuspended ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                            }`}
                          />
                          <span>{!isSuspended ? 'ACTIVE' : 'SUSPENDED'}</span>
                        </button>
                      </td>

                      {/* 6. Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* 360 View Profile (for Clients) */}
                          {isClient && onSelectSubscriber && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectSubscriber(user.username);
                              }}
                              className="p-1.5 bg-slate-950 hover:bg-cyan-950 border border-slate-800 hover:border-cyan-800 rounded-lg text-slate-400 hover:text-cyan-300 transition cursor-pointer"
                              title="View Youth Net 360° Subscriber Profile"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Agent Financial 360 & Cash Handover Profile (for Agents) */}
                          {isAgent && onSelectAgent && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectAgent(user.username);
                              }}
                              className="p-1.5 bg-slate-950 hover:bg-emerald-950 border border-slate-800 hover:border-emerald-800 rounded-lg text-slate-400 hover:text-emerald-300 transition cursor-pointer"
                              title="View Agent Financial Profile & Cash Handover"
                            >
                              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                            </button>
                          )}

                          {/* WhatsApp Credentials Dispatch */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onWhatsAppDispatch) {
                                onWhatsAppDispatch(user);
                              } else {
                                handleCopyCredentials(user);
                              }
                            }}
                            className="p-1.5 bg-slate-950 hover:bg-emerald-950 border border-slate-800 hover:border-emerald-800 rounded-lg text-slate-400 hover:text-emerald-300 transition cursor-pointer"
                            title="Dispatch Portal Credentials via WhatsApp"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>

                          {/* Copy Credentials */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyCredentials(user);
                            }}
                            className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                            title="Copy Login Credentials"
                          >
                            {copiedId === user.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* Edit User / Staff Profile */}
                          {onEditUser && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditUser(user);
                              }}
                              className={`p-1.5 bg-slate-950 hover:bg-slate-800 border rounded-lg transition cursor-pointer ${
                                isAgent || userRole === 'MANAGER'
                                  ? 'border-cyan-800/80 text-cyan-400 hover:text-white hover:bg-cyan-950/60 shadow-sm'
                                  : 'border-slate-800 text-slate-400 hover:text-cyan-300'
                              }`}
                              title={
                                isAgent || userRole === 'MANAGER'
                                  ? `Edit Staff Profile: Full Name, Phone, Area, Salary, Role, Status, Password (@${user.username})`
                                  : 'Edit User Profile'
                              }
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Reset Password */}
                          {onResetPassword && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onResetPassword(user);
                              }}
                              className="p-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-400 hover:text-amber-300 transition cursor-pointer"
                              title="Reset Password"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Delete User */}
                          {onDeleteUser && user.username !== 'admin' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteUser(user);
                              }}
                              className="p-1.5 bg-slate-950 hover:bg-rose-950 border border-slate-800 hover:border-rose-800 rounded-lg text-slate-400 hover:text-rose-400 transition cursor-pointer"
                              title="Delete Account"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersTable;
