import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
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
import { restoreSubscriberOnInvoicePaid } from '../lib/billingAndNetwork';
import { openWhatsAppLink } from '../lib/whatsappBilling';
import { EXPIRY_MIGRATION_SQL } from '../lib/expiryMigrationSql';
import {
  DEFAULT_ISP_BILLING_SETTINGS,
  buildBilingualPaymentSlip,
  isMissingTableOrColumnError,
  loadBillingSettingsFromDb,
  parseExpiryDateWithCutoffMs,
} from '../lib/expiryUtils';

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

  const [activeSubTab, setActiveSubTab] = useState<ExpiryTabKey>('expiring_3d');
  const [settings, setSettings] = useState<SupabaseIspBillingSettings>({
    ...DEFAULT_ISP_BILLING_SETTINGS,
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(true);
  const [mikrotikProfiles, setMikrotikProfiles] = useState<string[]>([]);

  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);
  const [openInvoices, setOpenInvoices] = useState<SupabaseInvoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<SupabaseExpiryAuditLog[]>([]);
  const [waLogs, setWaLogs] = useState<SupabaseWhatsappReminderLog[]>([]);

  const [missingSchemaItems, setMissingSchemaItems] = useState<string[]>([]);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSavingSettings, setIsSavingSettings] = useState<boolean>(false);
  const [isRunningSweep, setIsRunningSweep] = useState<boolean>(false);
  const [busyUsernames, setBusyUsernames] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showNotice = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 6000);
  }, []);

  const fetchMikrotikProfilesList = useCallback(async () => {
    try {
      const res = await safeMikrotikFetch('/api/mikrotik/ppp/profile', {}, activeRouter);
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          const names = json
            .map((p: any) => String(p?.name || '').trim())
            .filter(Boolean);
          setMikrotikProfiles(Array.from(new Set(names)));
        }
      }
    } catch {}
  }, [activeRouter]);

  const fetchAllDatabaseState = useCallback(async () => {
    setIsLoading(true);
    const missing = new Set<string>();
    try {
      const [settingsRes, clientsRes, invRes, auditRes, waRes] = await Promise.all([
        loadBillingSettingsFromDb(supabase),
        supabase.from('portal_users').select('*').eq('role', 'CLIENT').order('username', { ascending: true }),
        supabase.from('invoices').select('*').neq('status', 'PAID'),
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
      ]);

      setSettings(settingsRes.settings);
      if (!settingsRes.tableExists) {
        missing.add('isp_billing_settings');
      }

      if (clientsRes.data) {
        setSubscribers(clientsRes.data as SupabasePortalUser[]);
      }
      if (invRes.data) {
        setOpenInvoices(invRes.data as SupabaseInvoice[]);
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
      supabase.removeChannel(ch);
    };
  }, [fetchAllDatabaseState, fetchMikrotikProfilesList]);

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
      await fetchAllDatabaseState();
    } catch (err: any) {
      showNotice(`Sweep error: ${err?.message || 'Unable to execute /api/billing/run-expiry-check'}`, 'error');
    } finally {
      setIsRunningSweep(false);
    }
  };

  // Compute unpaid map & classify subscribers strictly from live Supabase rows
  const unpaidByUser = useMemo(() => {
    const map: Record<string, { amountDue: number; earliestDueDate: string | null; invoiceIds: string[] }> = {};
    for (const inv of openInvoices) {
      const uname = String(inv.subscriber_username || '').trim().toLowerCase();
      if (!uname) continue;
      const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
      if (bal <= 0) continue;
      if (!map[uname]) {
        map[uname] = { amountDue: 0, earliestDueDate: null, invoiceIds: [] };
      }
      map[uname].amountDue += bal;
      map[uname].invoiceIds.push(inv.id);
      if (inv.due_date && (!map[uname].earliestDueDate || inv.due_date < map[uname].earliestDueDate!)) {
        map[uname].earliestDueDate = inv.due_date;
      }
    }
    return map;
  }, [openInvoices]);

  const categorizedSubscribers = useMemo(() => {
    const nowMs = Date.now();
    const threeDaysMs = 3 * 86_400_000;
    const graceHours = Math.max(0, Number(settings.grace_hours) || 24);

    const expiring3d: Array<
      SupabasePortalUser & { amountDue: number; effectiveExpiryMs: number; daysRemaining: number }
    > = [];
    const inGrace: Array<
      SupabasePortalUser & { amountDue: number; effectiveExpiryMs: number; graceEndsMs: number }
    > = [];
    const suspended16: Array<
      SupabasePortalUser & { amountDue: number; effectiveExpiryMs: number | null }
    > = [];

    for (const sub of subscribers) {
      const uname = String(sub.username || '').trim().toLowerCase();
      const unpaid = unpaidByUser[uname];
      const amountDue = unpaid?.amountDue || Number(sub.monthly_fee) || 2500;
      const billingStatus = String(sub.billing_status || '').toUpperCase();
      const accountStatus = String(sub.account_status || 'ACTIVE').toUpperCase();

      const rawExpiry = sub.expiry_date || unpaid?.earliestDueDate || null;
      const expiryMs = parseExpiryDateWithCutoffMs(rawExpiry, settings.cutoff_time_pkt || '14:00');
      const graceEndsMs = sub.grace_ends_at
        ? Date.parse(String(sub.grace_ends_at))
        : expiryMs
        ? expiryMs + graceHours * 3_600_000
        : null;

      if (
        billingStatus === 'SUSPENDED_EXPIRED' ||
        accountStatus === 'EXPIRED' ||
        accountStatus === 'SUSPENDED'
      ) {
        suspended16.push({ ...sub, amountDue, effectiveExpiryMs: expiryMs });
        continue;
      }

      if (
        billingStatus === 'GRACE_PERIOD' ||
        (expiryMs !== null && graceEndsMs !== null && nowMs >= expiryMs && nowMs < graceEndsMs)
      ) {
        inGrace.push({
          ...sub,
          amountDue,
          effectiveExpiryMs: expiryMs || nowMs,
          graceEndsMs: graceEndsMs || nowMs + graceHours * 3_600_000,
        });
        continue;
      }

      if (expiryMs !== null && nowMs >= expiryMs && graceEndsMs !== null && nowMs >= graceEndsMs) {
        suspended16.push({ ...sub, amountDue, effectiveExpiryMs: expiryMs });
        continue;
      }

      if (
        expiryMs !== null &&
        nowMs < expiryMs &&
        expiryMs <= nowMs + threeDaysMs
      ) {
        const daysRemaining = Math.max(0, Math.ceil((expiryMs - nowMs) / 86_400_000));
        expiring3d.push({
          ...sub,
          amountDue,
          effectiveExpiryMs: expiryMs,
          daysRemaining,
        });
      }
    }

    return { expiring3d, inGrace, suspended16 };
  }, [subscribers, unpaidByUser, settings.cutoff_time_pkt, settings.grace_hours]);

  // 1-Click Send WhatsApp Slip + Log to whatsapp_reminder_logs & expiry_audit_logs
  const handleSendWhatsAppSlip = async (
    sub: SupabasePortalUser & { amountDue: number; effectiveExpiryMs: number }
  ) => {
    const uname = String(sub.username || '').trim().toLowerCase();
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    const nowIso = new Date().toISOString();

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
          subscriber_id: sub.id,
          username: uname,
          phone: sub.phone || null,
          message_body: slip,
          amount_due: sub.amountDue,
          expiry_date: new Date(sub.effectiveExpiryMs).toISOString(),
          status: 'SENT',
          created_at: nowIso,
        },
      ]);

      await supabase
        .from('portal_users')
        .update({ billing_status: 'REMINDER_SENT', last_reminder_cycle: cycleKey })
        .eq('id', sub.id);

      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: sub.id,
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

  // +24h Extend Grace persisted directly to Supabase portal_users & expiry_audit_logs
  const handleExtendGrace24h = async (
    sub: SupabasePortalUser & { graceEndsMs: number }
  ) => {
    const uname = String(sub.username || '').trim().toLowerCase();
    setBusyUsernames((p) => ({ ...p, [uname]: true }));
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    try {
      const baseMs = Math.max(nowMs, sub.graceEndsMs || nowMs);
      const nextGraceIso = new Date(baseMs + 24 * 3_600_000).toISOString();

      const { error } = await supabase
        .from('portal_users')
        .update({
          billing_status: 'GRACE_PERIOD',
          grace_ends_at: nextGraceIso,
        })
        .eq('id', sub.id);

      if (error) {
        throw new Error(error.message);
      }

      await supabase.from('expiry_audit_logs').insert([
        {
          subscriber_id: sub.id,
          username: uname,
          action_type: 'GRACE_EXTENDED',
          previous_profile: sub.package_profile_name || sub.package_speed || null,
          applied_profile: sub.package_profile_name || sub.package_speed || null,
          triggered_by: 'ADMIN',
          notes: `Grace extended +24h in Supabase until ${nextGraceIso}`,
          created_at: nowIso,
        },
      ]);

      showNotice(`Extended +24h grace for @${uname} until ${formatDateTimePkt(nextGraceIso)}.`, 'success');
      await fetchAllDatabaseState();
    } catch (err: any) {
      showNotice(`Unable to extend grace for @${uname}: ${err?.message}`, 'error');
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
    const nextDueDate = new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0];

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

      // 2. Atomic DB +30d + MikroTik profile restore + active 16.16.16.x kick + RESTORED_ON_PAYMENT log
      const restoreRes = await restoreSubscriberOnInvoicePaid(uname, {
        triggeredBy: 'ADMIN',
        expiryProfileName: settings.expiry_ppp_profile,
        notes: `1-Click Collect & Restore (${formatCurrency(sub.amountDue, 0)} settled)`,
      });

      showNotice(
        `Restored @${uname} to "${restoreRes.restoredProfile}" (+30d expiry: ${restoreRes.newExpiryIso.slice(
          0,
          10
        )} · Kicked ${restoreRes.kickedSessions} session${restoreRes.kickedSessions === 1 ? '' : 's'}).`,
        'success'
      );
      await fetchAllDatabaseState();
    } catch (err: any) {
      showNotice(`Collect & Restore error for @${uname}: ${err?.message}`, 'error');
    } finally {
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
            <span>In {settings.grace_hours}h Grace Period</span>
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

        {/* TAB 1: Expiring in 3 Days */}
        {activeSubTab === 'expiring_3d' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
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
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      No subscribers expiring within the next 3 days.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.expiring3d.map((sub) => {
                    const uname = String(sub.username || '').toLowerCase();
                    return (
                      <tr key={sub.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-cyan-400">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.package_speed || sub.package_profile_name || 'Standard'}
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
                          <button
                            type="button"
                            disabled={Boolean(busyUsernames[uname])}
                            onClick={() => handleSendWhatsAppSlip(sub)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                          >
                            <Send className="w-3 h-3" />
                            <span>Send WhatsApp Slip</span>
                          </button>
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
                    <td colSpan={6} className="py-8 text-center text-slate-500 font-sans">
                      No subscribers are currently inside the {settings.grace_hours}h grace window.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.inGrace.map((sub) => {
                    const uname = String(sub.username || '').toLowerCase();
                    const busy = Boolean(busyUsernames[uname]);
                    return (
                      <tr key={sub.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-cyan-400">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {sub.package_speed || sub.package_profile_name || 'Standard'}
                        </td>
                        <td className="py-2.5 px-3 text-cyan-300">
                          {formatDateTimePkt(new Date(sub.graceEndsMs).toISOString())}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-700 text-cyan-300 font-bold text-[11px]">
                            {formatCountdown(sub.graceEndsMs, Date.now())}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-400 font-bold">
                          {formatCurrency(sub.amountDue, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleExtendGrace24h(sub)}
                              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-semibold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                            >
                              <Clock className="w-3 h-3" />
                              <span>+24h Extend Grace</span>
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleCollectAndRestore(sub)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
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
                  <th className="py-2.5 px-3 font-sans">Subscriber</th>
                  <th className="py-2.5 px-3">Backed-Up Profile</th>
                  <th className="py-2.5 px-3">Suspended At</th>
                  <th className="py-2.5 px-3 text-right">Due Amount</th>
                  <th className="py-2.5 px-3 text-right font-sans">Instant 5s Restore</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {categorizedSubscribers.suspended16.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                      Zero subscribers currently isolated in the 16.16.16.0/24 expiry pool.
                    </td>
                  </tr>
                ) : (
                  categorizedSubscribers.suspended16.map((sub) => {
                    const uname = String(sub.username || '').toLowerCase();
                    const busy = Boolean(busyUsernames[uname]);
                    return (
                      <tr key={sub.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-white">{sub.full_name}</div>
                          <div className="text-[11px] font-mono text-rose-300">
                            @{sub.username} · {sub.phone || 'No phone'}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300 font-bold">
                            {sub.original_package_profile ||
                              sub.package_profile_name ||
                              sub.package_speed ||
                              '20Mbps'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {formatDateTimePkt(sub.suspended_at || sub.expiry_date)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-rose-400 font-bold">
                          {formatCurrency(sub.amountDue, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleCollectAndRestore(sub)}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>{busy ? 'Restoring...' : 'Collect & Restore'}</span>
                          </button>
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
    </div>
  );
};

export default ExpiryAutomationView;
