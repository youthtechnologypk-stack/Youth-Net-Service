import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import {
  X,
  UserPlus,
  User,
  Lock,
  Phone,
  MapPin,
  Wallet,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { UserAccount } from '../types/auth';
import { SupabasePortalUser } from '../services/supabaseClient';
import { getStoredUser } from '../lib/auth';
import {
  createScopedFieldAgent,
  getResellerTier,
} from '../lib/resellerEngine';

export interface AddScopedFieldAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserAccount | null;
  onSuccess?: (agent: SupabasePortalUser) => void;
}

export const AddScopedFieldAgentModal: React.FC<AddScopedFieldAgentModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onSuccess,
}) => {
  const activeUser = currentUser || getStoredUser();
  const viewerTier = getResellerTier(activeUser);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('+92 3');
  const [area, setArea] = useState(activeUser?.area || activeUser?.assignedArea || 'Field Sector');
  const [baseSalary, setBaseSalary] = useState('25000');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let pwd = '';
    for (let i = 0; i < 8; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  };

  useEffect(() => {
    if (!isOpen) return;
    setFullName('');
    setUsername('');
    setPassword(generatePassword());
    setPhone('+92 3');
    setArea(activeUser?.area || activeUser?.assignedArea || 'Field Sector');
    setBaseSalary('25000');
    setErrorMessage(null);
  }, [isOpen, activeUser?.area, activeUser?.assignedArea]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleFullNameChange = (val: string) => {
    setFullName(val);
    if (!username || username === fullName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')) {
      const suggested = val
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      setUsername(suggested);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim() || !username.trim() || !password.trim()) {
      setErrorMessage('Full name, username, and password are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createScopedFieldAgent({
        fullName,
        username,
        password,
        phone,
        area,
        baseSalary: Number(baseSalary) || 0,
        currentUser: activeUser,
      });

      if (res.error || !res.data) {
        setErrorMessage(res.error || 'Failed to create field agent.');
        return;
      }

      onSuccess?.(res.data);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unexpected error creating field agent.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const ownerBadgeLabel =
    viewerTier === 'SUB_DEALER'
      ? `Sub-Dealer Staff • @${activeUser?.username || 'sub_dealer'}`
      : viewerTier === 'DEALER'
      ? `Dealer Staff • @${activeUser?.username || 'dealer'}`
      : 'Master ISP Direct Field Staff';

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100dvh',
        zIndex: 999999,
      }}
      className="bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
    >
      <div className="w-full max-w-md bg-[#111A2E] border border-slate-700 rounded-2xl shadow-2xl overflow-hidden my-auto">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0">
              <UserPlus className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">
                {viewerTier ? 'Add My Field Agent' : 'Add Field Recovery Agent'}
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Isolated cash recovery &amp; field collection staff
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-cyan-300">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">{ownerBadgeLabel}</span>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Full Name *</label>
            <div className="relative">
              <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => handleFullNameChange(e.target.value)}
                placeholder="e.g. Ali Raza"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Login Username *</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ''))
                }
                placeholder="ali_recovery"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Portal Password *</label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Lock className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-8 pr-2 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword())}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                  title="Generate Password"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Phone / WhatsApp</label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+92 300 1234567"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Area / Sector</label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Sector G-10"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1">Base Monthly Salary (Rs.)</label>
            <div className="relative">
              <Wallet className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="number"
                min="0"
                step="500"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-emerald-300 font-mono tabular-nums focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition shadow-lg shadow-cyan-950/50 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Creating...' : 'Create Field Agent'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};

export default AddScopedFieldAgentModal;
