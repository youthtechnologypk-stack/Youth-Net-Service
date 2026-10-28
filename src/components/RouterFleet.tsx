import React, { useState } from 'react';
import {
  Server,
  Plus,
  Activity,
  Trash2,
  Edit2,
  CheckCircle,
  Cpu,
  RefreshCw,
  Globe,
  Shield,
  Layers,
  CheckCircle2,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { MikrotikRouter } from '../types/isp';
import { EditRouterModal } from './EditRouterModal';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';

interface RouterFleetProps {
  onOpenAddDeviceModal: () => void;
}

export const RouterFleet: React.FC<RouterFleetProps> = ({ onOpenAddDeviceModal }) => {
  const {
    routers,
    selectedRouterId,
    setSelectedRouterId,
    activeSessions,
    customers,
    deleteMikrotikRouter,
    refreshRouterHealth,
  } = useISP();

  const [testingRouterId, setTestingRouterId] = useState<string | null>(null);

  // Edit Modal State
  const [routerToEdit, setRouterToEdit] = useState<MikrotikRouter | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Delete Dialog State
  const [routerToDelete, setRouterToDelete] = useState<MikrotikRouter | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Toast Notification State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const handleEditRouter = (router: MikrotikRouter) => {
    setRouterToEdit(router);
    setIsEditModalOpen(true);
  };

  const handleDeleteRouter = async () => {
    if (!routerToDelete) return;
    setIsDeleting(true);
    const targetId = routerToDelete.id;
    const deletedName = routerToDelete.name;
    try {
      // 1. Complete Delete Pipeline: Await backend API response
      await deleteMikrotikRouter(targetId);

      // 2. Synchronously ensure client/mock fallback storage is updated
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('registered_routers');
          if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
              const updated = list.filter((r: any) => r?.id !== targetId && r?.name !== deletedName);
              localStorage.setItem('registered_routers', JSON.stringify(updated));
            }
          }
          const deletedRaw = localStorage.getItem('deleted_router_ids') || '[]';
          const deletedList = JSON.parse(deletedRaw);
          if (Array.isArray(deletedList) && !deletedList.includes(targetId)) {
            deletedList.push(targetId);
            localStorage.setItem('deleted_router_ids', JSON.stringify(deletedList));
          }
        } catch {}
      }

      // 3. Safe fallback selection: switch to first remaining router or clear
      const remainingRouters = (routers || []).filter((r) => r?.id !== targetId && r?.name !== deletedName);
      if (selectedRouterId === targetId || !remainingRouters.some((r) => r?.id === selectedRouterId)) {
        const nextRouter = remainingRouters.length > 0 ? remainingRouters[0] : null;
        setSelectedRouterId(nextRouter ? nextRouter.id : '');
        try {
          if (nextRouter) {
            localStorage.setItem('netpulse_selected_router_id', nextRouter.id);
          } else {
            localStorage.removeItem('netpulse_selected_router_id');
          }
        } catch {}
      }

      setIsDeleteDialogOpen(false);
      showToast(`Router "${deletedName}" deleted permanently from fleet & database.`);
    } catch (err: any) {
      showToast(`Error deleting router: ${err?.message || 'Failed'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  return (
    <div className="space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-600 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-medium animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Inventory Counter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span>MikroTik Hardware Fleet Inventory</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
              {(routers || []).length} Devices Registered
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage carrier-grade MikroTik BNG/BRAS routers, configure RouterOS v7 API credentials, and manage telemetry links.
          </p>
        </div>
        <button
          onClick={onOpenAddDeviceModal}
          className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-lg shadow-cyan-950/40 shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add MikroTik Device</span>
        </button>
      </div>

      {/* Empty State when no routers registered */}
      {(!routers || routers.length === 0) ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 bg-slate-800/80 rounded-2xl flex items-center justify-center mx-auto border border-slate-700 text-slate-400">
            <Server className="w-8 h-8 text-cyan-400/70" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h4 className="text-base font-bold text-white">No MikroTik Routers Connected</h4>
            <p className="text-xs text-slate-400 leading-relaxed">
              No MikroTik Routers Connected. Click "+ Add Router" to register a BNG/BRAS device.
            </p>
          </div>
          <button
            onClick={onOpenAddDeviceModal}
            className="inline-flex items-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-lg shadow-cyan-950/40 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Router</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {routers.map((router) => {
            if (!router) return null;
            const isSelected = router.id === selectedRouterId;
            const routerSessionsCount = activeSessions.filter((s) => s.routerId === router.id).length;
            const routerCustomersCount = customers.filter((c) => c.routerId === router.id).length;

            return (
              <div
                key={router.id}
                className={`bg-slate-900 border rounded-xl p-5 space-y-4 shadow-lg transition flex flex-col justify-between ${
                  isSelected
                    ? 'border-cyan-500/80 ring-1 ring-cyan-500/30 shadow-cyan-950/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
              <div className="space-y-3">
                {/* Device Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2.5 rounded-xl border ${
                        isSelected
                          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-white text-sm font-mono">{router.name}</h4>
                        {isSelected && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-bold font-mono">
                            ACTIVE BNG
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 block">{router.location}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border uppercase font-mono flex items-center gap-1 ${
                        router.status === 'online'
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-rose-950 text-rose-300 border-rose-800'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${router.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                      {router.status === 'online' ? 'REST Live' : 'Unreachable'}
                    </span>
                  </div>
                </div>

                {/* Network & API Specs */}
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 space-y-1.5 font-mono text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Model:</span>
                    <span className="text-slate-200 font-semibold">{router.model}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Management IP:</span>
                    <span className="text-cyan-300 font-bold">
                      {router.ipAddress}:{router.apiPort} {router.useSsl ? '(TLS)' : ''}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Firmware:</span>
                    <span className="text-indigo-300">{router.version}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Uplink WAN:</span>
                    <span className="text-slate-300">{router.wanInterface}</span>
                  </div>
                </div>

                {/* Hardware Telemetry Grid */}
                <div className="grid grid-cols-3 gap-2 text-xs font-mono text-center">
                  <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">CPU Load</span>
                    <span className="text-cyan-300 font-bold">{router.cpuLoad ?? 0}%</span>
                  </div>
                  <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">Memory</span>
                    <span className="text-slate-200 font-bold">
                      {router.memoryUsageMb ?? 0} MB
                    </span>
                  </div>
                  <div className="bg-slate-950/70 p-2 rounded border border-slate-800">
                    <span className="text-slate-400 text-[10px] block">WAN Bandwidth</span>
                    <span className="text-emerald-400 font-bold">
                      {((router.currentWanRxMbps || 0) / 1000).toFixed(2)}G
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1 pt-1">
                  <span>Assigned PPPoE Clients:</span>
                  <span className="text-cyan-400 font-bold">
                    {routerSessionsCount} active / {routerCustomersCount} secrets
                  </span>
                </div>
              </div>

              {/* Router Actions Row */}
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
                {isSelected ? (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1 font-mono">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Currently Active BNG</span>
                  </span>
                ) : (
                  <button
                    onClick={() => setSelectedRouterId(router.id)}
                    className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 font-bold text-xs transition border border-cyan-500/40 cursor-pointer"
                  >
                    Set as Active BNG
                  </button>
                )}

                <div className="flex items-center gap-1.5">
                  {/* EDIT ROUTER BUTTON */}
                  <button
                    onClick={() => handleEditRouter(router)}
                    className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-cyan-950/50 rounded-lg transition border border-transparent hover:border-cyan-800 cursor-pointer flex items-center gap-1 text-xs"
                    title="Edit Router Configuration & Credentials"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[11px] text-cyan-300 font-medium hidden sm:inline">Edit</span>
                  </button>

                  {/* TEST CONNECTION / SYNC */}
                  <button
                    onClick={async () => {
                      setTestingRouterId(router.id);
                      await refreshRouterHealth(router.id);
                      setTestingRouterId(null);
                    }}
                    disabled={testingRouterId === router.id}
                    className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded-lg transition border border-transparent hover:border-slate-700 cursor-pointer"
                    title="Test Connection & Refresh RouterOS Telemetry"
                  >
                    <Activity
                      className={`w-4 h-4 ${
                        testingRouterId === router.id ? 'animate-spin text-cyan-400' : ''
                      }`}
                    />
                  </button>

                  {/* DELETE ROUTER BUTTON */}
                  <button
                    onClick={() => {
                      setRouterToDelete(router);
                      setIsDeleteDialogOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900 rounded-lg transition cursor-pointer"
                    title="Delete MikroTik Router Permanently"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        </div>
      )}

      {/* Edit Router Modal */}
      <EditRouterModal
        isOpen={isEditModalOpen}
        router={routerToEdit}
        onClose={() => {
          setIsEditModalOpen(false);
          setRouterToEdit(null);
        }}
        onSuccess={(msg) => {
          showToast(msg);
        }}
      />

      {/* Delete Router Dialog */}
      <DeleteConfirmDialog
        isOpen={isDeleteDialogOpen}
        title="Delete Router"
        itemName={routerToDelete?.name || 'Router'}
        itemType="router"
        description={`Are you sure you want to remove router "${routerToDelete?.name}" (${routerToDelete?.ipAddress}) from the fleet? This will permanently delete its configuration and credentials.`}
        isLoading={isDeleting}
        onConfirm={handleDeleteRouter}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setRouterToDelete(null);
        }}
      />
    </div>
  );
};
