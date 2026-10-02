import React, { useState } from 'react';
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
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { UserAccount, SystemRole } from '../types/auth';
import { INITIAL_USER_ACCOUNTS } from '../data/initialUsers';
import { UserCredentialModal } from './UserCredentialModal';
import { buildWhatsAppShareText, generateRandomPassword } from '../services/authUtils';

interface UserManagementStudioProps {
  currentSimulatedRole?: SystemRole;
  onSwitchSimulatedRole?: (role: SystemRole) => void;
}

export const UserManagementStudio: React.FC<UserManagementStudioProps> = ({
  currentSimulatedRole = 'ADMIN',
  onSwitchSimulatedRole,
}) => {
  const { logWhatsAppNotice } = useISP();

  const [users, setUsers] = useState<UserAccount[]>(() => {
    try {
      const saved = localStorage.getItem('netpulse_user_accounts_v1');
      return saved ? JSON.parse(saved) : INITIAL_USER_ACCOUNTS;
    } catch {
      return INITIAL_USER_ACCOUNTS;
    }
  });

  const [roleFilter, setRoleFilter] = useState<'ALL' | SystemRole>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<UserAccount | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const saveUsers = (updated: UserAccount[]) => {
    setUsers(updated);
    try {
      localStorage.setItem('netpulse_user_accounts_v1', JSON.stringify(updated));
    } catch {
      // Storage unavailable
    }
  };

  const handleSaveUser = (user: UserAccount, temporaryPassword?: string) => {
    let updated: UserAccount[];
    const exists = users.some((u) => u.id === user.id);

    if (exists) {
      updated = users.map((u) => (u.id === user.id ? user : u));
      setActionNotice(`Credentials and settings for ${user.displayName} (${user.role}) updated successfully.`);
    } else {
      updated = [user, ...users];
      setActionNotice(`New user ${user.displayName} provisioned with role ${user.role}.`);
    }

    saveUsers(updated);

    // If a temporary password was provided, log a WhatsApp notification entry
    if (temporaryPassword) {
      const shareText = buildWhatsAppShareText(user, temporaryPassword);
      logWhatsAppNotice(
        user.phone,
        user.displayName,
        shareText,
        'isp_user_credentials_provisioned'
      );
    }

    setTimeout(() => setActionNotice(null), 5000);
  };

  const handleToggleStatus = (userId: string) => {
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    if (target.username === 'admin') {
      setActionNotice('Security Notice: Master Admin account cannot be disabled.');
      setTimeout(() => setActionNotice(null), 4000);
      return;
    }

    const nextStatus = !target.isActive;
    const updated = users.map((u) => (u.id === userId ? { ...u, isActive: nextStatus } : u));
    saveUsers(updated);
    setActionNotice(`User ${target.displayName} is now ${nextStatus ? 'ACTIVE' : 'DISABLED'}.`);
    setTimeout(() => setActionNotice(null), 4000);
  };

  const handleDirectWhatsAppShare = (user: UserAccount) => {
    const tempPass = generateRandomPassword();
    // Update user password hash
    const updated = users.map((u) =>
      u.id === user.id ? { ...u, mustChangePassword: true } : u
    );
    saveUsers(updated);

    const shareText = buildWhatsAppShareText(user, tempPass);
    const cleanPhone = user.phone.replace(/[^\d+]/g, '').replace('+', '');
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');

    logWhatsAppNotice(
      user.phone,
      user.displayName,
      shareText,
      'isp_user_credentials_one_click_share'
    );

    setActionNotice(`Reset temporary password (${tempPass}) and launched WhatsApp Share to ${user.phone}`);
    setTimeout(() => setActionNotice(null), 5000);
  };

  const handleCopyCredentials = (user: UserAccount) => {
    const tempPass = 'admin@123';
    const text = buildWhatsAppShareText(user, tempPass);
    navigator.clipboard.writeText(text);
    setCopiedId(user.id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  const filteredUsers = users.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.displayName.toLowerCase().includes(q) ||
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.phone.includes(q)
    );
  });

  const adminCount = users.filter((u) => u.role === 'ADMIN').length;
  const agentCount = users.filter((u) => u.role === 'AGENT').length;
  const clientCount = users.filter((u) => u.role === 'CLIENT').length;

  return (
    <div className="space-y-6 text-xs font-sans">
      {/* Top Banner & RBAC Overview */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-white">
                Authentication & Role-Based Access Control (RBAC)
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                JWT Auth & Bcrypt
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Manage Master Admin, Field Recovery Agent, and Subscriber Portal credentials with one-click WhatsApp dispatch.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectedUserForEdit(null);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition shadow-md shadow-cyan-950/40 cursor-pointer active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Provision User</span>
            </button>
          </div>
        </div>

        {/* Master Admin Seed Account Notice Bar */}
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
            <span className="font-bold text-slate-300">Master Admin Seed:</span>
            <span className="text-cyan-400 font-bold">admin@isp.local</span>
            <span className="text-slate-500">(Initial Pass: admin@123 / Bcrypt 12 rounds)</span>
          </div>

          {/* Role Session Simulator Switcher */}
          {onSwitchSimulatedRole && (
            <div className="flex items-center gap-2 self-end md:self-auto font-mono text-[11px]">
              <span className="text-slate-400">Simulate View:</span>
              <div className="flex bg-slate-900 p-0.5 rounded-lg border border-slate-700">
                {(['ADMIN', 'AGENT', 'CLIENT'] as SystemRole[]).map((r) => (
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

      {actionNotice && (
        <div className="p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl text-emerald-300 text-xs font-mono flex items-center gap-2 animate-fade-in shadow-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{actionNotice}</span>
        </div>
      )}

      {/* Role Counts Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">Total Platform Users</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-white">{users.length}</span>
            <Users className="w-4 h-4 text-cyan-400" />
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl">
          <span className="text-[11px] text-slate-400 block font-medium">NOC Master Admins</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-rose-400">{adminCount}</span>
            <Shield className="w-4 h-4 text-rose-400" />
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
          <span className="text-[11px] text-slate-400 block font-medium">Subscriber Portals</span>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xl font-bold font-mono text-emerald-400">{clientCount}</span>
            <Smartphone className="w-4 h-4 text-emerald-400" />
          </div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'ALL', label: `All Users (${users.length})` },
            { id: 'ADMIN', label: `Admins (${adminCount})` },
            { id: 'AGENT', label: `Field Agents (${agentCount})` },
            { id: 'CLIENT', label: `Subscribers (${clientCount})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setRoleFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                roleFilter === tab.id
                  ? 'bg-cyan-600 text-slate-950 font-bold'
                  : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search username, name, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>
      </div>

      {/* Users Table / Ledger */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">User / Display Name</th>
                <th className="py-3 px-4">System Role</th>
                <th className="py-3 px-4">Username &amp; Email</th>
                <th className="py-3 px-4">Linked Profile &amp; Sector</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions &amp; WhatsApp Share</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                    No user accounts match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-950/40 transition">
                    {/* User / Display Name */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
                          user.role === 'ADMIN'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : user.role === 'AGENT'
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}>
                          {user.displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-white block">{user.displayName}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{user.phone}</span>
                        </div>
                      </div>
                    </td>

                    {/* Role Pill */}
                    <td className="py-3 px-4">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider ${
                        user.role === 'ADMIN'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : user.role === 'AGENT'
                          ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                          : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      }`}>
                        {user.role}
                      </span>
                    </td>

                    {/* Username & Email */}
                    <td className="py-3 px-4 font-mono text-[11px]">
                      <span className="text-cyan-400 font-bold block">@{user.username}</span>
                      <span className="text-slate-400">{user.email}</span>
                    </td>

                    {/* Linked Profile */}
                    <td className="py-3 px-4 text-[11px]">
                      {user.role === 'AGENT' && (
                        <div>
                          <span className="text-slate-300 font-medium">Technician: {user.displayName}</span>
                          <span className="text-[10px] text-cyan-400 block font-mono">{user.assignedArea || 'Sector G-11'}</span>
                        </div>
                      )}
                      {user.role === 'CLIENT' && (
                        <div>
                          <span className="text-slate-300 font-medium">Subscriber Account</span>
                          <span className="text-[10px] text-slate-400 block font-mono">PPPoE: {user.username}</span>
                        </div>
                      )}
                      {user.role === 'ADMIN' && (
                        <span className="text-rose-300/80 font-mono text-[10px]">Super Administrator (NOC Root)</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4">
                      <button
                        onClick={() => handleToggleStatus(user.id)}
                        className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold flex items-center gap-1 cursor-pointer transition ${
                          user.isActive
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 hover:bg-emerald-900/50'
                            : 'bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900/50'
                        }`}
                        title="Click to toggle account access"
                      >
                        {user.isActive ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-rose-400" />}
                        <span>{user.isActive ? 'Active' : 'Disabled'}</span>
                      </button>
                    </td>

                    {/* Actions & WhatsApp Share */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleCopyCredentials(user)}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                          title="Copy Credentials to Clipboard"
                        >
                          {copiedId === user.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={() => handleDirectWhatsAppShare(user)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition flex items-center gap-1 cursor-pointer shadow-sm shadow-emerald-950/40 text-[11px]"
                          title="Generate Temporary Password & Share via WhatsApp"
                        >
                          <Send className="w-3 h-3 text-slate-950" />
                          <span>WhatsApp</span>
                        </button>

                        <button
                          onClick={() => {
                            setSelectedUserForEdit(user);
                            setIsModalOpen(true);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 transition cursor-pointer font-medium text-[11px]"
                          title="Reset Password / Edit Account"
                        >
                          <Key className="w-3 h-3 inline mr-1" />
                          <span>Reset</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Credential Provisioning Modal */}
      <UserCredentialModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedUserForEdit(null);
        }}
        userToEdit={selectedUserForEdit}
        onSaveUser={handleSaveUser}
      />
    </div>
  );
};
