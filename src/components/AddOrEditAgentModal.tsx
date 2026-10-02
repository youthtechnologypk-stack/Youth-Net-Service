import React, { useState, useEffect } from 'react';
import {
  X,
  UserCheck,
  UserPlus,
  MapPin,
  Phone,
  Mail,
  DollarSign,
  Activity,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  Shield,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { FieldAgent } from '../types/isp';

interface AddOrEditAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentToEdit?: FieldAgent | null; // if provided, edit mode; if null, add mode
  onSuccess?: (agentName: string) => void;
}

const COMMON_AREAS = [
  'Sector G-11 & F-11',
  'Sector I-8 & H-8',
  'Sector F-10 Commercial Hub',
  'Sector E-11 & D-12 Node',
  'Blue Area Commercial Node',
  'Bahria Town Phase 4 & 7',
  'PWD & Media Town Sector',
  'Saddar Metro Optical Hub',
];

export const AddOrEditAgentModal: React.FC<AddOrEditAgentModalProps> = ({
  isOpen,
  onClose,
  agentToEdit,
  onSuccess,
}) => {
  const { addAgent, updateAgent, deleteAgent, agents } = useISP();

  const isEditMode = Boolean(agentToEdit);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+92 3');
  const [email, setEmail] = useState('');
  const [assignedArea, setAssignedArea] = useState('Sector G-11 & F-11');
  const [customArea, setCustomArea] = useState('');
  const [status, setStatus] = useState<'active' | 'on_field' | 'offline'>('active');
  const [baseSalary, setBaseSalary] = useState<number>(650);
  const [cashInHand, setCashInHand] = useState<number>(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMessage(null);
      setIsSubmitting(false);

      if (agentToEdit) {
        setName(agentToEdit.name);
        setPhone(agentToEdit.phone);
        setEmail(agentToEdit.email);
        if (COMMON_AREAS.includes(agentToEdit.assignedArea)) {
          setAssignedArea(agentToEdit.assignedArea);
          setCustomArea('');
        } else {
          setAssignedArea('Custom');
          setCustomArea(agentToEdit.assignedArea);
        }
        setStatus(agentToEdit.status);
        setBaseSalary(agentToEdit.baseSalary || 650);
        setCashInHand(agentToEdit.cashInHand || 0);
      } else {
        // Defaults for new agent
        const nextNum = agents.length + 1;
        setName(`Agent ${nextNum}`);
        setPhone(`+92 30${nextNum} 555${Math.floor(1000 + Math.random() * 9000)}`);
        setEmail(`agent${nextNum}@netpulse.io`);
        setAssignedArea(COMMON_AREAS[nextNum % COMMON_AREAS.length]);
        setCustomArea('');
        setStatus('active');
        setBaseSalary(650);
        setCashInHand(0);
      }
    }
  }, [isOpen, agentToEdit, agents.length]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const finalArea = assignedArea === 'Custom' ? customArea.trim() : assignedArea;

    if (!cleanName) {
      setError('Please provide the agent\'s full name.');
      return;
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      setError('Please provide a valid WhatsApp phone number for the agent.');
      return;
    }
    if (!finalArea) {
      setError('Please specify the assigned operational sector/area.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditMode && agentToEdit) {
        updateAgent(agentToEdit.id, {
          name: cleanName,
          phone: cleanPhone,
          email: email.trim() || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@netpulse.io`,
          assignedArea: finalArea,
          status,
          baseSalary: Number(baseSalary) || 600,
          cashInHand: Number(cashInHand) || 0,
        });
        setSuccessMessage(`Agent "${cleanName}" details updated successfully!`);
      } else {
        const created = addAgent({
          name: cleanName,
          phone: cleanPhone,
          email: email.trim() || `${cleanName.toLowerCase().replace(/[^a-z0-9]/g, '.')}@netpulse.io`,
          assignedArea: finalArea,
          status,
          baseSalary: Number(baseSalary) || 600,
          cashInHand: 0,
        });
        setSuccessMessage(`New Agent "${created.name}" enrolled & WhatsApp welcome dispatched!`);
      }

      if (onSuccess) {
        onSuccess(cleanName);
      }

      setTimeout(() => {
        onClose();
      }, 1100);
    } catch (err: any) {
      setError(err?.message || 'Failed to save agent profile.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = () => {
    if (!agentToEdit) return;

    if (
      window.confirm(
        `Are you sure you want to offboard agent "${agentToEdit.name}"?\nThis will remove them from active field assignments.`
      )
    ) {
      deleteAgent(agentToEdit.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-slate-950 p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl shadow-lg ${
              isEditMode
                ? 'bg-gradient-to-tr from-indigo-600 to-cyan-600 text-white shadow-indigo-500/20'
                : 'bg-gradient-to-tr from-emerald-600 to-teal-600 text-white shadow-emerald-500/20'
            }`}>
              {isEditMode ? <UserCheck className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>{isEditMode ? 'Manage Field Recovery Agent' : 'Enroll New Field Recovery Agent'}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono">
                  {isEditMode ? 'Profile & Contract' : 'Field Operations'}
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                {isEditMode
                  ? `Update personal details, assigned sector, status, and contract rate for ${agentToEdit?.name}`
                  : 'Assign subscriber recovery sector, mobile app terminal credentials, and base monthly salary.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
          {successMessage && (
            <div className="p-3 bg-emerald-950/80 border border-emerald-700/80 rounded-xl text-emerald-300 flex items-center gap-2.5 font-mono animate-fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identity & Contact Details */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <Shield className="w-3.5 h-3.5" />
                <span>1. Agent Identity & Contact</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Full Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Zubair Ahmed"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    WhatsApp Phone Number <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-500" />
                    <input
                      type="text"
                      required
                      placeholder="+92 300 1234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-100 pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Email Address (Optional / Mobile App Login)
                </label>
                <div className="relative">
                  <Mail className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="email"
                    placeholder="agent@netpulse.io"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 pl-8 pr-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Field Assignment & Status */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <MapPin className="w-3.5 h-3.5" />
                <span>2. Operational Assignment & Status</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Assigned Recovery Sector <span className="text-rose-400">*</span>
                  </label>
                  <select
                    value={assignedArea}
                    onChange={(e) => setAssignedArea(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  >
                    {COMMON_AREAS.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                    <option value="Custom">Custom Area...</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Operational Field Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-mono"
                  >
                    <option value="active">🟢 Active / Available</option>
                    <option value="on_field">🛵 On Field Duty</option>
                    <option value="offline">⚪ Offline / Standby</option>
                  </select>
                </div>
              </div>

              {assignedArea === 'Custom' && (
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Custom Operational Sector Name
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rawalpindi West Sector Node 4"
                    value={customArea}
                    onChange={(e) => setCustomArea(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2.5 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
                  />
                </div>
              )}
            </div>

            {/* Compensation & Financial Settings */}
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <Briefcase className="w-3.5 h-3.5" />
                <span>3. Salary Contract & Financial Limits</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block text-slate-300 font-sans font-medium mb-1">
                    Base Monthly Salary ($/mo) <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      required
                      value={baseSalary}
                      onChange={(e) => setBaseSalary(parseFloat(e.target.value) || 0)}
                      className="w-full bg-slate-950 border border-slate-700 text-emerald-400 pl-7 pr-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-bold"
                    />
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5 block font-sans">
                    Monthly contracted remuneration before advance deductions.
                  </span>
                </div>

                {isEditMode && (
                  <div>
                    <label className="block text-slate-300 font-sans font-medium mb-1">
                      Active Cash-in-Hand ($)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-500">$</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={cashInHand}
                        onChange={(e) => setCashInHand(parseFloat(e.target.value) || 0)}
                        className="w-full bg-slate-950 border border-slate-700 text-cyan-300 pl-7 pr-3 py-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs font-bold"
                      />
                    </div>
                    <span className="text-[10px] text-slate-500 mt-0.5 block font-sans">
                      Current un-deposited physical recovery cash.
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              {isEditMode ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
                  title="Remove Agent from Roster"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Offboard Agent</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2.5 rounded-lg text-slate-950 font-bold transition shadow-lg flex items-center gap-1.5 text-xs cursor-pointer active:scale-95 ${
                    isEditMode
                      ? 'bg-indigo-500 hover:bg-indigo-400 shadow-indigo-950/50'
                      : 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-950/50'
                  }`}
                >
                  {isEditMode ? (
                    <>
                      <UserCheck className="w-4 h-4 text-slate-950" />
                      <span>Save Changes</span>
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 text-slate-950" />
                      <span>Enroll & Dispatch WhatsApp</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
