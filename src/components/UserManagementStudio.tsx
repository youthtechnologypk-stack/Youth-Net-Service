import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  Key,
  Smartphone,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Send,
  Lock,
  Unlock,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  UserCheck,
  Radio,
  FileText,
  Trash2,
  Edit,
  AlertTriangle,
  Ban,
  CheckCircle,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { UserAccount, SystemRole } from '../types/auth';
import { INITIAL_USER_ACCOUNTS } from '../data/initialUsers';
import { CreateAccountModal } from './CreateAccountModal';
import { EditUserModal } from './EditUserModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import { WhatsAppDispatchModal } from './WhatsAppDispatchModal';
import { AddUserModal } from './AddUserModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { PermissionMatrixStudio } from './PermissionMatrixStudio';
import { buildStandardWhatsAppCredentialText, getPortalUrlForRole } from '../services/authUtils';

interface UserManagementStudioProps {
  currentSimulatedRole?: SystemRole;
  onSwitchSimulatedRole?: (role: SystemRole) => void;
}

export const UserManagementStudio: React.FC<UserManagementStudioProps> = ({
  currentSimulatedRole = 'ADMIN',
  onSwitchSimulatedRole,
}) => {
  const { logWhatsAppNotice, deletePppoeUser } = useISP();

  // Primary user accounts state
  const [users, setUsers] = useState<UserAccount[]>(() => {
    try {
      const saved = localStorage.getItem('netpulse_user_accounts_v1');
      return saved ? JSON.parse(saved) : INITIAL_USER_ACCOUNTS;
    } catch {
      return INITIAL_USER_ACCOUNTS;
    }
  });

  const [activeManagementTab, setActiveManagementTab] = useState<'users' | 'permissions'>('users');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'CLIENT' | 'AGENT' | 'MANAGER'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState(false);
  const [isAddPppoeModalOpen, setIsAddPppoeModalOpen] = useState(false);

  // Selected users for modals
  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [lastGeneratedPassword, setLastGeneratedPassword] = useState<string>('••••••••');

  // Deletion dialog state
  const [userToDelete, setUserToDelete] = useState<UserAccount | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync users to storage
  const saveUsers = (updated: UserAccount[]) => {
    setUsers(updated);
    try {
      localStorage.setItem('netpulse_user_accounts_v1', JSON.stringify(updated));
    } catch {
      // Storage unavailable
    }
  };

  // Fetch from server API on mount to synchronize with PostgreSQL database
  useEffect(() => {
    const fetchServerUsers = async () => {
      try {
        const res = await fetch('/api/auth/users');
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.users) && data.users.length > 0) {
            // Merge with local users to preserve client metadata if needed
            const serverUsers: UserAccount[] = data.users.map((su: any) => {
              const localMatch = users.find((u) => u.username === su.username || u.id === su.id);
              return {
                id: su.id,
                username: su.username,
                fullName: su.fullName || su.displayName || 'System User',
                displayName: su.displayName || su.fullName || 'System User',
                phone: su.phone || '+92 300 0000000',
                role: su.role,
                isActive: su.isActive !== false,
                email: localMatch?.email || `${su.username}@youthnet.pk`,
                assignedArea: localMatch?.assignedArea,
                department: localMatch?.department,
                cashLimit: localMatch?.cashLimit,
                linkedCustomerId: localMatch?.linkedCustomerId,
                linkedAgentId: localMatch?.linkedAgentId,
                createdAt: su.createdAt || new Date().toISOString(),
              };
            });
            saveUsers(serverUsers);
          }
        }
      } catch {
        // Continue with local storage on network error
      }
    };

    fetchServerUsers();
  }, []);

  // 1. Create New Account Callback
  const handleAccountCreated = (newUser: UserAccount, plainPassword: string, sendWhatsApp: boolean) => {
    const updated = [newUser, ...users.filter((u) => u.username !== newUser.username)];
    saveUsers(updated);

    setSelectedUser(newUser);
    setLastGeneratedPassword(plainPassword);

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
      setActionNotice(`User account @${newUser.username} (${newUser.role}) created successfully.`);
      setTimeout(() => setActionNotice(null), 5000);
    }
  };

  // 2. Edit User Profile
  const handleSaveEditedUser = async (updatedUser: UserAccount) => {
    try {
      await fetch(`/api/auth/users/${updatedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: updatedUser.fullName,
          phone: updatedUser.phone,
          role: updatedUser.role,
          isActive: updatedUser.isActive,
        }),
      });
    } catch {
      // continue locally
    }

    const updated = users.map((u) => (u.id === updatedUser.id ? updatedUser : u));
    saveUsers(updated);
    setActionNotice(`User @${updatedUser.username} profile updated successfully.`);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // 3. Reset Password
  const handleResetPassword = async (userId: string, newPassword: string, sendWhatsApp: boolean) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return;

    try {
      await fetch(`/api/auth/users/${userId}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
    } catch {
      // continue locally
    }

    setSelectedUser(targetUser);
    setLastGeneratedPassword(newPassword);

    const shareText = buildStandardWhatsAppCredentialText(
      targetUser.displayName || targetUser.fullName,
      targetUser.username,
      newPassword,
      getPortalUrlForRole(targetUser.role)
    );

    logWhatsAppNotice(
      targetUser.phone,
      targetUser.displayName || targetUser.fullName,
      shareText,
      'isp_user_password_reset'
    );

    if (sendWhatsApp) {
      setIsWhatsAppModalOpen(true);
    } else {
      setActionNotice(`Password for @${targetUser.username} updated successfully.`);
      setTimeout(() => setActionNotice(null), 5000);
    }
  };

  // 4. Toggle Access / Ban (1-Click)
  const handleToggleStatus = async (user: UserAccount) => {
    if (user.username === 'admin') {
      setActionNotice('Security Policy: Master Administrator account cannot be suspended.');
      setTimeout(() => setActionNotice(null), 4000);
      return;
    }

    const nextStatus = !user.isActive;

    try {
      await fetch(`/api/auth/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextStatus }),
      });
    } catch {
      // continue locally
    }

    const updated = users.map((u) => (u.id === user.id ? { ...u, isActive: nextStatus } : u));
    saveUsers(updated);

    setActionNotice(
      `Account @${user.username} (${user.displayName || user.fullName}) is now ${
        nextStatus ? 'ACTIVE' : 'SUSPENDED'
      }.`
    );
    setTimeout(() => setActionNotice(null), 4000);
  };

  // 5. One-Click Copy Credentials
  const handleCopyCredentials = (user: UserAccount) => {
    const text = buildStandardWhatsAppCredentialText(
      user.displayName || user.fullName,
      user.username,
      '•••••••• (Existing)',
      getPortalUrlForRole(user.role)
    );
    navigator.clipboard.writeText(text);
    setCopiedId(user.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // 6. Direct WhatsApp Dispatch Modal Trigger
  const handleOpenWhatsAppDispatch = (user: UserAccount) => {
    setSelectedUser(user);
    setLastGeneratedPassword('••••••••');
    setIsWhatsAppModalOpen(true);
  };

  // Filtered users calculation
  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const nameMatch = (u.displayName || u.fullName || '').toLowerCase().includes(q);
    const userMatch = (u.username || '').toLowerCase().includes(q);
    const phoneMatch = (u.phone || '').includes(q);
    const areaMatch = (u.assignedArea || '').toLowerCase().includes(q);
    const deptMatch = (u.department || '').toLowerCase().includes(q);
    return nameMatch || userMatch || phoneMatch || areaMatch || deptMatch;
  });

  const totalCount = users.length;
  const clientCount = users.filter((u) => u.role === 'CLIENT').length;
  const agentCount = users.filter((u) => u.role === 'AGENT').length;
  const managerCount = users.filter((u) => u.role === 'MANAGER').length;
  const adminCount = users.filter((u) => u.role === 'ADMIN').length;

  return (
    <div className="space-y-6 text-xs font-sans">
      {/* 1. Header & Actions Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-extrabold text-xl text-white tracking-tight">
                User &amp; Access Management
              </span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono font-bold">
                Admin Control Panel
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Create, manage, and assign portal access credentials for Clients, Field Agents, and Managers with instant 1-click WhatsApp dispatch.
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

        {/* Master Admin Seed Indicator */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span className="font-bold text-slate-300">Master Administrator:</span>
            <span className="text-cyan-400 font-bold">@admin</span>
            <span className="text-slate-500">(Bcrypt RBAC 12 rounds active)</span>
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

      {/* Primary Sub-Navigation: Users vs Permission Matrix */}
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
          <span>User Accounts &amp; Credentials ({totalCount})</span>
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

          {/* 2. Top Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">All Users</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-white">{totalCount}</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">Clients / Subscribers</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-emerald-400">{clientCount}</span>
            <Smartphone className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">Field Recovery Agents</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-cyan-400">{agentCount}</span>
            <UserCheck className="w-4 h-4 text-cyan-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">Operations Managers</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-indigo-400">{managerCount}</span>
            <Shield className="w-4 h-4 text-indigo-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">Master Administrators</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-rose-400">{adminCount}</span>
            <ShieldCheck className="w-4 h-4 text-rose-400" />
          </div>
        </div>
      </div>

      {/* 3. Centralized Management Table Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        {/* Tabs: All Users | Clients | Field Agents | Managers */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: `All Users (${totalCount})` },
            { id: 'CLIENT', label: `Clients (${clientCount})` },
            { id: 'AGENT', label: `Field Agents (${agentCount})` },
            { id: 'MANAGER', label: `Managers (${managerCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setRoleFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                roleFilter === tab.id
                  ? 'bg-cyan-600 text-slate-950 font-bold shadow-md shadow-cyan-950/40'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Real-time search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search full name, @username, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-72 pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* 4. Table Columns: Full Name, Username / Account ID, Role Badge, Phone Number, Status, Actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4">Full Name</th>
                <th className="py-3.5 px-4">Username / Account ID</th>
                <th className="py-3.5 px-4">Role Badge</th>
                <th className="py-3.5 px-4">Phone Number</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-sans">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500 font-mono">
                    No accounts found matching the current role tab or search term.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const targetName = user.fullName || user.displayName || 'System User';
                  const isMasterAdmin = user.username === 'admin';

                  return (
                    <tr key={user.id} className="hover:bg-slate-950/50 transition">
                      {/* 1. Full Name */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 ${
                              user.role === 'ADMIN'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : user.role === 'MANAGER'
                                ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                                : user.role === 'AGENT'
                                ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            }`}
                          >
                            {targetName.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-white block">{targetName}</span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              {user.department || user.assignedArea || 'Standard Tier'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* 2. Username / Account ID */}
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <span className="text-cyan-400 font-bold block">@{user.username}</span>
                        <span className="text-slate-400">{user.email || `${user.username}@youthnet.pk`}</span>
                      </td>

                      {/* 3. Role Badge */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] px-2.5 py-1 rounded-full font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1 ${
                            user.role === 'ADMIN'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : user.role === 'MANAGER'
                              ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                              : user.role === 'AGENT'
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              user.role === 'ADMIN'
                                ? 'bg-rose-400'
                                : user.role === 'MANAGER'
                                ? 'bg-indigo-400'
                                : user.role === 'AGENT'
                                ? 'bg-cyan-400'
                                : 'bg-emerald-400'
                            }`}
                          />
                          <span>{user.role}</span>
                        </span>
                      </td>

                      {/* 4. Phone Number */}
                      <td className="py-3.5 px-4 font-mono text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-200">{user.phone}</span>
                          <button
                            onClick={() => handleOpenWhatsAppDispatch(user)}
                            className="p-1 rounded bg-slate-800 hover:bg-emerald-950 text-emerald-400 transition cursor-pointer"
                            title="Direct WhatsApp Dispatch"
                          >
                            <Send className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      {/* 5. Status (Active / Suspended) */}
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => handleToggleStatus(user)}
                          disabled={isMasterAdmin}
                          className={`text-[10px] px-2.5 py-1 rounded-full font-mono font-bold flex items-center gap-1.5 transition ${
                            user.isActive
                              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/60'
                              : 'bg-rose-950/80 text-rose-300 border border-rose-800 hover:bg-rose-900/60'
                          } ${isMasterAdmin ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                          title={
                            isMasterAdmin
                              ? 'Master Admin is permanently Active'
                              : user.isActive
                              ? 'Click to Suspend / Revoke access'
                              : 'Click to Activate access'
                          }
                        >
                          {user.isActive ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Ban className="w-3 h-3 text-rose-400" />
                          )}
                          <span>{user.isActive ? 'Active' : 'Suspended'}</span>
                        </button>
                      </td>

                      {/* 6. Actions (Edit, Reset Password, Deactivate / Delete) */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Copy credentials */}
                          <button
                            onClick={() => handleCopyCredentials(user)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                            title="Copy Portal Credentials"
                          >
                            {copiedId === user.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {/* WhatsApp 1-Click Dispatch */}
                          <button
                            onClick={() => handleOpenWhatsAppDispatch(user)}
                            className="px-2 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition flex items-center gap-1 text-[11px] shadow-sm shadow-emerald-950/40 cursor-pointer"
                            title="Instant 1-Click WhatsApp Dispatch"
                          >
                            <Send className="w-3 h-3" />
                            <span className="hidden md:inline">WhatsApp</span>
                          </button>

                          {/* Edit user */}
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setIsEditModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 transition cursor-pointer"
                            title="Edit User Profile"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>

                          {/* Reset Password */}
                          <button
                            onClick={() => {
                              setSelectedUser(user);
                              setIsResetModalOpen(true);
                            }}
                            className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 transition cursor-pointer font-medium text-[11px]"
                            title="Direct Password Reset"
                          >
                            <Key className="w-3 h-3 inline mr-1" />
                            <span>Reset</span>
                          </button>

                          {/* Deactivate / Delete */}
                          {!isMasterAdmin && (
                            <button
                              onClick={() => {
                                setUserToDelete(user);
                                setIsDeleteDialogOpen(true);
                              }}
                              className="p-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-800 text-rose-300 hover:text-white transition cursor-pointer"
                              title="Delete Account & MikroTik Secret"
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
      </>
      )}

      {/* 5. Modals */}
      {/* A. Create New Account Modal */}
      <CreateAccountModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleAccountCreated}
      />

      {/* B. Edit User Profile Modal */}
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

      {/* D. Instant WhatsApp Credential Dispatch Modal */}
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
        onConfirm={async () => {
          if (!userToDelete) return;
          setIsDeleting(true);
          try {
            // Delete from server backend API
            await fetch(`/api/auth/users/${userToDelete.id}`, { method: 'DELETE' });

            // Dual cleanup on physical MikroTik if PPPoE customer
            if (userToDelete.role === 'CLIENT' || userToDelete.username) {
              await deletePppoeUser(userToDelete.username);
            }

            const updated = users.filter((u) => u.id !== userToDelete.id);
            saveUsers(updated);

            setActionNotice(`User "${userToDelete.fullName || userToDelete.displayName}" deleted.`);
            setTimeout(() => setActionNotice(null), 4000);
          } finally {
            setIsDeleting(false);
            setIsDeleteDialogOpen(false);
            setUserToDelete(null);
          }
        }}
        title="Delete User Account"
        itemName={userToDelete ? `@${userToDelete.username} (${userToDelete.fullName || userToDelete.displayName})` : ''}
        itemType="user"
        description={
          userToDelete
            ? `Are you sure you want to delete user "${userToDelete.fullName || userToDelete.displayName}" (@${userToDelete.username})? This terminates portal access, revokes credentials, and purges any active session.`
            : undefined
        }
        confirmText="Confirm Permanent Delete"
        isLoading={isDeleting}
      />
    </div>
  );
};
