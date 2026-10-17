import React, { useState } from 'react';
import {
  X,
  Key,
  Eye,
  EyeOff,
  RefreshCw,
  Send,
  Lock,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
} from 'lucide-react';
import { UserAccount } from '../types/auth';
import { generateRandomPassword } from '../services/authUtils';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount | null;
  onConfirmReset: (userId: string, newPassword: string, sendWhatsApp: boolean) => Promise<void>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({
  isOpen,
  onClose,
  user,
  onConfirmReset,
}) => {
  const [newPassword, setNewPassword] = useState(() => generateRandomPassword());
  const [showPassword, setShowPassword] = useState(false);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !user) return null;

  const targetName = user.displayName || user.fullName;

  const handleGenerate = () => {
    setNewPassword(generateRandomPassword());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim()) {
      setError('Password cannot be empty.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await onConfirmReset(user.id, newPassword.trim(), sendWhatsApp);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl shadow-cyan-950/30">
        {/* Header */}
        <div className="bg-slate-950/80 border-b border-slate-800 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-950/60 border border-cyan-800/60 text-cyan-400 rounded-xl">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Reset User Password</h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Target: <strong className="text-white">@{user.username}</strong>
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
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* User info strip */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
            <div>
              <span className="font-bold text-white block text-sm">{targetName}</span>
              <span className="text-slate-400 font-mono text-[11px]">Phone: {user.phone}</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-slate-800 text-slate-300 border border-slate-700">
              {user.role}
            </span>
          </div>

          {/* Password Input with Generate and Show/Hide */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-slate-300 font-medium">New Password *</label>
              <button
                type="button"
                onClick={handleGenerate}
                className="text-cyan-400 hover:text-cyan-300 text-[11px] font-mono flex items-center gap-1 cursor-pointer transition"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Auto-Generate Strong Password</span>
              </button>
            </div>

            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-3.5 pr-10 py-2.5 text-slate-100 font-mono text-sm focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* WhatsApp Dispatch Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800/80 cursor-pointer hover:border-slate-700 transition">
            <input
              type="checkbox"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer bg-slate-900"
            />
            <div className="space-y-0.5">
              <span className="font-bold text-white text-xs block">
                Send Login Credentials to User via WhatsApp
              </span>
              <span className="text-[11px] text-slate-400 block">
                Immediately launches 1-click WhatsApp notification with the new password.
              </span>
            </div>
          </label>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3">
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
              {isSubmitting ? 'Saving...' : 'Confirm Reset Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
