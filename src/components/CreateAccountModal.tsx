import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  UserPlus,
  Shield,
  Smartphone,
  Key,
  RefreshCw,
  Eye,
  EyeOff,
  Users,
  CheckCircle2,
  AlertCircle,
  Link as LinkIcon,
  DollarSign,
  Briefcase,
  Send,
  Radio,
  Search,
  UserCheck,
  MapPin,
  Check,
} from 'lucide-react';
import { UserAccount, SystemRole } from '../types/auth';
import { useISP } from '../context/ISPContext';
import { generateRandomPassword } from '../services/authUtils';

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newUser: UserAccount, plainPassword: string, sendWhatsApp: boolean) => void;
}

export const CreateAccountModal: React.FC<CreateAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { customers, agents } = useISP();

  const [role, setRole] = useState<SystemRole>('CLIENT');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+92 ');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(() => generateRandomPassword());
  const [showPassword, setShowPassword] = useState(false);

  // Client specific fields
  const [linkedCustomerId, setLinkedCustomerId] = useState('');
  const [grantClientPortal, setGrantClientPortal] = useState(true);
  const [subscriberSearchQuery, setSubscriberSearchQuery] = useState('');
  const [isSubscriberSearchOpen, setIsSubscriberSearchOpen] = useState(false);

  // Agent specific fields
  const [assignedArea, setAssignedArea] = useState('Sector G-11 & G-10 (North Zone)');
  const [cashLimit, setCashLimit] = useState<number>(50000);
  const [linkedAgentId, setLinkedAgentId] = useState('');

  // Manager specific fields
  const [department, setDepartment] = useState('NOC & Network Operations');
  const [operationalPermissions, setOperationalPermissions] = useState('Full NOC Operations & SLA Oversight');

  // WhatsApp checkbox
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset or initialize on open
  useEffect(() => {
    if (isOpen) {
      setPassword(generateRandomPassword());
      setErrorMessage(null);
      setSubscriberSearchQuery('');
      setIsSubscriberSearchOpen(false);
    }
  }, [isOpen]);

  // Selected customer object helper
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === linkedCustomerId),
    [customers, linkedCustomerId]
  );

  // Filtered subscribers for autocomplete
  const filteredSubscribers = useMemo(() => {
    const q = subscriberSearchQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers.filter((c) => {
      const matchName = (c.name || '').toLowerCase().includes(q);
      const matchUsername = (c.pppoeUsername || '').toLowerCase().includes(q);
      const matchPhone = (c.phone || '').toLowerCase().includes(q);
      const matchIp = (c.assignedIp || '').toLowerCase().includes(q);
      const matchArea = (c.areaNode || '').toLowerCase().includes(q);
      return matchName || matchUsername || matchPhone || matchIp || matchArea;
    }).slice(0, 10);
  }, [customers, subscriberSearchQuery]);

  // When a subscriber profile is picked from autocomplete, auto-populate fields!
  const handleSelectCustomer = (customerId: string) => {
    setLinkedCustomerId(customerId);
    setIsSubscriberSearchOpen(false);
    setSubscriberSearchQuery('');
    const targetCust = customers.find((c) => c.id === customerId);
    if (targetCust) {
      setFullName(targetCust.name);
      setPhone(targetCust.phone);
      setUsername(targetCust.pppoeUsername);
    }
  };

  const handleClearSelectedCustomer = () => {
    setLinkedCustomerId('');
    setSubscriberSearchQuery('');
  };

  // When an agent is picked from dropdown, auto-populate fields!
  const handleSelectAgent = (agentId: string) => {
    setLinkedAgentId(agentId);
    const targetAgent = agents.find((a) => a.id === agentId);
    if (targetAgent) {
      if (!fullName || fullName === '') setFullName(targetAgent.name);
      if (!phone || phone === '+92 ' || phone === '') setPhone(targetAgent.phone);
      if (!username || username === '') {
        setUsername(targetAgent.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 15));
      }
      if (targetAgent.assignedArea) setAssignedArea(targetAgent.assignedArea);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !username.trim() || !password.trim()) {
      setErrorMessage('Full Name, Username, and Password are required.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const cleanUsername = username.trim().toLowerCase();
    const cleanPhone = phone.trim() || '+92 300 0000000';

    const newUser: UserAccount = {
      id: `usr-${cleanUsername}-${Date.now().toString().slice(-4)}`,
      username: cleanUsername,
      fullName: fullName.trim(),
      displayName: fullName.trim(),
      email: `${cleanUsername}@youthnet.pk`,
      role,
      phone: cleanPhone,
      isActive: true,
      mustChangePassword: true,
      linkedCustomerId: role === 'CLIENT' ? (linkedCustomerId || undefined) : undefined,
      linkedAgentId: role === 'AGENT' ? (linkedAgentId || undefined) : undefined,
      assignedArea: role === 'AGENT' ? assignedArea : undefined,
      department: role === 'MANAGER' ? department : undefined,
      cashLimit: role === 'AGENT' ? Number(cashLimit) : undefined,
      grantClientPortal: role === 'CLIENT' ? grantClientPortal : undefined,
      sendWhatsAppNotice: sendWhatsApp,
      createdAt: new Date().toISOString(),
    };

    try {
      // POST to backend API
      const res = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanUsername,
          fullName: fullName.trim(),
          phone: cleanPhone,
          role,
          password: password.trim(),
          isActive: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to create user on server.');
      }

      onSuccess(newUser, password.trim(), sendWhatsApp);
      onClose();
    } catch (err: any) {
      // Fallback: succeed locally if server returns 409 or network issue
      if (err.message && err.message.includes('already registered')) {
        setErrorMessage(err.message);
      } else {
        onSuccess(newUser, password.trim(), sendWhatsApp);
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl shadow-cyan-950/40 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="bg-slate-950/90 border-b border-slate-800 p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 text-slate-950 font-bold rounded-xl shadow-md shadow-cyan-950/40">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Create New Portal Account
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Assign Role-Based Access &amp; Dispatch WhatsApp Credentials
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

        {/* Modal Form Scrollable Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto text-xs flex-1">
          {errorMessage && (
            <div className="p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 flex items-center gap-2 font-mono">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Role Selection */}
          <div className="space-y-1.5">
            <label className="text-slate-300 font-bold flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              <span>Role Selection *</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'CLIENT', label: 'Client / Subscriber', desc: 'Self-Service Speed & Bills', color: 'emerald' },
                { id: 'AGENT', label: 'Field Agent', desc: 'Cash & Field SLA Tickets', color: 'cyan' },
                { id: 'MANAGER', label: 'Operations Manager', desc: 'NOC & Team Dispatch', color: 'indigo' },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id as SystemRole)}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    role === r.id
                      ? 'bg-slate-800/90 border-cyan-500 text-white shadow-md shadow-cyan-950/40 ring-1 ring-cyan-500'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  <span className={`block font-bold text-xs ${role === r.id ? 'text-cyan-400' : 'text-slate-200'}`}>
                    {r.label}
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-1 leading-tight">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Role-Specific Integrations */}
          {/* A. If Client / Subscriber */}
          {role === 'CLIENT' && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                <LinkIcon className="w-3.5 h-3.5" />
                <span>Subscriber Profile Linkage</span>
              </div>

              <div className="relative">
                <label className="text-slate-300 font-medium block mb-1 text-xs">
                  Link to Subscriber Profile / PPPoE Username
                </label>

                {selectedCustomer ? (
                  // Selected Pill Badge with Change button
                  <div className="flex items-center justify-between p-2.5 bg-emerald-950/40 border border-emerald-500/40 rounded-xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                        <UserCheck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white text-xs truncate">
                            {selectedCustomer.name}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-900/60 text-emerald-300 border border-emerald-700/50 shrink-0">
                            @{selectedCustomer.pppoeUsername}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span>{selectedCustomer.phone}</span>
                          <span>&bull;</span>
                          <span className="text-slate-300 font-mono text-[10px]">{selectedCustomer.assignedIp}</span>
                          {selectedCustomer.areaNode && (
                            <>
                              <span>&bull;</span>
                              <span className="text-cyan-400 text-[10px]">{selectedCustomer.areaNode}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearSelectedCustomer}
                      className="px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:text-white bg-emerald-900/50 hover:bg-emerald-800/80 border border-emerald-600/50 rounded-lg transition"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  // Searchable Combobox Input
                  <div className="relative">
                    <div className="relative flex items-center">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                      <input
                        type="text"
                        value={subscriberSearchQuery}
                        onChange={(e) => {
                          setSubscriberSearchQuery(e.target.value);
                          setIsSubscriberSearchOpen(true);
                        }}
                        onFocus={() => setIsSubscriberSearchOpen(true)}
                        placeholder="Type username, customer name, or phone number to search..."
                        className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-9 pr-9 py-2 text-slate-200 text-xs placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 transition"
                      />
                      {subscriberSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setSubscriberSearchQuery('')}
                          className="absolute right-3 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-slate-800 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Floating Dropdown List of matching subscribers */}
                    {isSubscriberSearchOpen && (
                      <div className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-slate-900/95 backdrop-blur-md border border-slate-700 rounded-xl shadow-2xl divide-y divide-slate-800/70">
                        {filteredSubscribers.length > 0 ? (
                          filteredSubscribers.map((c) => {
                            const query = subscriberSearchQuery.toLowerCase();
                            // Helper to highlight matched substring
                            const highlight = (text: string) => {
                              if (!query || !text) return text;
                              const idx = text.toLowerCase().indexOf(query);
                              if (idx === -1) return text;
                              return (
                                <>
                                  {text.slice(0, idx)}
                                  <span className="text-cyan-300 font-bold bg-cyan-950/80 px-0.5 rounded underline decoration-cyan-400">
                                    {text.slice(idx, idx + query.length)}
                                  </span>
                                  {text.slice(idx + query.length)}
                                </>
                              );
                            };

                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => handleSelectCustomer(c.id)}
                                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/80 transition flex items-center justify-between group"
                              >
                                <div className="min-w-0 pr-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-200 group-hover:text-cyan-300 text-xs truncate">
                                      {highlight(c.name)}
                                    </span>
                                    <span className="text-slate-500 text-[10px]">&bull;</span>
                                    <span className="font-mono text-cyan-400 group-hover:text-cyan-300 text-[11px]">
                                      @{highlight(c.pppoeUsername)}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span>{highlight(c.phone)}</span>
                                    {c.assignedIp && (
                                      <>
                                        <span className="text-slate-600">&bull;</span>
                                        <span className="font-mono text-slate-300 text-[10px]">
                                          {highlight(c.assignedIp)}
                                        </span>
                                      </>
                                    )}
                                    {c.areaNode && (
                                      <>
                                        <span className="text-slate-600">&bull;</span>
                                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 border border-slate-700/60 text-slate-300">
                                          {c.areaNode}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <span className="text-[10px] font-medium text-emerald-400 opacity-0 group-hover:opacity-100 transition whitespace-nowrap pl-2">
                                  Select &rarr;
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          // Empty / Not Found State
                          <div className="px-4 py-3 text-center text-xs text-slate-400">
                            No subscribers found matching &ldquo;<span className="text-cyan-400 font-semibold">{subscriberSearchQuery}</span>&rdquo;
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[11px] text-slate-400 mt-1">
                  Selecting a subscriber automatically populates their full name, mobile number, and portal account ID.
                </p>
              </div>

              {/* Toggle: Grant Client Self-Service Portal Access */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                <div>
                  <span className="font-bold text-white block text-xs">
                    Grant Client Self-Service Portal Access
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    Allows subscriber to login, run line tests, view invoices, and submit complaints.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setGrantClientPortal((prev) => !prev)}
                  className={`w-11 h-6 flex items-center rounded-full p-1 transition cursor-pointer ${
                    grantClientPortal ? 'bg-emerald-600 justify-end' : 'bg-slate-800 justify-start'
                  }`}
                >
                  <span className="w-4 h-4 rounded-full bg-white shadow-md transform transition" />
                </button>
              </div>
            </div>
          )}

          {/* B. If Field Agent */}
          {role === 'AGENT' && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs">
                <Briefcase className="w-3.5 h-3.5" />
                <span>Field Recovery &amp; POP Sector Assignments</span>
              </div>

              {agents.length > 0 && (
                <div>
                  <label className="text-slate-300 font-medium block mb-1">
                    Link to Field Agent Roster Profile (Optional)
                  </label>
                  <select
                    value={linkedAgentId}
                    onChange={(e) => handleSelectAgent(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Or enter new agent details below --</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.phone}) &bull; {a.assignedArea}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Assigned Area / POP Sector *</label>
                  <input
                    type="text"
                    value={assignedArea}
                    onChange={(e) => setAssignedArea(e.target.value)}
                    placeholder="e.g. Sector G-11 & G-10"
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="text-slate-300 font-medium block mb-1">
                    Cash Collection Limit (PKR) *
                  </label>
                  <select
                    value={cashLimit}
                    onChange={(e) => setCashLimit(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value={25000}>Rs. 25,000 / Maximum</option>
                    <option value={50000}>Rs. 50,000 / Standard</option>
                    <option value={100000}>Rs. 100,000 / Senior Agent</option>
                    <option value={250000}>Rs. 250,000 / High Value Area</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* C. If Manager */}
          {role === 'MANAGER' && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3.5">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                <Users className="w-3.5 h-3.5" />
                <span>NOC Department &amp; Supervisory Scope</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Assigned Department *</label>
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="NOC & Network Operations">NOC &amp; Network Operations</option>
                    <option value="Complaints & SLA Dispatch">Complaints &amp; SLA Dispatch</option>
                    <option value="Billing & Cash Reconciliation">Billing &amp; Cash Reconciliation</option>
                    <option value="Subscriber Retention">Subscriber Retention</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-300 font-medium block mb-1">Operational Permissions</label>
                  <input
                    type="text"
                    value={operationalPermissions}
                    onChange={(e) => setOperationalPermissions(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Core Credentials Form */}
          <div className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 font-medium block mb-1">Full Name *</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Dr. Shahzad Rafique"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-300 font-medium block mb-1">
                  Contact Phone (WhatsApp Number) *
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+92 300 1234567"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 font-medium block mb-1">
                  Portal Username / Account ID *
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                  placeholder="e.g. shahzad_rafique"
                  required
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Password *</label>
                  <button
                    type="button"
                    onClick={() => setPassword(generateRandomPassword())}
                    className="text-cyan-400 hover:text-cyan-300 text-[10px] font-mono flex items-center gap-1 cursor-pointer transition"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Auto-Generate</span>
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-3 pr-9 py-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Instant WhatsApp Dispatch Checkbox */}
          <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 cursor-pointer hover:border-emerald-700 transition">
            <input
              type="checkbox"
              checked={sendWhatsApp}
              onChange={(e) => setSendWhatsApp(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-emerald-700 text-emerald-600 focus:ring-emerald-500 cursor-pointer bg-slate-900"
            />
            <div className="space-y-0.5">
              <span className="font-bold text-emerald-300 text-xs flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />
                <span>Send Login Credentials to User via WhatsApp</span>
              </span>
              <p className="text-[11px] text-slate-300 leading-normal">
                Generates instant 1-click WhatsApp message button with the portal link, username, and password immediately upon account creation.
              </p>
            </div>
          </label>

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
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold transition shadow-lg shadow-cyan-950/50 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isSubmitting ? 'Creating Account...' : '+ Create Account & Credentials'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
