import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  MapPin,
  Plus,
  Edit3,
  Search,
  Server,
  Users,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import {
  NetworkAreaNode,
  PARENT_FLEET_ROUTER,
  NETWORK_AREAS_UPDATED_EVENT,
  createChildNetworkArea,
  updateNetworkArea,
  resolveAreaFromUsername,
} from '../lib/billingAndNetwork';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';

export interface AreaNodeManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAreasUpdated?: (areas: NetworkAreaNode[]) => void;
}

interface AreaFormState {
  id?: string;
  oldAreaName?: string;
  parent_router: string;
  area_name: string;
  prefix_code: string;
}

export const AreaNodeManagerModal: React.FC<AreaNodeManagerModalProps> = ({
  isOpen,
  onClose,
  onAreasUpdated,
}) => {
  const [areas, setAreas] = useState<NetworkAreaNode[]>([]);
  const [portalClients, setPortalClients] = useState<SupabasePortalUser[]>([]);
  const [mikrotikSecrets, setMikrotikSecrets] = useState<Array<{ name?: string }>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Add / Edit sub-modal mode
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [form, setForm] = useState<AreaFormState>({
    parent_router: PARENT_FLEET_ROUTER,
    area_name: '',
    prefix_code: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadDirectory = useCallback(async () => {
    setIsLoading(true);
    try {
      const [areasRes, usersRes, secretsRes] = await Promise.all([
        supabase.from('network_areas').select('*').order('area_name', { ascending: true }),
        supabase.from('portal_users').select('id, username, area, role').eq('role', 'CLIENT'),
        safeMikrotikFetch('/api/mikrotik/ppp/secret')
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
      ]);

      if (Array.isArray(areasRes.data)) {
        const list = areasRes.data as NetworkAreaNode[];
        setAreas(list);
        if (onAreasUpdated) onAreasUpdated(list);
      }
      if (Array.isArray(usersRes.data)) {
        setPortalClients(usersRes.data as SupabasePortalUser[]);
      }
      if (Array.isArray(secretsRes)) {
        setMikrotikSecrets(secretsRes);
      }
    } catch (err) {
      console.warn('AreaNodeManager load notice:', err);
    } finally {
      setIsLoading(false);
    }
  }, [onAreasUpdated]);

  useEffect(() => {
    if (!isOpen) {
      setFormMode(null);
      setFormError(null);
      return;
    }
    loadDirectory();

    const ch = supabase
      .channel('public:area_node_manager')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'network_areas' }, () => {
        loadDirectory();
      })
      .subscribe();

    const handleEvent = () => loadDirectory();
    window.addEventListener(NETWORK_AREAS_UPDATED_EVENT, handleEvent);

    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener(NETWORK_AREAS_UPDATED_EVENT, handleEvent);
    };
  }, [isOpen, loadDirectory]);

  // Compute active subscriber counts per area (matching portal_users.area + MikroTik PPPoE prefixes)
  const subscriberCountByArea = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const a of areas) {
      map[a.area_name.trim().toLowerCase()] = new Set<string>();
    }

    const portalByUser: Record<string, string> = {};
    for (const pu of portalClients) {
      const uname = (pu.username || '').trim().toLowerCase();
      if (!uname) continue;
      const areaVal = (pu.area || '').trim();
      portalByUser[uname] = areaVal;

      const resolved =
        (areaVal &&
          areaVal.toLowerCase() !== 'unassigned' &&
          areaVal.toLowerCase() !== 'saddar node' &&
          areaVal) ||
        resolveAreaFromUsername(uname, areas) ||
        '';
      const key = resolved.trim().toLowerCase();
      if (key && map[key]) {
        map[key].add(uname);
      }
    }

    for (const sec of mikrotikSecrets) {
      const uname = (sec?.name || '').trim().toLowerCase();
      if (!uname) continue;
      if (portalByUser[uname]) continue; // Already attributed via portal_users
      const resolved = resolveAreaFromUsername(uname, areas);
      if (resolved) {
        const key = resolved.trim().toLowerCase();
        if (map[key]) {
          map[key].add(uname);
        }
      }
    }

    const counts: Record<string, number> = {};
    for (const [k, set] of Object.entries(map)) {
      counts[k] = set.size;
    }
    return counts;
  }, [areas, portalClients, mikrotikSecrets]);

  const filteredAreas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return areas;
    return areas.filter(
      (a) =>
        (a.area_name || '').toLowerCase().includes(q) ||
        (a.prefix_code || '').toLowerCase().includes(q) ||
        (a.parent_router || '').toLowerCase().includes(q)
    );
  }, [areas, searchQuery]);

  const handleOpenAdd = () => {
    setFormMode('add');
    setForm({
      parent_router: PARENT_FLEET_ROUTER,
      area_name: '',
      prefix_code: '',
    });
    setFormError(null);
  };

  const handleOpenEdit = (area: NetworkAreaNode) => {
    setFormMode('edit');
    setForm({
      id: area.id,
      oldAreaName: area.area_name,
      parent_router: area.parent_router || PARENT_FLEET_ROUTER,
      area_name: area.area_name || '',
      prefix_code: area.prefix_code || '',
    });
    setFormError(null);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = form.area_name.trim();
    if (!cleanName) {
      setFormError('Area / Mohallah Name is required.');
      return;
    }

    setIsSaving(true);
    setFormError(null);

    try {
      if (formMode === 'add') {
        const res = await createChildNetworkArea(
          cleanName,
          form.prefix_code.trim().toLowerCase(),
          form.parent_router.trim() || PARENT_FLEET_ROUTER
        );
        if (!res.success) {
          setFormError(res.error || 'Failed to add new area.');
          setIsSaving(false);
          return;
        }
        showToast(`Added "${cleanName}" under ${form.parent_router || PARENT_FLEET_ROUTER}.`);
      } else if (formMode === 'edit' && form.id) {
        const res = await updateNetworkArea(form.id, form.oldAreaName || '', {
          parent_router: form.parent_router.trim() || PARENT_FLEET_ROUTER,
          area_name: cleanName,
          prefix_code: form.prefix_code.trim().toLowerCase(),
        });
        if (!res.success) {
          setFormError(res.error || 'Failed to update area.');
          setIsSaving(false);
          return;
        }
        const renamedNote =
          form.oldAreaName && form.oldAreaName !== cleanName
            ? ` (subscribers reassigned from "${form.oldAreaName}")`
            : '';
        showToast(`Updated "${cleanName}"${renamedNote}.`);
      }

      setFormMode(null);
      await loadDirectory();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Area &amp; Node Manager ({PARENT_FLEET_ROUTER})
              </h2>
              <p className="text-xs text-slate-400">
                Manage child mohallah nodes, username auto-prefixes, and linked subscriber counts.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition cursor-pointer"
            aria-label="Close Area & Node Manager"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Toast */}
        {toast && (
          <div
            className={`px-5 py-2.5 border-b text-xs font-mono flex items-center gap-2 shrink-0 ${
              toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{toast.text}</span>
          </div>
        )}

        {/* Toolbar / Add-Edit Form */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {formMode ? (
            <form
              onSubmit={handleSubmitForm}
              className="bg-slate-950 border border-cyan-800/70 rounded-xl p-4 space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white">
                  {formMode === 'add' ? 'Add New Network Area' : `Edit Area: ${form.oldAreaName}`}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setFormMode(null);
                    setFormError(null);
                  }}
                  className="text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Back to Directory
                </button>
              </div>

              {formError && (
                <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-mono flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Parent Fleet Router
                  </label>
                  <input
                    type="text"
                    value={form.parent_router}
                    onChange={(e) => setForm((f) => ({ ...f, parent_router: e.target.value }))}
                    placeholder={PARENT_FLEET_ROUTER}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Area / Mohallah Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.area_name}
                    onChange={(e) => setForm((f) => ({ ...f, area_name: e.target.value }))}
                    placeholder="e.g. Chaklala Scheme"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Username Auto-Prefix Code
                  </label>
                  <input
                    type="text"
                    value={form.prefix_code}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        prefix_code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                      }))
                    }
                    placeholder="e.g. chk (optional)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {formMode === 'edit' &&
                form.oldAreaName &&
                form.area_name.trim() &&
                form.oldAreaName !== form.area_name.trim() && (
                  <p className="text-[11px] font-mono text-amber-300">
                    Renaming this area will also update existing subscribers in &ldquo;{form.oldAreaName}&rdquo; to &ldquo;{form.area_name.trim()}&rdquo;.
                  </p>
                )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setFormMode(null);
                    setFormError(null);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{formMode === 'add' ? 'Save New Area' : 'Save Area Changes'}</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search mohallah name, prefix code, or router..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={loadDirectory}
                  disabled={isLoading}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Area</span>
                </button>
              </div>
            </div>
          )}

          {/* Area Directory Table */}
          <div className="border border-slate-800 rounded-xl bg-slate-950/60 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                    <th className="py-2.5 px-4 font-sans">Parent Fleet Node</th>
                    <th className="py-2.5 px-4 font-sans">Child Area / Mohallah</th>
                    <th className="py-2.5 px-4">Auto-Prefix</th>
                    <th className="py-2.5 px-4 text-right">Active Subscribers</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {isLoading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Loading child area nodes from Supabase...
                      </td>
                    </tr>
                  ) : filteredAreas.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No matching area nodes found. Click &ldquo;Add New Area&rdquo; to create one.
                      </td>
                    </tr>
                  ) : (
                    filteredAreas.map((area) => {
                      const subCount =
                        subscriberCountByArea[(area.area_name || '').trim().toLowerCase()] || 0;
                      return (
                        <tr key={area.id || area.area_name} className="hover:bg-slate-800/30 transition">
                          <td className="py-2.5 px-4 text-slate-400">
                            <span className="inline-flex items-center gap-1.5">
                              <Server className="w-3 h-3 text-indigo-400 shrink-0" />
                              <span>{area.parent_router || PARENT_FLEET_ROUTER}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-4 font-sans font-semibold text-white">
                            {area.area_name}
                          </td>
                          <td className="py-2.5 px-4">
                            {area.prefix_code ? (
                              <span className="text-cyan-300 font-bold">
                                [{area.prefix_code}]
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-bold">
                              <Users className="w-3 h-3 text-slate-500" />
                              <span>{subCount}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleOpenEdit(area)}
                              disabled={!area.id}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-cyan-300 border border-slate-700 font-sans font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                            >
                              <Edit3 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AreaNodeManagerModal;
