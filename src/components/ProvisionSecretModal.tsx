import React, { useState } from 'react';
import { X, Server, CheckCircle2, ShieldCheck, Zap } from 'lucide-react';
import { useISP } from '../context/ISPContext';

interface ProvisionSecretModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProvisionSecretModal: React.FC<ProvisionSecretModalProps> = ({ isOpen, onClose }) => {
  const { packages, routers, selectedRouterId, provisionPppoeSecret } = useISP();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('+92');
  const [address, setAddress] = useState('');
  const [areaNode, setAreaNode] = useState('Sector G-11 (North Zone)');
  const [pppoeUsername, setPppoeUsername] = useState('');
  const [pppoePassword, setPppoePassword] = useState('fiber1234');
  const [packageId, setPackageId] = useState(packages[1]?.id || packages[0]?.id);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const currentRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !pppoeUsername) return;

    setIsSubmitting(true);
    await provisionPppoeSecret({
      name,
      phone,
      address,
      areaNode,
      pppoeUsername,
      pppoePassword,
      packageId,
      assignedIp: `10.50.${Math.floor(Math.random() * 40 + 10)}.${Math.floor(Math.random() * 240 + 10)}`,
      macAddress: `00:1E:67:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}`,
    });

    setIsSubmitting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl space-y-4">
        {/* Header */}
        <div className="bg-slate-950 p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-950 border border-cyan-800 text-cyan-400 rounded-lg">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                Provision PPPoE Secret & Customer
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Target BRAS: {currentRouter.name} ({currentRouter.ipAddress})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Subscriber Full Name</label>
              <input
                type="text"
                required
                placeholder="e.g. Asad Ullah Khan"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!pppoeUsername) {
                    setPppoeUsername(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '_'));
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Mobile / WhatsApp Number</label>
              <input
                type="text"
                required
                placeholder="+92 300 1234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Installation Address</label>
            <input
              type="text"
              required
              placeholder="e.g. House 14, Street 9, Sector G-11/3"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Area Name</label>
              <select
                value={areaNode}
                onChange={(e) => setAreaNode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500 font-sans"
              >
                <option value="Sector G-11 (North Zone)">Sector G-11 (North Zone)</option>
                <option value="Sector F-10 (Commercial Zone)">Sector F-10 (Commercial Zone)</option>
                <option value="Sector I-8 (East Zone)">Sector I-8 (East Zone)</option>
                <option value="Blue Area (Main Business Hub)">Blue Area (Main Business Hub)</option>
                <option value="Sector F-11 (West Zone)">Sector F-11 (West Zone)</option>
                <option value="Sector G-10 (South Zone)">Sector G-10 (South Zone)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Bandwidth Package</label>
              <select
                value={packageId}
                onChange={(e) => setPackageId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded focus:outline-none focus:border-cyan-500"
              >
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name} (${pkg.priceMonthly}/mo)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-800">
            <div>
              <label className="block text-slate-400 mb-1 font-mono">RouterOS PPPoE Username</label>
              <input
                type="text"
                required
                placeholder="user_pppoe"
                value={pppoeUsername}
                onChange={(e) => setPppoeUsername(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-cyan-300 font-mono p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 mb-1 font-mono">PPPoE Password</label>
              <input
                type="text"
                required
                value={pppoePassword}
                onChange={(e) => setPppoePassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 font-mono p-2 rounded focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="flex items-center gap-2 text-cyan-300 font-semibold">
              <Zap className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>MikroTik RouterOS v7 & Automated Invoicing:</span>
            </div>
            <p className="text-[10px] text-slate-500">
              Provisioning this account immediately executes <code className="text-cyan-300">/rest/ppp/secret (PUT)</code> on RouterOS and automatically generates the first monthly invoice, sets account balance, and dispatches a welcome WhatsApp statement.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold transition disabled:opacity-50"
            >
              {isSubmitting ? 'Provisioning on Router...' : 'Provision on MikroTik'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
