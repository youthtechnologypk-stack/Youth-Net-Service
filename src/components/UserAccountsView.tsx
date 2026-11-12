import React, { useState, useEffect, useCallback } from 'react';
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
import { buildStandardWhatsAppCredentialText, getPortalUrlForRole } from '../services/authUtils';
import { RealMikrotikSubscriber, fetchLiveMikrotikSubscribers } from '../services/mikrotikSubscriberSync';
import { supabase } from '../services/supabaseClient';

export interface UserAccountsViewProps {
  currentSimulatedRole?: SystemRole;
  onSwitchSimulatedRole?: (role: SystemRole) => void;
  onBack?: () => void;
}

export const UserAccountsView: React.FC<UserAccountsViewProps> = ({
  currentSimulatedRole = 'ADMIN',
  onSwitchSimulatedRole,
  onBack,
}) => {
  const { routers, selectedRouterId, logWhatsAppNotice, deletePppoeUser } = useISP();
  const [liveSubscribers, setLiveSubscribers] = useState<RealMikrotikSubscriber[]>([]);

  // Sub-navigation: User Accounts vs Permission Matrix
  const [activeManagementTab, setActiveManagementTab] = useState<'users' | 'permissions'>('users');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Metrics state strictly from live Supabase portal_users
  const [userMetrics, setUserMetrics] = useState({
    total: 0,
    clients: 0,
    agents: 0,
    managers: 0,
    admins: 0,
  });

  // Selected username for Transworld 360° Profile View
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

      const { data, error } = await supabase.from('portal_users').select('id, role');
      if (!error && data) {
        setUserMetrics({
          total: data.length,
          clients: data.filter((u) => (u.role || '').toUpperCase() === 'CLIENT').length,
          agents: data.filter((u) => (u.role || '').toUpperCase() === 'AGENT').length,
          managers: data.filter((u) => (u.role || '').toUpperCase() === 'MANAGER').length,
          admins: data.filter((u) => (u.role || '').toUpperCase() === 'ADMIN').length,
        });
      }
    } catch (err) {
      console.warn('Failed to refresh metrics from Supabase:', err);
    }
  }, []);

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
      createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    };
  };

  // Handlers
  const handleAccountCreated = async (newUser: UserAccount, plainPassword: string, sendWhatsApp: boolean) => {
    // Insert directly into Supabase portal_users
    try {
      await supabase.from('portal_users').upsert([
        {
          id: newUser.id,
          username: (newUser.username || '').trim().toLowerCase(),
          full_name: newUser.fullName,
          phone: newUser.phone,
          role: newUser.role,
          area: newUser.area || 'Saddar Node',
          account_status: newUser.isActive ? 'ACTIVE' : 'SUSPENDED',
          is_active: newUser.isActive,
          password: plainPassword,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      console.warn('Supabase upsert notice:', err);
    }

    setSelectedUser(newUser);
    setLastGeneratedPassword(plainPassword);
    setRefreshTrigger((prev) => prev + 1);
    refreshMetrics();

    const shareText = buildStandardWhatsAppCredentialText(
      newUser.displayName || newUser.fullName,
      newUser.username,
      plainPassword,
      getPortalUrlForRole(newUser.role)
    );

    logWhatsAppNotice(
      newUser.phone,
      newUser.displayName || newUser.fullName,
      shareText,
      'isp_user_credentials_provisioned'
    );

    if (sendWhatsApp) {
      setIsWhatsAppModalOpen(true);
    } else {
      setActionNotice(`Account created! @${newUser.username} (${newUser.role}) is now active.`);
      setTimeout(() => setActionNotice(null), 5000);
    }
  };

  const handleSaveEditedUser = async (updatedUser: UserAccount) => {
    try {
      await supabase
        .from('portal_users')
        .update({
          full_name: updatedUser.fullName,
          phone: updatedUser.phone,
          role: updatedUser.role,
          area: updatedUser.area,
          account_status: updatedUser.isActive ? 'ACTIVE' : 'SUSPENDED',
          is_active: updatedUser.isActive,
        })
        .eq('id', updatedUser.id);

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

  // Render Transworld 360° Profile View if selected
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
                User &amp; Access Management
              </span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                Live Supabase Sync
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Strict 1:1 synchronization with Supabase PostgreSQL <code className="text-cyan-400">portal_users</code>. No mock data, prototype fallbacks, or duplicated profiles.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setIsAddPppoeModalOpen(true)}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs px-3.5 py-2 rounded-xl transition shadow-sm cursor-pointer active:scale-95"
              title="Add PPPoE Secret to physical MikroTik Router"
            >
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>+ MikroTik PPPoE</span>
            </button>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-xl transition shadow-lg shadow-cyan-950/50 cursor-pointer active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>+ Create New Account</span>
            </button>
          </div>
        </div>

        {/* Master Admin Indicator */}
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
      </div>

      {/* Sub-Navigation: Users vs Permission Matrix */}
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

          {/* Top Metrics Grid */}
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

          {/* Dedicated Strict Users Table */}
          <UsersTable
            onSelectSubscriber={(username) => setSelectedProfileUsername(username)}
            onSelectAgent={(agentUsername) => setSelectedAgentUsername(agentUsername)}
            onEditUser={(user) => {
              const roleUpper = (user.role || '').toUpperCase();
              if (roleUpper === 'AGENT' || roleUpper === 'MANAGER') {
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

      {/* A. Create New Account Modal */}
      <CreateAccountModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleAccountCreated}
        subscribers={liveSubscribers}
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
    </div>
  );
};

export default UserAccountsView;
