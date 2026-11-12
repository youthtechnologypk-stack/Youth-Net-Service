import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  Shield,
  Phone,
  MapPin,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Building,
  AtSign,
} from 'lucide-react';
import { supabase } from '../services/supabaseClient';

export interface StaffUserRecord {
  id: string;
  username: string;
  full_name?: string;
  fullName?: string;
  displayName?: string;
  phone?: string;
  area?: string;
  assignedArea?: string;
  base_salary?: number;
  role?: string;
  account_status?: string;
  isActive?: boolean;
  password?: string;
  cash_in_hand?: number;
  advance_balance?: number;
}

export interface EditStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffUserRecord | null;
  onSuccess: (updatedStaff: Partial<StaffUserRecord>) => void;
}

const COMMON_AREAS = [
  'Saddar Node',
  'Sector G-11',
  'Sector F-10',
  'Sector F-11',
  'Sector I-8',
  'Sector I-9',
  'Sector I-10',
  'DHA Phase 2',
  'Bahria Town Node',
  'Commercial Area Node',
];

export const EditStaffModal: React.FC<EditStaffModalProps> = ({
  isOpen,
  onClose,
  staff,
  onSuccess,
}) => {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [area, setArea] = useState('Saddar Node');
  const [baseSalary, setBaseSalary] = useState<string>('35000');
  const [role, setRole] = useState<'AGENT' | 'MANAGER'>('AGENT');
  const [accountStatus, setAccountStatus] = useState<'ACTIVE' | 'SUSPENDED'>('ACTIVE');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state whenever staff record changes
  useEffect(() => {
    if (staff) {
      const name = staff.full_name || staff.fullName || staff.displayName || '';
      setFullName(name);
      setPhone(staff.phone || '');
      setArea(staff.area || staff.assignedArea || 'Saddar Node');
      setBaseSalary(staff.base_salary != null ? String(staff.base_salary) : '35000');
      
      const roleUpper = (staff.role || 'AGENT').toUpperCase();
      setRole(roleUpper === 'MANAGER' ? 'MANAGER' : 'AGENT');

      const isSuspended =
        staff.account_status?.toUpperCase() === 'SUSPENDED' ||
        staff.isActive === false;
      setAccountStatus(isSuspended ? 'SUSPENDED' : 'ACTIVE');

      setNewPassword('');
      setShowPassword(false);
      setError(null);
    }
  }, [staff, isOpen]);

  if (!isOpen || !staff) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Full Name is required.');
      return;
    }

    const salaryNum = Number(baseSalary);
    if (isNaN(salaryNum) || salaryNum < 0) {
      setError('Please provide a valid non-negative base salary in PKR.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const updatePayload: Record<string, any> = {
      full_name: fullName.trim(),
      phone: phone.trim(),
      area: area.trim() || 'Saddar Node',
      base_salary: salaryNum,
      role: role,
      account_status: accountStatus,
      is_active: accountStatus === 'ACTIVE',
    };

    if (newPassword && newPassword.trim() !== '') {
      updatePayload.password = newPassword.trim();
    }

    try {
      // 1. Direct Supabase Commit to portal_users table
      const { error: sbError } = await supabase
        .from('portal_users')
        .update(updatePayload)
        .eq('id', staff.id);

      if (sbError) {
        throw new Error(sbError.message || 'Supabase database update failed.');
      }

      // 2. Sync to Node.js backend proxy if available
      try {
        await fetch(`/api/auth/users/${staff.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: fullName.trim(),
            phone: phone.trim(),
            role: role,
            area: area.trim(),
            isActive: accountStatus === 'ACTIVE',
          }),
        });

        if (newPassword && newPassword.trim() !== '') {
          await fetch(`/api/auth/users/${staff.id}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword: newPassword.trim() }),
          });
        }
      } catch (proxyErr) {
        // Non-blocking: Supabase is primary source of truth
        console.warn('Backend proxy sync notice:', proxyErr);
      }

      // 3. Invalidate any local storage cache keys
      try {
        localStorage.removeItem('youthnet_portal_users');
        localStorage.removeItem('youthnet_db_portal_users');
        localStorage.removeItem('portal_users');
      } catch {}

      onSuccess(updatePayload);
      onClose();
    } catch (err: any) {
      console.error('Failed to update staff profile in Supabase:', err);
      setError(err.message || 'Failed to update staff profile in PostgreSQL database.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn font-sans">
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl shadow-cyan-950/40 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-950/90 border-b border-slate-800 p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-950 border border-cyan-800 text-cyan-300 rounded-xl">
              {role === 'MANAGER' ? (
                <Shield className="w-5 h-5 text-indigo-400" />
              ) : (
                <UserCheck className="w-5 h-5 text-cyan-400" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">Edit Staff Profile</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-slate-300 font-bold uppercase">
                  {role}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Staff Account: <strong className="text-cyan-400">@{staff.username}</strong> &bull; Supabase Sync
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
            title="Close"
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

          {/* Read-Only Username / ID Banner */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AtSign className="w-4 h-4 text-slate-500" />
              <span className="text-slate-400">Username / Account ID:</span>
              <span className="font-mono font-bold text-cyan-400">@{staff.username}</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              Primary Key
            </span>
          </div>

          {/* Full Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">
                Full Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Asad Ullah Khan"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3 text-emerald-400" />
                <span>Phone / WhatsApp <span className="text-rose-400">*</span></span>
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+92 300 1234567"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Area & Base Salary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-slate-300 font-semibold block mb-1 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-cyan-400" />
                <span>Assigned Area / Node</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="area-options"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Saddar Node"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                />
                <datalist id="area-options">
                  {COMMON_AREAS.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1 flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-amber-400" />
                <span>Base Salary (PKR) <span className="text-rose-400">*</span></span>
              </label>
              <input
                type="number"
                min="0"
                step="500"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="35000"
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Role & Account Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-slate-300 font-semibold block mb-1 flex items-center gap-1">
                <Shield className="w-3 h-3 text-indigo-400" />
                <span>Staff Role</span>
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'AGENT' | 'MANAGER')}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="AGENT">Field Recovery Agent (AGENT)</option>
                <option value="MANAGER">Operations Manager (MANAGER)</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Account Status</label>
              <select
                value={accountStatus}
                onChange={(e) => setAccountStatus(e.target.value as 'ACTIVE' | 'SUSPENDED')}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="ACTIVE">ACTIVE (Authorized Staff)</option>
                <option value="SUSPENDED">SUSPENDED (Access Revoked)</option>
              </select>
            </div>
          </div>

          {/* New Password (Optional) */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                <span>New Password</span>
                <span className="text-[10px] text-slate-500 font-normal">(Optional)</span>
              </label>
              <span className="text-[10px] text-slate-500 font-mono">Leave blank to retain current password</span>
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password to reset..."
                autoComplete="new-password"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-3.5 pr-10 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Current Financial Balances (Contextual info if agent) */}
          {staff.cash_in_hand !== undefined && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 font-mono text-[11px]">
              <div>
                <span className="text-slate-500 block">Current Cash in Hand:</span>
                <span className="text-emerald-400 font-bold">
                  Rs. {Number(staff.cash_in_hand || 0).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Advance Balance:</span>
                <span className="text-amber-400 font-bold">
                  Rs. {Number(staff.advance_balance || 0).toLocaleString()}
                </span>
              </div>
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
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold transition shadow-lg shadow-cyan-950/40 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                  <span>Committing to Supabase...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Save Staff Profile</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditStaffModal;
