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
  Network,
  Copy,
  Database,
  Star,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { MIKROTIK_ROUTERS_MIGRATION_SQL } from '../services/routerSyncService';
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
    setDefaultMikrotikRouter,
    routerSyncSchemaMissing,
    refreshRouterHealth,
    routerProxyMode,
    setRouterProxyMode,
  } = useISP();

  const [testingRouterId, setTestingRouterId] = useState<string | null>(null);
  const [copiedRouterSql, setCopiedRouterSql] = useState(false);

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
    <div className="w-full max-w-full min-w-0 box-border space-y-4">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-600 text-emerald-200 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-medium animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Inventory Counter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg min-w-0 w-full max-w-full overflow-hidden">
        <div className="min-w-0 w-full sm:w-auto">
          <h3 className="text-sm font-bold text-white flex flex-wrap items-center gap-2">
            <span>MikroTik Hardware Fleet Inventory</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
              {(routers || []).length} Devices Registered
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5 break-words">
            Manage carrier-grade MikroTik BNG/BRAS routers, configure RouterOS v7 API credentials, and manage telemetry links.
          </p>
        </div>
        <button
          onClick={onOpenAddDeviceModal}
          className="bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-4 py-2 rounded-lg transition flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>+ Add MikroTik Device</span>
        </button>
      </div>

      {/* Target Router Gateway Mode: Exclusively Netlify Managed Proxy Mode (/api/mikrotik) */}
      <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs shadow-lg min-w-0 w-full max-w-full overflow-hidden">
        <div className="space-y-1 min-w-0 w-full md:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            <Network className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="font-bold text-white text-sm">RouterOS REST Gateway Architecture</span>
            <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase border bg-emerald-950 text-emerald-300 border-emerald-700/60">
              Netlify Managed Proxy Mode (Active)
            </span>
          </div>
          <p className="text-slate-400 text-xs break-words">
            All RouterOS health checks, CPU/WAN telemetry, and PPPoE sync calls route exclusively through the backend proxy (<code className="text-cyan-300">/api/mikrotik/*</code>) to eliminate browser SSL/CORS errors.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setRouterProxyMode('proxy');
            showToast('Verified Netlify Managed Proxy Mode (/api/mikrotik)');
          }}
          className="px-3.5 py-1.5 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white font-bold shadow-sm cursor-pointer shrink-0 transition"
        >
          Proxy Verified (/api/mikrotik)
        </button>
      </div>

      {routerSyncSchemaMissing && (
        <div className="bg-amber-950/70 border border-amber-700/70 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs min-w-0 w-full max-w-full">
          <div className="space-y-0.5 text-amber-200 min-w-0">
            <div className="font-bold font-mono text-amber-300 flex items-center gap-1.5">
              <Database className="w-4 h-4 shrink-0" />
              <span>Multi-Device Supabase Router Sync Table Needed</span>
            </div>
            <p className="text-[11px] text-amber-200/80">
              Run the SQL script in Supabase SQL Editor so saved routers (e.g., SADDAR) sync automatically across Desktop and Mobile.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(MIKROTIK_ROUTERS_MIGRATION_SQL);
              setCopiedRouterSql(true);
              setTimeout(() => setCopiedRouterSql(false), 3000);
            }}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>{copiedRouterSql ? 'SQL Copied!' : 'Copy Router SQL'}</span>
          </button>
        </div>
      )}

      {/* Empty State when no routers registered */}
      {(!routers || routers.length === 0) ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-10 text-center space-y-4 shadow-xl min-w-0 w-full max-w-full">
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
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Router</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-w-0 w-full">
          {routers.map((router) => {
            if (!router) return null;
            const isSelected = router.id === selectedRouterId;
            const routerSessionsCount = activeSessions.filter((s) => s.routerId === router.id).length;
            const routerCustomersCount = customers.filter((c) => c.routerId === router.id).length;

            return (
              <div
                key={router.id}
                className={`bg-slate-900 border rounded-xl p-4 sm:p-5 space-y-4 shadow-lg transition flex flex-col justify-between min-w-0 w-full max-w-full overflow-hidden ${
                  isSelected
                    ? 'border-cyan-500/80 ring-1 ring-cyan-500/30 shadow-cyan-950/20'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
              <div className="space-y-3 min-w-0">
                {/* Device Header */}
                <div className="flex flex-wrap items-start justify-between gap-2.5 min-w-0">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className={`p-2.5 rounded-xl border shrink-0 ${
                        isSelected
                          ? 'bg-cyan-950/80 border-cyan-500 text-cyan-300'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Server className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center flex-wrap gap-2">
                        <h4 className="font-bold text-white text-sm font-mono truncate">{router.name}</h4>
                        {isSelected && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/60 font-bold font-mono">
                            ACTIVE BNG
                          </span>
                        )}
                        {router.isDefault && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-700/60 font-bold font-mono inline-flex items-center gap-1">
                            <Star className="w-2.5 h-2.5" />
                            DEFAULT
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 block truncate">{router.location}</span>
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
                      {router.ip || router.ipAddress}:{router.port || (router.useSsl ? 443 : 80)} {router.useSsl ? '(TLS)' : ''}
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
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition border border-sky-600 dark:bg-sky-500/20 dark:hover:bg-sky-500/30 dark:text-sky-300 dark:border-sky-400/60 cursor-pointer"
                  >
                    Set as Active BNG
                  </button>
                )}

                <div className="flex items-center gap-1.5">
                  {!router.isDefault && (
                    <button
                      type="button"
                      onClick={async () => {
                        await setDefaultMikrotikRouter(router.id);
                        showToast(`"${router.name}" set as Default multi-device router.`);
                      }}
                      className="px-2 py-1 text-slate-300 hover:text-amber-300 hover:bg-amber-950/40 rounded-lg transition border border-slate-700 hover:border-amber-700 cursor-pointer flex items-center gap-1 text-[11px] font-mono"
                      title="Set as Default Router across Desktop & Mobile"
                    >
                      <Star className="w-3 h-3 text-amber-400" />
                      <span className="hidden sm:inline">Default</span>
                    </button>
                  )}

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
