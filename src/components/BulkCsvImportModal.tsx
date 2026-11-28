import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Loader2,
  FileSpreadsheet,
  RefreshCw,
  MessageSquare,
  Server,
  Play,
  StopCircle,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';
import {
  fetchMikrotikPppSecrets,
  provisionPppoeSecretRest,
} from '../services/mikrotikRestClient';
import {
  fetchConfiguredExpiryProfileName,
} from '../lib/billingAndNetwork';
import {
  getCachedPackageTariffs,
  loadPackageTariffsFromSupabase,
} from '../lib/packageTariffs';
import {
  BulkImportExecutionResultRow,
  MAX_BULK_CSV_BYTES,
  MikrotikExistingSecretLite,
  ParsedBulkSubscriberRow,
  downloadBulkCsvTemplate,
  downloadBulkImportResultsCsv,
  parseAndValidateBulkCsv,
} from '../lib/bulkSubscriberCsv';
import {
  getResellerTier,
  isResellerUser,
} from '../lib/resellerEngine';
import { getStoredUser } from '../lib/auth';
import { getPortalUrlForRole } from '../services/authUtils';
import { sendWhatsAppCredentialsViaGateway } from '../lib/whatsappRouting';
import { UserAccount } from '../types/auth';

export interface BulkCsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserAccount | null;
  onImportComplete?: (summary: { created: number; autoLinked: number; failed: number }) => void;
}

function addDaysYmd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const BulkCsvImportModal: React.FC<BulkCsvImportModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onImportComplete,
}) => {
  const { routers, selectedRouterId, profilePriceMap } = useISP();
  const activeRouter = useMemo(
    () => (routers || []).find((r) => r.id === selectedRouterId) || (routers || [])[0] || null,
    [routers, selectedRouterId]
  );

  const actor = currentUser || getStoredUser();
  const isResellerSession = isResellerUser(actor);
  const actorTier = getResellerTier(actor);

  const [mikrotikSecretsMap, setMikrotikSecretsMap] = useState<
    Map<string, MikrotikExistingSecretLite>
  >(() => new Map());
  const [isScanningMikrotik, setIsScanningMikrotik] = useState(false);
  const [mikrotikScanNote, setMikrotikScanNote] = useState<string>('');
  const [expiryProfileName, setExpiryProfileName] = useState<string>('EXPIRED-POOL');
  const [resellersList, setResellersList] = useState<SupabasePortalUser[]>([]);
  const [tariffMap, setTariffMap] = useState<Record<string, number>>(() => ({
    ...getCachedPackageTariffs(),
    ...(profilePriceMap || {}),
  }));

  const [uploadedFilename, setUploadedFilename] = useState<string>('');
  const [rawCsvText, setRawCsvText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewFilter, setPreviewFilter] = useState<'ALL' | 'VALID' | 'AUTO_LINK' | 'INVALID'>('ALL');

  // Execution toggles
  const [syncNewSecretsToMikrotik, setSyncNewSecretsToMikrotik] = useState<boolean>(true);
  const [autoSendWelcomeWhatsApp, setAutoSendWelcomeWhatsApp] = useState<boolean>(false);

  // Import execution progress
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [progressCurrent, setProgressCurrent] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(0);
  const [progressCurrentUser, setProgressCurrentUser] = useState<string>('');
  const [executionResults, setExecutionResults] = useState<BulkImportExecutionResultRow[]>([]);
  const [importCompleted, setImportCompleted] = useState<boolean>(false);
  const cancelRequestedRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const scanMikrotikAndReferenceData = async () => {
    setIsScanningMikrotik(true);
    setMikrotikScanNote('');
    try {
      const [secretsRes, expProfile, tariffs, resellersRes] = await Promise.all([
        activeRouter
          ? fetchMikrotikPppSecrets(activeRouter).catch(() => ({
              success: false,
              secrets: [],
              error: 'Router unreachable',
            }))
          : Promise.resolve({ success: false, secrets: [], error: 'No router selected' }),
        fetchConfiguredExpiryProfileName().catch(() => 'EXPIRED-POOL'),
        loadPackageTariffsFromSupabase().catch(() => getCachedPackageTariffs()),
        supabase
          .from('portal_users')
          .select('*')
          .in('role', ['DEALER', 'SUB_DEALER']),
      ]);

      setExpiryProfileName(expProfile || 'EXPIRED-POOL');
      setTariffMap({ ...tariffs, ...(profilePriceMap || {}) });

      if (Array.isArray(resellersRes.data)) {
        setResellersList(resellersRes.data as SupabasePortalUser[]);
      }

      const map = new Map<string, MikrotikExistingSecretLite>();
      if (secretsRes.success && Array.isArray(secretsRes.secrets)) {
        for (const sec of secretsRes.secrets as any[]) {
          const uname = String(sec.name || sec.username || '').trim();
          if (!uname) continue;
          map.set(uname.toLowerCase(), {
            username: uname,
            password: sec.password ? String(sec.password) : undefined,
            profile: sec.profile ? String(sec.profile) : undefined,
            comment: sec.comment ? String(sec.comment) : undefined,
            remoteAddress: sec['remote-address'] || sec.remoteAddress || undefined,
          });
        }
        setMikrotikScanNote(
          `Synced ${map.size} live PPPoE secrets from ${activeRouter?.name || 'MikroTik'} for Smart Auto-Link.`
        );
      } else {
        setMikrotikScanNote(
          activeRouter
            ? `Router ${activeRouter.name} offline/unreachable — new secrets can still be saved to Supabase.`
            : 'No active MikroTik router configured — importing directly to Supabase.'
        );
      }
      setMikrotikSecretsMap(map);
    } finally {
      setIsScanningMikrotik(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    cancelRequestedRef.current = false;
    void scanMikrotikAndReferenceData();
  }, [isOpen, activeRouter?.id]);

  // Live validation whenever CSV text or MikroTik secrets change
  const validationOutput = useMemo(() => {
    if (!rawCsvText.trim()) {
      return { rows: [] as ParsedBulkSubscriberRow[], headerError: undefined };
    }
    return parseAndValidateBulkCsv({
      csvText: rawCsvText,
      mikrotikSecretsMap,
      resellersList,
      tariffMap,
      defaultArea: actor?.area && actor.area !== 'Central NOC Core' ? actor.area : 'Baza Mohallah',
    });
  }, [rawCsvText, mikrotikSecretsMap, resellersList, tariffMap, actor?.area]);

  const parsedRows = validationOutput.rows;

  const counts = useMemo(() => {
    let valid = 0;
    let autoLink = 0;
    let invalid = 0;
    for (const r of parsedRows) {
      if (r.validationStatus === 'VALID') valid++;
      else if (r.validationStatus === 'AUTO_LINK') autoLink++;
      else invalid++;
    }
    return {
      total: parsedRows.length,
      valid,
      autoLink,
      invalid,
      importable: valid + autoLink,
    };
  }, [parsedRows]);

  const displayedPreviewRows = useMemo(() => {
    if (previewFilter === 'ALL') return parsedRows;
    return parsedRows.filter((r) => r.validationStatus === previewFilter);
  }, [parsedRows, previewFilter]);

  const handleFilePicked = (file: File | null | undefined) => {
    if (!file) return;
    setParseError(null);
    setImportCompleted(false);
    setExecutionResults([]);

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv' && file.type !== 'application/vnd.ms-excel') {
      setParseError('Please upload a valid .csv file.');
      return;
    }
    if (file.size > MAX_BULK_CSV_BYTES) {
      setParseError('CSV file exceeds 5 MB limit. Split into smaller batches and retry.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setUploadedFilename(file.name);
      setRawCsvText(text);
    };
    reader.onerror = () => {
      setParseError('Could not read the selected CSV file.');
    };
    reader.readAsText(file);
  };

  const upsertSubscriberInSupabase = async (
    row: ParsedBulkSubscriberRow,
    finalStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED'
  ): Promise<{ ok: boolean; error?: string; userId?: string }> => {
    const nowIso = new Date().toISOString();
    const expiryYmd = finalStatus === 'ACTIVE' ? addDaysYmd(31) : addDaysYmd(0);
    const derivedDealerId = isResellerSession
      ? actorTier === 'DEALER'
        ? actor?.id || null
        : actor?.parent_dealer_id || null
      : row.resolvedDealerId;
    const derivedSubDealerId = isResellerSession
      ? actorTier === 'SUB_DEALER'
        ? actor?.id || null
        : null
      : row.resolvedSubDealerId;

    // Check if user already exists in portal_users by username (case-insensitive)
    const { data: existingRow } = await supabase
      .from('portal_users')
      .select('id, username')
      .ilike('username', row.pppoe_username)
      .maybeSingle();

    const fullPayload: Record<string, any> = {
      username: row.pppoe_username,
      password: row.pppoe_password,
      role: 'CLIENT',
      full_name: row.full_name,
      phone: row.phone_whatsapp || '+92 ',
      area: row.coverage_area || 'Baza Mohallah',
      address: row.address || null,
      account_status: finalStatus,
      billing_status: finalStatus === 'ACTIVE' ? 'ACTIVE' : 'SUSPENDED_EXPIRED',
      is_suspended: finalStatus !== 'ACTIVE',
      package_speed: row.package_profile,
      package_name: row.package_profile,
      package_profile_name: row.package_profile,
      original_package_profile: row.package_profile,
      monthly_fee: row.resolvedMonthlyRate,
      billing_anchor_day: row.billing_cycle_day,
      expiry_date: expiryYmd,
      next_billing_date: expiryYmd,
      dealer_id: derivedDealerId,
      sub_dealer_id: derivedSubDealerId,
      created_by_id: actor?.id || null,
    };

    const minimalPayload: Record<string, any> = {
      username: row.pppoe_username,
      password: row.pppoe_password,
      role: 'CLIENT',
      full_name: row.full_name,
      phone: row.phone_whatsapp || '+92 ',
      area: row.coverage_area || 'Baza Mohallah',
      account_status: finalStatus,
      package_speed: row.package_profile,
      monthly_fee: row.resolvedMonthlyRate,
    };

    if (existingRow?.id) {
      const { error: updErr } = await supabase
        .from('portal_users')
        .update(fullPayload)
        .eq('id', existingRow.id);
      if (!updErr) return { ok: true, userId: existingRow.id };

      // Schema-safe fallback if optional columns are missing
      const { error: fallbackErr } = await supabase
        .from('portal_users')
        .update(minimalPayload)
        .eq('id', existingRow.id);
      if (!fallbackErr) return { ok: true, userId: existingRow.id };
      return { ok: false, error: fallbackErr.message || updErr.message };
    }

    const newId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { error: insErr } = await supabase
      .from('portal_users')
      .insert({ id: newId, created_at: nowIso, ...fullPayload });
    if (!insErr) return { ok: true, userId: newId };

    const { error: fallbackInsErr } = await supabase
      .from('portal_users')
      .insert({ id: newId, created_at: nowIso, ...minimalPayload });
    if (!fallbackInsErr) return { ok: true, userId: newId };

    return { ok: false, error: fallbackInsErr.message || insErr.message };
  };

  const handleRunBulkImport = async () => {
    if (isImporting || counts.importable === 0) return;
    cancelRequestedRef.current = false;
    setIsImporting(true);
    setImportCompleted(false);
    setExecutionResults([]);

    const importableRows = parsedRows.filter((r) => r.validationStatus !== 'INVALID');
    const invalidResults: BulkImportExecutionResultRow[] = parsedRows
      .filter((r) => r.validationStatus === 'INVALID')
      .map((r) => ({
        rowNumber: r.rowNumber,
        pppoe_username: r.pppoe_username || '(missing)',
        full_name: r.full_name || '(missing)',
        package_profile: r.package_profile,
        monthly_rate: r.resolvedMonthlyRate,
        mode: 'SKIPPED_INVALID',
        mikrotik_status: 'Skipped',
        supabase_status: 'Skipped',
        whatsapp_status: 'Skipped',
        message: r.validationReason,
      }));

    setProgressTotal(importableRows.length);
    setProgressCurrent(0);

    const results: BulkImportExecutionResultRow[] = [...invalidResults];
    let createdCount = 0;
    let autoLinkedCount = 0;
    let failedCount = 0;
    let whatsappSentCount = 0;

    for (let i = 0; i < importableRows.length; i++) {
      if (cancelRequestedRef.current) break;

      const row = importableRows[i];
      setProgressCurrent(i + 1);
      setProgressCurrentUser(row.pppoe_username);

      const isAutoLink = row.validationStatus === 'AUTO_LINK';
      let mkStatus = 'Not synced';
      let sbStatus = 'Pending';
      let waStatus = 'Disabled';
      let detailMsg = '';

      try {
        // 1. MikroTik Smart Auto-Link or Provision to Expiry Pool
        if (isAutoLink) {
          mkStatus = `Auto-Linked (${row.mikrotikMatch?.profile || row.package_profile})`;
          detailMsg = `Linked existing MikroTik secret "${row.pppoe_username}"`;
        } else if (syncNewSecretsToMikrotik && activeRouter) {
          const initialMkProfile =
            row.initial_status === 'ACTIVE' ? row.package_profile : expiryProfileName;
          const mkRes = await provisionPppoeSecretRest(activeRouter, {
            name: row.pppoe_username,
            password: row.pppoe_password,
            service: 'pppoe',
            profile: initialMkProfile,
            comment: `${row.full_name} | ${row.phone_whatsapp || 'N/A'} | ${row.coverage_area}`,
          });

          if (mkRes.success) {
            mkStatus = `Created on ${activeRouter.name} (${initialMkProfile})`;
          } else {
            const errLower = String(mkRes.error || '').toLowerCase();
            if (errLower.includes('already') || errLower.includes('exist')) {
              mkStatus = 'Auto-Linked (Already existed on router)';
            } else {
              mkStatus = `MikroTik Error: ${mkRes.error || 'Unreachable'}`;
            }
          }
        } else {
          mkStatus = 'Skipped (Sync toggle off)';
        }

        // 2. Upsert subscriber into Supabase portal_users
        const finalStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' =
          isAutoLink
            ? row.initial_status
            : syncNewSecretsToMikrotik && row.initial_status !== 'ACTIVE'
            ? 'EXPIRED'
            : row.initial_status;

        const sbRes = await upsertSubscriberInSupabase(row, finalStatus);
        if (!sbRes.ok) {
          sbStatus = `Failed: ${sbRes.error || 'DB error'}`;
          failedCount++;
          results.push({
            rowNumber: row.rowNumber,
            pppoe_username: row.pppoe_username,
            full_name: row.full_name,
            package_profile: row.package_profile,
            monthly_rate: row.resolvedMonthlyRate,
            mode: 'FAILED',
            mikrotik_status: mkStatus,
            supabase_status: sbStatus,
            whatsapp_status: 'Skipped',
            message: sbRes.error || 'Database upsert failed',
          });
          setExecutionResults([...results]);
          continue;
        }

        sbStatus = isAutoLink ? 'Upserted & Linked' : 'Inserted';
        if (isAutoLink) autoLinkedCount++;
        else createdCount++;

        // 3. Optional Auto-Send Welcome WhatsApp (Throttled 3s)
        if (autoSendWelcomeWhatsApp) {
          if (!row.phone_whatsapp || row.phone_whatsapp.replace(/\D/g, '').length < 10) {
            waStatus = 'Skipped (No valid phone)';
          } else {
            if (whatsappSentCount > 0) {
              // 3-second anti-ban throttle between consecutive WhatsApp dispatches
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            if (cancelRequestedRef.current) break;

            const waRes = await sendWhatsAppCredentialsViaGateway({
              phone: row.phone_whatsapp,
              fullName: row.full_name,
              username: row.pppoe_username,
              password: row.pppoe_password,
              role: 'CLIENT',
              portalUrl: getPortalUrlForRole('CLIENT'),
              subscriber: {
                id: sbRes.userId,
                username: row.pppoe_username,
                full_name: row.full_name,
                phone: row.phone_whatsapp,
                dealer_id: row.resolvedDealerId || undefined,
              },
            }).catch((e: any) => ({ ok: false, errorMessage: e?.message || 'WhatsApp dispatch failed' }));

            whatsappSentCount++;
            waStatus = waRes.ok ? 'Sent' : `Failed (${(waRes as any).errorMessage || 'Gateway offline'})`;
          }
        }

        results.push({
          rowNumber: row.rowNumber,
          pppoe_username: row.pppoe_username,
          full_name: row.full_name,
          package_profile: row.package_profile,
          monthly_rate: row.resolvedMonthlyRate,
          mode: isAutoLink ? 'AUTO_LINKED' : 'CREATED_NEW',
          mikrotik_status: mkStatus,
          supabase_status: sbStatus,
          whatsapp_status: waStatus,
          message: detailMsg || `Tariff Rs. ${row.resolvedMonthlyRate.toLocaleString()}/mo saved`,
        });
      } catch (err: any) {
        failedCount++;
        results.push({
          rowNumber: row.rowNumber,
          pppoe_username: row.pppoe_username,
          full_name: row.full_name,
          package_profile: row.package_profile,
          monthly_rate: row.resolvedMonthlyRate,
          mode: 'FAILED',
          mikrotik_status: mkStatus,
          supabase_status: 'Error',
          whatsapp_status: waStatus,
          message: err?.message || 'Unexpected import error',
        });
      }

      setExecutionResults([...results]);
    }

    setIsImporting(false);
    setImportCompleted(true);
    if (onImportComplete) {
      onImportComplete({
        created: createdCount,
        autoLinked: autoLinkedCount,
        failed: failedCount,
      });
    }
  };

  if (!isOpen) return null;

  const progressPct =
    progressTotal > 0 ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="w-full max-w-6xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white truncate">
                Bulk CSV Account Creation &amp; Smart MikroTik Auto-Link
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Import subscribers in batch — existing MikroTik secrets auto-link seamlessly without skipping
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (isImporting) {
                cancelRequestedRef.current = true;
              }
              onClose();
            }}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Close Bulk Import"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Top Action Strip: Template Download + MikroTik Scan Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
            <div className="lg:col-span-7 flex items-start gap-2.5 text-xs">
              <Server className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-semibold text-slate-200 flex items-center gap-2">
                  <span>
                    Active Router: {activeRouter ? `${activeRouter.name} (${activeRouter.ipAddress})` : 'None Selected'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void scanMikrotikAndReferenceData()}
                    disabled={isScanningMikrotik || isImporting}
                    className="inline-flex items-center gap-1 text-[11px] font-mono text-cyan-400 hover:text-cyan-300 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanningMikrotik ? 'animate-spin' : ''}`} />
                    <span>{isScanningMikrotik ? 'Scanning...' : 'Re-Scan Secrets'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  {mikrotikScanNote || 'Preparing MikroTik secret lookup map...'}
                </p>
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-wrap items-center lg:justify-end gap-2">
              <button
                type="button"
                onClick={downloadBulkCsvTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold transition cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download Sample CSV Template</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold transition cursor-pointer whitespace-nowrap disabled:opacity-50"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadedFilename ? 'Change CSV File' : 'Upload .CSV File'}</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  handleFilePicked(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {/* Drag-and-Drop Upload Zone when no file loaded yet */}
          {!rawCsvText && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFilePicked(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-cyan-500/70 bg-slate-950/60 rounded-xl p-8 text-center cursor-pointer transition space-y-2.5"
            >
              <Upload className="w-8 h-8 text-cyan-400 mx-auto" />
              <div className="text-sm font-bold text-white">
                Drop your subscriber CSV file here, or click to browse
              </div>
              <p className="text-xs text-slate-400 max-w-xl mx-auto">
                Expected columns:{' '}
                <code className="text-cyan-300 font-mono text-[11px]">
                  full_name, pppoe_username, pppoe_password, phone_whatsapp, package_profile, coverage_area, address, dealer_username, billing_cycle_day, initial_status
                </code>
              </p>
            </div>
          )}

          {(parseError || validationOutput.headerError) && (
            <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-700/70 text-rose-200 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{parseError || validationOutput.headerError}</span>
            </div>
          )}

          {/* Execution Toggles + Summary KPIs when CSV is loaded */}
          {parsedRows.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono tabular-nums">
                <button
                  type="button"
                  onClick={() => setPreviewFilter('ALL')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    previewFilter === 'ALL'
                      ? 'bg-slate-800 border-cyan-500/70'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span className="text-[11px] text-slate-400 block">Total CSV Rows</span>
                  <span className="text-xl font-bold text-white">{counts.total}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFilter('VALID')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    previewFilter === 'VALID'
                      ? 'bg-emerald-950/70 border-emerald-500/70'
                      : 'bg-slate-950 border-slate-800 hover:border-emerald-800'
                  }`}
                >
                  <span className="text-[11px] text-emerald-400 block">Valid (New Secrets)</span>
                  <span className="text-xl font-bold text-emerald-300">{counts.valid}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFilter('AUTO_LINK')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    previewFilter === 'AUTO_LINK'
                      ? 'bg-cyan-950/70 border-cyan-500/70'
                      : 'bg-slate-950 border-slate-800 hover:border-cyan-800'
                  }`}
                >
                  <span className="text-[11px] text-cyan-400 block">Already on MikroTik (Auto-Link)</span>
                  <span className="text-xl font-bold text-cyan-300">{counts.autoLink}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFilter('INVALID')}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer ${
                    previewFilter === 'INVALID'
                      ? 'bg-rose-950/70 border-rose-500/70'
                      : 'bg-slate-950 border-slate-800 hover:border-rose-800'
                  }`}
                >
                  <span className="text-[11px] text-rose-400 block">Invalid (Will Skip)</span>
                  <span className="text-xl font-bold text-rose-300">{counts.invalid}</span>
                </button>
              </div>

              {/* Provisioning & WhatsApp Toggles */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-cyan-700/60 transition">
                  <input
                    type="checkbox"
                    checked={syncNewSecretsToMikrotik}
                    onChange={(e) => setSyncNewSecretsToMikrotik(e.target.checked)}
                    disabled={isImporting}
                    className="mt-0.5 rounded border-slate-600 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white block">
                      Sync New Secrets to MikroTik (Default Expiry Pool: {expiryProfileName})
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Creates PPPoE secrets for brand-new accounts on {activeRouter?.name || 'active router'}. Existing MikroTik secrets always Auto-Link safely.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer hover:border-emerald-700/60 transition">
                  <input
                    type="checkbox"
                    checked={autoSendWelcomeWhatsApp}
                    onChange={(e) => setAutoSendWelcomeWhatsApp(e.target.checked)}
                    disabled={isImporting}
                    className="mt-0.5 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Auto-Send Welcome WhatsApp (Throttled 3s)</span>
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Sends portal login credentials via connected WhatsApp gateway with a 3-second safety delay per subscriber.
                    </span>
                  </div>
                </label>
              </div>

              {/* Progress Bar during / after Execution */}
              {(isImporting || importCompleted) && (
                <div className="p-4 rounded-xl bg-slate-950 border border-cyan-800/60 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                    <div className="flex items-center gap-2 text-cyan-300 font-bold">
                      {isImporting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                          <span>
                            Creating {progressCurrent} / {progressTotal}... (@{progressCurrentUser})
                          </span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-300">
                            Import Complete: {executionResults.filter((r) => r.mode === 'CREATED_NEW').length} Created ·{' '}
                            {executionResults.filter((r) => r.mode === 'AUTO_LINKED').length} Auto-Linked ·{' '}
                            {executionResults.filter((r) => r.mode === 'FAILED' || r.mode === 'SKIPPED_INVALID').length} Failed/Skipped
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-slate-300 font-bold tabular-nums">{progressPct}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Live Validation Preview Table (or Execution Results Table once finished) */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-200">
                    {importCompleted
                      ? `Import Execution Results (${executionResults.length} rows)`
                      : `Live Validation Preview — ${uploadedFilename} (${displayedPreviewRows.length} shown)`}
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Tariffs auto-matched from System Package Pricing
                  </span>
                </div>

                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  {importCompleted ? (
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 text-[11px] border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Row</th>
                          <th className="py-2 px-3">PPPoE User</th>
                          <th className="py-2 px-3">Mode</th>
                          <th className="py-2 px-3">MikroTik</th>
                          <th className="py-2 px-3">Supabase</th>
                          <th className="py-2 px-3">WhatsApp</th>
                          <th className="py-2 px-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {executionResults.map((res) => (
                          <tr key={`${res.rowNumber}-${res.pppoe_username}`} className="hover:bg-slate-900/60">
                            <td className="py-2 px-3 text-slate-500">#{res.rowNumber}</td>
                            <td className="py-2 px-3 text-white font-bold">@{res.pppoe_username}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`font-bold ${
                                  res.mode === 'AUTO_LINKED'
                                    ? 'text-cyan-400'
                                    : res.mode === 'CREATED_NEW'
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {res.mode}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-300">{res.mikrotik_status}</td>
                            <td className="py-2 px-3 text-slate-300">{res.supabase_status}</td>
                            <td className="py-2 px-3 text-slate-400">{res.whatsapp_status}</td>
                            <td className="py-2 px-3 text-slate-400 font-sans">{res.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-900 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Row</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Full Name</th>
                          <th className="py-2 px-3">PPPoE Username</th>
                          <th className="py-2 px-3">Package &amp; Rate</th>
                          <th className="py-2 px-3">Area / Day</th>
                          <th className="py-2 px-3">Validation Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80">
                        {displayedPreviewRows.map((row) => (
                          <tr
                            key={`${row.rowNumber}-${row.pppoe_username}`}
                            className={
                              row.validationStatus === 'INVALID'
                                ? 'bg-rose-950/20'
                                : row.validationStatus === 'AUTO_LINK'
                                ? 'bg-cyan-950/15'
                                : 'hover:bg-slate-900/60'
                            }
                          >
                            <td className="py-2 px-3 font-mono text-slate-500">#{row.rowNumber}</td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {row.validationStatus === 'VALID' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/70 text-[10px] font-mono font-bold">
                                  <CheckCircle2 className="w-3 h-3" />
                                  VALID
                                </span>
                              )}
                              {row.validationStatus === 'AUTO_LINK' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-600/70 text-[10px] font-mono font-bold">
                                  <Link2 className="w-3 h-3" />
                                  Auto-Link
                                </span>
                              )}
                              {row.validationStatus === 'INVALID' && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700/70 text-[10px] font-mono font-bold">
                                  <AlertTriangle className="w-3 h-3" />
                                  INVALID
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-white font-medium">{row.full_name || '—'}</td>
                            <td className="py-2 px-3 font-mono text-cyan-300">
                              {row.pppoe_username ? `@${row.pppoe_username}` : '—'}
                            </td>
                            <td className="py-2 px-3 font-mono tabular-nums text-slate-200 whitespace-nowrap">
                              {row.package_profile} ·{' '}
                              <span className="text-emerald-400">
                                Rs. {row.resolvedMonthlyRate.toLocaleString()}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                              {row.coverage_area} · Day {row.billing_cycle_day}
                            </td>
                            <td
                              className={`py-2 px-3 text-[11px] ${
                                row.validationStatus === 'INVALID'
                                  ? 'text-rose-300'
                                  : row.validationStatus === 'AUTO_LINK'
                                  ? 'text-cyan-300'
                                  : 'text-slate-400'
                              }`}
                            >
                              {row.validationReason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-400 font-mono">
            {parsedRows.length > 0
              ? `${counts.importable} ready (${counts.valid} new + ${counts.autoLink} Auto-Link)`
              : 'Upload a CSV file to preview and validate accounts'}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {importCompleted && executionResults.length > 0 && (
              <button
                type="button"
                onClick={() => downloadBulkImportResultsCsv(executionResults)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Import Results CSV</span>
              </button>
            )}

            {isImporting ? (
              <button
                type="button"
                onClick={() => {
                  cancelRequestedRef.current = true;
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition cursor-pointer"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Stop Batch</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  {importCompleted ? 'Done & Close' : 'Cancel'}
                </button>
                {!importCompleted && (
                  <button
                    type="button"
                    onClick={() => void handleRunBulkImport()}
                    disabled={counts.importable === 0 || isScanningMikrotik}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition cursor-pointer disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Import {counts.importable} Subscriber{counts.importable === 1 ? '' : 's'}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BulkCsvImportModal;
