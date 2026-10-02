import React, { useState } from 'react';
import {
  X,
  Layers,
  Server,
  Plus,
  Edit2,
  Trash2,
  Radio,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Activity,
  HardDrive,
  Power,
  Sliders,
} from 'lucide-react';
import { VsolOlt } from '../types/olt';
import { useISP } from '../context/ISPContext';

interface OltFleetManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddNew: () => void;
  onEditOlt: (olt: VsolOlt) => void;
}

export const OltFleetManagerModal: React.FC<OltFleetManagerModalProps> = ({
  isOpen,
  onClose,
  onAddNew,
  onEditOlt,
}) => {
  const { olts, onus, selectedOltId, setSelectedOltId, deleteOlt, testOltSnmpConnection } = useISP();

  const [testingOltId, setTestingOltId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { latency: number; msg: string }>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleTest = async (olt: VsolOlt) => {
    setTestingOltId(olt.id);
    try {
      const res = await testOltSnmpConnection(olt.ipAddress, olt.snmpCommunity, olt.snmpPort);
      setTestResult((prev) => ({
        ...prev,
        [olt.id]: { latency: res.latencyMs, msg: res.message },
      }));
    } finally {
      setTestingOltId(null);
    }
  };

  const handleDelete = (olt: VsolOlt) => {
    const mappedOnus = onus.filter((o) => o.oltId === olt.id);
    if (mappedOnus.length > 0) {
      if (!confirm(`Warning: OLT "${olt.name}" currently has ${mappedOnus.length} active ONUs registered. Are you sure you want to decommission this OLT?`)) {
        return;
      }
    }
    deleteOlt(olt.id);
    setDeleteConfirmId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-slate-950 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                VSOL OLT Fleet Management &amp; Hardware Hub
              </h3>
              <p className="text-slate-400 text-xs">
                Manage legacy and newly deployed EPON/GPON OLT chassis, SNMP configurations, and port allocations.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onAddNew();
              }}
              className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-cyan-950/50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add New OLT</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-3.5 text-xs font-mono">
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Total OLTs Registered: <strong className="text-white font-bold">{olts.length}</strong></span>
            <span className="text-cyan-400">Active Chassis: {olts.find(o => o.id === selectedOltId)?.name}</span>
          </div>

          <div className="space-y-3">
            {olts.map((olt) => {
              const mappedOnuCount = onus.filter((o) => o.oltId === olt.id).length;
              const isSelected = selectedOltId === olt.id;
              const isTesting = testingOltId === olt.id;
              const testInfo = testResult[olt.id];

              return (
                <div
                  key={olt.id}
                  className={`p-4 rounded-xl border transition ${
                    isSelected
                      ? 'bg-slate-950/90 border-cyan-500 ring-1 ring-cyan-500/50 shadow-lg shadow-cyan-950/40'
                      : 'bg-slate-950/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg border ${
                        isSelected
                          ? 'bg-cyan-950 text-cyan-400 border-cyan-700'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}>
                        <Server className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-white text-xs">{olt.name}</h4>
                          <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                            olt.ponType === 'GPON'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          }`}>
                            {olt.ponType}
                          </span>
                          {isSelected && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                              ACTIVE IN NOC
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          {olt.model} &bull; Node: {olt.areaNode}
                        </span>
                      </div>
                    </div>

                    {/* Quick Selection / Edit Actions */}
                    <div className="flex items-center gap-1.5 self-end sm:self-auto font-mono">
                      {!isSelected ? (
                        <button
                          onClick={() => setSelectedOltId(olt.id)}
                          className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-[11px] font-bold transition cursor-pointer"
                        >
                          Select
                        </button>
                      ) : (
                        <span className="px-2.5 py-1 bg-cyan-950 text-cyan-400 rounded-lg text-[11px] font-bold border border-cyan-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Selected</span>
                        </span>
                      )}

                      <button
                        onClick={() => handleTest(olt)}
                        disabled={isTesting}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 rounded-lg transition cursor-pointer"
                        title="Test SNMP Handshake"
                      >
                        <Zap className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-cyan-400' : ''}`} />
                      </button>

                      <button
                        onClick={() => {
                          onClose();
                          onEditOlt(olt);
                        }}
                        className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition cursor-pointer"
                        title="Edit OLT Configuration"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      {olts.length > 1 && (
                        <button
                          onClick={() => handleDelete(olt)}
                          className="p-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-400 rounded-lg border border-rose-900 transition cursor-pointer"
                          title="Decommission OLT"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* OLT Details Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2.5 text-[11px] text-slate-300">
                    <div>
                      <span className="text-slate-500 text-[10px] block">IP &amp; SNMP:</span>
                      <span className="text-cyan-400 font-bold">{olt.ipAddress}:{olt.snmpPort}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] block">PON Capacity:</span>
                      <span>{olt.totalPonPorts} Ports ({mappedOnuCount} ONUs Mapped)</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] block">CPU &amp; Temp:</span>
                      <span className="text-emerald-400">{olt.cpuLoad}%</span> / <span className="text-amber-400">{olt.temperatureC}°C</span>
                    </div>

                    <div>
                      <span className="text-slate-500 text-[10px] block">Firmware:</span>
                      <span className="text-slate-400 truncate block">{olt.firmwareVersion}</span>
                    </div>
                  </div>

                  {testInfo && (
                    <div className="mt-2.5 p-2 rounded bg-slate-900 border border-slate-800 text-[10px] text-emerald-400 flex items-center justify-between">
                      <span>✓ {testInfo.msg}</span>
                      <span className="text-slate-400 font-bold">{testInfo.latency}ms</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
