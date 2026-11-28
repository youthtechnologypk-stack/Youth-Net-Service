import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X,
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Search,
  CheckSquare,
  Square,
  Sparkles,
  Download,
  StopCircle,
  Loader2,
  Server,
  ShieldCheck,
  Users,
  Phone,
  MapPin,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import { fetchMikrotikPppSecrets } from '../services/mikrotikRestClient';
import {
  fetchConfiguredExpiryProfileName,
  fetchNetworkAreas,
  NetworkAreaNode,
} from '../lib/billingAndNetwork';
import {
  getCachedPackageTariffs,
  loadPackageTariffsFromSupabase,
} from '../lib/packageTariffs';
import {
  MikrotikAutoImportCandidate,
  MikrotikAutoImportResultRow,
  MikrotikAutoImportScanResult,
  buildAutoImportPayloads,
  classifyMikrotikSecretsForImport,
  downloadAutoImportResultsCsv,
} from '../lib/mikrotikAutoImport';
import { getStoredUser } from '../lib/auth';
import { isResellerUser } from '../lib/resellerEngine';
import { UserAccount } from '../types/auth';

export interface MikrotikAutoImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserAccount | null;
  onImportComplete?: () => void;
}

export const MIKROTIK_AUTO_IMPORT_COMPLETED_EVENT = 'youthnet:mikrotik-auto-import-completed';

export const MikrotikAutoImportModal: React.FC<MikrotikAutoImportModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onImportComplete,
}) => {
  const { routers, selectedRouterId } = useISP();
  const activeUser = currentUser || getStoredUser();
  const isReseller = isResellerUser(activeUser);
  const currentRouter = useMemo(
    () => (routers || []).find((r) => r.id === selectedRouterId) || (routers || [])[0] || null,
    [routers, selectedRouterId]
  );

  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<MikrotikAutoImportScanResult | null>(null);
  const [expiryProfileName, setExpiryProfileName] = useState<string>('EXPIRED-16-POOL');
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);

  // Selection & Filters
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'EXPIRED'>('ALL');
  const [billingCycleDay, setBillingCycleDay] = useState<number>(() => new Date().getDate());
  const [validityDays, setValidityDays] = useState<number>(31);
  const [defaultArea, setDefaultArea] = useState<string>('Baza Mohallah');

  // Batch Import Execution State
  const [isImporting, setIsImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressUsername, setProgressUsername] = useState('');
  const [executionResults, setExecutionResults] = useState<MikrotikAutoImportResultRow[]>([]);
  const cancelRef = useRef(false);

  const runLiveScan = useCallback(async () => {
    if (isReseller) {
      setScanError('Router-wide MikroTik secret auto-import is restricted to Master ISP Administrators.');
      return;
    }

    setIsScanning(true);
    setScanError(null);
    setImportDone(false);
    setExecutionResults([]);

    try {
      const [mkRes, portalUsersRes, expiryProf, tariffs, areas] = await Promise.all([
        fetchMikrotikPppSecrets(currentRouter || undefined),
        supabase.from('portal_users').select('id, username'),
        fetchConfiguredExpiryProfileName(),
        loadPackageTariffsFromSupabase().catch(() => getCachedPackageTariffs()),
        fetchNetworkAreas().catch(() => [] as NetworkAreaNode[]),
      ]);

      setExpiryProfileName(expiryProf);
      setNetworkAreas(areas);
      if (areas.length > 0 && !areas.some((a) => a.area_name === defaultArea)) {
        setDefaultArea(areas[0].area_name);
      }

      if (!mkRes.success) {
        setScanResult(null);
        setScanError(
          mkRes.error ||
            'Could not fetch live PPPoE secrets from MikroTik (/ppp/secret). Verify router connectivity and credentials.'
        );
        return;
      }

      const existingRows = Array.isArray(portalUsersRes.data)
        ? (portalUsersRes.data as Array<Pick<SupabasePortalUser, 'username'>>)
        : [];

      const classified = classifyMikrotikSecretsForImport({
        secrets: mkRes.secrets || [],
        existingPortalUsers: existingRows,
        expiryProfileName: expiryProf,
        tariffMap: tariffs,
        networkAreas: areas,
        defaultArea,
      });

      setScanResult(classified);
      // Select all non-system/test unlinked secrets by default (or all unlinked secrets, allowing admin to uncheck)
      setSelectedUsernames(new Set(classified.candidates.map((c) => c.username)));
    } catch (err: any) {
      setScanError(err?.message || 'Unexpected error while scanning MikroTik secrets.');
    } finally {
      setIsScanning(false);
    }
  }, [currentRouter, defaultArea, isReseller]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setStatusFilter('ALL');
      void runLiveScan();
    }
  }, [isOpen, runLiveScan]);

  const filteredCandidates = useMemo(() => {
    const list = scanResult?.candidates || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.username.toLowerCase().includes(q) ||
        c.fullName.toLowerCase().includes(q) ||
        c.phoneWhatsapp.toLowerCase().includes(q) ||
        c.profile.toLowerCase().includes(q) ||
        c.coverageArea.toLowerCase().includes(q) ||
        c.rawComment.toLowerCase().includes(q)
      );
    });
  }, [scanResult, searchQuery, statusFilter]);

  const selectedCount = selectedUsernames.size;

  const toggleOne = (username: string) => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      for (const c of filteredCandidates) next.add(c.username);
      return next;
    });
  };

  const handleUnselectAllFiltered = () => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      for (const c of filteredCandidates) next.delete(c.username);
      return next;
    });
  };

  const handleUnselectSystemSecrets = () => {
    if (!scanResult) return;
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      for (const c of scanResult.candidates) {
        if (c.isLikelySystemSecret) next.delete(c.username);
      }
      return next;
    });
  };

  const handleRunBatchCreate = async () => {
    if (isImporting || !scanResult || selectedCount === 0 || isReseller) return;

    const toImport = scanResult.candidates.filter((c) => selectedUsernames.has(c.username));
    if (toImport.length === 0) return;

    cancelRef.current = false;
    setIsImporting(true);
    setImportDone(false);
    setProgressTotal(toImport.length);
    setProgressCurrent(0);
    setExecutionResults([]);

    // Re-fetch latest portal usernames right before inserting to guarantee zero duplicates
    const { data: freshUsers } = await supabase.from('portal_users').select('username');
    const existingLower = new Set<string>(
      (freshUsers || []).map((u: any) => String(u?.username || '').trim().toLowerCase())
    );

    const results: MikrotikAutoImportResultRow[] = [];
    const CHUNK_SIZE = 10;

    for (let start = 0; start < toImport.length; start += CHUNK_SIZE) {
      if (cancelRef.current) break;

      const chunk = toImport.slice(start, start + CHUNK_SIZE);
      const chunkPrepared: Array<{
        candidate: MikrotikAutoImportCandidate;
        fullPayload: Record<string, any>;
        minimalPayload: Record<string, any>;
      }> = [];

      for (const cand of chunk) {
        if (existingLower.has(cand.username.toLowerCase())) {
          results.push({
            username: cand.username,
            fullName: cand.fullName,
            phoneWhatsapp: cand.phoneWhatsapp,
            profile: cand.profile,
            monthlyRate: cand.monthlyRate,
            status: cand.status,
            coverageArea: cand.coverageArea,
            outcome: 'SKIPPED_EXISTS',
            message: 'Already exists in portal_users',
          });
          continue;
        }
        const built = buildAutoImportPayloads(cand, {
          billingCycleDay,
          validityDays,
          createdById: activeUser?.id || null,
        });
        chunkPrepared.push({
          candidate: cand,
          fullPayload: built.fullPayload,
          minimalPayload: built.minimalPayload,
        });
      }

      if (chunkPrepared.length > 0) {
        setProgressUsername(chunkPrepared[0].candidate.username);

        // Attempt fast batch insert first
        const { error: batchErr } = await supabase
          .from('portal_users')
          .insert(chunkPrepared.map((item) => item.fullPayload));

        if (!batchErr) {
          for (const item of chunkPrepared) {
            existingLower.add(item.candidate.username.toLowerCase());
            results.push({
              username: item.candidate.username,
              fullName: item.candidate.fullName,
              phoneWhatsapp: item.candidate.phoneWhatsapp,
              profile: item.candidate.profile,
              monthlyRate: item.candidate.monthlyRate,
              status: item.candidate.status,
              coverageArea: item.candidate.coverageArea,
              outcome: 'CREATED',
              message: `Portal account created (${item.candidate.status})`,
            });
          }
        } else {
          // Schema-safe / row-level resilient fallback so one bad column or duplicate never blocks the rest
          for (const item of chunkPrepared) {
            if (cancelRef.current) break;
            setProgressUsername(item.candidate.username);

            const { error: fullSingleErr } = await supabase
              .from('portal_users')
              .insert(item.fullPayload);

            if (!fullSingleErr) {
              existingLower.add(item.candidate.username.toLowerCase());
              results.push({
                username: item.candidate.username,
                fullName: item.candidate.fullName,
                phoneWhatsapp: item.candidate.phoneWhatsapp,
                profile: item.candidate.profile,
                monthlyRate: item.candidate.monthlyRate,
                status: item.candidate.status,
                coverageArea: item.candidate.coverageArea,
                outcome: 'CREATED',
                message: `Portal account created (${item.candidate.status})`,
              });
              continue;
            }

            const { error: minSingleErr } = await supabase
              .from('portal_users')
              .insert(item.minimalPayload);

            if (!minSingleErr) {
              existingLower.add(item.candidate.username.toLowerCase());
              results.push({
                username: item.candidate.username,
                fullName: item.candidate.fullName,
                phoneWhatsapp: item.candidate.phoneWhatsapp,
                profile: item.candidate.profile,
                monthlyRate: item.candidate.monthlyRate,
                status: item.candidate.status,
                coverageArea: item.candidate.coverageArea,
                outcome: 'CREATED',
                message: 'Created (standard schema fallback)',
              });
            } else {
              const isDup = /duplicate|unique/i.test(minSingleErr.message || '');
              results.push({
                username: item.candidate.username,
                fullName: item.candidate.fullName,
                phoneWhatsapp: item.candidate.phoneWhatsapp,
                profile: item.candidate.profile,
                monthlyRate: item.candidate.monthlyRate,
                status: item.candidate.status,
                coverageArea: item.candidate.coverageArea,
                outcome: isDup ? 'SKIPPED_EXISTS' : 'FAILED',
                message: isDup
                  ? 'Already exists in portal_users'
                  : minSingleErr.message || fullSingleErr.message || 'Insert failed',
              });
            }
          }
        }
      }

      setProgressCurrent(Math.min(toImport.length, start + chunk.length));
      setExecutionResults([...results]);
    }

    setIsImporting(false);
    setImportDone(true);

    // Refresh parent views & broadcast event so open directories update immediately
    if (onImportComplete) onImportComplete();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(MIKROTIK_AUTO_IMPORT_COMPLETED_EVENT));
    }
  };

  if (!isOpen) return null;

  const createdCount = executionResults.filter((r) => r.outcome === 'CREATED').length;
  const skippedCount = executionResults.filter((r) => r.outcome === 'SKIPPED_EXISTS').length;
  const failedCount = executionResults.filter((r) => r.outcome === 'FAILED').length;
  const systemHintCount = (scanResult?.candidates || []).filter((c) => c.isLikelySystemSecret).length;
  const progressPct = progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[9995] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-2xl bg-[#0B1221] border border-slate-800 shadow-[0_24px_80px_rgba(2,6,23,0.85)] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-cyan-500/25 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-white tracking-tight">
                  1-Click Auto-Import from MikroTik PPPoE Secrets
                </h2>
                <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-[10px] font-mono font-bold">
                  /ppp/secret &rarr; Supabase
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">
                Router:{' '}
                <strong className="text-cyan-300 font-mono">
                  {currentRouter ? `${currentRouter.name} (${currentRouter.ipAddress})` : 'Active NAS Router'}
                </strong>{' '}
                &bull; Expiry Pool:{' '}
                <span className="text-amber-300 font-mono">{expiryProfileName}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void runLiveScan()}
              disabled={isScanning || isImporting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>Re-Scan Router</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isImporting) return;
                onClose();
              }}
              disabled={isImporting}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Scanning State */}
          {isScanning && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 bg-slate-950/60 rounded-2xl border border-slate-800">
              <Loader2 className="w-9 h-9 text-cyan-400 animate-spin" />
              <p className="text-sm font-bold text-white">
                Scanning Live MikroTik PPPoE Secrets (/ppp/secret)...
              </p>
              <p className="text-xs text-slate-400 font-mono max-w-md">
                Comparing every router secret against Supabase portal accounts, parsing phone comments, and matching package tariffs.
              </p>
            </div>
          )}

          {/* Error State */}
          {!isScanning && scanError && (
            <div className="p-5 rounded-xl bg-rose-950/40 border border-rose-700/60 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-2">
                <p className="text-sm font-bold text-rose-200">Unable to Scan MikroTik Router</p>
                <p className="text-xs text-rose-300/90 leading-relaxed">{scanError}</p>
                <button
                  type="button"
                  onClick={() => void runLiveScan()}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer transition"
                >
                  Retry Live Scan
                </button>
              </div>
            </div>
          )}

          {/* Preview Summary + Checklist */}
          {!isScanning && scanResult && (
            <>
              {/* 3 KPI Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                      Total MikroTik Secrets Found
                    </span>
                    <span className="text-2xl font-black font-mono tabular-nums text-cyan-300 mt-1 block">
                      {scanResult.totalSecrets.toLocaleString()}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-cyan-950/70 border border-cyan-800/60 flex items-center justify-center text-cyan-400">
                    <Server className="w-5 h-5" />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-900/50 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                      Already Linked in Portal
                    </span>
                    <span className="text-2xl font-black font-mono tabular-nums text-emerald-400 mt-1 block">
                      {scanResult.alreadyLinkedCount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      Skipped automatically (zero duplicates)
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-950/70 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-800/50 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                      New Unlinked Ready to Auto-Create
                    </span>
                    <span className="text-2xl font-black font-mono tabular-nums text-amber-300 mt-1 block">
                      {scanResult.candidates.length.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-cyan-400 font-mono">
                      {selectedCount.toLocaleString()} selected for batch creation
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-950/70 border border-amber-800/60 flex items-center justify-center text-amber-300">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Progress Banner during/after batch import */}
              {(isImporting || importDone) && (
                <div
                  className={`p-4 rounded-xl border space-y-3 ${
                    importDone
                      ? 'bg-emerald-950/35 border-emerald-600/50'
                      : 'bg-cyan-950/35 border-cyan-600/50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold">
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                          <span className="text-cyan-200">
                            Importing {progressCurrent} / {progressTotal} accounts... (@{progressUsername})
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-200">
                            Auto-Import Complete: {createdCount} Created · {skippedCount} Already Existed ·{' '}
                            {failedCount} Failed
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isImporting && (
                        <button
                          type="button"
                          onClick={() => {
                            cancelRef.current = true;
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-700 text-rose-200 text-xs font-bold cursor-pointer"
                        >
                          <StopCircle className="w-3.5 h-3.5" />
                          <span>Stop</span>
                        </button>
                      )}
                      {importDone && executionResults.length > 0 && (
                        <button
                          type="button"
                          onClick={() => downloadAutoImportResultsCsv(executionResults)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-xs font-bold cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download Results CSV</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-200 ${
                        importDone
                          ? 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                          : 'bg-gradient-to-r from-cyan-500 to-blue-500'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* All Already Synced Empty State */}
              {scanResult.candidates.length === 0 ? (
                <div className="py-12 px-6 text-center bg-slate-950/60 border border-emerald-800/40 rounded-2xl space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <h3 className="text-base font-bold text-white">
                    100% Synced — All {scanResult.totalSecrets} MikroTik Secrets Are Already in the Portal!
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Every active and expired PPPoE secret on this MikroTik router already has a matching subscriber portal account in Supabase.
                  </p>
                </div>
              ) : (
                <>
                  {/* Batch Defaults & Filter Controls */}
                  <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-1.5 text-slate-300 font-mono">
                        <span>Cycle Day:</span>
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={billingCycleDay}
                          disabled={isImporting}
                          onChange={(e) =>
                            setBillingCycleDay(
                              Math.max(1, Math.min(31, Number(e.target.value) || 1))
                            )
                          }
                          className="w-14 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 text-center font-bold focus:outline-none focus:border-cyan-500"
                        />
                      </label>

                      <label className="flex items-center gap-1.5 text-slate-300 font-mono">
                        <span>Active Validity:</span>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={validityDays}
                          disabled={isImporting}
                          onChange={(e) =>
                            setValidityDays(
                              Math.max(1, Math.min(365, Number(e.target.value) || 31))
                            )
                          }
                          className="w-16 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-emerald-300 text-center font-bold focus:outline-none focus:border-cyan-500"
                        />
                        <span className="text-slate-500">days</span>
                      </label>

                      <label className="flex items-center gap-1.5 text-slate-300 font-mono">
                        <span>Default Area:</span>
                        <select
                          value={defaultArea}
                          disabled={isImporting}
                          onChange={(e) => setDefaultArea(e.target.value)}
                          className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                          {networkAreas.length > 0 ? (
                            networkAreas.map((a) => (
                              <option key={a.id} value={a.area_name}>
                                {a.area_name}
                              </option>
                            ))
                          ) : (
                            <option value="Baza Mohallah">Baza Mohallah</option>
                          )}
                        </select>
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                      >
                        <option value="ALL">All Status ({scanResult.candidates.length})</option>
                        <option value="ACTIVE">
                          Active ({scanResult.candidates.filter((c) => c.status === 'ACTIVE').length})
                        </option>
                        <option value="EXPIRED">
                          Expired ({scanResult.candidates.filter((c) => c.status === 'EXPIRED').length})
                        </option>
                      </select>

                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Filter username, comment, profile..."
                          className="w-56 pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 text-xs font-mono focus:outline-none focus:border-cyan-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Selection Quick Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        disabled={isImporting}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 font-semibold cursor-pointer transition"
                      >
                        Select All Shown ({filteredCandidates.length})
                      </button>
                      <button
                        type="button"
                        onClick={handleUnselectAllFiltered}
                        disabled={isImporting}
                        className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold cursor-pointer transition"
                      >
                        Unselect All Shown
                      </button>
                      {systemHintCount > 0 && (
                        <button
                          type="button"
                          onClick={handleUnselectSystemSecrets}
                          disabled={isImporting}
                          className="px-2.5 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/70 border border-amber-700/60 text-amber-300 font-semibold cursor-pointer transition"
                        >
                          Uncheck Test/Guest Accounts ({systemHintCount})
                        </button>
                      )}
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      Showing {filteredCandidates.length} of {scanResult.candidates.length} unlinked secrets
                    </span>
                  </div>

                  {/* Selectable Checklist Table */}
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 overflow-hidden">
                    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800 text-[10px] font-mono uppercase tracking-wider text-slate-400">
                          <tr>
                            <th className="py-2.5 px-3 w-10 text-center">Import</th>
                            <th className="py-2.5 px-3">PPPoE Username</th>
                            <th className="py-2.5 px-3">Parsed Full Name &amp; Comment</th>
                            <th className="py-2.5 px-3">Phone / WhatsApp</th>
                            <th className="py-2.5 px-3">Profile &amp; Tariff</th>
                            <th className="py-2.5 px-3">Area</th>
                            <th className="py-2.5 px-3">Portal Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {filteredCandidates.map((cand) => {
                            const isChecked = selectedUsernames.has(cand.username);
                            return (
                              <tr
                                key={cand.username}
                                onClick={() => !isImporting && toggleOne(cand.username)}
                                className={`transition cursor-pointer ${
                                  isChecked
                                    ? 'bg-cyan-950/20 hover:bg-cyan-950/35'
                                    : 'opacity-55 hover:bg-slate-900/60'
                                }`}
                              >
                                <td className="py-2.5 px-3 text-center">
                                  {isChecked ? (
                                    <CheckSquare className="w-4 h-4 text-cyan-400 inline" />
                                  ) : (
                                    <Square className="w-4 h-4 text-slate-600 inline" />
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-white">{cand.username}</span>
                                    {cand.isLikelySystemSecret && (
                                      <span className="px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-700/60 text-amber-300 text-[9px] font-bold">
                                        System/Test?
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-500">
                                    Pass: {cand.password ? '••••••' : 'default'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <div className="font-semibold text-slate-100">{cand.fullName}</div>
                                  {cand.rawComment && (
                                    <div
                                      className="text-[10px] text-slate-500 font-mono truncate max-w-[210px]"
                                      title={cand.rawComment}
                                    >
                                      Comment: {cand.rawComment}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  {cand.phoneWhatsapp ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-300">
                                      <Phone className="w-3 h-3 text-emerald-400" />
                                      {cand.phoneWhatsapp}
                                    </span>
                                  ) : (
                                    <span className="text-slate-600">No phone in comment</span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <div className="text-cyan-300 font-bold">{cand.profile}</div>
                                  <div className="text-[10px] text-slate-400">
                                    {cand.monthlyRate > 0
                                      ? `Rs. ${cand.monthlyRate.toLocaleString()}/mo`
                                      : 'Rs. 0 (Expiry Pool / Unmapped)'}
                                  </div>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className="inline-flex items-center gap-1 text-slate-300">
                                    <MapPin className="w-3 h-3 text-sky-400 shrink-0" />
                                    {cand.coverageArea}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 font-mono">
                                  <span
                                    className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${
                                      cand.status === 'ACTIVE'
                                        ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60'
                                        : 'bg-rose-950/70 text-rose-300 border-rose-700/60'
                                    }`}
                                  >
                                    {cand.status}
                                  </span>
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    {cand.statusReason}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] font-mono text-slate-400">
            Creates <strong className="text-slate-200">CLIENT</strong> Self-Service Portal accounts in Supabase matching exact MikroTik usernames &amp; passwords.
          </p>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition cursor-pointer disabled:opacity-50"
            >
              {importDone ? 'Done & Close' : 'Cancel'}
            </button>

            {scanResult && scanResult.candidates.length > 0 && !importDone && (
              <button
                type="button"
                onClick={() => void handleRunBatchCreate()}
                disabled={isImporting || selectedCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 text-xs font-extrabold shadow-lg shadow-emerald-950/50 transition cursor-pointer disabled:opacity-40"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>
                      Importing {progressCurrent} / {progressTotal}...
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Create All Missing Accounts ({selectedCount})</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MikrotikAutoImportModal;
