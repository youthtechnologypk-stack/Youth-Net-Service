import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Shield,
  Smartphone,
  Plus,
  CheckCircle2,
  Radio,
  UserCheck,
  ShieldCheck,
  ArrowLeft,
  Wifi,
  UserX,
  X,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
  Loader2,
  MessageCircle,
  Upload,
  RefreshCw,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { UserAccount, SystemRole } from '../types/auth';
import { UsersTable, PortalUserRow } from './UsersTable';
import { CreateAccountModal } from './CreateAccountModal';
import { EditUserModal } from './EditUserModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import { WhatsAppDispatchModal } from './WhatsAppDispatchModal';
import { AddUserModal } from './AddUserModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { PermissionMatrixStudio } from './PermissionMatrixStudio';
import { SubscriberProfileView } from './SubscriberProfileView';
import { AgentProfileView } from './AgentProfileView';
import { EditStaffModal } from './EditStaffModal';
import { AddScopedFieldAgentModal } from './AddScopedFieldAgentModal';
import { BulkCsvImportModal } from './BulkCsvImportModal';
import {
  MikrotikAutoImportModal,
  MIKROTIK_AUTO_IMPORT_COMPLETED_EVENT,
} from './MikrotikAutoImportModal';
import { buildStandardWhatsAppCredentialText, getPortalUrlForRole } from '../services/authUtils';
import { buildWhatsAppUrl } from '../lib/whatsappBilling';
import {
  formatWhatsAppDisplayPhone,
  sendWhatsAppCredentialsViaGateway,
} from '../lib/whatsappRouting';
import { RealMikrotikSubscriber, fetchLiveMikrotikSubscribers } from '../services/mikrotikSubscriberSync';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import { getStoredUser } from '../lib/auth';
import {
  getResellerTier,
  isResellerUser,
  isVisibleToCurrentUser,
  resolveResellerScope,
} from '../lib/resellerEngine';
import {
  isStaffRoleEligibleForGisControl,
  normalizeGisMapPermission,
} from '../lib/gisAccessControl';
import {
  isMissingPermissionsColumnError,
  resolveStaffPermissions,
  updatePortalUserPermissions,
} from '../lib/staffPermissions';

interface AccountCredentialToast {
  id: number;
  status: 'sending' | 'sent' | 'created_no_wa' | 'failed';
  username: string;
  fullName: string;
  role: SystemRole;
  formattedPhone: string;
  plainPassword: string;
  portalUrl: string;
  senderCompanyName?: string;
  errorMessage?: string;
  waUrl: string;
  copied: boolean;
}

export interface UserAccountsViewProps {
  currentSimulatedRole?: SystemRole;
  currentUser?: UserAccount | null;
  onSwitchSimulatedRole?: (role: SystemRole) => void;
  onBack?: () => void;
}

export const UserAccountsView: React.FC<UserAccountsViewProps> = ({
  currentSimulatedRole = 'ADMIN',
  currentUser,
  onSwitchSimulatedRole,
  onBack,
}) => {
  const activeUser = currentUser || getStoredUser();
  const isResellerView =
    isResellerUser(activeUser) ||
    currentSimulatedRole === 'DEALER' ||
    currentSimulatedRole === 'SUB_DEALER' ||
    activeUser?.role === 'DEALER' ||
    activeUser?.role === 'SUB_DEALER';
  const resellerTier = getResellerTier(activeUser) || (currentSimulatedRole === 'DEALER' ? 'DEALER' : 'SUB_DEALER');
  const { routers, selectedRouterId, activeSessions, logWhatsAppNotice, deletePppoeUser } = useISP();
  const [liveSubscribers, setLiveSubscribers] = useState<RealMikrotikSubscriber[]>([]);
  const [allPortalUsers, setAllPortalUsers] = useState<SupabasePortalUser[]>([]);

  // Sub-navigation: User Accounts vs Permission Matrix
  const [activeManagementTab, setActiveManagementTab] = useState<'users' | 'permissions'>('users');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [credentialToast, setCredentialToast] = useState<AccountCredentialToast | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  useEffect(() => {
    if (isResellerView && activeManagementTab !== 'users') {
      setActiveManagementTab('users');
    }
  }, [isResellerView, activeManagementTab]);

  // Metrics state strictly from live Supabase portal_users
  const [userMetrics, setUserMetrics] = useState({
    total: 0,
    clients: 0,
    agents: 0,
    managers: 0,
    admins: 0,
  });

  // Selected username for Youth Net 360° Profile View
  const [selectedProfileUsername, setSelectedProfileUsername] = useState<string | null>(null);

  // Selected username for Agent Financial 360° Profile View
  const [selectedAgentUsername, setSelectedAgentUsername] = useState<string | null>(null);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isEditStaffModalOpen, setIsEditStaffModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isAddPppoeModalOpen, setIsAddPppoeModalOpen] = useState(false);
  const [isAddScopedAgentModalOpen, setIsAddScopedAgentModalOpen] = useState(false);
  const [isBulkCsvModalOpen, setIsBulkCsvModalOpen] = useState(false);
  const [isMikrotikAutoImportOpen, setIsMikrotikAutoImportOpen] = useState(false);

  // Selected user for modals
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [selectedStaffUser, setSelectedStaffUser] = useState<PortalUserRow | null>(null);
  const [lastGeneratedPassword, setLastGeneratedPassword] = useState<string>('••••••••');

  // Deletion dialog state
  const [userToDelete, setUserToDelete] = useState<PortalUserRow | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 1. Purge stale localStorage on mount & fetch live metrics
  const refreshMetrics = useCallback(async () => {
    try {
      localStorage.removeItem('portal_users');
      localStorage.removeItem('isp_users');
      localStorage.removeItem('youthnet_portal_users');
      localStorage.removeItem('youthnet_db_portal_users');
      localStorage.removeItem('netpulse_user_accounts_v1');

      const { data, error } = await supabase.from('portal_users').select('*');
      if (!error && Array.isArray(data)) {
        const rows = data as SupabasePortalUser[];
        setAllPortalUsers(rows);
        setUserMetrics({
          total: rows.length,
          clients: rows.filter((u) => (u.role || '').toUpperCase() === 'CLIENT').length,
          agents: rows.filter((u) => (u.role || '').toUpperCase() === 'AGENT').length,
          managers: rows.filter((u) => (u.role || '').toUpperCase() === 'MANAGER').length,
          admins: rows.filter((u) => (u.role || '').toUpperCase() === 'ADMIN').length,
        });
      }
    } catch (err) {
      console.warn('Failed to refresh metrics from Supabase:', err);
    }
  }, []);

  // Scoped Reseller Subscriber Metrics (strictly PPPoE CLIENTs belonging to this Dealer/Sub-Dealer)
  const resellerSubscriberMetrics = useMemo(() => {
    if (!isResellerView) {
      return { total: 0, active: 0, online: 0, suspendedExpired: 0 };
    }
    const scope = resolveResellerScope(activeUser, allPortalUsers);
    const scopedClients = allPortalUsers.filter((u) => {
      if ((u.role || '').toUpperCase() !== 'CLIENT') return false;
      return isVisibleToCurrentUser(u, activeUser, {
        childSubDealerIds: scope.allowedResellerIds,
        allowedSubscriberUsernames: scope.allowedSubscriberUsernames,
      });
    });

    const onlineUsernameSet = new Set<string>(
      (activeSessions || [])
        .map((s) => String(s?.username || '').trim().toLowerCase())
        .filter(Boolean)
    );

    let online = 0;
    let suspendedExpired = 0;
    let active = 0;

    scopedClients.forEach((u) => {
      const uname = String(u.username || '').trim().toLowerCase();
      const statusUpper = String(u.account_status || '').toUpperCase();
      const billingUpper = String(u.billing_status || '').toUpperCase();
      const isSusp =
        u.is_suspended === true ||
        statusUpper === 'SUSPENDED' ||
        statusUpper === 'EXPIRED' ||
        billingUpper === 'SUSPENDED_EXPIRED';

      if (isSusp) {
        suspendedExpired++;
      } else {
        active++;
      }
      if (uname && onlineUsernameSet.has(uname)) {
        online++;
      }
    });

    return {
      total: scopedClients.length,
      active,
      online,
      suspendedExpired,
    };
  }, [isResellerView, activeUser, allPortalUsers, activeSessions]);

  useEffect(() => {
    const onAutoImportDone = () => {
      setRefreshTrigger((prev) => prev + 1);
      void refreshMetrics();
    };
    window.addEventListener(MIKROTIK_AUTO_IMPORT_COMPLETED_EVENT, onAutoImportDone);
    return () => {
      window.removeEventListener(MIKROTIK_AUTO_IMPORT_COMPLETED_EVENT, onAutoImportDone);
    };
  }, [refreshMetrics]);

  useEffect(() => {
    refreshMetrics();

    // Fetch live MikroTik secrets for the create account modal
    const targetRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
    fetchLiveMikrotikSubscribers(targetRouter).then((subs) => {
      if (subs && subs.length > 0) {
        setLiveSubscribers(subs);
      }
    });

    // Realtime metrics sync
    const channel = supabase
      .channel('portal_users_metrics_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        refreshMetrics();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [routers, selectedRouterId, refreshMetrics]);

  // Map PortalUserRow to UserAccount
  const mapRowToAccount = (row: PortalUserRow): UserAccount => {
    const roleUpper = (row.role || 'CLIENT').toUpperCase() as SystemRole;
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name || row.fullName || row.displayName || row.username,
      displayName: row.displayName || row.full_name || row.username,
      phone: row.phone || '+92 300 0000000',
      role: roleUpper,
      isActive: row.account_status !== 'SUSPENDED' && row.isActive !== false,
      email: row.email || `${row.username}@youthnet.pk`,
      area: row.area || row.assignedArea || 'Saddar Node',
      assignedArea: row.assignedArea || row.area || 'Saddar Node',
      password: row.password,
      package_speed: row.package_speed,
      monthly_fee: row.monthly_fee,
      package_volume_gb: row.package_volume_gb,
      cnic: row.cnic,
      address: row.address,
      can_access_gis_map:
        typeof row.can_access_gis_map === 'boolean' ? row.can_access_gis_map : undefined,
      gis_map_permission: normalizeGisMapPermission(
        row.gis_map_permission,
        row.can_access_gis_map,
        roleUpper
      ),
      permissions:
        row.permissions && typeof row.permissions === 'object' ? row.permissions : undefined,
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    };
  };

  // Handlers
  const handleCopyToastCredentials = (toast: AccountCredentialToast) => {
    const text = [
      `Portal Link: ${toast.portalUrl}`,
      `Name: ${toast.fullName}`,
      `Username: ${toast.username}`,
      `Password: ${toast.plainPassword}`,
      `Role: ${toast.role}`,
    ].join('\n');
    navigator.clipboard?.writeText(text).catch(() => {});
    setCredentialToast((prev) => (prev && prev.id === toast.id ? { ...prev, copied: true } : prev));
    setTimeout(() => {
      setCredentialToast((prev) => (prev && prev.id === toast.id ? { ...prev, copied: false } : prev));
    }, 2500);
  };

  const handleAccountCreated = async (newUser: UserAccount, plainPassword: string, sendWhatsApp: boolean) => {
    const resolvedPerms = resolveStaffPermissions(newUser, newUser.role);
    const creatorTier = String(activeUser?.tier_level || activeUser?.role || '').toUpperCase();
    const derivedDealerId =
      creatorTier === 'DEALER'
        ? String(activeUser?.id || '')
        : creatorTier === 'SUB_DEALER'
        ? String(activeUser?.parent_dealer_id || '') || null
        : null;
    const derivedSubDealerId =
      creatorTier === 'SUB_DEALER' ? String(activeUser?.id || '') : null;

    const insertPayload: Record<string, any> = {
      id: newUser.id,
      username: (newUser.username || '').trim().toLowerCase(),
      full_name: newUser.fullName,
      phone: newUser.phone,
      role: newUser.role,
      area: newUser.area || 'Saddar Node',
      account_status: newUser.isActive ? 'ACTIVE' : 'SUSPENDED',
      password: plainPassword,
      can_access_gis_map: resolvedPerms.gis_map !== 'none',
      gis_map_permission: resolvedPerms.gis_map,
      permissions: resolvedPerms,
      ...(derivedDealerId ? { dealer_id: derivedDealerId } : {}),
      ...(derivedSubDealerId ? { sub_dealer_id: derivedSubDealerId } : {}),
      ...(activeUser?.id ? { created_by_id: String(activeUser.id) } : {}),
      created_at: new Date().toISOString(),
    };
    // Insert directly into Supabase portal_users
    try {
      const { error: upsertErr } = await supabase.from('portal_users').upsert([insertPayload]);
      if (upsertErr && isMissingPermissionsColumnError(upsertErr)) {
        const {
          can_access_gis_map: _c,
          gis_map_permission: _p,
          permissions: _perms,
          ...legacyPayload
        } = insertPayload;
        await supabase.from('portal_users').upsert([legacyPayload]);
        await updatePortalUserPermissions({
          userId: newUser.id,
          username: newUser.username,
          permissions: resolvedPerms,
        });
      }
    } catch (err) {
      console.warn('Supabase upsert notice:', err);
    }

    setSelectedUser(newUser);
    setLastGeneratedPassword(plainPassword);
    setRefreshTrigger((prev) => prev + 1);
    refreshMetrics();

    const portalUrl = getPortalUrlForRole(newUser.role);
    const shareText = buildStandardWhatsAppCredentialText(
      newUser.displayName || newUser.fullName,
      newUser.username,
      plainPassword,
      portalUrl
    );
    const waUrl = buildWhatsAppUrl(newUser.phone, shareText);
    const formattedPhone = formatWhatsAppDisplayPhone(newUser.phone);

    logWhatsAppNotice(
      newUser.phone,
      newUser.displayName || newUser.fullName,
      shareText,
      'isp_user_credentials_provisioned'
    );

    const toastId = Date.now();

    if (!sendWhatsApp) {
      setCredentialToast({
        id: toastId,
        status: 'created_no_wa',
        username: newUser.username,
        fullName: newUser.displayName || newUser.fullName,
        role: newUser.role,
        formattedPhone,
        plainPassword,
        portalUrl,
        waUrl,
        copied: false,
      });
      setTimeout(() => {
        setCredentialToast((prev) => (prev && prev.id === toastId ? null : prev));
      }, 6000);
      return;
    }

    // Zero-click background Baileys Gateway send (NEVER opens manual WhatsApp modal or wa.me tab)
    setCredentialToast({
      id: toastId,
      status: 'sending',
      username: newUser.username,
      fullName: newUser.displayName || newUser.fullName,
      role: newUser.role,
      formattedPhone,
      plainPassword,
      portalUrl,
      waUrl,
      copied: false,
    });

    const dispatchRes = await sendWhatsAppCredentialsViaGateway({
      phone: newUser.phone,
      username: newUser.username,
      fullName: newUser.displayName || newUser.fullName,
      password: plainPassword,
      role: newUser.role,
      portalUrl,
      subscriber: {
        id: newUser.id,
        username: newUser.username,
        full_name: newUser.displayName || newUser.fullName,
        phone: newUser.phone,
        dealer_id: derivedDealerId,
        sub_dealer_id: derivedSubDealerId,
      },
    });

    if (dispatchRes.ok && dispatchRes.status === 'SENT') {
      setCredentialToast({
        id: toastId,
        status: 'sent',
        username: newUser.username,
        fullName: newUser.displayName || newUser.fullName,
        role: newUser.role,
        formattedPhone: dispatchRes.formattedPhone || formattedPhone,
        plainPassword,
        portalUrl,
        senderCompanyName: dispatchRes.senderCompanyName,
        waUrl,
        copied: false,
      });
      setTimeout(() => {
        setCredentialToast((prev) => (prev && prev.id === toastId ? null : prev));
      }, 8000);
    } else {
      setCredentialToast({
        id: toastId,
        status: 'failed',
        username: newUser.username,
        fullName: newUser.displayName || newUser.fullName,
        role: newUser.role,
        formattedPhone: dispatchRes.formattedPhone || formattedPhone,
        plainPassword,
        portalUrl,
        senderCompanyName: dispatchRes.senderCompanyName,
        errorMessage:
          dispatchRes.error ||
          dispatchRes.skippedReason ||
          'WhatsApp session is disconnected. Pair your session or use the fallback options below.',
        waUrl,
        copied: false,
      });
    }
  };

  const handleSaveEditedUser = async (updatedUser: UserAccount) => {
    try {
      const resolvedPerms = resolveStaffPermissions(updatedUser, updatedUser.role);
      const updatePayload: Record<string, any> = {
        full_name: updatedUser.fullName,
        phone: updatedUser.phone,
        role: updatedUser.role,
        area: updatedUser.area,
        account_status: updatedUser.isActive ? 'ACTIVE' : 'SUSPENDED',
        can_access_gis_map: resolvedPerms.gis_map !== 'none',
        gis_map_permission: resolvedPerms.gis_map,
        permissions: resolvedPerms,
      };
      const { error: updateErr } = await supabase
        .from('portal_users')
        .update(updatePayload)
        .eq('id', updatedUser.id);
      if (updateErr && isMissingPermissionsColumnError(updateErr)) {
        const {
          can_access_gis_map: _c,
          gis_map_permission: _p,
          permissions: _perms,
          ...legacyPayload
        } = updatePayload;
        await supabase.from('portal_users').update(legacyPayload).eq('id', updatedUser.id);
      }
      await updatePortalUserPermissions({
        userId: updatedUser.id,
        username: updatedUser.username,
        permissions: resolvedPerms,
      });

      await fetch(`/api/auth/users/${updatedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: updatedUser.fullName,
          phone: updatedUser.phone,
          role: updatedUser.role,
          isActive: updatedUser.isActive,
        }),
      }).catch(() => {});
    } catch (err) {
      console.error('Failed to update user profile in Supabase:', err);
    }

    setRefreshTrigger((prev) => prev + 1);
    refreshMetrics();
    setActionNotice(`User @${updatedUser.username} updated successfully.`);
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleResetPassword = async (userId: string, newPassword: string, sendWhatsApp: boolean) => {
    try {
      await supabase
        .from('portal_users')
        .update({ password: newPassword })
        .eq('id', userId);

      await fetch(`/api/auth/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      }).catch(() => {});

      if (selectedUser) {
        setLastGeneratedPassword(newPassword);
        if (sendWhatsApp) {
          setIsWhatsAppModalOpen(true);
        } else {
          setActionNotice(`Password reset for @${selectedUser.username}.`);
          setTimeout(() => setActionNotice(null), 4000);
        }
      }
    } catch (err) {
      console.error('Failed to reset password:', err);
    }
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      // 1. Delete strictly from Supabase portal_users
      await supabase.from('portal_users').delete().eq('id', userToDelete.id);
      await supabase.from('portal_users').delete().eq('username', userToDelete.username);

      // 2. Delete from server API
      await fetch(`/api/auth/users/${userToDelete.id}`, { method: 'DELETE' }).catch(() => {});

      // 3. MikroTik cleanup if client
      if ((userToDelete.role || '').toUpperCase() === 'CLIENT' || userToDelete.username) {
        await deletePppoeUser(userToDelete.username).catch(() => {});
      }

      setActionNotice(`User @${userToDelete.username} deleted.`);
      setTimeout(() => setActionNotice(null), 4000);
      setRefreshTrigger((prev) => prev + 1);
      refreshMetrics();
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
      setUserToDelete(null);
    }
  };

  // Render Youth Net 360° Profile View if selected
  if (selectedProfileUsername) {
    return (
      <SubscriberProfileView
        username={selectedProfileUsername}
        onBack={() => setSelectedProfileUsername(null)}
      />
    );
  }

  // Render Agent Financial 360° & Handover Profile View if an agent is selected
  if (selectedAgentUsername) {
    return (
      <AgentProfileView
        username={selectedAgentUsername}
        onBack={() => {
          setSelectedAgentUsername(null);
          refreshMetrics();
        }}
      />
    );
  }

  return (
    <div className="space-y-6 text-xs font-sans">
      {/* 1. Top Header & Action Controls */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              {onBack && (
                <button
                  onClick={onBack}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition cursor-pointer mr-1"
                  title="Go Back"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <span className="font-extrabold text-xl text-white tracking-tight">
                {isResellerView ? 'My Subscribers' : 'User & Access Management'}
              </span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                {isResellerView ? 'Isolated Reseller Directory' : 'Live Supabase Sync'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              {isResellerView ? (
                <>
                  Viewing PPPoE internet subscribers assigned to <strong className="text-cyan-400">@{activeUser?.username || 'reseller'}</strong>. Master ISP staff and other resellers are strictly isolated.
                </>
              ) : (
                <>
                  Strict 1:1 synchronization with Supabase PostgreSQL <code className="text-cyan-400">portal_users</code>. No mock data, prototype fallbacks, or duplicated profiles.
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setIsAddPppoeModalOpen(true)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition shadow-lg shadow-cyan-950/40 cursor-pointer active:scale-95"
              title="Add PPPoE Subscriber"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>{isResellerView ? '+ Add Subscriber' : '+ MikroTik PPPoE'}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBulkCsvModalOpen(true)}
              className="flex items-center gap-1.5 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/70 font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer active:scale-95"
              title="Bulk CSV Import with Smart Auto-Link for Existing MikroTik Secrets"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>Bulk CSV Import</span>
            </button>
            {!isResellerView && (
              <button
                type="button"
                onClick={() => setIsMikrotikAutoImportOpen(true)}
                className="flex items-center gap-1.5 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/70 font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer active:scale-95"
                title="1-Click Scan Live MikroTik PPPoE Secrets & Auto-Create Missing Portal Accounts"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                <span>Sync &amp; Auto-Create from MikroTik</span>
              </button>
            )}
            {isResellerView ? (
              <button
                type="button"
                onClick={() => setIsAddScopedAgentModalOpen(true)}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer active:scale-95"
              >
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <span>+ Add Field Agent</span>
              </button>
            ) : (
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-bold text-xs px-4 py-2 rounded-xl transition shadow-sm cursor-pointer active:scale-95"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>+ Create New Account</span>
              </button>
            )}
          </div>
        </div>

        {/* Session Context Indicator */}
        {isResellerView ? (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="font-bold text-slate-300">
                {resellerTier === 'DEALER' ? 'Dealer Reseller Portal:' : 'Sub-Dealer Reseller Portal:'}
              </span>
              <span className="text-cyan-400 font-bold">@{activeUser?.username || 'reseller'}</span>
              <span className="text-slate-500">(Tenant isolation enforced)</span>
            </div>
          </div>
        ) : (
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 text-xs">
            <div className="flex items-center gap-2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
              <span className="font-bold text-slate-300">Master Administrator:</span>
              <span className="text-cyan-400 font-bold">@admin</span>
              <span className="text-slate-500">(Supabase RBAC active)</span>
            </div>

            {onSwitchSimulatedRole && (
              <div className="flex items-center gap-2 self-end md:self-auto font-mono text-[11px]">
                <span className="text-slate-400">Simulate View:</span>
                <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                  {(['ADMIN', 'MANAGER', 'AGENT', 'CLIENT'] as SystemRole[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => onSwitchSimulatedRole(r)}
                      className={`px-2 py-0.5 rounded font-bold transition cursor-pointer ${
                        currentSimulatedRole === r
                          ? 'bg-cyan-600 text-slate-950 shadow-sm'
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
        )}
      </div>

      {/* Sub-Navigation: Users vs Permission Matrix (Hidden for Resellers) */}
      {!isResellerView && (
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
          <button
            onClick={() => setActiveManagementTab('users')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
              activeManagementTab === 'users'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-900/30'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Accounts &amp; Credentials ({userMetrics.total})</span>
          </button>
          <button
            onClick={() => setActiveManagementTab('permissions')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-xs transition cursor-pointer ${
              activeManagementTab === 'permissions'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-900/30'
                : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Granular Feature &amp; Permission Matrix</span>
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-950 text-cyan-300 font-mono font-bold">
              RBAC
            </span>
          </button>
        </div>
      )}

      {activeManagementTab === 'permissions' ? (
        <PermissionMatrixStudio
          currentSimulatedRole={currentSimulatedRole}
          onSwitchSimulatedRole={onSwitchSimulatedRole}
        />
      ) : (
        <>
          {/* Action Notification Banner */}
          {actionNotice && (
            <div className="p-3.5 bg-emerald-950/90 border border-emerald-700 rounded-xl text-emerald-300 text-xs font-mono flex items-center gap-2.5 animate-fadeIn shadow-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{actionNotice}</span>
            </div>
          )}

          {/* Top Metrics Grid: 3 Clean Reseller Cards vs 5 Master ISP Staff/Admin Cards */}
          {isResellerView ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">My Total Subscribers</span>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-2xl font-bold font-mono text-white">
                    {resellerSubscriberMetrics.total}
                  </span>
                  <Users className="w-5 h-5 text-cyan-400" />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Assigned PPPoE internet accounts
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">My Active / Online</span>
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      {resellerSubscriberMetrics.online}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      online / {resellerSubscriberMetrics.active} active
                    </span>
                  </div>
                  <Wifi className="w-5 h-5 text-emerald-400" />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Live connected PPPoE sessions
                </span>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">My Suspended / Expired</span>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-2xl font-bold font-mono text-rose-400">
                    {resellerSubscriberMetrics.suspendedExpired}
                  </span>
                  <UserX className="w-5 h-5 text-rose-400" />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Disconnected or awaiting renewal
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">All Users</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold font-mono text-white">{userMetrics.total}</span>
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">Clients / Subscribers</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold font-mono text-emerald-400">{userMetrics.clients}</span>
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">Field Recovery Agents</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold font-mono text-cyan-400">{userMetrics.agents}</span>
                  <UserCheck className="w-4 h-4 text-cyan-400" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">Operations Managers</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold font-mono text-indigo-400">{userMetrics.managers}</span>
                  <Shield className="w-4 h-4 text-indigo-400" />
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
                <span className="text-[11px] text-slate-400 block font-medium">Master Administrators</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xl font-bold font-mono text-rose-400">{userMetrics.admins}</span>
                  <ShieldCheck className="w-4 h-4 text-rose-400" />
                </div>
              </div>
            </div>
          )}

          {/* Dedicated Strict Users Table */}
          <UsersTable
            currentUser={activeUser}
            onSelectSubscriber={(username) => setSelectedProfileUsername(username)}
            onSelectAgent={(agentUsername) => setSelectedAgentUsername(agentUsername)}
            onEditUser={(user) => {
              if (!isResellerView && isStaffRoleEligibleForGisControl(user.role)) {
                setSelectedStaffUser(user);
                setIsEditStaffModalOpen(true);
              } else {
                setSelectedUser(mapRowToAccount(user));
                setIsEditModalOpen(true);
              }
            }}
            onResetPassword={(user) => {
              setSelectedUser(mapRowToAccount(user));
              setIsResetModalOpen(true);
            }}
            onWhatsAppDispatch={(user) => {
              setSelectedUser(mapRowToAccount(user));
              setLastGeneratedPassword(user.password || '••••••••');
              setIsWhatsAppModalOpen(true);
            }}
            onDeleteUser={(user) => {
              setUserToDelete(user);
              setIsDeleteDialogOpen(true);
            }}
            onRefresh={refreshMetrics}
            refreshTrigger={refreshTrigger}
          />
        </>
      )}

      {/* A. Create New Account Modal (Master ISP Admin Only) */}
      {!isResellerView && (
        <CreateAccountModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={handleAccountCreated}
          subscribers={liveSubscribers}
        />
      )}

      {/* A2. Create Scoped Field Agent Modal (Dealers & Sub-Dealers) */}
      <AddScopedFieldAgentModal
        isOpen={isAddScopedAgentModalOpen}
        onClose={() => setIsAddScopedAgentModalOpen(false)}
        currentUser={activeUser}
        onSuccess={(created) => {
          setActionNotice(`Field Agent ${created.full_name} (@${created.username}) created under your account.`);
          setTimeout(() => setActionNotice(null), 5000);
          setRefreshTrigger((prev) => prev + 1);
          void refreshMetrics();
        }}
      />

      {/* B. Edit Staff Profile Modal (for Field Agents & Managers) */}
      <EditStaffModal
        isOpen={isEditStaffModalOpen}
        onClose={() => {
          setIsEditStaffModalOpen(false);
          setSelectedStaffUser(null);
        }}
        staff={selectedStaffUser}
        onSuccess={(updated) => {
          setActionNotice(`Staff profile for @${selectedStaffUser?.username} updated successfully.`);
          setTimeout(() => setActionNotice(null), 5000);
          setRefreshTrigger((prev) => prev + 1);
          refreshMetrics();
        }}
      />

      {/* C. Edit User Profile Modal (General / Clients) */}
      <EditUserModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedUser(null);
        }}
        user={selectedUser}
        onSave={handleSaveEditedUser}
      />

      {/* C. Reset Password Modal */}
      <ResetPasswordModal
        isOpen={isResetModalOpen}
        onClose={() => {
          setIsResetModalOpen(false);
          setSelectedUser(null);
        }}
        user={selectedUser}
        onConfirmReset={handleResetPassword}
      />

      {/* D. WhatsApp Credential Dispatch Modal */}
      <WhatsAppDispatchModal
        isOpen={isWhatsAppModalOpen}
        onClose={() => {
          setIsWhatsAppModalOpen(false);
          setSelectedUser(null);
        }}
        user={selectedUser}
        plainPassword={lastGeneratedPassword}
      />

      {/* E. Add PPPoE User to physical MikroTik */}
      <AddUserModal
        isOpen={isAddPppoeModalOpen}
        onClose={() => setIsAddPppoeModalOpen(false)}
        onSuccess={(data) => {
          setActionNotice(`PPPoE user ${data.user.username} provisioned on MikroTik.`);
          setTimeout(() => setActionNotice(null), 5000);
          setRefreshTrigger((prev) => prev + 1);
          void refreshMetrics();
        }}
      />

      {/* F. Delete User Confirmation Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setUserToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Delete User Account"
        itemName={userToDelete ? `@${userToDelete.username} (${userToDelete.full_name || userToDelete.fullName || userToDelete.username})` : ''}
        itemType="user"
        description={
          userToDelete
            ? `Are you sure you want to delete user "${userToDelete.full_name || userToDelete.username}" (@${userToDelete.username}) from Supabase? This permanently removes portal access.`
            : undefined
        }
        confirmText="Confirm Permanent Delete"
        isLoading={isDeleting}
      />

      <BulkCsvImportModal
        isOpen={isBulkCsvModalOpen}
        onClose={() => setIsBulkCsvModalOpen(false)}
        currentUser={activeUser}
        onImportComplete={() => {
          setRefreshTrigger((prev) => prev + 1);
          void refreshMetrics();
        }}
      />

      <MikrotikAutoImportModal
        isOpen={isMikrotikAutoImportOpen && !isResellerView}
        onClose={() => setIsMikrotikAutoImportOpen(false)}
        currentUser={activeUser}
        onImportComplete={() => {
          setRefreshTrigger((prev) => prev + 1);
          void refreshMetrics();
        }}
      />

      {/* Non-blocking Floating Toast for Account Creation & Zero-Click WhatsApp Dispatch */}
      {credentialToast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 right-5 z-[9990] w-[calc(100vw-2.5rem)] max-w-md rounded-2xl border p-4 shadow-2xl backdrop-blur-md transition-all animate-fadeIn ${
            credentialToast.status === 'failed'
              ? 'bg-slate-950/95 border-amber-500/70 text-amber-100 shadow-amber-950/40'
              : credentialToast.status === 'sending'
              ? 'bg-slate-950/95 border-cyan-500/60 text-cyan-100 shadow-cyan-950/40'
              : 'bg-emerald-950/95 border-emerald-500/70 text-emerald-100 shadow-emerald-950/40'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 p-1.5 rounded-xl shrink-0 ${
                credentialToast.status === 'failed'
                  ? 'bg-amber-500/20 text-amber-400'
                  : credentialToast.status === 'sending'
                  ? 'bg-cyan-500/20 text-cyan-400'
                  : 'bg-emerald-500/20 text-emerald-400'
              }`}
            >
              {credentialToast.status === 'sending' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : credentialToast.status === 'failed' ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-xs font-bold leading-snug text-white">
                {credentialToast.status === 'sending' &&
                  `Account @${credentialToast.username} created — sending WhatsApp credentials to ${credentialToast.formattedPhone}...`}
                {credentialToast.status === 'sent' &&
                  `Account created & WhatsApp credentials auto-sent to ${credentialToast.formattedPhone}`}
                {credentialToast.status === 'created_no_wa' &&
                  `Account @${credentialToast.username} (${credentialToast.role}) created successfully.`}
                {credentialToast.status === 'failed' &&
                  `Account @${credentialToast.username} created — WhatsApp auto-send failed`}
              </p>

              {credentialToast.status === 'sent' && credentialToast.senderCompanyName && (
                <p className="text-[11px] text-emerald-300/90 font-mono flex items-center gap-1.5">
                  <MessageCircle className="w-3 h-3 shrink-0" />
                  <span>Dispatched via {credentialToast.senderCompanyName}</span>
                </p>
              )}

              {credentialToast.status === 'failed' && (
                <>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    {credentialToast.errorMessage}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1.5">
                    <button
                      type="button"
                      onClick={() => handleCopyToastCredentials(credentialToast)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-semibold text-[11px] transition cursor-pointer"
                    >
                      {credentialToast.copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-cyan-400" />
                      )}
                      <span>{credentialToast.copied ? 'Copied!' : 'Copy Credentials'}</span>
                    </button>
                    <a
                      href={credentialToast.waUrl}
                      target="_blank"
                      rel="noopener noreferrer external"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[11px] transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Manual WhatsApp</span>
                    </a>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCredentialToast(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0"
              aria-label="Dismiss notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserAccountsView;
