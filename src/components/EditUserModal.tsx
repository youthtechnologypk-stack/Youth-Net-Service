import React, { useState, useEffect } from 'react';
import {
  X,
  Edit,
  Shield,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  Users,
  DollarSign,
  Link as LinkIcon,
} from 'lucide-react';
import { UserAccount, SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount | null;
  onSave: (updatedUser: UserAccount) => Promise<void>;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  isOpen,
  onClose,
  user,
  onSave,
}) => {
  const { customers, agents } = useISP();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<SystemRole>('CLIENT');
  const [isActive, setIsActive] = useState(true);
  const [assignedArea, setAssignedArea] = useState('');
  const [cashLimit, setCashLimit] = useState<number>(50000);
  const [department, setDepartment] = useState('');
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [linkedAgentId, setLinkedAgentId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || user.displayName || '');
      setPhone(user.phone || '');
      setRole(user.role);
      setIsActive(user.isActive);
      setAssignedArea(user.assignedArea || 'Sector G-11');
      setCashLimit(user.cashLimit || 50000);
      setDepartment(user.department || 'NOC & Network Operations');
      setLinkedCustomerId(user.linkedCustomerId || '');
      setLinkedAgentId(user.linkedAgentId || '');
      setError(null);
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Full Name is required.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const updated: UserAccount = {
      ...user,
      fullName: fullName.trim(),
      displayName: fullName.trim(),
      phone: phone.trim(),
      role,
      isActive,
      assignedArea: role === 'AGENT' ? assignedArea : undefined,
      cashLimit: role === 'AGENT' ? Number(cashLimit) : undefined,
      department: role === 'MANAGER' ? department : undefined,
      linkedCustomerId: role === 'CLIENT' ? (linkedCustomerId || undefined) : undefined,
      linkedAgentId: role === 'AGENT' ? (linkedAgentId || undefined) : undefined,
    };

    try {
      await onSave(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl shadow-cyan-950/30 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950/80 border-b border-slate-800 p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-slate-800 border border-slate-700 text-cyan-400 rounded-xl">
              <Edit className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Edit User Profile</h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Account ID: <strong className="text-cyan-400">@{user.username}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-xs flex-1">
          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Full Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-medium block mb-1">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-slate-300 font-medium block mb-1">WhatsApp Phone *</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Role & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-300 font-medium block mb-1">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as SystemRole)}
                disabled={user.username === 'admin'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="CLIENT">Client / Subscriber</option>
                <option value="AGENT">Field Agent</option>
                <option value="MANAGER">Operations Manager</option>
                {user.role === 'ADMIN' && <option value="ADMIN">Administrator</option>}
              </select>
            </div>
            <div>
              <label className="text-slate-300 font-medium block mb-1">Account Status</label>
              <select
                value={isActive ? 'true' : 'false'}
                onChange={(e) => setIsActive(e.target.value === 'true')}
                disabled={user.username === 'admin'}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="true">Active (Normal Access)</option>
                <option value="false">Suspended (Access Revoked)</option>
              </select>
            </div>
          </div>

          {/* Role specific options */}
          {role === 'AGENT' && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
              <div className="text-cyan-400 font-bold flex items-center gap-1.5">
                <Briefcase className="w-3.5 h-3.5" />
                <span>Field Agent Settings</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Assigned Area</label>
                  <input
                    type="text"
                    value={assignedArea}
                    onChange={(e) => setAssignedArea(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Cash Limit (PKR)</label>
                  <input
                    type="number"
                    value={cashLimit}
                    onChange={(e) => setCashLimit(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>
          )}

          {role === 'MANAGER' && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
              <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>Manager Department</span>
              </div>
              <div>
                <label className="text-slate-300 font-medium block mb-1">Department</label>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {role === 'CLIENT' && (
            <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-3">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Linked Subscriber Profile</span>
              </div>
              <select
                value={linkedCustomerId}
                onChange={(e) => setLinkedCustomerId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="">-- No Linked Customer Record --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} &bull; @{c.pppoeUsername} &bull; {c.areaNode}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold transition shadow-md shadow-cyan-950/40 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Saving Changes...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
