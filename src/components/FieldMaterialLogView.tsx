import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wrench,
  Plus,
  Trash2,
  Edit,
  RefreshCw,
  Search,
  MapPin,
  UserCheck,
  Cable,
  Box,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Database,
  Copy,
  Check,
  X,
  Save,
  Loader2,
  FileSpreadsheet,
  FileDown,
  Layers,
  ArrowLeftRight,
  PackagePlus,
  PackageMinus,
} from 'lucide-react';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import {
  CreateFieldMaterialItemInput,
  FIELD_MATERIAL_ACTION_TYPES,
  FIELD_MATERIAL_CATEGORIES,
  FIELD_MATERIAL_MIGRATION_SQL,
  FIELD_MATERIAL_UNITS,
  FieldMaterialActionType,
  FieldMaterialUnit,
  SupabaseFieldMaterialLog,
  computeFieldMaterialKpis,
  createFieldMaterialLogsBatch,
  deleteFieldMaterialLog,
  fetchFieldMaterialLogs,
  fetchFieldStaffDirectory,
  formatActionTypeMeta,
  getDefaultUnitForCategory,
  normalizeFieldMaterialActionType,
  normalizeFieldMaterialUnit,
  normalizePerformerRole,
  updateFieldMaterialLog,
} from '../services/fieldMaterialService';
import { exportFieldMaterialLogsToExcel, exportFieldMaterialLogsToPdf } from '../lib/fieldMaterialExport';
import { getCachedGlobalSystemSettings } from '../lib/systemSettings';
import {
  NetworkAreaNode,
  fetchNetworkAreas,
  NETWORK_AREAS_UPDATED_EVENT,
} from '../lib/billingAndNetwork';
import { AreaNodeSelector } from './AreaNodeSelector';
import { DateFilterToolbar } from './DateFilterToolbar';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  matchesDateFilter,
} from '../lib/dateFilter';
import { SystemRole, UserAccount } from '../types/auth';
import { useAuth } from '../context/AuthContext';

export interface FieldMaterialLogViewProps {
  currentUser?: UserAccount | null;
  currentRole?: SystemRole;
  compactMobile?: boolean;
}

interface DraftMaterialLineItem {
  id: string;
  material_category: string;
  quantity: string;
  unit: FieldMaterialUnit;
  remarks: string;
}

function createEmptyLineItem(defaultCategory = 'PLC Splitter 1:8'): DraftMaterialLineItem {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    material_category: defaultCategory,
    quantity: defaultCategory.toLowerCase().includes('wire') ? '85' : '1',
    unit: getDefaultUnitForCategory(defaultCategory),
    remarks: '',
  };
}

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 16);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export const FieldMaterialLogView: React.FC<FieldMaterialLogViewProps> = ({
  currentUser: propUser,
  currentRole: propRole,
  compactMobile = false,
}) => {
  const { currentUser: authUser } = useAuth();
  const activeUser = propUser || authUser;
  const effectiveRole = String(propRole || activeUser?.role || 'AGENT')
    .trim()
    .toUpperCase();
  const isMasterAdmin = effectiveRole === 'ADMIN';
  const canAssignOtherStaff = effectiveRole === 'ADMIN' || effectiveRole === 'MANAGER';

  // Core data state
  const [logs, setLogs] = useState<SupabaseFieldMaterialLog[]>([]);
  const [staffList, setStaffList] = useState<SupabasePortalUser[]>([]);
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [missingTable, setMissingTable] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilterState>(() => createDefaultDateFilter('month'));
  const [areaFilter, setAreaFilter] = useState<string>('ALL');
  const [technicianFilter, setTechnicianFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<'ALL' | FieldMaterialActionType>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Quick Entry Modal (Multi-Item Visit Form)
  const [isEntryModalOpen, setIsEntryModalOpen] = useState<boolean>(false);
  const [visitActionType, setVisitActionType] = useState<FieldMaterialActionType>('INSTALLED');
  const [visitPoleLocation, setVisitPoleLocation] = useState<string>('');
  const [visitCoverageArea, setVisitCoverageArea] = useState<string>(activeUser?.area || '');
  const [visitStaffId, setVisitStaffId] = useState<string>(activeUser?.id || '');
  const [visitSharedRemarks, setVisitSharedRemarks] = useState<string>('');
  const [draftItems, setDraftItems] = useState<DraftMaterialLineItem[]>([
    createEmptyLineItem('PLC Splitter 1:8'),
  ]);
  const [isSavingBatch, setIsSavingBatch] = useState<boolean>(false);
  const [entryFormError, setEntryFormError] = useState<string | null>(null);

  // Master Admin Edit Modal State
  const [editingLog, setEditingLog] = useState<SupabaseFieldMaterialLog | null>(null);
  const [editActionType, setEditActionType] = useState<FieldMaterialActionType>('INSTALLED');
  const [editCategory, setEditCategory] = useState<string>('PLC Splitter 1:8');
  const [editQuantity, setEditQuantity] = useState<string>('1');
  const [editUnit, setEditUnit] = useState<FieldMaterialUnit>('Pieces');
  const [editPoleLocation, setEditPoleLocation] = useState<string>('');
  const [editCoverageArea, setEditCoverageArea] = useState<string>('');
  const [editStaffId, setEditStaffId] = useState<string>('');
  const [editPerformerName, setEditPerformerName] = useState<string>('');
  const [editPerformerRole, setEditPerformerRole] = useState<string>('AGENT');
  const [editTimestampLocal, setEditTimestampLocal] = useState<string>('');
  const [editRemarks, setEditRemarks] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editFormError, setEditFormError] = useState<string | null>(null);

  // Master Admin Delete Confirmation Modal State
  const [deletingLog, setDeletingLog] = useState<SupabaseFieldMaterialLog | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const loadAllData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const [logsRes, staff, areas] = await Promise.all([
        fetchFieldMaterialLogs(),
        fetchFieldStaffDirectory(),
        fetchNetworkAreas(),
      ]);

      setLogs(logsRes.data);
      setMissingTable(logsRes.missingTable);
      setStaffList(staff);
      setNetworkAreas(areas);
    } catch (err: any) {
      console.error('Error loading field material logs:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();

    const channel = supabase
      .channel('public:field_material_logs_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'field_material_logs' },
        () => {
          loadAllData(true);
        }
      )
      .subscribe();

    const onAreasUpdated = () => {
      fetchNetworkAreas().then(setNetworkAreas).catch(() => {});
    };
    window.addEventListener(NETWORK_AREAS_UPDATED_EVENT, onAreasUpdated);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(NETWORK_AREAS_UPDATED_EVENT, onAreasUpdated);
    };
  }, [loadAllData]);

  // Dynamic Filter Options
  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    networkAreas.forEach((a) => {
      if (a.area_name?.trim()) set.add(a.area_name.trim());
    });
    logs.forEach((l) => {
      if (l.coverage_area?.trim()) set.add(l.coverage_area.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [networkAreas, logs]);

  const availableTechnicians = useMemo(() => {
    const map = new Map<string, { label: string; role: string }>();
    staffList.forEach((s) => {
      const name = (s.full_name || s.username || '').trim();
      if (name) {
        map.set(name.toLowerCase(), { label: name, role: String(s.role || 'AGENT').toUpperCase() });
      }
    });
    logs.forEach((l) => {
      const name = (l.performed_by_name || '').trim();
      if (name && !map.has(name.toLowerCase())) {
        map.set(name.toLowerCase(), {
          label: name,
          role: String(l.performed_by_role || 'AGENT').toUpperCase(),
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [staffList, logs]);

  // Filtered Logs
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((row) => {
      if (!matchesDateFilter(row.created_at, dateFilter)) return false;
      if (
        areaFilter !== 'ALL' &&
        (row.coverage_area || '').trim().toLowerCase() !== areaFilter.trim().toLowerCase()
      ) {
        return false;
      }
      if (
        technicianFilter !== 'ALL' &&
        (row.performed_by_name || '').trim().toLowerCase() !== technicianFilter.trim().toLowerCase()
      ) {
        return false;
      }
      if (actionFilter !== 'ALL' && normalizeFieldMaterialActionType(row.action_type) !== actionFilter) {
        return false;
      }
      if (q) {
        const haystack = [
          row.material_category,
          row.pole_id_or_location,
          row.coverage_area,
          row.performed_by_name,
          row.performed_by_role,
          row.action_type,
          row.remarks || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [logs, dateFilter, areaFilter, technicianFilter, actionFilter, searchQuery]);

  // Live KPI Totals from Filtered Rows
  const kpis = useMemo(() => computeFieldMaterialKpis(filteredLogs), [filteredLogs]);

  // Copy SQL helper
  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(FIELD_MATERIAL_MIGRATION_SQL);
      setCopiedSql(true);
      showToast('SQL copied! Paste & run in Supabase SQL Editor, then click Refresh.');
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      showToast('Clipboard blocked. Please copy SQL manually.', 'error');
    }
  };

  // Open Quick Entry Modal
  const openQuickEntryModal = () => {
    setVisitActionType('INSTALLED');
    setVisitPoleLocation('');
    setVisitCoverageArea(
      activeUser?.area &&
        activeUser.area !== 'Central NOC Core' &&
        activeUser.area !== 'All Coverage Sectors'
        ? activeUser.area
        : networkAreas[0]?.area_name || ''
    );
    setVisitStaffId(activeUser?.id || '');
    setVisitSharedRemarks('');
    setDraftItems([createEmptyLineItem('PLC Splitter 1:8')]);
    setEntryFormError(null);
    setIsEntryModalOpen(true);
  };

  const handleAddDraftItem = () => {
    setDraftItems((prev) => {
      const nextDefault =
        prev.length === 1 ? 'Drop Wire (1-Core / 2-Core)' : 'Pole Clamp / Hardware';
      return [...prev, createEmptyLineItem(nextDefault)];
    });
  };

  const handleRemoveDraftItem = (lineId: string) => {
    setDraftItems((prev) => (prev.length > 1 ? prev.filter((item) => item.id !== lineId) : prev));
  };

  const handleUpdateDraftItem = (
    lineId: string,
    patch: Partial<DraftMaterialLineItem>,
    autoSelectUnit = false
  ) => {
    setDraftItems((prev) =>
      prev.map((item) => {
        if (item.id !== lineId) return item;
        const nextCat = patch.material_category ?? item.material_category;
        return {
          ...item,
          ...patch,
          unit:
            autoSelectUnit && patch.material_category
              ? getDefaultUnitForCategory(nextCat)
              : patch.unit ?? item.unit,
        };
      })
    );
  };

  const handleSaveBatchEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntryFormError(null);

    if (!visitPoleLocation.trim()) {
      setEntryFormError('Please enter a Pole ID, FAT Box, or Subscriber Location (e.g., Pole #14 - Baza Mohallah).');
      return;
    }

    const chosenStaff = canAssignOtherStaff
      ? staffList.find((s) => s.id === visitStaffId)
      : undefined;

    const performerId = chosenStaff?.id || activeUser?.id || null;
    const performerName =
      chosenStaff?.full_name ||
      chosenStaff?.username ||
      activeUser?.fullName ||
      activeUser?.username ||
      'Field Technician';
    const performerRole = chosenStaff?.role || effectiveRole;

    const batchPayload: CreateFieldMaterialItemInput[] = draftItems.map((line) => {
      const combinedRemarks = [line.remarks.trim(), visitSharedRemarks.trim()]
        .filter(Boolean)
        .join(' — ');
      return {
        action_type: visitActionType,
        material_category: line.material_category,
        quantity: Number(line.quantity),
        unit: line.unit,
        pole_id_or_location: visitPoleLocation.trim(),
        coverage_area: visitCoverageArea.trim() || 'General Coverage Area',
        performed_by_user_id: performerId,
        performed_by_name: performerName,
        performed_by_role: normalizePerformerRole(performerRole),
        remarks: combinedRemarks,
      };
    });

    setIsSavingBatch(true);
    try {
      const inserted = await createFieldMaterialLogsBatch(batchPayload, {
        id: activeUser?.id || null,
        name: activeUser?.fullName || activeUser?.username || 'Field Technician',
        role: effectiveRole,
      });

      setLogs((prev) => [...inserted, ...prev]);
      setIsEntryModalOpen(false);
      showToast(
        `Saved ${inserted.length} field material ${inserted.length === 1 ? 'entry' : 'entries'} for ${visitPoleLocation.trim()} to PostgreSQL.`
      );
      loadAllData(true);
    } catch (err: any) {
      const msg = err?.message || 'Failed to save material log to Supabase.';
      setEntryFormError(msg);
      if (msg.toLowerCase().includes('field_material_logs')) {
        setMissingTable(true);
      }
    } finally {
      setIsSavingBatch(false);
    }
  };

  // Master Admin Edit Handlers
  const openEditModal = (row: SupabaseFieldMaterialLog) => {
    if (!isMasterAdmin) return;
    setEditingLog(row);
    setEditActionType(normalizeFieldMaterialActionType(row.action_type));
    setEditCategory(row.material_category || 'Other');
    setEditQuantity(String(row.quantity ?? 1));
    setEditUnit(normalizeFieldMaterialUnit(row.unit));
    setEditPoleLocation(row.pole_id_or_location || '');
    setEditCoverageArea(row.coverage_area || '');
    setEditStaffId(row.performed_by_user_id || '');
    setEditPerformerName(row.performed_by_name || '');
    setEditPerformerRole(normalizePerformerRole(row.performed_by_role));
    setEditTimestampLocal(toDatetimeLocalValue(row.created_at));
    setEditRemarks(row.remarks || '');
    setEditFormError(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLog || !isMasterAdmin) return;
    setEditFormError(null);
    setIsSavingEdit(true);

    try {
      const matchedStaff = staffList.find((s) => s.id === editStaffId);
      const updated = await updateFieldMaterialLog(
        editingLog.id,
        {
          action_type: editActionType,
          material_category: editCategory,
          quantity: Number(editQuantity),
          unit: editUnit,
          pole_id_or_location: editPoleLocation.trim(),
          coverage_area: editCoverageArea.trim() || 'General Coverage Area',
          performed_by_user_id: matchedStaff?.id || editStaffId || editingLog.performed_by_user_id,
          performed_by_name:
            matchedStaff?.full_name || editPerformerName.trim() || editingLog.performed_by_name,
          performed_by_role: matchedStaff?.role || editPerformerRole,
          created_at: editTimestampLocal ? new Date(editTimestampLocal).toISOString() : undefined,
          remarks: editRemarks.trim(),
        },
        effectiveRole
      );

      setLogs((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEditingLog(null);
      showToast('Field material log updated in PostgreSQL.');
      loadAllData(true);
    } catch (err: any) {
      setEditFormError(err?.message || 'Failed to update material log.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Master Admin Delete Handler
  const handleConfirmDelete = async () => {
    if (!deletingLog || !isMasterAdmin) return;
    setDeleteError(null);
    setIsDeleting(true);

    try {
      const deletedId = await deleteFieldMaterialLog(deletingLog.id, effectiveRole);
      setLogs((prev) => prev.filter((r) => r.id !== deletedId));
      setDeletingLog(null);
      showToast('Field material entry deleted & KPI totals recalculated.');
      loadAllData(true);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete material log.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Export Handlers
  const buildExportPayload = () => {
    const settings = getCachedGlobalSystemSettings();
    return {
      companyName: settings.companyDisplayName || settings.ispName || 'Youth Net Service',
      supportHelpline: settings.supportHelpline,
      dateFilter,
      areaFilterLabel: areaFilter === 'ALL' ? 'All Coverage Areas' : areaFilter,
      technicianFilterLabel: technicianFilter === 'ALL' ? 'All Staff / Technicians' : technicianFilter,
      actionFilterLabel:
        actionFilter === 'ALL' ? 'All Actions' : formatActionTypeMeta(actionFilter).label,
      generatedAt: new Date(),
      summary: kpis,
      rows: filteredLogs,
    };
  };

  const handleExportExcel = () => {
    try {
      const filename = exportFieldMaterialLogsToExcel(buildExportPayload());
      showToast(`Exported Excel audit report: ${filename}`);
    } catch (err: any) {
      showToast(`Excel export failed: ${err?.message || 'Unexpected error'}`, 'error');
    }
  };

  const handleExportPdf = () => {
    try {
      const filename = exportFieldMaterialLogsToPdf(buildExportPayload());
      showToast(`Exported PDF audit report: ${filename}`);
    } catch (err: any) {
      showToast(`PDF export failed: ${err?.message || 'Unexpected error'}`, 'error');
    }
  };

  const renderActionBadge = (actionType: string) => {
    const meta = formatActionTypeMeta(actionType);
    if (meta.code === 'REMOVED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-amber-950/90 text-amber-300 border border-amber-700/80 whitespace-nowrap">
          <PackageMinus className="w-3 h-3 shrink-0" />
          <span>Removed · {meta.urduHint}</span>
        </span>
      );
    }
    if (meta.code === 'REPLACED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-cyan-950/90 text-cyan-300 border border-cyan-700/80 whitespace-nowrap">
          <ArrowLeftRight className="w-3 h-3 shrink-0" />
          <span>Replaced · {meta.urduHint}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-emerald-950/90 text-emerald-300 border border-emerald-700/80 whitespace-nowrap">
        <PackagePlus className="w-3 h-3 shrink-0" />
        <span>Installed · {meta.urduHint}</span>
      </span>
    );
  };

  return (
    <div className="space-y-5 text-xs font-sans animate-fadeIn">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[10000] p-3.5 rounded-xl border shadow-2xl flex items-center gap-2.5 text-xs font-mono animate-fadeIn ${
            toast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-600 text-emerald-200'
              : 'bg-rose-950/95 border-rose-600 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 flex items-center justify-center text-slate-950 shadow-lg shadow-cyan-950/50 shrink-0">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Field Material &amp; FTTH Pole Deployment Log
              </h2>
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-[10px] font-bold uppercase">
                FTTH Audit
              </span>
            </div>
            <p className="text-slate-400 text-xs mt-0.5">
              Track splitters, drop wire, fiber cables, FAT boxes, and pole hardware installed, removed, or replaced across coverage areas.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => loadAllData(true)}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            title="Refresh material logs from PostgreSQL"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={openQuickEntryModal}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 transition cursor-pointer active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>+ Log Field Material (Installed / Removed)</span>
          </button>
        </div>
      </div>

      {/* Supabase Missing Table One-Click Migration Banner */}
      {missingTable && (
        <div className="p-4 rounded-2xl bg-amber-950/50 border border-amber-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-amber-300 font-bold text-xs">
              <Database className="w-4 h-4 shrink-0" />
              <span>Supabase Table `field_material_logs` Setup Required</span>
            </div>
            <p className="text-[11px] text-amber-200/85">
              Click <strong>Copy SQL Migration</strong> and run it once in your Supabase SQL Editor to enable permanent PostgreSQL storage for FTTH field material &amp; pole logs.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="shrink-0 whitespace-nowrap px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'Copied SQL!' : 'Copy SQL Migration'}</span>
          </button>
        </div>
      )}

      {/* 3 Filtered Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900 border border-cyan-900/60 shadow-lg space-y-1">
          <span className="text-[10px] text-cyan-300 font-mono uppercase tracking-wider flex items-center justify-between">
            <span>Total Wire Used (Meters)</span>
            <Cable className="w-4 h-4 text-cyan-400" />
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-cyan-300">
            {kpis.totalWireUsedMeters.toLocaleString()} <span className="text-sm font-normal text-slate-400">Meters</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono block">
            Drop wire &amp; main fiber installed/replaced ({describeDateFilter(dateFilter)})
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-900/60 shadow-lg space-y-1">
          <span className="text-[10px] text-emerald-300 font-mono uppercase tracking-wider flex items-center justify-between">
            <span>Splitters &amp; Boxes Installed</span>
            <Box className="w-4 h-4 text-emerald-400" />
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400">
            {kpis.totalSplittersAndBoxesInstalled.toLocaleString()}{' '}
            <span className="text-sm font-normal text-slate-400">Pieces</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono tabular-nums block">
            PLC splitters, FAT/ODB boxes &amp; joints · +{kpis.totalOtherInstalledPieces} other pcs
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-slate-900 border border-amber-900/60 shadow-lg space-y-1">
          <span className="text-[10px] text-amber-300 font-mono uppercase tracking-wider flex items-center justify-between">
            <span>Materials Removed / Recovered</span>
            <RotateCcw className="w-4 h-4 text-amber-400" />
          </span>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-300">
            {kpis.totalRemovedPieces.toLocaleString()}{' '}
            <span className="text-sm font-normal text-slate-400">pcs</span>
            <span className="mx-1.5 text-slate-600">/</span>
            {kpis.totalRemovedMeters.toLocaleString()}{' '}
            <span className="text-sm font-normal text-slate-400">m</span>
          </div>
          <span className="text-[10px] text-slate-400 font-mono block">
            Purana saman recovered from poles &amp; subscriber premises
          </span>
        </div>
      </div>

      {/* Period Filter Toolbar + Export Excel & Export PDF */}
      <DateFilterToolbar
        value={dateFilter}
        onChange={setDateFilter}
        totalCount={logs.length}
        filteredCount={filteredLogs.length}
        recordLabel="material logs"
        compact={compactMobile}
        extraActions={
          <>
            <button
              type="button"
              onClick={handleExportExcel}
              className="px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/75 text-emerald-300 border border-emerald-700/80 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              title="Export filtered FTTH material usage log as Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/75 text-rose-300 border border-rose-700/80 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
              title="Export filtered FTTH material usage log as printable A4 PDF"
            >
              <FileDown className="w-3.5 h-3.5 text-rose-400" />
              <span>Export PDF</span>
            </button>
          </>
        }
      />

      {/* Secondary Filter Bar: Search + Coverage Area + Technician + Action Type */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pole #, FAT box, @subscriber, splitter, or notes..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
          />
        </div>

        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
          aria-label="Filter by Coverage Area"
        >
          <option value="ALL">All Coverage Areas</option>
          {availableAreas.map((area) => (
            <option key={area} value={area}>
              {area}
            </option>
          ))}
        </select>

        <select
          value={technicianFilter}
          onChange={(e) => setTechnicianFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
          aria-label="Filter by Technician"
        >
          <option value="ALL">All Technicians / Staff</option>
          {availableTechnicians.map((t) => (
            <option key={t.label} value={t.label}>
              {t.label} ({t.role})
            </option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value as 'ALL' | FieldMaterialActionType)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500 cursor-pointer"
          aria-label="Filter by Action Type"
        >
          <option value="ALL">All Actions</option>
          <option value="INSTALLED">Installed (New Lagaya)</option>
          <option value="REMOVED">Removed (Purana Utara)</option>
          <option value="REPLACED">Replaced (Tabdeel Kiya)</option>
        </select>
      </div>

      {/* Main Audit Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3.5 px-4">Date &amp; Time</th>
                <th className="py-3.5 px-4">Person &amp; Role</th>
                <th className="py-3.5 px-4">Action (Installed / Removed)</th>
                <th className="py-3.5 px-4">Material Item</th>
                <th className="py-3.5 px-4 text-right">Qty &amp; Unit</th>
                <th className="py-3.5 px-4">Pole / Location / Area</th>
                <th className="py-3.5 px-4">Notes</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 font-mono">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      <span>Loading FTTH field material logs from PostgreSQL...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-14 text-center text-slate-400 space-y-2">
                    <Layers className="w-7 h-7 text-slate-600 mx-auto" />
                    <p className="font-sans text-slate-300 font-semibold">
                      No field material records found for {describeDateFilter(dateFilter)}.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Click &ldquo;+ Log Field Material (Installed / Removed)&rdquo; to log splitters, drop wire, FAT boxes, or pole hardware.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-950/60 transition">
                    <td className="py-3.5 px-4 text-slate-400 whitespace-nowrap">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="font-sans font-semibold text-white flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        <span>{row.performed_by_name}</span>
                      </div>
                      <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded bg-slate-950 border border-slate-700 text-[9px] font-bold text-slate-300 uppercase">
                        {row.performed_by_role || 'AGENT'}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      {renderActionBadge(row.action_type)}
                    </td>

                    <td className="py-3.5 px-4 font-sans font-semibold text-slate-100 whitespace-nowrap">
                      {row.material_category}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap tabular-nums">
                      <span className="font-bold text-white text-sm">
                        {Number(row.quantity) || 0}
                      </span>{' '}
                      <span className="text-slate-400 text-[11px]">{row.unit}</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-sans font-semibold text-cyan-300 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span>{row.pole_id_or_location}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {row.coverage_area || 'General Coverage Area'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-sans text-slate-300 max-w-xs break-words">
                      {row.remarks || '—'}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {isMasterAdmin ? (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="px-2.5 py-1 rounded-lg bg-blue-950/70 hover:bg-blue-900/80 text-blue-300 border border-blue-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                            title="Edit material log entry (Master Admin)"
                          >
                            <Edit className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError(null);
                              setDeletingLog(row);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer"
                            title="Delete material log entry (Master Admin)"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Delete</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-mono">Verified</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL 1: Quick Field Entry Form (Multi-Item Visit) */}
      {isEntryModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto font-sans animate-fadeIn">
          <div className="w-[95vw] sm:w-full max-w-2xl max-h-[92vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800 sticky top-0 z-10">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-400">
                  <Wrench className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">
                    Log Field Material (Installed / Removed / Replaced)
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    Add 1 or multiple FTTH items used during this pole / subscriber visit
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingBatch}
                onClick={() => setIsEntryModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBatchEntry} className="p-5 space-y-4 text-xs">
              {entryFormError && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-200 font-mono text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span className="break-words">{entryFormError}</span>
                </div>
              )}

              {/* Action Type 3-Way Toggle */}
              <div>
                <label className="block text-slate-300 font-bold mb-1.5">
                  Action Type (Kaam Ki Qisam) *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setVisitActionType('INSTALLED')}
                    className={`px-3 py-2.5 rounded-xl border font-bold text-left transition cursor-pointer flex items-center gap-2 ${
                      visitActionType === 'INSTALLED'
                        ? 'bg-emerald-950 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/60'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <PackagePlus className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div>
                      <div className="text-xs">Installed</div>
                      <div className="text-[10px] font-mono opacity-80">New Lagaya</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setVisitActionType('REMOVED')}
                    className={`px-3 py-2.5 rounded-xl border font-bold text-left transition cursor-pointer flex items-center gap-2 ${
                      visitActionType === 'REMOVED'
                        ? 'bg-amber-950 border-amber-500 text-amber-200 shadow-md shadow-amber-950/60'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <PackageMinus className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="text-xs">Removed</div>
                      <div className="text-[10px] font-mono opacity-80">Purana Utara</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setVisitActionType('REPLACED')}
                    className={`px-3 py-2.5 rounded-xl border font-bold text-left transition cursor-pointer flex items-center gap-2 ${
                      visitActionType === 'REPLACED'
                        ? 'bg-cyan-950 border-cyan-500 text-cyan-200 shadow-md shadow-cyan-950/60'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <ArrowLeftRight className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <div className="text-xs">Replaced</div>
                      <div className="text-[10px] font-mono opacity-80">Utar Kar Naya Lagaya</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Visit Context: Who + Pole/Location + Coverage Area */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Who Installed / Removed *
                  </label>
                  {canAssignOtherStaff ? (
                    <select
                      value={visitStaffId}
                      onChange={(e) => setVisitStaffId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                    >
                      <option value={activeUser?.id || ''}>
                        {activeUser?.fullName || activeUser?.username || 'Current Staff'} ({effectiveRole}) — Myself
                      </option>
                      {staffList
                        .filter((s) => s.id !== activeUser?.id)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} (@{s.username}) — {s.role}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-cyan-300 font-mono text-xs flex items-center justify-between">
                      <span>{activeUser?.fullName || activeUser?.username || 'Field Agent'}</span>
                      <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-[10px]">
                        {effectiveRole}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-slate-300 font-bold mb-1">
                    Pole ID / FAT / Subscriber Location *
                  </label>
                  <input
                    type="text"
                    required
                    value={visitPoleLocation}
                    onChange={(e) => setVisitPoleLocation(e.target.value)}
                    placeholder="e.g. Pole #14 - Baza Mohallah, FAT-08, or @bzwaqas74"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <AreaNodeSelector
                value={visitCoverageArea}
                onChange={setVisitCoverageArea}
                areas={networkAreas}
                onAreasUpdated={setNetworkAreas}
                label="Coverage Area / Node"
              />

              {/* Multi-Item List */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-slate-200 font-bold text-xs flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Materials Used / Recovered in This Visit ({draftItems.length})</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleAddDraftItem}
                    className="px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-800 font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Add Another Item (Same Visit)</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {draftItems.map((line, index) => (
                    <div
                      key={line.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5"
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span className="font-bold text-slate-300">Item #{index + 1}</span>
                        {draftItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDraftItem(line.id)}
                            className="text-rose-400 hover:text-rose-300 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Remove</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-6">
                          <label className="block text-[10px] text-slate-400 font-mono mb-1">
                            Material Category *
                          </label>
                          <select
                            value={line.material_category}
                            onChange={(e) =>
                              handleUpdateDraftItem(
                                line.id,
                                { material_category: e.target.value },
                                true
                              )
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                          >
                            {FIELD_MATERIAL_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-slate-400 font-mono mb-1">
                            Quantity *
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="any"
                            required
                            value={line.quantity}
                            onChange={(e) =>
                              handleUpdateDraftItem(line.id, { quantity: e.target.value })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-white font-mono font-bold text-xs focus:outline-none focus:border-cyan-500"
                          />
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[10px] text-slate-400 font-mono mb-1">
                            Unit *
                          </label>
                          <select
                            value={line.unit}
                            onChange={(e) =>
                              handleUpdateDraftItem(line.id, {
                                unit: e.target.value as FieldMaterialUnit,
                              })
                            }
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                          >
                            {FIELD_MATERIAL_UNITS.map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <input
                          type="text"
                          value={line.remarks}
                          onChange={(e) =>
                            handleUpdateDraftItem(line.id, { remarks: e.target.value })
                          }
                          placeholder="Item note (optional, e.g. 2-core drop wire pulled for @bzwaqas74)"
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shared Visit Remarks */}
              <div>
                <label className="block text-slate-300 font-bold mb-1">
                  Overall Visit Remarks (Optional)
                </label>
                <textarea
                  rows={2}
                  value={visitSharedRemarks}
                  onChange={(e) => setVisitSharedRemarks(e.target.value)}
                  placeholder="e.g. 1:8 splitter installed on Pole #14 and 85m 2-core drop wire pulled for @bzwaqas74"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSavingBatch}
                  onClick={() => setIsEntryModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingBatch}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-2 cursor-pointer transition shadow-lg shadow-emerald-950/50 disabled:opacity-50"
                >
                  {isSavingBatch ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to PostgreSQL...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>
                        Save {draftItems.length} {draftItems.length === 1 ? 'Item' : 'Items'} to Log
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Master Admin Edit Material Entry */}
      {editingLog && isMasterAdmin && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto font-sans animate-fadeIn">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-white text-sm">Edit Field Material Entry (Admin)</h3>
              </div>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => setEditingLog(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-3.5 text-xs">
              {editFormError && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-200 font-mono text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{editFormError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Action Type *</label>
                  <select
                    value={editActionType}
                    onChange={(e) => setEditActionType(e.target.value as FieldMaterialActionType)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-bold focus:outline-none focus:border-cyan-500"
                  >
                    {FIELD_MATERIAL_ACTION_TYPES.map((act) => (
                      <option key={act} value={act}>
                        {formatActionTypeMeta(act).label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Date &amp; Time</label>
                  <input
                    type="datetime-local"
                    value={editTimestampLocal}
                    onChange={(e) => setEditTimestampLocal(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 font-mono">
                <div className="sm:col-span-6">
                  <label className="block text-slate-400 text-[11px] mb-1">Material Category *</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {FIELD_MATERIAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    {!FIELD_MATERIAL_CATEGORIES.includes(editCategory as any) && (
                      <option value={editCategory}>{editCategory}</option>
                    )}
                  </select>
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-slate-400 text-[11px] mb-1">Quantity *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={editQuantity}
                    onChange={(e) => setEditQuantity(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-bold focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="block text-slate-400 text-[11px] mb-1">Unit *</label>
                  <select
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value as FieldMaterialUnit)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {FIELD_MATERIAL_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] font-mono mb-1">
                  Pole ID / FAT / Subscriber Location *
                </label>
                <input
                  type="text"
                  required
                  value={editPoleLocation}
                  onChange={(e) => setEditPoleLocation(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <AreaNodeSelector
                value={editCoverageArea}
                onChange={setEditCoverageArea}
                areas={networkAreas}
                onAreasUpdated={setNetworkAreas}
                label="Coverage Area / Node"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Technician / Staff</label>
                  <select
                    value={editStaffId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setEditStaffId(nextId);
                      const matched = staffList.find((s) => s.id === nextId);
                      if (matched) {
                        setEditPerformerName(matched.full_name || matched.username);
                        setEditPerformerRole(String(matched.role || 'AGENT').toUpperCase());
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Keep: {editPerformerName} ({editPerformerRole})</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} (@{s.username}) — {s.role}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 text-[11px] mb-1">Performer Name</label>
                  <input
                    type="text"
                    required
                    value={editPerformerName}
                    onChange={(e) => setEditPerformerName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 text-[11px] font-mono mb-1">Notes / Remarks</label>
                <textarea
                  rows={2}
                  value={editRemarks}
                  onChange={(e) => setEditRemarks(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => setEditingLog(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Master Admin Delete Confirmation */}
      {deletingLog && isMasterAdmin && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto font-sans animate-fadeIn">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-slate-900 border border-rose-800/80 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-950 border border-rose-800 text-rose-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-sm">Delete Field Material Entry?</h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    Permanent delete from PostgreSQL `field_material_logs`
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingLog(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {deleteError && (
                <div className="p-3 rounded-xl bg-rose-950/90 border border-rose-600 text-rose-200 font-mono text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{deleteError}</span>
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 font-mono text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Action:</span>
                  {renderActionBadge(deletingLog.action_type)}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Material &amp; Qty:</span>
                  <span className="font-bold text-white">
                    {deletingLog.quantity} {deletingLog.unit} — {deletingLog.material_category}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Pole / Location:</span>
                  <span className="text-cyan-300">
                    {deletingLog.pole_id_or_location} ({deletingLog.coverage_area})
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Performed By:</span>
                  <span className="text-slate-200">
                    {deletingLog.performed_by_name} ({deletingLog.performed_by_role})
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">Timestamp:</span>
                  <span className="text-slate-300">
                    {deletingLog.created_at ? new Date(deletingLog.created_at).toLocaleString() : '—'}
                  </span>
                </div>
                {deletingLog.remarks && (
                  <div className="pt-2 border-t border-slate-800">
                    <span className="text-slate-400 block mb-0.5">Notes:</span>
                    <span className="text-slate-200 font-sans">{deletingLog.remarks}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeletingLog(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold cursor-pointer transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm Delete</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FieldMaterialLogView;
