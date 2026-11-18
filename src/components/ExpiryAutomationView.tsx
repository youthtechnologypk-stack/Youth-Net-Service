import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  DollarSign,
  Edit2,
  FastForward,
  History,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  ShieldAlert,
  Sliders,
  Timer,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';
import {
  supabase,
  SupabaseExpiryAuditLog,
  SupabaseInvoice,
  SupabaseIspBillingSettings,
  SupabasePortalUser,
  SupabaseWhatsappReminderLog,
} from '../services/supabaseClient';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import { getActiveRouterAuth, resolveRestHostAndPort } from '../services/apiClient';
import {
  restoreSubscriberOnInvoicePaid,
  addCalendarMonthDateString,
  syncMikrotikSecretProfile,
  kickMikrotikActiveSessionForUser,
  triggerAutoExpirySweep,
  syncProfilesFromMikrotikToSupabase,
  bulkActivateSubscribers,
  bulkReceivePayments,
  updateSubscriberGracePeriod,
  removeSubscriberGracePeriod,
  shiftBillToNextMonth,
} from '../lib/billingAndNetwork';
import { openWhatsAppLink } from '../lib/whatsappBilling';
import { EXPIRY_MIGRATION_SQL } from '../lib/expiryMigrationSql';
import {
  DEFAULT_ISP_BILLING_SETTINGS,
  buildBilingualPaymentSlip,
  isMissingTableOrColumnError,
  loadBillingSettingsFromDb,
} from '../lib/expiryUtils';
import {
  computeBillingAnchorDay,
  evaluateSubscribersExpiryBuckets,
  fetchLiveFieldStaffWithBalances,
} from '../lib/anniversaryBilling';
import {
  extractOrigPkgFromComment,
  isExpiryOrBlockedProfile,
  resolveExactSubscriberProfile,
} from '../lib/mikrotikProfileSync';
import { BulkReceiveAmountModal } from './BulkReceiveAmountModal';

type ExpiryTabKey = 'expiring_3d' | 'grace_24h' | 'suspended_16' | 'audit_logs';

function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  if (diff <= 0) return 'Grace Expired';
  const totalMins = Math.floor(diff / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m left`;
}

function formatDateTimePkt(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ExpiryAutomationView: React.FC = () => {
  const { routers, selectedRouterId } = useISP();
  const { formatCurrency } = useCurrency();
  const activeRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];
  const activeRouterRef = useRef(activeRouter);
  activeRouterRef.current = activeRouter;

  const [activeSubTab, setActiveSubTab] = useState<ExpiryTabKey>('expiring_3d');
  const [settings, setSettings] = useState<SupabaseIspBillingSettings>({
    ...DEFAULT_ISP_BILLING_SETTINGS,
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(true);
  const [mikrotikProfiles, setMikrotikProfiles] = useState<string[]>([]);
  const [mkSecrets, setMkSecrets] = useState<Array<Record<string, any>>>([]);
  const [mkActive, setMkActive] = useState<Array<Record<string, any>>>([]);

  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);
  const [allInvoices, setAllInvoices] = useState<SupabaseInvoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<SupabaseExpiryAuditLog[]>([]);
  const [waLogs, setWaLogs] = useState<SupabaseWhatsappReminderLog[]>([]);

  const openInvoices = useMemo(
    () => (allInvoices || []).filter((inv) => String(inv.status || '').toUpperCase() !== 'PAID'),
    [allInvoices]
  );

  const [missingSchemaItems, setMissingSchemaItems] = useState<string[]>([]);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [isRunningSweep, setIsRunningSweep] = useState<boolean>(false);
  const [isSyncingProfiles, setIsSyncingProfiles] = useState<boolean>(false);
  const [lastProfileSyncSummary, setLastProfileSyncSummary] = useState<string | null>(null);
  const [busyUsernames, setBusyUsernames] = useState<Record<string, boolean>>({});
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now());
  const [fieldAgents, setFieldAgents] = useState<
    Array<{ id: string; full_name: string; area?: string; role?: string }>
  >([]);
  const [selectedUsernames, setSelectedUsernames] = useState<Record<string, boolean>>({});
  const [isBulkActivating, setIsBulkActivating] = useState<boolean>(false);
  const [bulkActivateProgress, setBulkActivateProgress] = useState<string | null>(null);
  const [isBulkReceiveModalOpen, setIsBulkReceiveModalOpen] = useState<boolean>(false);
  const [isBulkReceiving, setIsBulkReceiving] = useState<boolean>(false);
  const [bulkReceiveProgress, setBulkReceiveProgress] = useState<string | null>(null);
  const [extraGraceTarget, setExtraGraceTarget] = useState<
    (SupabasePortalUser & { amountDue: number; effectiveExpiryMs?: number | null; isSyntheticRecord?: boolean }) | null
  >(null);
  const [extraGracePreset, setExtraGracePreset] = useState<'24' | '48' | '72' | 'custom'>('24');
  const [extraGraceCustomHours, setExtraGraceCustomHours] = useState<string>('36');
  const [extraGraceNoteInput, setExtraGraceNoteInput] = useState<string>('');
  const [isGrantingExtraGrace, setIsGrantingExtraGrace] = useState<boolean>(false);

  // Edit / Remove Grace modals for Grace tab
  const [editGraceTarget, setEditGraceTarget] = useState<
    (SupabasePortalUser & { amountDue: number; graceEndsMs: number; isSyntheticRecord?: boolean; extraGraceNote?: string | null }) | null
  >(null);
  const [editGraceDateTimeLocal, setEditGraceDateTimeLocal] = useState<string>('');
  const [editGraceNote, setEditGraceNote] = useState<string>('');
  const [isSavingEditGrace, setIsSavingEditGrace] = useState<boolean>(false);

  const [removeGraceTarget, setRemoveGraceTarget] = useState<
    (SupabasePortalUser & { amountDue: number; graceEndsMs: number; isSyntheticRecord?: boolean }) | null
  >(null);
  const [isRemovingGrace, setIsRemovingGrace] = useState<boolean>(false);

  const autoRestoredPaidUsersRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotice = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 6000);
  }, []);

  const fetchMikrotikProfilesList = useCallback(async () => {
    try {
      const [profRes, secRes, actRes] = await Promise.allSettled([
        safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter),
        safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter),
        safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter),
      ]);

      if (profRes.status === 'fulfilled' && profRes.value.ok) {
        const json = await profRes.value.json();
        if (Array.isArray(json)) {
          const names = json.map((p: any) => String(p?.name || '').trim()).filter(Boolean);
          setMikrotikProfiles(Array.from(new Set(names)));
        }
      }
      if (secRes.status === 'fulfilled' && secRes.value.ok) {
        const json = await secRes.value.json();
        if (Array.isArray(json)) {
          setMkSecrets(json);
        }
      }
      if (actRes.status === 'fulfilled' && actRes.value.ok) {
        const json = await actRes.value.json();
        if (Array.isArray(json)) {
          setMkActive(json);
        }
      }
    } catch {}
  }, [activeRouter]);

  const fetchAllDatabaseState = useCallback(async () => {
    setIsLoading(true);
    const missing = new Set<string>();
    try {
      const [settingsRes, clientsRes, invRes, auditRes, waRes, staffRes] = await Promise.all([
        loadBillingSettingsFromDb(supabase),
        supabase.from('portal_users').select('*').eq('role', 'CLIENT').order('username', { ascending: true }),
        supabase.from('invoices').select('*').order('created_at', { ascending: false }),
        supabase
          .from('expiry_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('whatsapp_reminder_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        fetchLiveFieldStaffWithBalances(supabase).catch(() => []),
      ]);

      setSettings(settingsRes.settings);
      if (!settingsRes.tableExists) {
        missing.add('isp_billing_settings');
      }

      if (clientsRes.data) {
        setSubscribers(clientsRes.data as SupabasePortalUser[]);
      }
      if (invRes.data) {
        setAllInvoices(invRes.data as SupabaseInvoice[]);
      }
      if (Array.isArray(staffRes)) {
        setFieldAgents(
          staffRes.map((s) => ({
            id: s.id,
            full_name: s.name,
            area: s.assignedArea,
            role: s.role,
          }))
        );
      }

      if (auditRes.error && isMissingTableOrColumnError(auditRes.error)) {
        missing.add('expiry_audit_logs');
      } else if (auditRes.data) {
        setAuditLogs(auditRes.data as SupabaseExpiryAuditLog[]);
      }

      if (waRes.error && isMissingTableOrColumnError(waRes.error)) {
        missing.add('whatsapp_reminder_logs');
      } else if (waRes.data) {
        setWaLogs(waRes.data as SupabaseWhatsappReminderLog[]);
      }

      setMissingSchemaItems(Array.from(missing));
    } catch (err: any) {
      console.warn('ExpiryAutomationView load error:', err?.message || err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllDatabaseState();
    fetchMikrotikProfilesList();

    // Auto-run grace/expiry enforcement on load & periodically every 5 minutes
    const runBackgroundSweep = () => {
      triggerAutoExpirySweep(activeRouterRef.current, { triggeredBy: 'ADMIN' })
        .then((res) => {
          if (res.ran && (res.suspendedTo16Pool > 0 || res.disabledSecrets > 0 || res.enteredGrace > 0)) {
            showNotice(
              `Auto-Expiry Engine synced: Suspended ${res.suspendedTo16Pool + res.disabledSecrets} past-grace account(s), entered grace ${res.enteredGrace}, kicked ${res.kickedActiveSessions} session(s).`,
              'success'
            );
            fetchAllDatabaseState();
            fetchMikrotikProfilesList();
          }
        })
        .catch(() => {});
    };

    runBackgroundSweep();
    const sweepInterval = setInterval(runBackgroundSweep, 5 * 60_000);
    const tickInterval = setInterval(() => setNowTickMs(Date.now()), 30_000);

    const ch = supabase
      .channel('public:expiry_automation_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        fetchAllDatabaseState();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'isp_billing_settings' }, () => {
        fetchAllDatabaseState();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expiry_audit_logs' }, () => {
        fetchAllDatabaseState();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_reminder_logs' }, () => {
        fetchAllDatabaseState();
      })
      .subscribe();

    return () => {
      clearInterval(sweepInterval);
      clearInterval(tickInterval);
      supabase.removeChannel(ch);
    };
  }, [fetchAllDatabaseState, fetchMikrotikProfilesList, showNotice]);

  // Save settings directly to Supabase isp_billing_settings (and sync payment fields to whatsapp_billing_config)
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    const nowIso = new Date().toISOString();

    const payload: SupabaseIspBillingSettings = {
      id: 1,
      expiry_ppp_profile: settings.expiry_ppp_profile.trim() || 'EXPIRED-16-POOL',
      suspension_mode:
        settings.suspension_mode === 'DISABLE_SECRET' ? 'DISABLE_SECRET' : 'EXPIRED_PROFILE',
      grace_hours: Math.max(0, Number(settings.grace_hours) || 24),
      cutoff_time_pkt: settings.cutoff_time_pkt || '14:00',
      jazzcash_title: (settings.jazzcash_title || '').trim(),
      jazzcash_number: (settings.jazzcash_number || '').trim(),
      easypaisa_title: (settings.easypaisa_title || '').trim(),
      easypaisa_number: (settings.easypaisa_number || '').trim(),
      bank_name: (settings.bank_name || '').trim(),
      bank_account_title: (settings.bank_account_title || '').trim(),
      bank_iban: (settings.bank_iban || '').trim(),
      updated_at: nowIso,
    };

    try {
      const { error } = await supabase
        .from('isp_billing_settings')
        .upsert([payload], { onConflict: 'id' });

      // Always keep whatsapp_billing_config payment details synchronized in PostgreSQL as well
      const { data: existingWa } = await supabase
        .from('whatsapp_billing_config')
        .select('id')
        .limit(1)
        .maybeSingle();

      if (existingWa?.id) {
        await supabase
          .from('whatsapp_billing_config')
          .update({
            jazzcash_title: payload.jazzcash_title,
            jazzcash_number: payload.jazzcash_number,
            easypaisa_title: payload.easypaisa_title,
            easypaisa_number: payload.easypaisa_number,
            bank_name: payload.bank_name,
            bank_account_title: payload.bank_account_title,
            bank_iban_or_acc: payload.bank_iban,
            updated_at: nowIso,
          })
          .eq('id', existingWa.id);
      }

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          setMissingSchemaItems((prev) => Array.from(new Set([...prev, 'isp_billing_settings'])));
          showNotice(
            'Payment accounts synced to whatsapp_billing_config. Run the SQL migration to persist isp_billing_settings profile & grace fields.',
            'error'
          );
        } else {
          throw new Error(error.message);
        }
      } else {
        setSettings(payload);
        showNotice(
          `Saved to Supabase isp_billing_settings (${payload.expiry_ppp_profile} · ${payload.grace_hours}h Grace · ${payload.cutoff_time_pkt} PKT Cut-off).`,
          'success'
        );
        await fetchAllDatabaseState();
      }
    } catch (err: any) {
      showNotice(`Failed to save billing settings: ${err?.message || 'Error'}`, 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Trigger backend /api/billing/run-expiry-check sweep now
  const handleRunExpirySweepNow = async () => {
    setIsRunningSweep(true);
    try {
      const auth = getActiveRouterAuth(activeRouter);
      const resolved = resolveRestHostAndPort(activeRouter);

      const res = await fetch('/api/billing/run-expiry-check', {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: auth.authHeader,
          'x-router-host': resolved.host,
          'x-router-ip': resolved.host,
          'x-router-port': String(resolved.port),
          'x-router-ssl': resolved.useSsl ? 'true' : 'false',
          'x-router-id': activeRouter?.id || '',
        },
        body: JSON.stringify({
          routerHost: resolved.host,
          routerPort: resolved.port,
          useSsl: resolved.useSsl,
          triggeredBy: 'ADMIN',
        }),
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        throw new Error('Backend /api/billing/run-expiry-check did not return JSON.');
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.errors?.[0] || data.error || 'Expiry sweep failed');
      }

      if (Array.isArray(data.schemaWarnings) && data.schemaWarnings.length > 0) {
        setMissingSchemaItems((prev) =>
          Array.from(new Set([...prev, 'isp_billing_settings / expiry_audit_logs']))
        );
      }

      showNotice(
        `2:00 PM Expiry Sweep Complete (${data.durationMs}ms): Scanned ${data.scanned} · Reminders ${data.remindersSent} · Entered Grace ${data.enteredGrace} · Suspended (16.16.16.0/24) ${data.suspendedTo16Pool} · Disabled ${data.disabledSecrets} · Kicked ${data.kickedActiveSessions}.`,
        data.errors?.length ? 'error' : 'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Sweep error: ${err?.message || 'Unable to execute /api/billing/run-expiry-check'}`, 'error');
    } finally {
      setIsRunningSweep(false);
    }
  };

  const categorizedSubscribers = useMemo(() => {
    const evaluated = evaluateSubscribersExpiryBuckets({
      subscribers,
      allInvoices,
      auditLogs,
      cutoffTimePkt: settings.cutoff_time_pkt || '14:00',
      graceHours: Math.max(0, Number(settings.grace_hours) || 24),
      expiryProfileName: settings.expiry_ppp_profile,
      mikrotikSecrets: mkSecrets,
      mikrotikActive: mkActive,
      nowMs: nowTickMs,
    });

    return {
      expiring3d: evaluated.expiring3d.map((item) => ({
        ...item.subscriber,
        amountDue: item.amountDue,
        effectiveExpiryMs: item.effectiveExpiryMs ?? Date.now(),
        daysRemaining: item.daysRemaining,
        isSyntheticRecord: item.isSyntheticRecord,
      })),
      inGrace: evaluated.inGrace.map((item) => ({
        ...item.subscriber,
        amountDue: item.amountDue,
        effectiveExpiryMs: item.effectiveExpiryMs ?? Date.now(),
        graceEndsMs: item.graceEndsMs ?? Date.now(),
        isSyntheticRecord: item.isSyntheticRecord,
        isExtraGrace: Boolean(item.isExtraGrace),
        extraGraceNote: item.extraGraceNote || null,
      })),
      suspended16: evaluated.suspended16.map((item) => {
        const unameLower = String(item.subscriber.username || '').trim().toLowerCase();
        const mkSec = mkSecrets.find(
          (s) => String(s?.name || '').trim().toLowerCase() === unameLower
        );
        const origFromComment = extractOrigPkgFromComment(
          mkSec?.comment,
          settings.expiry_ppp_profile
        );
        const adoptedProfile =
          origFromComment ||
          resolveExactSubscriberProfile({
            liveSecret: mkSec,
            subscriber: item.subscriber,
            mikrotikProfiles,
            expiryProfileName: settings.expiry_ppp_profile,
          });
        return {
          ...item.subscriber,
          amountDue: item.amountDue,
          effectiveExpiryMs: item.effectiveExpiryMs,
          isSyntheticRecord: item.isSyntheticRecord,
          suspensionReason: item.suspensionReason,
          adoptedProfile,
        };
      }),
      paidSuspendedToRestore: evaluated.paidSuspendedToRestore,
    };
  }, [
    subscribers,
    allInvoices,
    auditLogs,
    settings.cutoff_time_pkt,
    settings.grace_hours,
    settings.expiry_ppp_profile,
    mkSecrets,
    mkActive,
    mikrotikProfiles,
    nowTickMs,
  ]);

  // Automatically restore any paid subscribers (unpaidInvoiceTotal <= 0) still flagged suspended in DB/MikroTik
  useEffect(() => {
    const stuckPaid = categorizedSubscribers.paidSuspendedToRestore || [];
    if (isLoading || stuckPaid.length === 0) return;

    const pendingToRestore = stuckPaid.filter(
      (item) => !autoRestoredPaidUsersRef.current.has(item.username)
    );
    if (pendingToRestore.length === 0) return;

    for (const item of pendingToRestore) {
      autoRestoredPaidUsersRef.current.add(item.username);
    }

    (async () => {
      let restoredCount = 0;
      for (const item of pendingToRestore) {
        const res = await restoreSubscriberOnInvoicePaid(item.username, {
          triggeredBy: 'ADMIN',
          notes: `Auto-restored zero-due paid subscriber (${item.reason})`,
          expiryProfileName: settings.expiry_ppp_profile,
          activeRouter: activeRouterRef.current,
          preloadedSecrets: mkSecrets,
          preloadedProfiles: mikrotikProfiles,
          preloadedActive: mkActive,
        });
        if (res.success) restoredCount++;
      }
      if (restoredCount > 0) {
        showNotice(
          `Auto-restored ${restoredCount} paid subscriber(s) removed from Suspended 16.16.16.0/24 pool.`,
          'success'
        );
        await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
      }
    })();
  }, [
    categorizedSubscribers.paidSuspendedToRestore,
    isLoading,
    settings.expiry_ppp_profile,
    mkSecrets,
    mikrotikProfiles,
    mkActive,
    showNotice,
    fetchAllDatabaseState,
    fetchMikrotikProfilesList,
  ]);

  const activeTabRows = useMemo(() => {
    if (activeSubTab === 'expiring_3d') return categorizedSubscribers.expiring3d;
    if (activeSubTab === 'grace_24h') return categorizedSubscribers.inGrace;
    if (activeSubTab === 'suspended_16') return categorizedSubscribers.suspended16;
    return [];
  }, [activeSubTab, categorizedSubscribers]);

  const selectedRowsInActiveTab = useMemo(
    () =>
      activeTabRows.filter((row) => {
        const u = String(row.username || '').trim().toLowerCase();
        return Boolean(u && selectedUsernames[u]);
      }),
    [activeTabRows, selectedUsernames]
  );

  const selectedTotalDueInTab = useMemo(
    () =>
      selectedRowsInActiveTab.reduce((sum, r) => sum + (Number((r as any).amountDue) || 0), 0),
    [selectedRowsInActiveTab]
  );

  const allInTabSelected =
    activeTabRows.length > 0 && selectedRowsInActiveTab.length === activeTabRows.length;

  const toggleSelectAllInTab = () => {
    if (allInTabSelected) {
      setSelectedUsernames((prev) => {
        const next = { ...prev };
        for (const r of activeTabRows) {
          delete next[String(r.username || '').trim().toLowerCase()];
        }
        return next;
      });
    } else {
      setSelectedUsernames((prev) => {
        const next = { ...prev };
        for (const r of activeTabRows) {
          const u = String(r.username || '').trim().toLowerCase();
          if (u) next[u] = true;
        }
        return next;
      });
    }
  };

  const toggleSelectOneUser = (username: string) => {
    const u = String(username || '').trim().toLowerCase();
    if (!u) return;
    setSelectedUsernames((prev) => ({ ...prev, [u]: !prev[u] }));
  };

  // Sync exact PPPoE profiles from MikroTik /ppp/profile & /ppp/secret into Supabase portal_users
  const handleSyncProfilesFromMikrotik = async () => {
    setIsSyncingProfiles(true);
    try {
      const res = await syncProfilesFromMikrotikToSupabase(
        activeRouterRef.current,
        settings.expiry_ppp_profile
      );
      if (!res.success) {
        showNotice(`MikroTik Profile Sync failed: ${res.error || 'Router unreachable'}`, 'error');
        return;
      }
      if (res.profiles.length > 0) {
        setMikrotikProfiles(res.profiles);
      }
      const summaryText = `Adopted ${res.profiles.length} RouterOS profiles (${res.totalSecrets} secrets): updated ${res.syncedCount} active subscriber(s), ${res.adoptedFromCommentCount} from ORIG_PKG comment, ${res.alreadySyncedCount} already synced.`;
      setLastProfileSyncSummary(summaryText);
      showNotice(summaryText, 'success');
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`MikroTik Profile Sync error: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsSyncingProfiles(false);
    }
  };

  // Bulk Activate (Restore Exact MikroTik Profiles) for selected rows
  const handleBulkActivateSelected = async () => {
    if (selectedRowsInActiveTab.length === 0 || isBulkActivating) return;
    setIsBulkActivating(true);
    setBulkActivateProgress(`Restoring 0 / ${selectedRowsInActiveTab.length}...`);
    try {
      const res = await bulkActivateSubscribers({
        subscribers: selectedRowsInActiveTab.map((r: any) => ({
          id: r.id,
          username: r.username,
          original_package_profile: r.adoptedProfile || r.original_package_profile,
          package_name: r.package_name,
          package_profile_name: r.package_profile_name,
          package_speed: r.package_speed,
          isSyntheticRecord: r.isSyntheticRecord,
        })),
        activeRouter: activeRouterRef.current,
        expiryProfileName: settings.expiry_ppp_profile,
        triggeredBy: 'ADMIN',
        onProgress: (curr, total, uname) => {
          setBulkActivateProgress(`Restoring ${curr} / ${total} (@${uname})...`);
        },
      });

      setSelectedUsernames({});
      showNotice(
        `Bulk Activate complete: Restored ${res.restoredCount} subscriber(s) to their exact MikroTik profiles & kicked ${res.kickedSessions} session(s)${
          res.failedCount > 0 ? ` (${res.failedCount} failed)` : ''
        }.`,
        res.failedCount > 0 && res.restoredCount === 0 ? 'error' : 'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Bulk Activate failed: ${err?.message || 'Unknown error'}`, 'error');
    } finally {
      setIsBulkActivating(false);
      setBulkActivateProgress(null);
    }
  };

  // Bulk Receive Amount for selected suspended/expiry subscribers + auto-restore MikroTik profiles
  const bulkReceivePreviewRows = useMemo(() => {
    const rows: Array<{ key: string; username: string; label: string; amount: number }> = [];
    for (const sub of selectedRowsInActiveTab) {
      const uname = String(sub.username || '').trim().toLowerCase();
      const userOpenInvs = openInvoices.filter(
        (inv) => String(inv.subscriber_username || '').trim().toLowerCase() === uname
      );
      if (userOpenInvs.length > 0) {
        for (const inv of userOpenInvs) {
          const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
          if (bal > 0) {
            rows.push({
              key: inv.id,
              username: uname,
              label: `#${inv.invoice_no}`,
              amount: bal,
            });
          }
        }
      } else if ((Number((sub as any).amountDue) || 0) > 0) {
        rows.push({
          key: `synthetic-${uname}`,
          username: uname,
          label: 'Monthly Package Due',
          amount: Number((sub as any).amountDue) || 0,
        });
      }
    }
    return rows;
  }, [selectedRowsInActiveTab, openInvoices]);

  const bulkReceiveModalTotal = useMemo(
    () => bulkReceivePreviewRows.reduce((s, r) => s + r.amount, 0),
    [bulkReceivePreviewRows]
  );

  const handleConfirmBulkReceive = async (payload: {
    paymentMethod: string;
    agentId: string;
    agentName: string;
    referenceNote: string;
  }) => {
    if (selectedRowsInActiveTab.length === 0) return;
    setIsBulkReceiving(true);
    setBulkReceiveProgress(`Preparing ${selectedRowsInActiveTab.length} account(s)...`);

    try {
      const itemsToCollect: Array<{ invoice: SupabaseInvoice; amountToCollect: number }> = [];
      const workingInvoices = [...allInvoices];
      const nowIso = new Date().toISOString();

      for (const sub of selectedRowsInActiveTab) {
        const uname = String(sub.username || '').trim().toLowerCase();
        const userOpenInvs = openInvoices.filter(
          (inv) => String(inv.subscriber_username || '').trim().toLowerCase() === uname
        );
        if (userOpenInvs.length > 0) {
          for (const inv of userOpenInvs) {
            const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
            if (bal > 0) {
              itemsToCollect.push({ invoice: inv, amountToCollect: bal });
            }
          }
        } else if ((Number((sub as any).amountDue) || 0) > 0) {
          const dueAmt = Number((sub as any).amountDue) || 0;
          const anchorDay = computeBillingAnchorDay(sub);
          const genNo = `INV-${nowIso.slice(0, 7).replace('-', '')}-${Math.floor(1000 + Math.random() * 9000)}`;
          const { data: createdInv, error: createErr } = await supabase
            .from('invoices')
            .insert([
              {
                invoice_no: genNo,
                subscriber_username: uname,
                assigned_agent_id: payload.agentId || null,
                assigned_agent_name: payload.agentId ? payload.agentName : null,
                amount: dueAmt,
                paid_amount: 0,
                due_date: nowIso.slice(0, 10),
                status: 'DUE',
                cycle_day: anchorDay,
                created_at: nowIso,
              },
            ])
            .select()
            .maybeSingle();

          if (!createErr && createdInv) {
            workingInvoices.push(createdInv as SupabaseInvoice);
            itemsToCollect.push({
              invoice: createdInv as SupabaseInvoice,
              amountToCollect: dueAmt,
            });
          }
        }
      }

      const res = await bulkReceivePayments({
        items: itemsToCollect,
        allInvoices: workingInvoices,
        portalClients: subscribers,
        paymentMethod: payload.paymentMethod,
        agentId: payload.agentId || null,
        agentName: payload.agentName,
        collectedByName: payload.agentName,
        referenceNote: payload.referenceNote,
        activeRouter: activeRouterRef.current,
        expiryProfileName: settings.expiry_ppp_profile,
        onProgress: (curr, total, label) => {
          setBulkReceiveProgress(`Settling ${curr} / ${total}: ${label}...`);
        },
      });

      setIsBulkReceiveModalOpen(false);
      setSelectedUsernames({});
      showNotice(
        `Bulk Receive Complete: Settled ${res.settledInvoicesCount} invoice(s) totaling ${formatCurrency(
          res.totalCollected,
          0
        )} (${payload.paymentMethod}) & auto-restored ${res.restoredSubscribersCount} subscriber(s) (kicked ${res.kickedSessions} session(s)).`,
        res.errors.length > 0 && res.settledInvoicesCount === 0 ? 'error' : 'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Bulk Receive failed: ${err?.message || 'Error'}`, 'error');
    } finally {
      setIsBulkReceiving(false);
      setBulkReceiveProgress(null);
    }
  };

  // 1-Click Send WhatsApp Slip + Log to whatsapp_reminder_logs & expiry_audit_logs
  const handleSendWhatsAppSlip = async (
    sub: SupabasePortalUser & { amountDue: number; effectiveExpiryMs: number; isSyntheticRecord?: boolean }
  ) => {
    const uname = String(sub.username || '').trim().toLowerCase();
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    const nowIso = new Date().toISOString();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sub.id || ''));
    const realSubscriberId = !sub.isSyntheticRecord && isUuid ? sub.id : null;

    try {
      const expiryDateLabel = new Date(sub.effectiveExpiryMs).toISOString().slice(0, 10);
      const cycleKey = expiryDateLabel.slice(0, 7);
      const slip = buildBilingualPaymentSlip({
        fullName: sub.full_name || sub.username,
        username: uname,
        packageLabel:
          sub.package_speed || sub.package_profile_name || sub.original_package_profile || 'Fiber Broadband',
        amountDue: sub.amountDue,
        expiryDateLabel,
        settings: {
          ...DEFAULT_ISP_BILLING_SETTINGS,
          ...settings,
          jazzcash_title: settings.jazzcash_title || '',
          jazzcash_number: settings.jazzcash_number || '',
          easypaisa_title: settings.easypaisa_title || '',
          easypaisa_number: settings.easypaisa_number || '',
          bank_name: settings.bank_name || '',
          bank_account_title: settings.bank_account_title || '',
          bank_iban: settings.bank_iban || '',
        },
      });

      openWhatsAppLink(sub.phone, slip);

      await supabase.from('whatsapp_reminder_logs').insert([
        {
          subscriber_id: realSubscriberId,
          username: uname,
          phone: sub.phone || null,
          message_body: slip,
          amount_due: sub.amountDue,
          expiry_date: new Date(sub.effectiveExpiryMs).toISOString(),
          status: 'SENT',
          created_at: nowIso,
        },
      ]);

      if (realSubscriberId) {
        await supabase
          .from('portal_users')
          .update({ billing_status: 'REMINDER_SENT', last_reminder_cycle: cycleKey })
          .eq('id', realSubscriberId);
      }

      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: realSubscriberId,
          username: uname,
          action_type: 'REMINDER_3D',
          previous_profile: sub.original_package_profile || sub.package_profile_name || null,
          applied_profile: sub.package_profile_name || null,
          triggered_by: 'ADMIN',
          notes: `Manual WhatsApp payment slip opened & logged for cycle ${cycleKey}`,
          created_at: nowIso,
        },
      ]);

      showNotice(`WhatsApp payment slip logged & opened for @${uname}.`, 'success');
      await fetchAllDatabaseState();
    } catch (err: any) {
      showNotice(`Failed to log reminder for @${uname}: ${err?.message}`, 'error');
    } finally {
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  // Format ISO / ms into `YYYY-MM-DDTHH:mm` for datetime-local input
  const toDateTimeLocalValue = (ms: number): string => {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
      d.getMinutes()
    )}`;
  };

  // Open Edit Grace modal (allows extending or shortening grace_until / grace_ends_at + note)
  const handleOpenEditGraceModal = (
    sub: SupabasePortalUser & { amountDue: number; graceEndsMs: number; isSyntheticRecord?: boolean; extraGraceNote?: string | null }
  ) => {
    setEditGraceTarget(sub);
    setEditGraceDateTimeLocal(toDateTimeLocalValue(sub.graceEndsMs || Date.now() + 24 * 3_600_000));
    setEditGraceNote(sub.extraGraceNote || '');
  };

  const applyQuickDeltaToEditGrace = (deltaHours: number) => {
    const parsedCurrent = editGraceDateTimeLocal ? Date.parse(editGraceDateTimeLocal) : NaN;
    const baseMs = !Number.isNaN(parsedCurrent)
      ? Math.max(Date.now(), parsedCurrent)
      : Math.max(Date.now(), editGraceTarget?.graceEndsMs || Date.now());
    setEditGraceDateTimeLocal(toDateTimeLocalValue(baseMs + deltaHours * 3_600_000));
  };

  const handleSaveEditGrace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editGraceTarget || !editGraceDateTimeLocal) return;
    const targetMs = Date.parse(editGraceDateTimeLocal);
    if (Number.isNaN(targetMs)) {
      showNotice('Please pick a valid grace deadline date & time.', 'error');
      return;
    }

    const uname = String(editGraceTarget.username || '').trim().toLowerCase();
    setIsSavingEditGrace(true);
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    try {
      const graceUntilIso = new Date(targetMs).toISOString();
      const res = await updateSubscriberGracePeriod({
        subscriberId: editGraceTarget.id,
        username: uname,
        graceUntilIso,
        note: editGraceNote,
        activeRouter: activeRouterRef.current,
        expiryProfileName: settings.expiry_ppp_profile,
        preloadedSecrets: mkSecrets,
        preloadedProfiles: mikrotikProfiles,
        preloadedActive: mkActive,
      });
      setEditGraceTarget(null);
      showNotice(
        `Updated grace period for @${uname} until ${formatDateTimePkt(res.graceUntilIso)}.`,
        'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Unable to update grace for @${uname}: ${err?.message}`, 'error');
    } finally {
      setIsSavingEditGrace(false);
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  // Remove / Cancel Grace Period (suspends immediately if past-due unpaid & not shifted, else restores ACTIVE)
  const handleConfirmRemoveGrace = async () => {
    if (!removeGraceTarget) return;
    const sub = removeGraceTarget;
    const uname = String(sub.username || '').trim().toLowerCase();
    setIsRemovingGrace(true);
    setBusyUsernames((p) => ({ ...p, [uname]: true }));

    try {
      const res = await removeSubscriberGracePeriod({
        username: uname,
        subscriberId: sub.id,
        allInvoices,
        expiryProfileName: settings.expiry_ppp_profile,
        suspensionMode: settings.suspension_mode,
        activeRouter: activeRouterRef.current,
        preloadedSecrets: mkSecrets,
        preloadedProfiles: mikrotikProfiles,
        preloadedActive: mkActive,
      });
      setRemoveGraceTarget(null);
      showNotice(
        res.outcome === 'SUSPENDED'
          ? `Grace removed for @${uname}: unpaid balance (${formatCurrency(
              res.unpaidTotal,
              0
            )}) -> immediately applied ${res.appliedProfile} & kicked ${res.kickedSessions} session(s).`
          : `Grace cleared for @${uname}: returned cleanly to ACTIVE (${res.appliedProfile}).`,
        'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Unable to remove grace for @${uname}: ${err?.message}`, 'error');
    } finally {
      setIsRemovingGrace(false);
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  // Shift Bill to Next Month (Advances due_date & next_billing_date +1 calendar month, exempts from expiry, restores if suspended)
  const handleShiftBillToNextMonth = async (
    sub: SupabasePortalUser & { isSyntheticRecord?: boolean }
  ) => {
    const uname = String(sub.username || '').trim().toLowerCase();
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    try {
      const res = await shiftBillToNextMonth({
        username: uname,
        subscriberId: sub.id,
        allInvoices,
        activeRouter: activeRouterRef.current,
        expiryProfileName: settings.expiry_ppp_profile,
        preloadedSecrets: mkSecrets,
        preloadedProfiles: mikrotikProfiles,
        preloadedActive: mkActive,
      });
      showNotice(
        `Shifted @${uname}'s bill & cycle to next month (${res.nextDueDate}) · Updated ${
          res.updatedInvoicesCount
        } invoice(s)${
          res.restoredMikrotik
            ? ` · Restored MikroTik "${res.appliedProfile}" (kicked ${res.kickedSessions} session(s))`
            : ''
        }. Exempt from expiry pool.`,
        'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Unable to shift bill for @${uname}: ${err?.message}`, 'error');
    } finally {
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  // 1-Click Collect & Restore (Marks open invoices PAID + DB +30d + MikroTik profile restore + kick 16.16.16.x)
  const handleCollectAndRestore = async (
    sub: SupabasePortalUser & { amountDue: number }
  ) => {
    const uname = String(sub.username || '').trim().toLowerCase();
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    const nowIso = new Date().toISOString();
    const anchorDay = computeBillingAnchorDay(sub);
    const nextDueDate = addCalendarMonthDateString(new Date(), anchorDay);

    try {
      // 1. Settle any open invoices in Supabase for this subscriber
      const userOpenInvoices = openInvoices.filter(
        (inv) => String(inv.subscriber_username || '').trim().toLowerCase() === uname
      );
      for (const inv of userOpenInvoices) {
        const balance = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
        await supabase
          .from('invoices')
          .update({
            status: 'PAID',
            paid_amount: Number(inv.amount) || balance,
            paid_at: nowIso,
            due_date: nextDueDate,
          })
          .eq('id', inv.id);

        if (balance > 0) {
          await supabase.from('payment_transactions').insert([
            {
              invoice_id: inv.id,
              subscriber_username: uname,
              collected_by_name: 'NOC Expiry Desk',
              amount_paid: balance,
              payment_mode: 'Cash / Online Restore',
              payment_date: nowIso,
              notes: `Collect & Restore from Auto-Expiry & Grace Console`,
            },
          ]);
        }
      }

      // 2. Atomic DB +30d + MikroTik exact profile restore + active 16.16.16.x kick + RESTORED_ON_PAYMENT log
      const restoreRes = await restoreSubscriberOnInvoicePaid(uname, {
        triggeredBy: 'ADMIN',
        expiryProfileName: settings.expiry_ppp_profile,
        activeRouter: activeRouterRef.current,
        preloadedSecrets: mkSecrets,
        preloadedProfiles: mikrotikProfiles,
        preloadedActive: mkActive,
        notes: `1-Click Collect & Restore (${formatCurrency(sub.amountDue, 0)} settled)`,
      });

      showNotice(
        `Restored @${uname} to "${restoreRes.restoredProfile}" (+1 mo expiry: ${restoreRes.newExpiryIso.slice(
          0,
          10
        )} · Kicked ${restoreRes.kickedSessions} session${restoreRes.kickedSessions === 1 ? '' : 's'}).`,
        'success'
      );
      await Promise.all([fetchAllDatabaseState(), fetchMikrotikProfilesList()]);
    } catch (err: any) {
      showNotice(`Collect & Restore error for @${uname}: ${err?.message}`, 'error');
    } finally {
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  // Open Extra Grace modal for a suspended subscriber
  const handleOpenExtraGraceModal = (
    sub: SupabasePortalUser & { amountDue: number; effectiveExpiryMs?: number | null; isSyntheticRecord?: boolean }
  ) => {
    setExtraGraceTarget(sub);
    setExtraGracePreset('24');
    setExtraGraceCustomHours('36');
    setExtraGraceNoteInput('');
  };

  const resolvedExtraGraceHours = useMemo(() => {
    if (extraGracePreset === 'custom') {
      const parsed = Math.floor(Number(extraGraceCustomHours));
      return Number.isFinite(parsed) && parsed >= 1 ? Math.min(720, parsed) : 24;
    }
    return Number(extraGracePreset) || 24;
  }, [extraGracePreset, extraGraceCustomHours]);

  // Grant Extra Grace: Set grace_until = NOW + hours, is_suspended = false, restore exact MikroTik profile & kick 16.16.16.x
  const handleConfirmExtraGrace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extraGraceTarget) return;

    const sub = extraGraceTarget;
    const uname = String(sub.username || '').trim().toLowerCase();
    const hours = resolvedExtraGraceHours;
    const note = extraGraceNoteInput.trim();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const graceUntilIso = new Date(nowMs + hours * 3_600_000).toISOString();

    setIsGrantingExtraGrace(true);
    setBusyUsernames((p) => ({ ...p, [uname]: true }));

    try {
      // 1. Resolve exact adopted MikroTik profile from ORIG_PKG comment / live secret / Supabase
      const liveSecret =
        mkSecrets.find((s) => String(s?.name || '').trim().toLowerCase() === uname) || null;
      const origCommentPkg = extractOrigPkgFromComment(
        liveSecret?.comment,
        settings.expiry_ppp_profile
      );
      const restoredProfile = origCommentPkg
        ? resolveExactSubscriberProfile({
            liveSecret: { ...liveSecret, profile: origCommentPkg },
            subscriber: sub,
            mikrotikProfiles,
            expiryProfileName: settings.expiry_ppp_profile,
          }) || origCommentPkg
        : resolveExactSubscriberProfile({
            liveSecret,
            subscriber: sub,
            mikrotikProfiles,
            expiryProfileName: settings.expiry_ppp_profile,
          });

      // 2. Find or create portal_users row so grace_until & is_suspended persist reliably
      const { data: existingRow } = await supabase
        .from('portal_users')
        .select('id')
        .ilike('username', uname)
        .limit(1)
        .maybeSingle();

      let realSubscriberId: string | null = existingRow?.id ? String(existingRow.id) : null;

      if (realSubscriberId) {
        const { error: fullErr } = await supabase
          .from('portal_users')
          .update({
            is_suspended: false,
            grace_until: graceUntilIso,
            grace_ends_at: graceUntilIso,
            billing_status: 'GRACE_PERIOD',
            account_status: 'ACTIVE',
            original_package_profile: restoredProfile,
            last_restored_at: nowIso,
          } as any)
          .eq('id', realSubscriberId);

        if (fullErr) {
          if (isMissingTableOrColumnError(fullErr)) {
            const { error: fbErr } = await supabase
              .from('portal_users')
              .update({
                grace_ends_at: graceUntilIso,
                billing_status: 'GRACE_PERIOD',
                account_status: 'ACTIVE',
                original_package_profile: restoredProfile,
                last_restored_at: nowIso,
              })
              .eq('id', realSubscriberId);
            if (fbErr) throw new Error(fbErr.message);
          } else {
            throw new Error(fullErr.message);
          }
        }
      } else {
        const { data: insertedRow, error: insErr } = await supabase
          .from('portal_users')
          .insert([
            {
              username: uname,
              password: `Yn@${Math.floor(1000 + Math.random() * 9000)}`,
              role: 'CLIENT',
              full_name: sub.full_name || uname,
              phone: sub.phone || '',
              area: sub.area || 'Saddar Node',
              account_status: 'ACTIVE',
              billing_status: 'GRACE_PERIOD',
              grace_ends_at: graceUntilIso,
              original_package_profile: restoredProfile,
              package_profile_name: restoredProfile,
              package_speed: restoredProfile,
              monthly_fee: sub.amountDue || 0,
              last_restored_at: nowIso,
            },
          ])
          .select('id')
          .maybeSingle();

        if (insErr) throw new Error(insErr.message);
        realSubscriberId = insertedRow?.id ? String(insertedRow.id) : null;
      }

      // 3. Restore MikroTik PPPoE secret back to original_package_profile & kick 16.16.16.x active session
      const mkSync = await syncMikrotikSecretProfile(
        uname,
        restoredProfile,
        { disabled: 'false' },
        activeRouter
      );
      const kickedSessions = await kickMikrotikActiveSessionForUser(uname, activeRouter);

      // 4. Write permanent audit log entry
      const auditNote = `[EXTRA_GRACE +${hours}h] Temporarily restored to ${restoredProfile} until ${graceUntilIso}${
        note ? ` — Note: ${note}` : ''
      }`;
      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: realSubscriberId,
          username: uname,
          action_type: 'GRACE_EXTENDED',
          previous_profile: mkSync.previousProfile || settings.expiry_ppp_profile,
          applied_profile: restoredProfile,
          triggered_by: 'ADMIN',
          notes: auditNote,
          created_at: nowIso,
        },
      ]);

      setExtraGraceTarget(null);
      setActiveSubTab('grace_24h');
      showNotice(
        `Extra Grace (+${hours}h) granted to @${uname}! Restored to "${restoredProfile}" (kicked ${kickedSessions} session${
          kickedSessions === 1 ? '' : 's'
        }). Auto-suspends again at ${formatDateTimePkt(graceUntilIso)} if unpaid.`,
        'success'
      );
      await fetchAllDatabaseState();
      await fetchMikrotikProfilesList();
    } catch (err: any) {
      showNotice(`Extra Grace failed for @${uname}: ${err?.message || 'Error'}`, 'error');
    } finally {
      setIsGrantingExtraGrace(false);
      setBusyUsernames((p) => ({ ...p, [uname]: false }));
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(EXPIRY_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 3000);
      showNotice('Copied PostgreSQL migration SQL to clipboard.', 'success');
    } catch {
      showNotice('Copy failed — open supabase/migrations/20261114_expiry_grace_automation.sql.', 'error');
    }
  };

  return (
    <div className="space-y-5 text-xs font-sans">
      {/* Feedback Toast */}
      {toast && (
        <div
          className={`p-3.5 rounded-xl border font-mono text-xs flex items-center gap-2 ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-700 text-rose-200'
              : 'bg-emerald-950/90 border-emerald-700 text-emerald-200'
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

      {/* Missing Schema Notice (shown only when Supabase tables aren't migrated yet) */}
      {missingSchemaItems.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/50 border border-amber-700/80 text-amber-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Database className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-xs text-white">
                Supabase Migration Required for Full Audit &amp; Settings Tables ({missingSchemaItems.join(', ')})
              </div>
              <p className="text-[11px] font-mono text-amber-200/90">
                Run <code className="text-white">supabase/migrations/20261114_expiry_grace_automation.sql</code> in your Supabase SQL Editor so <code className="text-white">isp_billing_settings</code>, <code className="text-white">expiry_audit_logs</code>, <code className="text-white">whatsapp_reminder_logs</code>, and <code className="text-white">portal_users</code> grace/backup columns persist cleanly.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'SQL Copied!' : 'Copy Migration SQL'}</span>
          </button>
        </div>
      )}

      {/* Top Action Header */}
      <div className="bg-[#111A2E] border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className="text-cyan-400 font-semibold">Supabase PostgreSQL + MikroTik 16.16.16.0/24</span>
            <span aria-hidden="true">·</span>
            <span>Daily Cron: 2:00 PM PKT (09:00 UTC)</span>
            <span aria-hidden="true">·</span>
            <span>Grace: {settings.grace_hours}h</span>
            <span aria-hidden="true">·</span>
            <span>Expiry Profile: {settings.expiry_ppp_profile}</span>
          </div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-cyan-400 shrink-0" />
            <span>Automated Expiry, 2:00 PM Cut-Off, 24h Grace &amp; 16.16.16.0/24 Restore Engine</span>
          </h2>
          <p className="text-xs text-slate-400">
            3-day advance WhatsApp payment slips, {settings.cutoff_time_pkt} PKT cut-off, {settings.grace_hours}h grace period, backed-up <code className="text-slate-300">original_package_profile</code>, and 5-second payment restore.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleSyncProfilesFromMikrotik}
            disabled={isSyncingProfiles}
            className="px-3.5 py-2 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 text-cyan-200 border border-cyan-700/70 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
            title="Fetch live /ppp/profile & /ppp/secret directly from MikroTik and adopt exact speed profiles into Supabase"
          >
            <Wifi className={`w-3.5 h-3.5 text-cyan-400 ${isSyncingProfiles ? 'animate-pulse' : ''}`} />
            <span>{isSyncingProfiles ? 'Syncing Profiles...' : 'Sync Profiles from MikroTik'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen((v) => !v)}
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isSettingsOpen ? 'Hide DB Settings' : 'Expiry & Payment Settings'}</span>
          </button>

          <button
            type="button"
            onClick={fetchAllDatabaseState}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh DB</span>
          </button>

          <button
            type="button"
            onClick={handleRunExpirySweepNow}
            disabled={isRunningSweep}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <Play className={`w-3.5 h-3.5 ${isRunningSweep ? 'animate-pulse' : ''}`} />
            <span>{isRunningSweep ? 'Running 2:00 PM Sweep...' : 'Run 2:00 PM Expiry Sweep Now'}</span>
          </button>
        </div>
      </div>

      {/* Live Adopted MikroTik RouterOS Profiles Strip */}
      {(mikrotikProfiles.length > 0 || lastProfileSyncSummary) && (
        <div className="px-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="text-cyan-400 font-bold shrink-0">
              Live MikroTik Profiles ({mikrotikProfiles.filter((p) => !isExpiryOrBlockedProfile(p, settings.expiry_ppp_profile)).length}):
            </span>
            {mikrotikProfiles
              .filter((p) => !isExpiryOrBlockedProfile(p, settings.expiry_ppp_profile))
              .map((prof) => (
                <span
                  key={prof}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200"
                >
                  {prof}
                </span>
              ))}
          </div>
          {lastProfileSyncSummary && (
            <span className="text-emerald-400 truncate max-w-full">{lastProfileSyncSummary}</span>
          )}
        </div>
      )}

      {/* Persistent Settings Card (isp_billing_settings) */}
      {isSettingsOpen && (
        <form
          onSubmit={handleSaveSettings}
          className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Persistent Billing &amp; MikroTik Expiry Settings (isp_billing_settings)</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              {settings.updated_at ? `Updated ${formatDateTimePkt(settings.updated_at)}` : 'Row ID #1'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                16.16.16.0/24 Expiry PPP Profile
              </label>
              <div className="flex gap-1.5">
                {mikrotikProfiles.length > 0 ? (
                  <select
                    value={settings.expiry_ppp_profile}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, expiry_ppp_profile: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                  >
                    {!mikrotikProfiles.includes(settings.expiry_ppp_profile) && (
                      <option value={settings.expiry_ppp_profile}>
                        {settings.expiry_ppp_profile}
                      </option>
                    )}
                    {mikrotikProfiles.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={settings.expiry_ppp_profile}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, expiry_ppp_profile: e.target.value }))
                    }
                    placeholder="EXPIRED-16-POOL"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                )}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Post-Grace Suspension Mode
              </label>
              <select
                value={settings.suspension_mode}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, suspension_mode: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="EXPIRED_PROFILE">Shift to 16.16.16.0/24 Expiry Profile</option>
                <option value="DISABLE_SECRET">Disable PPPoE Secret</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Grace Period (Hours)
              </label>
              <input
                type="number"
                min={0}
                max={720}
                value={settings.grace_hours}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, grace_hours: Number(e.target.value) || 0 }))
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">
                Cut-off Time (PKT)
              </label>
              <input
                type="time"
                value={settings.cutoff_time_pkt}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, cutoff_time_pkt: e.target.value || '14:00' }))
                }
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Payment Account Details persisted in isp_billing_settings */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2 border-t border-slate-800/80">
            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="text-[11px] font-bold text-rose-400">JazzCash Account</div>
              <input
                type="text"
                value={settings.jazzcash_title || ''}
                onChange={(e) => setSettings((s) => ({ ...s, jazzcash_title: e.target.value }))}
                placeholder="Account Title"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
              />
              <input
                type="text"
                value={settings.jazzcash_number || ''}
                onChange={(e) => setSettings((s) => ({ ...s, jazzcash_number: e.target.value }))}
                placeholder="03XX-XXXXXXX"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white font-mono text-xs"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="text-[11px] font-bold text-emerald-400">EasyPaisa Account</div>
              <input
                type="text"
                value={settings.easypaisa_title || ''}
                onChange={(e) => setSettings((s) => ({ ...s, easypaisa_title: e.target.value }))}
                placeholder="Account Title"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
              />
              <input
                type="text"
                value={settings.easypaisa_number || ''}
                onChange={(e) => setSettings((s) => ({ ...s, easypaisa_number: e.target.value }))}
                placeholder="03XX-XXXXXXX"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white font-mono text-xs"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
              <div className="text-[11px] font-bold text-cyan-400">Bank Transfer / IBAN</div>
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={settings.bank_name || ''}
                  onChange={(e) => setSettings((s) => ({ ...s, bank_name: e.target.value }))}
                  placeholder="Bank Name"
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                />
                <input
                  type="text"
                  value={settings.bank_account_title || ''}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, bank_account_title: e.target.value }))
                  }
                  placeholder="Account Title"
                  className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                />
              </div>
              <input
                type="text"
                value={settings.bank_iban || ''}
                onChange={(e) => setSettings((s) => ({ ...s, bank_iban: e.target.value }))}
                placeholder="PKXX XXXX XXXX XXXX XXXX XXXX"
                className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white font-mono text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingSettings ? 'Saving to Supabase...' : 'Save Settings to PostgreSQL'}</span>
            </button>
          </div>
        </form>
      )}

      {/* 4 Live Database Tabs */}
      <div className="bg-[#111A2E] border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveSubTab('expiring_3d')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'expiring_3d'
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Expiring in 3 Days</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-950/25 font-mono text-[10px]">
              {categorizedSubscribers.expiring3d.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('grace_24h')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'grace_24h'
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Timer className="w-3.5 h-3.5" />
            <span>In {settings.grace_hours}h / Extra Grace Period</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-950/25 font-mono text-[10px]">
              {categorizedSubscribers.inGrace.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('suspended_16')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'suspended_16'
                ? 'bg-rose-500 text-slate-950 border-rose-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Suspended in 16.16.16.0/24</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-950/25 font-mono text-[10px]">
              {categorizedSubscribers.suspended16.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('audit_logs')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-2 ${
              activeSubTab === 'audit_logs'
                ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Permanent Audit &amp; WhatsApp Log</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-950/25 font-mono text-[10px]">
              {auditLogs.length + waLogs.length}
            </span>
          </button>
        </div>

        {/* Sticky Bulk Action Bar when 1+ subscribers are selected in Expiring/Grace/Suspended tabs */}
        {activeSubTab !== 'audit_logs' && selectedRowsInActiveTab.length > 0 && (
          <div className="sticky top-2 z-20 p-3 rounded-xl bg-slate-950/95 backdrop-blur-md border border-cyan-600/60 shadow-2xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold font-mono">
                {selectedRowsInActiveTab.length} Subscriber{selectedRowsInActiveTab.length === 1 ? '' : 's'} Selected
              </span>
              {selectedTotalDueInTab > 0 && (
                <span className="text-amber-300 font-mono font-bold">
                  • Total {formatCurrency(selectedTotalDueInTab, 0)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBulkActivating || isBulkReceiving}
                onClick={handleBulkActivateSelected}
                className="px-3.5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shadow"
              >
                <Zap className={`w-3.5 h-3.5 ${isBulkActivating ? 'animate-pulse' : ''}`} />
                <span>
                  {isBulkActivating
                    ? bulkActivateProgress || 'Restoring MikroTik Profiles...'
                    : '⚡ Bulk Activate (Restore MikroTik Profiles)'}
                </span>
              </button>

              {(activeSubTab === 'suspended_16' || bulkReceivePreviewRows.length > 0) && (
                <button
                  type="button"
                  disabled={isBulkActivating || isBulkReceiving || bulkReceivePreviewRows.length === 0}
                  onClick={() => setIsBulkReceiveModalOpen(true)}
                  className="px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap shadow"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>
                    💰 Bulk Receive Amount ({selectedRowsInActiveTab.length} Selected • Total{' '}
                    {formatCurrency(bulkReceiveModalTotal, 0)})
                  </span>
                </button>
              )}

              <button
                type="button"
                disabled={isBulkActivating || isBulkReceiving}
                onClick={() => setSelectedUsernames({})}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* TAB 1: Expiring in 3 Days */}
        {activeSubTab === 'expiring_3d' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={allInTabSelected}
                      onChange={toggleSelectAllInTab}
                      aria-label="Select all expiring subscribers"
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-sans">Subscriber</th>
                  <th className="py-2.5 px-3">Package</th>
                  <th className="py-2.5 px-3">Expiry (2:00 PM PKT)</th>
                  <th className="py-2.5 px-3 text-right">Due Amount</th>
                  <th className="py-2.5 px-3">Reminder Cycle</th>
                  <th className="py-2.5 px-3 text-right font-sans">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {categorizedSubscribers.expiring3d.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                      No subscribers expiring within the next 3 days.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.expiring3d.map((sub) => {
                    const uname = String(sub.username || '').toLowerCase();
                    const checked = Boolean(selectedUsernames[uname]);
                    return (
                      <tr key={sub.id} className={`hover:bg-slate-900/50 ${checked ? 'bg-cyan-950/20' : ''}`}>
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectOneUser(uname)}
                            aria-label={`Select @${uname}`}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-cyan-400">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.original_package_profile || sub.package_name || sub.package_profile_name || sub.package_speed || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-amber-300 font-semibold">
                            {new Date(sub.effectiveExpiryMs).toISOString().slice(0, 10)}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            In {sub.daysRemaining} day{sub.daysRemaining === 1 ? '' : 's'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-400 font-bold">
                          {formatCurrency(sub.amountDue, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.billing_status === 'REMINDER_SENT' ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300 text-[10px]">
                              SENT ({sub.last_reminder_cycle || 'Current'})
                            </span>
                          ) : (
                            <span className="text-slate-500">Pending 3D Slip</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <button
                              type="button"
                              disabled={Boolean(busyUsernames[uname])}
                              onClick={() => handleShiftBillToNextMonth(sub)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/70 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Shift current bill & cycle to next calendar month (exempt from expiry)"
                            >
                              <FastForward className="w-3 h-3" />
                              <span>Shift Next Month</span>
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(busyUsernames[uname])}
                              onClick={() => handleSendWhatsAppSlip(sub)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              <Send className="w-3 h-3" />
                              <span>Send WhatsApp Slip</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: In 24h Grace Period */}
        {activeSubTab === 'grace_24h' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={allInTabSelected}
                      onChange={toggleSelectAllInTab}
                      aria-label="Select all grace subscribers"
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-sans">Subscriber</th>
                  <th className="py-2.5 px-3">Package</th>
                  <th className="py-2.5 px-3">Grace Ends At</th>
                  <th className="py-2.5 px-3">Remaining</th>
                  <th className="py-2.5 px-3 text-right">Due Amount</th>
                  <th className="py-2.5 px-3 text-right font-sans">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {categorizedSubscribers.inGrace.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                      No subscribers are currently inside the {settings.grace_hours}h grace window.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.inGrace.map((sub) => {
                    const uname = String(sub.username || '').toLowerCase();
                    const busy = Boolean(busyUsernames[uname]);
                    const checked = Boolean(selectedUsernames[uname]);
                    return (
                      <tr key={sub.id} className={`hover:bg-slate-900/50 ${checked ? 'bg-cyan-950/20' : ''}`}>
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectOneUser(uname)}
                            aria-label={`Select @${uname}`}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-cyan-400">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.original_package_profile || sub.package_name || sub.package_profile_name || sub.package_speed || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-cyan-300">
                          {formatDateTimePkt(new Date(sub.graceEndsMs).toISOString())}
                        </td>
                        <td className="py-2.5 px-3">
                          {sub.isExtraGrace ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950 border border-amber-600/80 text-amber-300 font-bold text-[11px]">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>Extra Grace: {formatCountdown(sub.graceEndsMs, nowTickMs)}</span>
                              </span>
                              {sub.extraGraceNote && (
                                <div className="text-[10px] font-sans text-slate-400 max-w-[220px] truncate" title={sub.extraGraceNote}>
                                  {sub.extraGraceNote}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold text-[11px]">
                              {formatCountdown(sub.graceEndsMs, nowTickMs)}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-400 font-bold">
                          {formatCurrency(sub.amountDue, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenEditGraceModal(sub)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Edit grace deadline (+24h / +48h / +72h / custom date & note)"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit Grace</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setRemoveGraceTarget(sub)}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900/80 text-rose-300 border border-rose-800 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Remove / cancel grace period"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Remove Grace</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleShiftBillToNextMonth(sub)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/70 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Shift bill to next month & clear grace"
                            >
                              <FastForward className="w-3 h-3" />
                              <span>Shift Next Mo</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCollectAndRestore(sub)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              <Zap className="w-3 h-3" />
                              <span>Collect &amp; Restore</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: Suspended in 16.16.16.0/24 */}
        {activeSubTab === 'suspended_16' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={allInTabSelected}
                      onChange={toggleSelectAllInTab}
                      aria-label="Select all suspended subscribers"
                      className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-sans">Subscriber</th>
                  <th className="py-2.5 px-3">Adopted MikroTik Profile</th>
                  <th className="py-2.5 px-3">Suspended At</th>
                  <th className="py-2.5 px-3 text-right">Due Amount</th>
                  <th className="py-2.5 px-3 text-right font-sans">Instant 5s Restore</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {categorizedSubscribers.suspended16.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      Zero subscribers currently isolated in the 16.16.16.0/24 expiry pool.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.suspended16.map((sub: any) => {
                    const uname = String(sub.username || '').toLowerCase();
                    const busy = Boolean(busyUsernames[uname]);
                    const checked = Boolean(selectedUsernames[uname]);
                    return (
                      <tr key={sub.id} className={`hover:bg-slate-900/50 ${checked ? 'bg-cyan-950/20' : ''}`}>
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelectOneUser(uname)}
                            aria-label={`Select @${uname}`}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900 accent-cyan-500 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-rose-300">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 font-bold">
                            {sub.adoptedProfile ||
                              sub.original_package_profile ||
                              sub.package_name ||
                              sub.package_profile_name ||
                              'default'}
                          </span>
                          {sub.suspensionReason && (
                            <div className="text-[10px] text-rose-400 mt-1 font-mono">
                              {sub.suspensionReason}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {formatDateTimePkt(
                            sub.suspended_at ||
                              sub.expiry_date ||
                              (sub.effectiveExpiryMs ? new Date(sub.effectiveExpiryMs).toISOString() : null)
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-400 font-bold">
                          {formatCurrency(sub.amountDue, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex flex-wrap items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleShiftBillToNextMonth(sub)}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/70 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Shift bill to next calendar month & restore internet immediately"
                            >
                              <FastForward className="w-3.5 h-3.5" />
                              <span>Shift Next Mo</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleOpenExtraGraceModal(sub)}
                              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/50 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                              title="Temporarily restore internet & grant extra hours to pay"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>⏳ Extra Grace</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCollectAndRestore(sub)}
                              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>{busy ? 'Restoring...' : 'Collect & Restore'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: Permanent Audit & WhatsApp Log */}
        {activeSubTab === 'audit_logs' && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Permanent Expiry Audit Logs */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Permanent Expiry Audit Logs ({auditLogs.length})</span>
                </h4>
                <span className="text-[10px] font-mono text-slate-500">expiry_audit_logs</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                {auditLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    No audit log entries recorded yet.
                  </p>
                ) : (
                  auditLogs.map((log) => (
                    <div
                      key={log.id || `${log.username}-${log.created_at}`}
                      className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-700/70 text-cyan-300 font-bold text-[10px]">
                            {log.action_type}
                          </span>
                          <span className="text-white font-bold">@{log.username}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {formatDateTimePkt(log.created_at)}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        Profile: {log.previous_profile || '—'} →{' '}
                        <span className="text-emerald-300">{log.applied_profile || '—'}</span> · Trigger:{' '}
                        <span className="text-slate-300">{log.triggered_by}</span>
                      </div>
                      {log.notes && <div className="text-slate-300 font-sans">{log.notes}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Persistent WhatsApp Dispatch Ledger */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                  <span>WhatsApp Reminder Dispatch Ledger ({waLogs.length})</span>
                </h4>
                <span className="text-[10px] font-mono text-slate-500">whatsapp_reminder_logs</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
                {waLogs.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">
                    No WhatsApp reminder slips dispatched yet.
                  </p>
                ) : (
                  waLogs.map((w) => (
                    <div
                      key={w.id || `${w.username}-${w.created_at}`}
                      className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-mono space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded font-bold text-[10px] border ${
                              w.status === 'SENT'
                                ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                                : w.status === 'FAILED'
                                ? 'bg-rose-950 border-rose-700 text-rose-300'
                                : 'bg-amber-950 border-amber-700 text-amber-300'
                            }`}
                          >
                            {w.status}
                          </span>
                          <span className="text-white font-bold">@{w.username}</span>
                          <span className="text-slate-400">{w.phone || 'No phone'}</span>
                        </div>
                        <span className="text-amber-400 font-bold">
                          {formatCurrency(Number(w.amount_due) || 0, 0)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Sent: {formatDateTimePkt(w.created_at)} · Expiry:{' '}
                        {w.expiry_date ? String(w.expiry_date).slice(0, 10) : '—'}
                      </div>
                      <p className="text-slate-300 font-sans whitespace-pre-line line-clamp-3">
                        {w.message_body}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Extra Grace Period Modal */}
      {extraGraceTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-md rounded-2xl bg-[#111A2E] border border-amber-700/60 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Grant Extra Grace Period</h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    @{extraGraceTarget.username} · Due {formatCurrency(extraGraceTarget.amountDue || 0, 0)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExtraGraceTarget(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleConfirmExtraGrace} className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Subscriber</span>
                  <span className="text-white font-bold">{extraGraceTarget.full_name || extraGraceTarget.username}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Restoring Package</span>
                  <span className="text-cyan-300 font-mono font-bold">
                    {(extraGraceTarget as any).adoptedProfile ||
                      extraGraceTarget.original_package_profile ||
                      extraGraceTarget.package_name ||
                      extraGraceTarget.package_profile_name ||
                      'default'}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Select Extra Grace Duration
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: '24' as const, label: '+24 Hours (1 Day)' },
                    { id: '48' as const, label: '+48 Hours (2 Days)' },
                    { id: '72' as const, label: '+72 Hours (3 Days)' },
                    { id: 'custom' as const, label: 'Custom Hours' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setExtraGracePreset(opt.id)}
                      className={`px-3 py-2.5 rounded-xl border text-xs font-bold transition cursor-pointer ${
                        extraGracePreset === opt.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {extraGracePreset === 'custom' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">
                      Custom Hours (1 – 720)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      required
                      value={extraGraceCustomHours}
                      onChange={(e) => setExtraGraceCustomHours(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-amber-500"
                    />
                  </div>
                )}

                <div className="text-[11px] font-mono text-amber-300 pt-1">
                  Auto-expires back to {settings.expiry_ppp_profile} at:{' '}
                  <span className="font-bold text-white">
                    {formatDateTimePkt(new Date(Date.now() + resolvedExtraGraceHours * 3_600_000).toISOString())}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Admin Note / Promise to Pay (Optional)
                </label>
                <input
                  type="text"
                  value={extraGraceNoteInput}
                  onChange={(e) => setExtraGraceNoteInput(e.target.value)}
                  placeholder="e.g. Promised cash handover tomorrow"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setExtraGraceTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGrantingExtraGrace}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isGrantingExtraGrace ? 'Restoring & Saving...' : 'Grant Extra Grace'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Edit Grace Period Modal (Extend / Shorten / Custom Date & Note) */}
      {editGraceTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-md rounded-2xl bg-[#111A2E] border border-cyan-700/60 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                  <Edit2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Edit Grace Period Deadline</h3>
                  <p className="text-[11px] font-mono text-slate-400">
                    @{editGraceTarget.username} · Due {formatCurrency(editGraceTarget.amountDue || 0, 0)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditGraceTarget(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSaveEditGrace} className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                  Quick Adjust Grace Deadline
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: '+24h', hours: 24 },
                    { label: '+48h', hours: 48 },
                    { label: '+72h', hours: 72 },
                    { label: '-12h', hours: -12 },
                  ].map((btn) => (
                    <button
                      key={btn.label}
                      type="button"
                      onClick={() => applyQuickDeltaToEditGrace(btn.hours)}
                      className="px-2.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-cyan-300 font-bold text-xs transition cursor-pointer"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Exact Grace Expiry Date &amp; Time
                </label>
                <input
                  type="datetime-local"
                  required
                  value={editGraceDateTimeLocal}
                  onChange={(e) => setEditGraceDateTimeLocal(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">
                  Admin Note / Promise to Pay (Optional)
                </label>
                <input
                  type="text"
                  value={editGraceNote}
                  onChange={(e) => setEditGraceNote(e.target.value)}
                  placeholder="e.g. Extended until salary arrives"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditGraceTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEditGrace}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingEditGrace ? 'Saving...' : 'Save Grace Deadline'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove / Cancel Grace Confirmation Modal */}
      {removeGraceTarget && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-md rounded-2xl bg-[#111A2E] border border-rose-700/60 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Remove / Cancel Grace Period</h3>
                  <p className="text-[11px] font-mono text-rose-300">
                    @{removeGraceTarget.username} · Due {formatCurrency(removeGraceTarget.amountDue || 0, 0)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRemoveGraceTarget(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 cursor-pointer"
              >
                Close
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                This clears <code className="text-white">grace_until</code> for{' '}
                <strong className="text-white">@{removeGraceTarget.username}</strong>.
                {removeGraceTarget.amountDue > 0 ? (
                  <span className="block mt-1.5 text-rose-300">
                    Because this subscriber still has unpaid past-due invoices (
                    {formatCurrency(removeGraceTarget.amountDue, 0)}), removing grace will immediately apply the{' '}
                    <strong className="text-white">{settings.expiry_ppp_profile}</strong> expiry rule &amp; kick
                    active sessions unless shifted to next month.
                  </span>
                ) : (
                  <span className="block mt-1.5 text-emerald-300">
                    No unpaid balance found — subscriber will return cleanly to ACTIVE billing state.
                  </span>
                )}
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRemoveGraceTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemovingGrace}
                  onClick={handleConfirmRemoveGrace}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isRemovingGrace ? 'Removing Grace...' : 'Confirm Remove Grace'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Receive Amount Confirmation Modal */}
      <BulkReceiveAmountModal
        isOpen={isBulkReceiveModalOpen}
        onClose={() => setIsBulkReceiveModalOpen(false)}
        title="Bulk Receive & Auto-Restore Subscribers"
        itemLabel="Dues"
        previewRows={bulkReceivePreviewRows}
        totalAmount={bulkReceiveModalTotal}
        agents={fieldAgents}
        isProcessing={isBulkReceiving}
        progressLabel={bulkReceiveProgress}
        onConfirm={handleConfirmBulkReceive}
      />
    </div>
  );
};

export default ExpiryAutomationView;
