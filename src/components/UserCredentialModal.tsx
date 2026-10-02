import React, { useState } from 'react';
import {
  X,
  Shield,
  Key,
  Smartphone,
  Copy,
  Check,
  Send,
  RefreshCw,
  UserCheck,
  User,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';
import { UserAccount, SystemRole, CredentialShareDetails } from '../types/auth';
import { useISP } from '../context/ISPContext';
import { generateRandomPassword, buildWhatsAppShareText } from '../services/authUtils';

interface UserCredentialModalProps {
  isOpen: boolean;
  onClose: () => void;
  userToEdit?: UserAccount | null;
  onSaveUser: (user: UserAccount, temporaryPassword?: string) => void;
}

export const UserCredentialModal: React.FC<UserCredentialModalProps> = ({
  isOpen,
  onClose,
  userToEdit,
  onSaveUser,
}) => {
  const { agents, customers } = useISP();

  const isEditMode = Boolean(userToEdit);

  const [username, setUsername] = useState(userToEdit?.username || '');
  const [displayName, setDisplayName] = useState(userToEdit?.displayName || '');
  const [email, setEmail] = useState(userToEdit?.email || '');
  const [phone, setPhone] = useState(userToEdit?.phone || '+92 ');
  const [role, setRole] = useState<SystemRole>(userToEdit?.role || 'AGENT');
  const [password, setPassword] = useState(isEditMode ? '' : generateRandomPassword());
  const [isActive, setIsActive] = useState(userToEdit ? userToEdit.isActive : true);
  const [mustChangePassword, setMustChangePassword] = useState(userToEdit ? userToEdit.mustChangePassword : true);
  const [linkedAgentId, setLinkedAgentId] = useState(userToEdit?.linkedAgentId || agents[0]?.id || '');
  const [linkedCustomerId, setLinkedCustomerId] = useState(userToEdit?.linkedCustomerId || customers[0]?.id || '');

  const [copied, setCopied] = useState(false);
  const [showSharePreview, setShowSharePreview] = useState(false);

  if (!isOpen) return null;

  const handleGeneratePassword = () => {
    setPassword(generateRandomPassword());
  };

  const getTargetPhone = () => {
    if (role === 'AGENT') {
      const a = agents.find((ag) => ag.id === linkedAgentId);
      return a ? a.phone : phone;
    }
    if (role === 'CLIENT') {
      const c = customers.find((cu) => cu.id === linkedCustomerId);
      return c ? c.phone : phone;
    }
    return phone;
  };

  const currentPhone = getTargetPhone();

  const previewUser: UserAccount = {
    id: userToEdit?.id || `usr-${Date.now()}`,
    username: username || 'user.login',
    email: email || `${username || 'user'}@youthnet.pk`,
    role,
    passwordHash: '',
    displayName: displayName || (role === 'AGENT' ? agents.find((a) => a.id === linkedAgentId)?.name || 'Field Agent' : 'User Account'),
    phone: currentPhone,
    isActive,
    mustChangePassword,
    linkedAgentId: role === 'AGENT' ? linkedAgentId : undefined,
    linkedCustomerId: role === 'CLIENT' ? linkedCustomerId : undefined,
    createdAt: userToEdit?.createdAt || new Date().toISOString(),
  };

  const portalUrl =
    role === 'CLIENT'
      ? 'https://youthnet.pk/portal'
      : role === 'AGENT'
      ? 'https://youthnet.pk/field-agent'
      : 'https://youthnet.pk/noc-admin';

  const shareText = buildWhatsAppShareText(previewUser, password || '••••••••', portalUrl);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleWhatsAppSend = () => {
    const cleanPhone = currentPhone.replace(/[^\d+]/g, '');
    const url = `https://wa.me/${cleanPhone.replace('+', '')}?text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;

    onSaveUser(previewUser, password);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in text-xs font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${
              role === 'ADMIN'
                ? 'bg-rose-950 border-rose-800 text-rose-400'
                : role === 'AGENT'
                ? 'bg-cyan-950 border-cyan-800 text-cyan-400'
                : 'bg-emerald-950 border-emerald-800 text-emerald-400'
            }`}>
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {isEditMode && userToEdit ? `Edit Credentials: ${userToEdit.displayName}` : 'Provision New System User Account'}
              </h3>
              <p className="text-xs text-slate-400">
                Configure role, credentials, and dispatch WhatsApp access payload
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          {/* Role Selector */}
          <div>
            <label className="block text-slate-400 mb-1.5 font-medium">System Access Role</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'ADMIN', title: 'NOC Admin', desc: 'Full Platform Access' },
                { id: 'AGENT', title: 'Field Agent', desc: 'Collections & SLA' },
                { id: 'CLIENT', title: 'Subscriber', desc: 'Billing & Portal' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    const newRole = item.id as SystemRole;
                    setRole(newRole);
                    if (newRole === 'AGENT' && agents[0]) {
                      setDisplayName(agents[0].name);
                      setUsername(agents[0].name.toLowerCase().replace(' ', '.'));
                      setPhone(agents[0].phone);
                    } else if (newRole === 'CLIENT' && customers[0]) {
                      setDisplayName(customers[0].name);
                      setUsername(customers[0].pppoeUsername);
                      setPhone(customers[0].phone);
                    }
                  }}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                    role === item.id
                      ? 'bg-cyan-950/80 border-cyan-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <span className="block text-xs text-cyan-300 font-mono">{item.title}</span>
                  <span className="text-[10px] text-slate-400 block font-normal">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Linked Profile based on Role */}
          {role === 'AGENT' && (
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Link with Field Technician Profile</label>
              <select
                value={linkedAgentId}
                onChange={(e) => {
                  setLinkedAgentId(e.target.value);
                  const a = agents.find((ag) => ag.id === e.target.value);
                  if (a) {
                    setDisplayName(a.name);
                    setUsername(a.name.toLowerCase().replace(' ', '.'));
                    setPhone(a.phone);
                    setEmail(`${a.name.toLowerCase().replace(' ', '.')}@youthnet.pk`);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.assignedArea}) - {a.phone}
                  </option>
                ))}
              </select>
            </div>
          )}

          {role === 'CLIENT' && (
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Link with Subscriber Account</label>
              <select
                value={linkedCustomerId}
                onChange={(e) => {
                  setLinkedCustomerId(e.target.value);
                  const c = customers.find((cu) => cu.id === e.target.value);
                  if (c) {
                    setDisplayName(c.name);
                    setUsername(c.pppoeUsername);
                    setPhone(c.phone);
                    setEmail(c.email);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 text-xs p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-sans"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.accountNumber} - PPPoE: {c.pppoeUsername})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Credentials Input Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1 font-medium">Login Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. bilal.khan"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Display Name</label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Full Name"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@youthnet.pk"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-medium">WhatsApp Phone (+92...)</label>
              <input
                type="text"
                required
                value={currentPhone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 300 0000000"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
              />
            </div>
          </div>

          {/* Password & Security Section */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-cyan-400" />
                <span>Password Provisioning (Bcrypt Hash)</span>
              </span>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>🎲 Generate Password</span>
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEditMode ? 'Leave blank to keep existing password' : 'Enter temporary password'}
                className="w-full bg-slate-900 border border-slate-700 text-emerald-400 font-mono font-bold text-xs p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 tracking-wider"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-slate-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mustChangePassword}
                  onChange={(e) => setMustChangePassword(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Require password change on first login</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span className={isActive ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                  {isActive ? 'Active Account' : 'Account Disabled'}
                </span>
              </label>
            </div>
          </div>

          {/* One-Click WhatsApp Share Accordion */}
          <div className="bg-slate-950 border border-emerald-900/60 rounded-xl p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-xs">One-Click WhatsApp Dispatch Payload</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSharePreview(!showSharePreview)}
                className="text-[11px] text-emerald-400 hover:underline cursor-pointer"
              >
                {showSharePreview ? 'Hide Message Preview' : 'Preview Message'}
              </button>
            </div>

            {showSharePreview && (
              <pre className="p-3 bg-slate-900 rounded-lg text-[10px] font-mono text-slate-300 whitespace-pre-wrap border border-slate-800 leading-relaxed max-h-40 overflow-y-auto">
                {shareText}
              </pre>
            )}

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 text-[11px]">
              <span className="text-slate-400 font-mono">
                Recipient: <strong className="text-white">{currentPhone}</strong>
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition flex items-center gap-1 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Text'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleWhatsAppSend}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/40"
                >
                  <Send className="w-3.5 h-3.5 text-slate-950" />
                  <span>Send via WhatsApp</span>
                </button>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition shadow-md shadow-cyan-950/40 cursor-pointer active:scale-95"
            >
              {isEditMode ? 'Save & Update Credentials' : 'Create User & Issue Credentials'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
