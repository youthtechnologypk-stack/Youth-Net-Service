import React, { useState, useEffect } from 'react';
import {
  X,
  Layers,
  Server,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Activity,
  Shield,
  HardDrive,
} from 'lucide-react';
import { VsolOlt, OltPonType } from '../types/olt';
import { useISP } from '../context/ISPContext';

interface AddEditOltModalProps {
  isOpen: boolean;
  onClose: () => void;
  oltToEdit?: VsolOlt | null;
}

export const AddEditOltModal: React.FC<AddEditOltModalProps> = ({
  isOpen,
  onClose,
  oltToEdit,
}) => {
  const { addOlt, updateOlt, testOltSnmpConnection } = useISP();

  const [name, setName] = useState('');
  const [model, setModel] = useState('VSOL V1600G1-B (8-Port GPON)');
  const [ponType, setPonType] = useState<OltPonType>('GPON');
  const [ipAddress, setIpAddress] = useState('192.168.8.');
  const [snmpPort, setSnmpPort] = useState(161);
  const [snmpCommunity, setSnmpCommunity] = useState('public');
  const [totalPonPorts, setTotalPonPorts] = useState(8);
  const [areaNode, setAreaNode] = useState('Sector-G11-PON-02');
  const [firmwareVersion, setFirmwareVersion] = useState('v2.03.54R');
  const [powerSupply, setPowerSupply] = useState<'dual_ac_redundant' | 'single_ac' | 'dc'>('dual_ac_redundant');

  // Test SNMP state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs: number } | null>(null);

  useEffect(() => {
    if (oltToEdit) {
      setName(oltToEdit.name);
      setModel(oltToEdit.model);
      setPonType(oltToEdit.ponType);
      setIpAddress(oltToEdit.ipAddress);
      setSnmpPort(oltToEdit.snmpPort);
      setSnmpCommunity(oltToEdit.snmpCommunity);
      setTotalPonPorts(oltToEdit.totalPonPorts);
      setAreaNode(oltToEdit.areaNode);
      setFirmwareVersion(oltToEdit.firmwareVersion);
      setPowerSupply(oltToEdit.powerSupply);
    } else {
      setName('');
      setModel('VSOL V1600G1-B (8-Port GPON)');
      setPonType('GPON');
      setIpAddress(`192.168.8.${Math.floor(105 + Math.random() * 50)}`);
      setSnmpPort(161);
      setSnmpCommunity('public');
      setTotalPonPorts(8);
      setAreaNode('Sector-F10-PON-01');
      setFirmwareVersion('v2.04.12R-2026');
      setPowerSupply('dual_ac_redundant');
    }
    setTestResult(null);
  }, [oltToEdit, isOpen]);

  if (!isOpen) return null;

  const handleTestSnmp = async () => {
    if (!ipAddress) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testOltSnmpConnection(ipAddress, snmpCommunity, snmpPort);
      setTestResult(res);
    } catch {
      setTestResult({
        success: false,
        message: 'SNMP connection timed out. Verify IP and community string.',
        latencyMs: 0,
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ipAddress.trim()) return;

    // Generate SFP modules based on port count
    const sfpModules = Array.from({ length: totalPonPorts }, (_, i) => ({
      port: `${ponType}0/${i + 1}`,
      wavelength: '1490nm Tx / 1310nm Rx',
      sfpTxPowerDbm: 4.6 + Math.round((Math.random() * 0.4 - 0.2) * 10) / 10,
      activeOnus: oltToEdit ? Math.min(25, Math.floor(Math.random() * 40)) : 0,
      maxOnus: ponType === 'GPON' ? 128 : 64,
    }));

    if (oltToEdit) {
      updateOlt(oltToEdit.id, {
        name,
        model,
        ponType,
        ipAddress,
        snmpPort,
        snmpCommunity,
        totalPonPorts,
        areaNode,
        firmwareVersion,
        powerSupply,
      });
    } else {
      addOlt({
        name,
        model,
        ponType,
        ipAddress,
        snmpPort,
        snmpCommunity,
        firmwareVersion,
        totalPonPorts,
        activeOnuCount: 0,
        status: 'online',
        uptime: '0 days, 00:05:00',
        cpuLoad: 9,
        temperatureC: 37.2,
        powerSupply,
        areaNode,
        sfpModules,
      });
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {oltToEdit ? 'Edit VSOL OLT Configuration' : 'Register New VSOL OLT Hardware'}
              </h3>
              <p className="text-slate-400 text-xs">
                Configure IP address, SNMP v2c telemetry, and PON port capacity.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
          {/* OLT Name & Model */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                OLT Node Identifier Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Sector F-10 Main Hub (VSOL GPON)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">
                Hardware Model Preset
              </label>
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  if (e.target.value.includes('EPON')) {
                    setPonType('EPON');
                    setTotalPonPorts(e.target.value.includes('4-Port') ? 4 : 8);
                  } else {
                    setPonType('GPON');
                    setTotalPonPorts(e.target.value.includes('16-Port') ? 16 : 8);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="VSOL V1600G1-B (8-Port GPON)">VSOL V1600G1-B (8-Port GPON OLT)</option>
                <option value="VSOL V1600G2 (16-Port GPON)">VSOL V1600G2 (16-Port High-Density GPON)</option>
                <option value="VSOL V1600D4-DP (4-Port EPON)">VSOL V1600D4-DP (4-Port EPON OLT)</option>
                <option value="VSOL V1600D8 (8-Port EPON)">VSOL V1600D8 (8-Port EPON OLT)</option>
              </select>
            </div>
          </div>

          {/* PON Type & Port Count */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">PON Technology</label>
              <div className="grid grid-cols-2 gap-2">
                {(['GPON', 'EPON'] as OltPonType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setPonType(type)}
                    className={`py-1.5 rounded-lg font-bold transition text-xs cursor-pointer ${
                      ponType === type
                        ? 'bg-cyan-600 text-slate-950'
                        : 'bg-slate-950 text-slate-400 border border-slate-800'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">Total PON SFP Ports</label>
              <select
                value={totalPonPorts}
                onChange={(e) => setTotalPonPorts(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value={4}>4 PON Ports (Up to 256/512 ONUs)</option>
                <option value={8}>8 PON Ports (Up to 512/1024 ONUs)</option>
                <option value={16}>16 PON Ports (Up to 1024/2048 ONUs)</option>
              </select>
            </div>
          </div>

          {/* IP Address, SNMP Port, Community */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Management IP *</label>
              <input
                type="text"
                required
                placeholder="192.168.8.100"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">SNMP UDP Port</label>
              <input
                type="number"
                value={snmpPort}
                onChange={(e) => setSnmpPort(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">Community String</label>
              <input
                type="text"
                value={snmpCommunity}
                onChange={(e) => setSnmpCommunity(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Area Node & Power Supply */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 font-semibold mb-1">Fiber Node / Hub Area</label>
              <input
                type="text"
                placeholder="e.g. Sector-F10-PON-01"
                value={areaNode}
                onChange={(e) => setAreaNode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-slate-400 font-semibold mb-1">Chassis Power Supply</label>
              <select
                value={powerSupply}
                onChange={(e) => setPowerSupply(e.target.value as any)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                <option value="dual_ac_redundant">Dual AC 220V (Redundant)</option>
                <option value="single_ac">Single AC 220V</option>
                <option value="dc">DC -48V Telecom Supply</option>
              </select>
            </div>
          </div>

          {/* SNMP Test Action Bar */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-cyan-400" />
                <span>Test OLT SNMP Connectivity</span>
              </span>
              <button
                type="button"
                onClick={handleTestSnmp}
                disabled={isTesting}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing Handshake...' : 'Ping SNMP Agent'}</span>
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                    : 'bg-rose-950/80 border-rose-700 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <div>
                  <span className="font-bold block">{testResult.message}</span>
                  {testResult.latencyMs > 0 && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      Latency: {testResult.latencyMs}ms | Community: {snmpCommunity}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-slate-950 font-bold rounded-xl transition shadow-lg shadow-cyan-950/50 cursor-pointer"
            >
              {oltToEdit ? 'Save Changes' : 'Register OLT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
