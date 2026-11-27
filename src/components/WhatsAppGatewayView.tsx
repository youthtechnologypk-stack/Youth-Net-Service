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
  Server,
  PlugZap,
  X,
} from 'lucide-react';
import type { SystemRole, UserAccount } from '../types/auth';
import type { SupabaseWhatsappLog } from '../services/supabaseClient';
import {
  buildPortalAuthHeaders,
  DEFAULT_MASTER_COMPANY_NAME,
  getConfiguredWhatsAppGatewayUrl,
  getDisplayWhatsAppGatewayUrl,
  loadPersistedWhatsAppGatewayUrl,
  normalizeWhatsAppGatewayUrl,
  safeWhatsAppApiFetch,
  saveWhatsAppGatewayUrl,
  WHATSAPP_GATEWAY_MIGRATION_SQL,
} from '../lib/whatsappRouting';
import { WhatsAppTemplatesAndBroadcastPanel } from './WhatsAppTemplatesAndBroadcastPanel';

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
  PORTAL_CREDENTIALS: {
    label: 'Account Credentials',
    color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  INVOICE_GENERATED: {
    label: 'Monthly Invoice (+31d)',
    color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  PRE_EXPIRY_3D: {
    label: '3-Day Pre-Expiry',
    color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  GRACE_PERIOD_3D: {
    label: '3-Day Grace Notice',
    color: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  AUTO_SUSPENSION: {
    label: 'Auto-Suspension (16.16)',
    color: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  },
  PAYMENT_RESTORED: {
    label: 'Paid Receipt (Client)',
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  AGENT_PAYMENT_RECEIPT: {
    label: 'Agent Cash Confirmed',
    color: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  },
  COMPLAINT_CREATED_CLIENT: {
    label: 'Complaint (Client)',
    color: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  COMPLAINT_CREATED_GROUP: {
    label: 'Complaint (Team Group)',
    color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
  },
  COMPLAINT_RESOLVED_CLIENT: {
    label: 'Complaint Solved',
    color: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  },
  CUSTOM_MESSAGE: {
    label: 'Custom Broadcast',
    color: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
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

  // Gateway Server URL state (for Netlify / external self-hosted Baileys Node.js server)
  const [gatewayUrlInput, setGatewayUrlInput] = useState<string>(() => getConfiguredWhatsAppGatewayUrl());
  const [activeGatewayUrl, setActiveGatewayUrl] = useState<string>(() => getConfiguredWhatsAppGatewayUrl());
  const [gatewayUnreachable, setGatewayUnreachable] = useState<string | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<{
    state: 'idle' | 'testing' | 'online' | 'offline';
    message: string;
  }>({ state: 'idle', message: '' });

  // QR Pairing Modal & Floating Connected Toast
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [connectedToast, setConnectedToast] = useState<string | null>(null);
  const prevSessionStatusRef = useRef<string>('DISCONNECTED');

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

  const isMasterAdmin =
    String(currentRole || '').toUpperCase() === 'ADMIN' ||
    String(currentUser?.role || '').toUpperCase() === 'ADMIN';

  const fetchStatus = useCallback(
    async (silent = false, overrideUrl?: string) => {
      if (!silent) setLoading(true);
      const targetBase = overrideUrl !== undefined ? overrideUrl : activeGatewayUrl;

      // Poll /api/whatsapp/status first, transparently falling back to /api/whatsapp/session/status for older gateways
      let result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/status',
        { headers: buildPortalAuthHeaders() },
        targetBase
      );
      if (result.httpStatus === 404) {
        result = await safeWhatsAppApiFetch<any>(
          '/api/whatsapp/session/status',
          { headers: buildPortalAuthHeaders() },
          targetBase
        );
      }

      if (result.isGatewayUnreachable) {
        setGatewayUnreachable(result.error);
        setGatewayHealth({
          state: 'offline',
          message: `Unreachable at ${result.gatewayUrl}`,
        });
        if (!silent) setLoading(false);
        return;
      }

      setGatewayUnreachable(null);
      if (result.ok && result.data?.success) {
        const json = result.data;
        const normalizedLower = String(
          json.status || json.session?.status || 'disconnected'
        ).toLowerCase();
        const prevLower = String(prevSessionStatusRef.current || '').toLowerCase();

        setStatusData(json);
        setGatewayHealth({
          state: 'online',
          message: `Connected to ${result.gatewayUrl}`,
        });
        if (!brandingInitializedRef.current) {
          setCompanyName(json.branding?.companyName || DEFAULT_MASTER_COMPANY_NAME);
          setSupportPhone(json.branding?.supportPhone || '');
          setAutoSend(json.branding?.autoSend !== false);
          brandingInitializedRef.current = true;
        }

        // Auto-close QR pairing modal with green "WhatsApp Connected!" toast immediately upon pairing
        if (normalizedLower === 'connected') {
          if (isQrModalOpen || prevLower === 'qr_ready' || prevLower === 'connecting') {
            setIsQrModalOpen(false);
            const linkedPhone = json.phone || json.session?.phone || '';
            const msg = linkedPhone
              ? `WhatsApp Connected! (${linkedPhone})`
              : 'WhatsApp Connected!';
            setConnectedToast(msg);
            setFeedback({ type: 'success', text: msg });
            window.setTimeout(() => {
              setConnectedToast((cur) => (cur === msg ? null : cur));
            }, 6000);
          }
        }
        prevSessionStatusRef.current = normalizedLower;
      } else if (!silent) {
        setFeedback({
          type: 'error',
          text: result.error || result.data?.error || 'Failed to load WhatsApp session status.',
        });
      }
      if (!silent) setLoading(false);
    },
    [activeGatewayUrl, isQrModalOpen]
  );

  const fetchLogs = useCallback(
    async (overrideUrl?: string) => {
      const targetBase = overrideUrl !== undefined ? overrideUrl : activeGatewayUrl;
      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/logs?limit=150',
        { headers: buildPortalAuthHeaders() },
        targetBase
      );
      if (!result.isGatewayUnreachable && result.ok && result.data?.success) {
        setLogs(Array.isArray(result.data.logs) ? result.data.logs : []);
        setTableMissing(Boolean(result.data.tableMissing));
      }
    },
    [activeGatewayUrl]
  );

  useEffect(() => {
    let active = true;
    brandingInitializedRef.current = false;
    loadPersistedWhatsAppGatewayUrl().then((persistedUrl) => {
      if (!active) return;
      setGatewayUrlInput(persistedUrl);
      setActiveGatewayUrl(persistedUrl);
      fetchStatus(false, persistedUrl);
      fetchLogs(persistedUrl);
    });
    return () => {
      active = false;
    };
  }, [currentUser?.id, currentRole]);

  // Poll /api/whatsapp/status every 2 seconds while QR modal is displayed or session is CONNECTING / QR_READY
  useEffect(() => {
    const st = String(statusData?.session?.status || '').toUpperCase();
    const shouldPoll = isQrModalOpen || st === 'CONNECTING' || st === 'QR_READY';
    if (!shouldPoll) return;
    if (gatewayUnreachable) return;
    const timer = setInterval(() => {
      fetchStatus(true);
    }, 2000);
    return () => clearInterval(timer);
  }, [isQrModalOpen, statusData?.session?.status, gatewayUnreachable, fetchStatus]);

  const handleTestGatewayConnection = async () => {
    const check = normalizeWhatsAppGatewayUrl(gatewayUrlInput);
    if (!check.valid) {
      setGatewayHealth({ state: 'offline', message: check.error || 'Invalid Gateway URL.' });
      setFeedback({ type: 'error', text: check.error || 'Invalid Gateway URL.' });
      return;
    }
    setGatewayHealth({ state: 'testing', message: 'Testing Baileys Gateway...' });
    setFeedback(null);

    const res = await safeWhatsAppApiFetch<any>(
      '/api/whatsapp/health',
      { method: 'GET', headers: { Accept: 'application/json' } },
      check.normalized
    );

    if (res.isGatewayUnreachable || !res.ok || !res.data?.success) {
      const msg =
        res.error ||
        `Baileys WhatsApp Gateway Server is unreachable at ${getDisplayWhatsAppGatewayUrl(check.normalized)}. Start the Node.js Baileys server or set your Gateway URL below.`;
      setGatewayUnreachable(msg);
      setGatewayHealth({ state: 'offline', message: `Offline at ${res.gatewayUrl}` });
      setFeedback({ type: 'error', text: msg });
      return;
    }

    setGatewayUnreachable(null);
    const activeCount = Number(res.data?.connectedSessionsCount ?? res.data?.activeSessionsCount ?? 0);
    setGatewayHealth({
      state: 'online',
      message: `Online at ${res.gatewayUrl} (${activeCount} connected session${activeCount === 1 ? '' : 's'})`,
    });
    setFeedback({
      type: 'success',
      text: `Baileys WhatsApp Gateway is ONLINE at ${res.gatewayUrl}!`,
    });
  };

  const handleSaveGatewayUrl = async () => {
    setActionLoading('gateway_url');
    setFeedback(null);
    const saved = await saveWhatsAppGatewayUrl(gatewayUrlInput);
    if (!saved.ok) {
      setFeedback({ type: 'error', text: saved.error || 'Invalid Gateway URL.' });
      setActionLoading(null);
      return;
    }

    setGatewayUrlInput(saved.normalizedUrl);
    setActiveGatewayUrl(saved.normalizedUrl);
    setFeedback({
      type: 'success',
      text: saved.normalizedUrl
        ? `Gateway URL saved (${saved.normalizedUrl})${saved.savedToSupabase ? ' to Supabase & browser' : ' locally'}. Reconnecting...`
        : 'Gateway URL reset to same-origin integrated server. Reconnecting...',
    });
    await fetchStatus(false, saved.normalizedUrl);
    await fetchLogs(saved.normalizedUrl);
    setActionLoading(null);
  };

  const handleStartSession = async () => {
    setActionLoading('start');
    setFeedback(null);
    setIsQrModalOpen(true);
    try {
      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/session/start',
        {
          method: 'POST',
          headers: buildPortalAuthHeaders(),
          body: JSON.stringify({}),
        },
        activeGatewayUrl
      );

      if (result.isGatewayUnreachable) {
        setIsQrModalOpen(false);
        setGatewayUnreachable(result.error);
        setFeedback({ type: 'error', text: result.error || 'Baileys WhatsApp Gateway Server is unreachable.' });
        return;
      }

      setGatewayUnreachable(null);
      const json = result.data;
      if (!result.ok || !json?.success) {
        setIsQrModalOpen(false);
        setFeedback({
          type: 'error',
          text: result.error || json?.error || 'Failed to initialize WhatsApp QR session.',
        });
      } else {
        const nextStatus = String(json.status || json.session?.status || 'CONNECTING').toUpperCase();
        const nextQr = json.qrDataUrl || json.session?.qrDataUrl || null;
        if (statusData) {
          setStatusData({
            ...statusData,
            session: {
              ...statusData.session,
              status: nextStatus as any,
              qrDataUrl: nextQr,
            },
          });
        }
        if (nextStatus === 'CONNECTED') {
          setIsQrModalOpen(false);
          const msg = json.session?.phone
            ? `WhatsApp Connected! (${json.session.phone})`
            : 'WhatsApp Connected!';
          setConnectedToast(msg);
          setFeedback({ type: 'success', text: msg });
          window.setTimeout(() => {
            setConnectedToast((cur) => (cur === msg ? null : cur));
          }, 6000);
        } else {
          setFeedback({
            type: 'info',
            text: 'Live QR code generated. Open WhatsApp -> Linked Devices -> Link a Device to scan.',
          });
        }
        await fetchStatus(true);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogoutSession = async () => {
    setActionLoading('logout');
    setFeedback(null);
    try {
      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/session/logout',
        {
          method: 'POST',
          headers: buildPortalAuthHeaders(),
          body: JSON.stringify({}),
        },
        activeGatewayUrl
      );
      if (result.isGatewayUnreachable) {
        setGatewayUnreachable(result.error);
        setFeedback({ type: 'error', text: result.error || 'Baileys WhatsApp Gateway Server is unreachable.' });
        return;
      }
      if (!result.ok || !result.data?.success) {
        setFeedback({
          type: 'error',
          text: result.error || result.data?.error || 'Failed to disconnect WhatsApp session.',
        });
      } else {
        setFeedback({
          type: 'success',
          text: 'WhatsApp session disconnected and local auth credentials cleared.',
        });
        await fetchStatus(true);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('branding');
    setFeedback(null);
    try {
      let targetUrl = activeGatewayUrl;
      if (isMasterAdmin && gatewayUrlInput.trim() !== activeGatewayUrl) {
        const savedUrl = await saveWhatsAppGatewayUrl(gatewayUrlInput);
        if (!savedUrl.ok) {
          setFeedback({ type: 'error', text: savedUrl.error || 'Invalid Gateway URL.' });
          return;
        }
        targetUrl = savedUrl.normalizedUrl;
        setActiveGatewayUrl(targetUrl);
      }

      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/branding',
        {
          method: 'POST',
          headers: buildPortalAuthHeaders(),
          body: JSON.stringify({
            companyName: companyName.trim(),
            supportPhone: supportPhone.trim(),
            autoSend,
          }),
        },
        targetUrl
      );

      if (result.isGatewayUnreachable) {
        setGatewayUnreachable(result.error);
        setFeedback({ type: 'error', text: result.error || 'Baileys WhatsApp Gateway Server is unreachable.' });
        return;
      }

      const json = result.data;
      if (!result.ok || !json?.success) {
        setFeedback({
          type: 'error',
          text: result.error || json?.error || 'Failed to save branding settings.',
        });
      } else {
        setGatewayUnreachable(null);
        if (isMasterAdmin) {
          import('../lib/systemSettings')
            .then(({ saveGlobalSystemSettings }) =>
              saveGlobalSystemSettings({
                companyDisplayName: companyName.trim() || DEFAULT_MASTER_COMPANY_NAME,
                ispName: companyName.trim() || DEFAULT_MASTER_COMPANY_NAME,
                supportHelpline: supportPhone.trim(),
                baileysGatewayUrl: targetUrl,
                autoSendMasterSwitch: autoSend,
                whatsAppGatewayEnabled: autoSend,
              })
            )
            .catch(() => {});
        }
        setFeedback({
          type: 'success',
          text: json.schemaWarning
            ? 'Branding saved (some optional columns require running the WhatsApp SQL migration in Supabase).'
            : `Branding saved! All automated messages will sign as "${json.branding?.companyName}".`,
        });
        await fetchStatus(true, targetUrl);
      }
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
      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/send-auto',
        {
          method: 'POST',
          headers: buildPortalAuthHeaders(),
          body: JSON.stringify({
            eventType: 'MANUAL_TEST',
            messageVars: {
              phone: cleanPhone,
              customNote: `Live zero-click Baileys WhatsApp Gateway verification from ${companyName || DEFAULT_MASTER_COMPANY_NAME}.`,
            },
          }),
        },
        activeGatewayUrl
      );

      if (result.isGatewayUnreachable) {
        setGatewayUnreachable(result.error);
        setFeedback({ type: 'error', text: result.error || 'Baileys WhatsApp Gateway Server is unreachable.' });
        return;
      }

      const json = result.data;
      if (json?.ok && json?.status === 'SENT') {
        setFeedback({
          type: 'success',
          text: `Test message delivered automatically via "${json.senderCompanyName}" to ${cleanPhone}!`,
        });
      } else {
        setFeedback({
          type: 'error',
          text: json?.error || json?.skippedReason || result.error || 'Test delivery failed. Ensure WhatsApp is Connected.',
        });
      }
      await fetchLogs();
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunPreExpirySweep = async () => {
    setActionLoading('sweep');
    setFeedback(null);
    try {
      const result = await safeWhatsAppApiFetch<any>(
        '/api/whatsapp/cron/pre-expiry',
        {
          method: 'POST',
          headers: buildPortalAuthHeaders(),
          body: JSON.stringify({}),
        },
        activeGatewayUrl
      );

      if (result.isGatewayUnreachable) {
        setGatewayUnreachable(result.error);
        setFeedback({ type: 'error', text: result.error || 'Baileys WhatsApp Gateway Server is unreachable.' });
        return;
      }

      const json = result.data;
      if (!result.ok || !json?.success) {
        setFeedback({
          type: 'error',
          text: result.error || json?.error || 'Failed to run 5-day pre-expiry auto-billing.',
        });
      } else {
        const invGen = Number(json.invoicesGenerated ?? 0);
        const waSent = Number(json.whatsappSent ?? json.sent ?? 0);
        const skipped = Number(json.skippedExisting ?? json.skipped ?? 0);
        const failed = Number(json.failed ?? 0);
        setFeedback({
          type: 'success',
          text: `5-Day Pre-Expiry Auto-Billing complete: ${json.scanned ?? 0} scanned | ${invGen} DUE Invoices Generated | ${waSent} WhatsApp Sent | ${skipped} Skipped | ${failed} Failed.`,
        });
        await fetchLogs();
      }
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
  const canPair = statusData?.canPairOwnWhatsapp ?? isMasterAdmin;
  const effectiveTier = statusData?.effectiveTier || (isMasterAdmin ? 'ADMIN' : 'DEALER');

  return (
    <div className="space-y-6 pb-10">
      {/* Green Floating "WhatsApp Connected!" Toast */}
      {connectedToast && (
        <div
          role="status"
          className="fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl bg-emerald-950/95 border border-emerald-500/60 text-emerald-200 shadow-2xl shadow-emerald-950/70 flex items-center gap-2.5 text-xs font-bold backdrop-blur-md"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{connectedToast}</span>
          <button
            type="button"
            onClick={() => setConnectedToast(null)}
            className="ml-2 text-emerald-300/70 hover:text-emerald-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Live QR Pairing Modal (polls /api/whatsapp/status every 2 seconds & auto-closes on connected) */}
      {isQrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-[#0d1117] border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Pair WhatsApp Device</h3>
                  <p className="text-[11px] text-slate-400">
                    Auto-checking connection every 2 seconds
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQrModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                aria-label="Close QR Modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center justify-center text-center space-y-4">
              {sessionStatus === 'QR_READY' && statusData?.session?.qrDataUrl ? (
                <>
                  <div className="bg-white p-3.5 rounded-2xl shadow-xl">
                    <img
                      src={statusData.session.qrDataUrl}
                      alt="WhatsApp Pairing QR Code"
                      className="w-60 h-60 object-contain"
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-amber-300">
                      Scan with WhatsApp on Your Phone
                    </p>
                    <p className="text-xs text-slate-400">
                      WhatsApp &rarr; Menu (&vellip;) &rarr; Linked Devices &rarr; Link a Device
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-3 py-1.5 rounded-lg">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Waiting for scan &amp; handshake... modal will auto-close once connected.</span>
                  </div>
                </>
              ) : (
                <div className="py-8 space-y-3">
                  <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
                  <p className="text-sm font-bold text-cyan-300">
                    {sessionStatus === 'CONNECTING'
                      ? 'Completing WhatsApp Handshake...'
                      : 'Initializing Baileys Multi-Device Session...'}
                  </p>
                  <p className="text-xs text-slate-400 max-w-xs">
                    Fetching latest WhatsApp Web protocol version and syncing session credentials.
                  </p>
                </div>
              )}

              {statusData?.session?.lastError && (
                <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 w-full">
                  {statusData.session.lastError}
                </p>
              )}

              <div className="flex items-center justify-center gap-2 pt-2 w-full">
                <button
                  type="button"
                  onClick={handleStartSession}
                  disabled={actionLoading === 'start'}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === 'start' ? 'animate-spin' : ''}`} />
                  Refresh QR
                </button>
                <button
                  type="button"
                  onClick={() => setIsQrModalOpen(false)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              Run 5-Day Pre-Expiry Auto-Billing
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

      {/* Baileys Gateway Offline / Static Host Banner */}
      {gatewayUnreachable && (
        <div className="bg-rose-500/10 border border-rose-500/35 rounded-2xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-start gap-3">
            <WifiOff className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs font-bold text-rose-200">{gatewayUnreachable}</p>
              <p className="text-[11px] text-rose-200/80">
                Hosting on Netlify? Run <code className="px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300">node baileys-server.js</code> on your VPS, office PC, or Cloudflare Tunnel, then enter its URL in{' '}
                <strong className="text-white">Baileys Gateway Server URL</strong> below and click <strong className="text-white">Test Connection</strong>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleTestGatewayConnection}
            disabled={gatewayHealth.state === 'testing'}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-100 text-xs font-bold shrink-0 transition cursor-pointer"
          >
            {gatewayHealth.state === 'testing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <PlugZap className="w-3.5 h-3.5" />
            )}
            Retry Connection
          </button>
        </div>
      )}

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
            type="button"
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

            {/* Baileys Gateway Server URL Config (Admin Editable for Netlify -> Self-Hosted Node Server) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Baileys Gateway Server URL</span>
                </label>
                {gatewayHealth.state !== 'idle' && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                      gatewayHealth.state === 'online'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : gatewayHealth.state === 'testing'
                        ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                    }`}
                  >
                    {gatewayHealth.message}
                  </span>
                )}
              </div>

              {isMasterAdmin ? (
                <>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={gatewayUrlInput}
                      onChange={(e) => setGatewayUrlInput(e.target.value)}
                      placeholder="https://wa.youthtechnology.pk or http://localhost:3001"
                      className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleTestGatewayConnection}
                        disabled={gatewayHealth.state === 'testing'}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {gatewayHealth.state === 'testing' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <PlugZap className="w-3.5 h-3.5" />
                        )}
                        Test Connection
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveGatewayUrl}
                        disabled={actionLoading === 'gateway_url'}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                      >
                        {actionLoading === 'gateway_url' ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        Save URL
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Point Netlify or remote browsers to your self-hosted <code className="text-cyan-300">node baileys-server.js</code> (e.g. Cloudflare Tunnel, VPS HTTPS domain, or LAN IP). Leave blank to use the built-in server.
                  </p>
                </>
              ) : (
                <p className="text-[11px] font-mono text-slate-300">
                  Active Gateway Endpoint: <span className="text-cyan-300">{getDisplayWhatsAppGatewayUrl(activeGatewayUrl)}</span>
                </p>
              )}
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

      {/* Team Work Group, 10 Editable Automated Templates & Custom Broadcast Builder */}
      <WhatsAppTemplatesAndBroadcastPanel
        currentUser={currentUser}
        effectiveTier={statusData?.effectiveTier || 'ADMIN'}
        companyName={companyName || statusData?.branding?.companyName || DEFAULT_MASTER_COMPANY_NAME}
        supportPhone={supportPhone || statusData?.branding?.supportPhone || ''}
        isConnected={sessionStatus === 'CONNECTED'}
        onMessageSent={() => void fetchLogs()}
      />

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
              <option value="PORTAL_CREDENTIALS">Account Credentials</option>
              <option value="INVOICE_GENERATED">Monthly Invoice (+31d)</option>
              <option value="PRE_EXPIRY_3D">3-Day Pre-Expiry</option>
              <option value="GRACE_PERIOD_3D">3-Day Grace Notice</option>
              <option value="AUTO_SUSPENSION">Auto-Suspension</option>
              <option value="PAYMENT_RESTORED">Paid Receipt (Client)</option>
              <option value="AGENT_PAYMENT_RECEIPT">Agent Cash Confirmed</option>
              <option value="COMPLAINT_CREATED_CLIENT">Complaint (Client)</option>
              <option value="COMPLAINT_CREATED_GROUP">Complaint (Team Group)</option>
              <option value="COMPLAINT_RESOLVED_CLIENT">Complaint Solved</option>
              <option value="CUSTOM_MESSAGE">Custom Broadcast</option>
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
