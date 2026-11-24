import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  LogOut,
  MessageSquare,
  Power,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Wifi,
  WifiOff,
  XCircle,
  Clock,
  Building2,
} from 'lucide-react';
import type { SystemRole, UserAccount } from '../types/auth';
import type { SupabaseWhatsappLog } from '../services/supabaseClient';
import {
  buildPortalAuthHeaders,
  DEFAULT_MASTER_COMPANY_NAME,
  WHATSAPP_GATEWAY_MIGRATION_SQL,
} from '../lib/whatsappRouting';

interface WhatsAppGatewayViewProps {
  currentUser: UserAccount | null;
  currentRole: SystemRole;
}

interface SessionStatusPayload {
  portalUserId: string;
  effectiveTier: 'ADMIN' | 'DEALER' | 'SUB_DEALER' | 'OTHER';
  canPairOwnWhatsapp: boolean;
  session: {
    portalUserId: string;
    sessionKey: string;
    status: 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';
    qrDataUrl: string | null;
    phone: string | null;
    lastError: string | null;
    updatedAt: string;
  };
  branding: {
    companyName: string;
    supportPhone: string;
    autoSend: boolean;
  };
  tenantSessions: Array<{
    portalUserId: string;
    username: string;
    fullName: string;
    tier: 'ADMIN' | 'DEALER' | 'SUB_DEALER';
    companyName: string;
    status: string;
    phone: string | null;
    autoSend: boolean;
    allowSubdealerWhatsapp: boolean;
  }>;
  schemaWarning: boolean;
}

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  PROVISION_WELCOME: {
    label: 'Welcome / Provisioned',
    color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  INVOICE_GENERATED: {
    label: 'Monthly Invoice',
    color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  PRE_EXPIRY_3D: {
    label: '3-Day Pre-Expiry',
    color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  AUTO_SUSPENSION: {
    label: 'Auto-Suspension (16.16)',
    color: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  PAYMENT_RESTORED: {
    label: 'Paid & Restored',
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  MANUAL_TEST: {
    label: 'Gateway Test',
    color: 'bg-slate-500/20 text-slate-300 border-slate-600/40',
  },
};

export const WhatsAppGatewayView: React.FC<WhatsAppGatewayViewProps> = ({
  currentUser,
  currentRole,
}) => {
  const [statusData, setStatusData] = useState<SessionStatusPayload | null>(null);
  const [logs, setLogs] = useState<SupabaseWhatsappLog[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Branding form state (never clobbered during QR polling)
  const [companyName, setCompanyName] = useState('');
  const [supportPhone, setSupportPhone] = useState('');
  const [autoSend, setAutoSend] = useState(true);
  const brandingInitializedRef = useRef(false);

  // Test send state
  const [testPhone, setTestPhone] = useState('');
  const [copiedSql, setCopiedSql] = useState(false);

  // Log filters
  const [logSearch, setLogSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'FAILED' | 'SKIPPED'>('ALL');
  const [eventFilter, setEventFilter] = useState<string>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/session/status', {
        headers: buildPortalAuthHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setStatusData(json);
        if (!brandingInitializedRef.current) {
          setCompanyName(json.branding?.companyName || DEFAULT_MASTER_COMPANY_NAME);
          setSupportPhone(json.branding?.supportPhone || '');
          setAutoSend(json.branding?.autoSend !== false);
          brandingInitializedRef.current = true;
        }
      } else if (!silent) {
        setFeedback({ type: 'error', text: json?.error || 'Failed to load WhatsApp session status.' });
      }
    } catch (err: any) {
      if (!silent) {
        setFeedback({ type: 'error', text: err?.message || 'Unable to connect to WhatsApp gateway server.' });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/logs?limit=150', {
        headers: buildPortalAuthHeaders(),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setLogs(Array.isArray(json.logs) ? json.logs : []);
        setTableMissing(Boolean(json.tableMissing));
      }
    } catch {
      // ignore transient poll error
    }
  }, []);

  useEffect(() => {
    brandingInitializedRef.current = false;
    fetchStatus(false);
    fetchLogs();
  }, [currentUser?.id, currentRole, fetchStatus, fetchLogs]);

  // Poll every 2.5s while CONNECTING or QR_READY so QR refresh & instant pair completion appear live
  useEffect(() => {
    const st = statusData?.session?.status;
    if (st !== 'CONNECTING' && st !== 'QR_READY') return;
    const timer = setInterval(() => {
      fetchStatus(true);
    }, 2500);
    return () => clearInterval(timer);
  }, [statusData?.session?.status, fetchStatus]);

  const handleStartSession = async () => {
    setActionLoading('start');
    setFeedback(null);
    try {
      const res = await fetch('/api/whatsapp/session/start', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ type: 'error', text: json?.error || 'Failed to initialize WhatsApp QR session.' });
      } else {
        setFeedback({
          type: 'info',
          text:
            json.session?.status === 'CONNECTED'
              ? `WhatsApp connected (${json.session.phone || 'Active'}).`
              : 'Live QR code generated. Open WhatsApp -> Linked Devices -> Link a Device to scan.',
        });
        await fetchStatus(true);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error starting WhatsApp session.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogoutSession = async () => {
    setActionLoading('logout');
    setFeedback(null);
    try {
      const res = await fetch('/api/whatsapp/session/logout', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ type: 'error', text: json?.error || 'Failed to disconnect WhatsApp session.' });
      } else {
        setFeedback({ type: 'success', text: 'WhatsApp session disconnected and local auth credentials cleared.' });
        await fetchStatus(true);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error disconnecting WhatsApp session.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('branding');
    setFeedback(null);
    try {
      const res = await fetch('/api/whatsapp/branding', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({
          companyName: companyName.trim(),
          supportPhone: supportPhone.trim(),
          autoSend,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ type: 'error', text: json?.error || 'Failed to save branding settings.' });
      } else {
        setFeedback({
          type: 'success',
          text: json.schemaWarning
            ? 'Branding saved (some optional columns require running the WhatsApp SQL migration in Supabase).'
            : `Branding saved! All automated messages will sign as "${json.branding?.companyName}".`,
        });
        await fetchStatus(true);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error saving branding.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTestMessage = async () => {
    const cleanPhone = testPhone.trim();
    if (!cleanPhone) {
      setFeedback({ type: 'error', text: 'Enter a recipient WhatsApp number (e.g. 03001234567) to send a test.' });
      return;
    }
    setActionLoading('test');
    setFeedback(null);
    try {
      const res = await fetch('/api/whatsapp/send-auto', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({
          eventType: 'MANUAL_TEST',
          messageVars: {
            phone: cleanPhone,
            customNote: `Live zero-click Baileys WhatsApp Gateway verification from ${companyName || DEFAULT_MASTER_COMPANY_NAME}.`,
          },
        }),
      });
      const json = await res.json();
      if (json.ok && json.status === 'SENT') {
        setFeedback({
          type: 'success',
          text: `Test message delivered automatically via "${json.senderCompanyName}" to ${cleanPhone}!`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: json.error || json.skippedReason || 'Test delivery failed. Ensure WhatsApp is Connected.',
        });
      }
      await fetchLogs();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Test send request failed.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunPreExpirySweep = async () => {
    setActionLoading('sweep');
    setFeedback(null);
    try {
      const res = await fetch('/api/whatsapp/cron/pre-expiry', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setFeedback({ type: 'error', text: json?.error || 'Failed to run 3-day pre-expiry sweep.' });
      } else {
        setFeedback({
          type: 'success',
          text: `3-Day Pre-Expiry Sweep complete: ${json.scanned} due soon | ${json.sent} Sent | ${json.skipped} Skipped (already sent today) | ${json.failed} Failed.`,
        });
        await fetchLogs();
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error running pre-expiry sweep.' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(WHATSAPP_GATEWAY_MIGRATION_SQL);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      // ignore
    }
  };

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    return logs.filter((row) => {
      if (statusFilter !== 'ALL' && String(row.status || '').toUpperCase() !== statusFilter) {
        return false;
      }
      if (eventFilter !== 'ALL' && String(row.event_type || '').toUpperCase() !== eventFilter) {
        return false;
      }
      if (!q) return true;
      return (
        String(row.subscriber_username || '').toLowerCase().includes(q) ||
        String(row.recipient_phone || '').toLowerCase().includes(q) ||
        String(row.sender_company_name || '').toLowerCase().includes(q) ||
        String(row.message_body || '').toLowerCase().includes(q)
      );
    });
  }, [logs, logSearch, statusFilter, eventFilter]);

  const stats = useMemo(() => {
    const sent = logs.filter((l) => String(l.status).toUpperCase() === 'SENT').length;
    const failed = logs.filter((l) => String(l.status).toUpperCase() === 'FAILED').length;
    const connectedTenants = (statusData?.tenantSessions || []).filter(
      (t) => String(t.status).toUpperCase() === 'CONNECTED'
    ).length;
    return { sent, failed, total: logs.length, connectedTenants };
  }, [logs, statusData]);

  const sessionStatus = statusData?.session?.status || 'DISCONNECTED';
  const canPair = statusData?.canPairOwnWhatsapp ?? false;
  const effectiveTier = statusData?.effectiveTier || 'ADMIN';

  return (
    <div className="space-y-6 pb-10">
      {/* Header Strip */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-[#0d1117] border border-slate-800/90 rounded-2xl p-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100 tracking-tight">
                Multi-Tenant WhatsApp Gateway &amp; Branding
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Zero-click Baileys automated delivery with hierarchical Sub-Dealer &rarr; Dealer &rarr; Master ISP sender routing
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {(effectiveTier === 'ADMIN' || effectiveTier === 'DEALER') && (
            <button
              onClick={handleRunPreExpirySweep}
              disabled={actionLoading === 'sweep'}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-all disabled:opacity-50"
            >
              {actionLoading === 'sweep' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Run 3-Day Pre-Expiry Auto-Send
            </button>
          )}
          <button
            onClick={() => {
              fetchStatus(false);
              fetchLogs();
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Gateway
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-medium ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : feedback.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : feedback.type === 'error' ? (
              <XCircle className="w-4 h-4 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-200 text-xs px-1.5"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Optional Supabase Migration Banner */}
      {(statusData?.schemaWarning || tableMissing) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-300">
                Supabase WhatsApp Gateway Columns / Table Pending Migration
              </p>
              <p className="text-[11px] text-amber-200/80 mt-0.5">
                Live Baileys pairing and background auto-sending are active right now, and logs are buffered in memory. Run the SQL migration in Supabase to persist <code className="text-amber-100">company_name</code>, <code className="text-amber-100">allow_subdealer_whatsapp</code>, and <code className="text-amber-100">whatsapp_logs</code> permanently.
              </p>
            </div>
          </div>
          <button
            onClick={handleCopySql}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold shrink-0 transition-all"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copiedSql ? 'Migration SQL Copied!' : 'Copy WhatsApp SQL'}
          </button>
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your Session Status</p>
          <div className="flex items-center gap-2 mt-2">
            {sessionStatus === 'CONNECTED' ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-slate-500" />
            )}
            <span
              className={`text-sm font-bold ${
                sessionStatus === 'CONNECTED'
                  ? 'text-emerald-400'
                  : sessionStatus === 'QR_READY'
                  ? 'text-amber-400'
                  : 'text-slate-300'
              }`}
            >
              {sessionStatus === 'CONNECTED'
                ? statusData?.session?.phone || 'Connected'
                : sessionStatus === 'QR_READY'
                ? 'Awaiting QR Scan'
                : sessionStatus === 'CONNECTING'
                ? 'Connecting...'
                : 'Disconnected'}
            </span>
          </div>
        </div>

        <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Active Tenant Sessions</p>
          <p className="text-2xl font-bold text-cyan-400 mt-1 tabular-nums">{stats.connectedTenants}</p>
        </div>

        <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Auto-Sent (Delivered)</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1 tabular-nums">{stats.sent}</p>
        </div>

        <div className="bg-[#0d1117] border border-slate-800 rounded-xl p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Failed Deliveries</p>
          <p className="text-2xl font-bold text-rose-400 mt-1 tabular-nums">{stats.failed}</p>
        </div>
      </div>

      {/* Main 2-Column Workspace: QR Scanner + Branding Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Live QR Scanner & Device Control */}
        <div className="lg:col-span-6 bg-[#0d1117] border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Live Baileys WhatsApp Pairing
                </h3>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${
                  sessionStatus === 'CONNECTED'
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : sessionStatus === 'QR_READY'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : sessionStatus === 'CONNECTING'
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {sessionStatus}
              </span>
            </div>

            {!canPair && effectiveTier === 'SUB_DEALER' ? (
              <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-5 text-center space-y-2.5">
                <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
                <p className="text-sm font-bold text-slate-100">
                  Own WhatsApp Pairing Disabled by Parent Dealer / Admin
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Your Parent Dealer or Master ISP Admin has not enabled{' '}
                  <strong className="text-slate-200">Allow Sub-Dealer Own WhatsApp</strong> for your
                  account yet. All automated notifications for your subscribers automatically route
                  through your Parent Dealer&apos;s WhatsApp or{' '}
                  <strong className="text-emerald-300">Youth Net Service</strong>.
                </p>
              </div>
            ) : (
              <div className="bg-[#090d14] border border-slate-800/90 rounded-xl p-5 flex flex-col items-center justify-center min-h-[270px] text-center">
                {sessionStatus === 'CONNECTED' ? (
                  <div className="space-y-3">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
                      <Smartphone className="w-8 h-8 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-base font-bold text-emerald-300">
                        Connected: {statusData?.session?.phone || 'Active WhatsApp'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Session ID: <code className="text-slate-300">{statusData?.session?.sessionKey}</code>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Background auto-sending is active for all 5 lifecycle events with zero popups.
                      </p>
                    </div>
                    <button
                      onClick={handleLogoutSession}
                      disabled={actionLoading === 'logout'}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      {actionLoading === 'logout' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <LogOut className="w-3.5 h-3.5" />
                      )}
                      Disconnect &amp; Unlink Device
                    </button>
                  </div>
                ) : sessionStatus === 'QR_READY' && statusData?.session?.qrDataUrl ? (
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded-2xl shadow-lg inline-block">
                      <img
                        src={statusData.session.qrDataUrl}
                        alt="WhatsApp Pairing QR Code"
                        className="w-56 h-56 object-contain"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-amber-300">
                        Scan QR to Pair Your WhatsApp Number
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Open WhatsApp &rarr; Menu (&vellip;) &rarr; Linked Devices &rarr; Link a Device
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleStartSession}
                        disabled={actionLoading === 'start'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Regenerate QR
                      </button>
                      <button
                        onClick={handleLogoutSession}
                        disabled={actionLoading === 'logout'}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-[11px] font-semibold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : sessionStatus === 'CONNECTING' ? (
                  <div className="space-y-3">
                    <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
                    <p className="text-sm font-semibold text-cyan-300">
                      Connecting to WhatsApp Multi-Device Gateway...
                    </p>
                    <p className="text-xs text-slate-400">
                      Generating live QR code — this takes 2 to 5 seconds.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto">
                      <QrCode className="w-7 h-7 text-slate-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-200">
                        No WhatsApp Number Linked
                      </p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm">
                        Pair your business WhatsApp to send automated welcome credentials, invoices, 3-day reminders, suspension notices, and paid receipts under your Company Name.
                      </p>
                      {statusData?.session?.lastError && (
                        <p className="text-[11px] text-rose-400 mt-2">
                          Last status: {statusData.session.lastError}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleStartSession}
                      disabled={actionLoading === 'start'}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all disabled:opacity-50"
                    >
                      {actionLoading === 'start' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <QrCode className="w-4 h-4" />
                      )}
                      Generate Live QR &amp; Pair WhatsApp
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Quick Zero-Click Test Box */}
          {canPair && (
            <div className="pt-3 border-t border-slate-800/80">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Zero-Click Live Test Message
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="e.g. 03001234567 or +923001234567"
                  className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60"
                />
                <button
                  onClick={handleSendTestMessage}
                  disabled={actionLoading === 'test' || sessionStatus !== 'CONNECTED'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold transition-all"
                >
                  {actionLoading === 'test' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  Send Test
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Company Branding & Auto-Send Configuration */}
        <form
          onSubmit={handleSaveBranding}
          className="lg:col-span-6 bg-[#0d1117] border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-5"
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-sm font-bold text-slate-100">
                  Company Branding &amp; Automation Controls
                </h3>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700">
                {effectiveTier}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Company Display Name (Signed on Every Outgoing Client Message)
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g. Youth Net Service or Ali Fiber Net"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Support Helpline Number (Shown in Message Footer)
              </label>
              <input
                type="text"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                placeholder="e.g. +92 323 4193599"
                className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            {/* Auto-Send Master Switch */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Power className={`w-4 h-4 ${autoSend ? 'text-emerald-400' : 'text-slate-500'}`} />
                  <p className="text-xs font-bold text-slate-100">
                    Auto-Send Master Switch (Zero-Click Background Delivery)
                  </p>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Automatically sends Welcome Credentials, Monthly Bills, 3-Day Pre-Expiry Reminders, Auto-Suspension Notices, and Payment Receipts with zero manual popups.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAutoSend((v) => !v)}
                className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${
                  autoSend ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
                aria-label="Toggle Auto-Send"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    autoSend ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Hierarchical Routing Info Box */}
            <div className="bg-[#090d14] border border-slate-800/80 rounded-xl p-3.5 space-y-1.5">
              <p className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Hierarchical Sender Routing Priority
              </p>
              <ol className="text-[11px] text-slate-400 space-y-1 list-decimal list-inside">
                <li>
                  <strong className="text-slate-200">Sub-Dealer WhatsApp</strong> (if linked &amp; permitted via{' '}
                  <code className="text-slate-300">Allow Sub-Dealer Own WhatsApp</code>) &rarr; signed with Sub-Dealer Company Name.
                </li>
                <li>
                  <strong className="text-slate-200">Parent Dealer WhatsApp</strong> (if linked) &rarr; signed with Dealer Company Name.
                </li>
                <li>
                  <strong className="text-slate-200">Master ISP Fallback</strong> &rarr; sent via Master Admin session signed as{' '}
                  <strong className="text-emerald-300">Youth Net Service</strong>.
                </li>
              </ol>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-800/80">
            <button
              type="submit"
              disabled={actionLoading === 'branding'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all disabled:opacity-50"
            >
              {actionLoading === 'branding' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              Save Company Branding &amp; Auto-Send
            </button>
          </div>
        </form>
      </div>

      {/* Multi-Tenant Sessions Table (Visible to Admin & Dealers) */}
      {(effectiveTier === 'ADMIN' || effectiveTier === 'DEALER') &&
        (statusData?.tenantSessions?.length || 0) > 0 && (
          <div className="bg-[#0d1117] border border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Multi-Tenant WhatsApp Sessions ({statusData?.tenantSessions.length})
              </h3>
              <span className="text-[11px] text-slate-400">
                Independent Baileys sockets per Admin, Dealer &amp; Permitted Sub-Dealer
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/40">
                    <th className="py-2.5 px-4">Tenant / Username</th>
                    <th className="py-2.5 px-4">Tier</th>
                    <th className="py-2.5 px-4">Company Display Name</th>
                    <th className="py-2.5 px-4">Linked Phone</th>
                    <th className="py-2.5 px-4">Auto-Send</th>
                    <th className="py-2.5 px-4">Gateway Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {statusData?.tenantSessions.map((t) => (
                    <tr key={t.portalUserId} className="hover:bg-slate-800/30">
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-slate-200">{t.fullName}</p>
                        <p className="text-[10px] text-slate-500">@{t.username}</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.tier === 'ADMIN'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : t.tier === 'DEALER'
                              ? 'bg-cyan-500/15 text-cyan-300'
                              : 'bg-indigo-500/15 text-indigo-300'
                          }`}
                        >
                          {t.tier}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-200 font-medium">{t.companyName}</td>
                      <td className="py-2.5 px-4 text-slate-300 font-mono text-[11px]">
                        {t.phone || '—'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`text-[11px] font-semibold ${
                            t.autoSend ? 'text-emerald-400' : 'text-slate-500'
                          }`}
                        >
                          {t.autoSend ? 'ON' : 'OFF'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.status === 'CONNECTED'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : t.status === 'QR_READY'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              t.status === 'CONNECTED'
                                ? 'bg-emerald-400'
                                : t.status === 'QR_READY'
                                ? 'bg-amber-400'
                                : 'bg-slate-500'
                            }`}
                          />
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {/* Scoped Real-Time Delivery Log */}
      <div className="bg-[#0d1117] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Scoped WhatsApp Delivery Log ({filteredLogs.length})
            </h3>
            <p className="text-[11px] text-slate-400">
              Real-time background send history strictly isolated to your account scope
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search user, phone, company..."
                className="bg-slate-900 border border-slate-700/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
              />
            </div>

            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="ALL">All Events</option>
              <option value="PROVISION_WELCOME">Welcome / Provisioned</option>
              <option value="INVOICE_GENERATED">Monthly Invoice</option>
              <option value="PRE_EXPIRY_3D">3-Day Pre-Expiry</option>
              <option value="AUTO_SUSPENSION">Auto-Suspension</option>
              <option value="PAYMENT_RESTORED">Paid &amp; Restored</option>
              <option value="MANUAL_TEST">Gateway Test</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
            >
              <option value="ALL">All Status</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
              <option value="SKIPPED">SKIPPED</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No WhatsApp delivery logs recorded yet. Pair your WhatsApp above or run a test send.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/40">
                  <th className="py-2.5 px-4">Time</th>
                  <th className="py-2.5 px-4">Event</th>
                  <th className="py-2.5 px-4">Subscriber</th>
                  <th className="py-2.5 px-4">Recipient</th>
                  <th className="py-2.5 px-4">Sender Company</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Message / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredLogs.map((row) => {
                  const ev = EVENT_LABELS[String(row.event_type || '').toUpperCase()] || {
                    label: row.event_type,
                    color: 'bg-slate-800 text-slate-300 border-slate-700',
                  };
                  const st = String(row.status || '').toUpperCase();
                  const isExpanded = expandedLogId === row.id;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setExpandedLogId(isExpanded ? null : row.id)}
                      className="hover:bg-slate-800/30 cursor-pointer align-top"
                    >
                      <td className="py-2.5 px-4 text-[11px] text-slate-400 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {row.created_at
                            ? new Date(row.created_at).toLocaleString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${ev.color}`}
                        >
                          {ev.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-200">
                        {row.subscriber_username ? `@${row.subscriber_username}` : 'Direct Test'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                        {row.recipient_phone}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-semibold text-slate-200">{row.sender_company_name}</p>
                        <p className="text-[10px] text-slate-500">
                          {row.sender_tier || 'ADMIN'}
                          {row.sender_phone ? ` · ${row.sender_phone}` : ''}
                        </p>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            st === 'SENT'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : st === 'FAILED'
                              ? 'bg-rose-500/15 text-rose-300'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {st === 'SENT' ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {st}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 max-w-md">
                        <p
                          className={`text-[11px] text-slate-300 whitespace-pre-wrap ${
                            isExpanded ? '' : 'line-clamp-2'
                          }`}
                        >
                          {row.message_body}
                        </p>
                        {row.error_message && (
                          <p className="text-[10px] text-rose-400 mt-1">{row.error_message}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
