import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  FileText,
  Filter,
  Loader2,
  Megaphone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  StopCircle,
  Users,
  XCircle,
} from 'lucide-react';
import type { UserAccount } from '../types/auth';
import {
  supabase,
  type SupabaseInvoice,
  type SupabasePortalUser,
} from '../services/supabaseClient';
import {
  buildPortalAuthHeaders,
  DEFAULT_MASTER_COMPANY_NAME,
  formatWhatsAppDisplayPhone,
  formatWhatsAppGroupJid,
  isValidWhatsAppPhone,
  safeWhatsAppApiFetch,
  triggerAutoWhatsAppNotification,
} from '../lib/whatsappRouting';
import {
  DEFAULT_TEMPLATE_MAP,
  DEFAULT_WHATSAPP_TEMPLATES,
  getSampleTemplateValues,
  loadPersistedTeamWorkGroupConfig,
  loadPersistedWhatsAppTemplates,
  renderWhatsAppTemplate,
  savePersistedTeamWorkGroupConfig,
  savePersistedWhatsAppTemplates,
  WHATSAPP_TEMPLATE_PLACEHOLDERS,
  type EditableWhatsAppTemplateKey,
  type TeamWorkGroupConfig,
} from '../lib/whatsappTemplates';
import { isVisibleToCurrentUser, resolveResellerScope } from '../lib/resellerEngine';

interface WhatsAppTemplatesAndBroadcastPanelProps {
  currentUser: UserAccount | null;
  effectiveTier: 'ADMIN' | 'DEALER' | 'SUB_DEALER' | 'OTHER';
  companyName: string;
  supportPhone: string;
  isConnected: boolean;
  onMessageSent?: () => void;
}

interface ConnectedGroupItem {
  id: string;
  subject: string;
  participantsCount: number;
}

type BroadcastMode = 'SINGLE' | 'FILTERED' | 'ALL';
type BroadcastFilterKind = 'DUE' | 'OVERDUE' | 'ACTIVE' | 'AREA';

export const WhatsAppTemplatesAndBroadcastPanel: React.FC<
  WhatsAppTemplatesAndBroadcastPanelProps
> = ({
  currentUser,
  effectiveTier,
  companyName,
  supportPhone,
  isConnected,
  onMessageSent,
}) => {
  const portalUserId = currentUser?.id ? String(currentUser.id) : null;
  const isMasterAdmin = effectiveTier === 'ADMIN';

  // Panel active tab (Templates Editor vs Custom Broadcast Composer)
  const [activeSubTab, setActiveSubTab] = useState<'TEMPLATES' | 'BROADCAST'>('TEMPLATES');

  // --- Team WhatsApp Work Group State ---
  const [teamGroup, setTeamGroup] = useState<TeamWorkGroupConfig>({
    groupJid: '',
    groupName: '',
    inviteLink: '',
  });
  const [connectedGroups, setConnectedGroups] = useState<ConnectedGroupItem[]>([]);
  const [fetchingGroups, setFetchingGroups] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [testingGroup, setTestingGroup] = useState(false);
  const [groupBanner, setGroupBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // --- 10 Editable Templates State ---
  const [templates, setTemplates] = useState<Record<EditableWhatsAppTemplateKey, string>>({
    ...DEFAULT_TEMPLATE_MAP,
  });
  const [selectedTemplateKey, setSelectedTemplateKey] =
    useState<EditableWhatsAppTemplateKey>('INVOICE_GENERATED');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<
    'ALL' | 'ONBOARDING' | 'BILLING' | 'COMPLAINTS'
  >('ALL');
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [templateBanner, setTemplateBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const templateTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // --- Custom Broadcast Builder State ---
  const [scopedSubscribers, setScopedSubscribers] = useState<SupabasePortalUser[]>([]);
  const [openInvoicesByUser, setOpenInvoicesByUser] = useState<
    Map<string, { totalDue: number; earliestDueDate: string | null; hasOverdue: boolean }>
  >(new Map());
  const [loadingSubscribers, setLoadingSubscribers] = useState(false);

  const [broadcastMode, setBroadcastMode] = useState<BroadcastMode>('SINGLE');
  const [broadcastFilter, setBroadcastFilter] = useState<BroadcastFilterKind>('DUE');
  const [selectedArea, setSelectedArea] = useState<string>('');
  const [singleSubSearch, setSingleSubSearch] = useState<string>('');
  const [selectedSingleUsername, setSelectedSingleUsername] = useState<string>('');
  const [directPhoneOverride, setDirectPhoneOverride] = useState<string>('');
  const [customMessageText, setCustomMessageText] = useState<string>(
    `Assalam-o-Alaikum *{client_name}*,\n\nImportant update from *{company_name}*:\nPlease note our support helpline is {helpline}.\n\nThank you for staying connected!`
  );
  const broadcastTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);
  const cancelBroadcastRef = useRef(false);
  const [broadcastProgress, setBroadcastProgress] = useState<{
    total: number;
    processed: number;
    sent: number;
    failed: number;
    lastError?: string;
  } | null>(null);

  // Load persisted templates & Team Work Group config on mount
  const loadTemplatesAndGroup = useCallback(async () => {
    const [loadedTemplates, loadedGroup] = await Promise.all([
      loadPersistedWhatsAppTemplates(portalUserId),
      loadPersistedTeamWorkGroupConfig(portalUserId),
    ]);
    setTemplates(loadedTemplates);
    setTeamGroup(loadedGroup);

    // Also pull from backend API in case another admin updated it on gateway server
    const apiRes = await safeWhatsAppApiFetch<any>('/api/whatsapp/templates', {
      method: 'GET',
      headers: buildPortalAuthHeaders(),
    });
    if (apiRes.ok && apiRes.data?.success) {
      if (apiRes.data.templates) {
        setTemplates((prev) => ({ ...prev, ...apiRes.data.templates }));
      }
      if (apiRes.data.teamGroup && (apiRes.data.teamGroup.groupJid || apiRes.data.teamGroup.groupName)) {
        setTeamGroup((prev) => ({
          groupJid: apiRes.data.teamGroup.groupJid || prev.groupJid,
          groupName: apiRes.data.teamGroup.groupName || prev.groupName,
          inviteLink: apiRes.data.teamGroup.inviteLink || prev.inviteLink,
        }));
      }
    }
  }, [portalUserId]);

  // Load tenant-scoped subscribers & unpaid invoices for Custom Broadcast Builder
  const loadBroadcastAudience = useCallback(async () => {
    setLoadingSubscribers(true);
    try {
      const [{ data: usersData }, { data: invData }] = await Promise.all([
        supabase.from('portal_users').select('*').order('full_name', { ascending: true }),
        supabase.from('invoices').select('*').neq('status', 'PAID'),
      ]);

      const allRows = (usersData || []) as SupabasePortalUser[];
      const scope = resolveResellerScope(currentUser, allRows);
      const rawClients = allRows.filter(
        (u) => String(u.role || '').toUpperCase() === 'CLIENT'
      );
      const visibleClients = scope.isIsolated
        ? rawClients.filter((c) =>
            isVisibleToCurrentUser(c, currentUser, {
              childSubDealerIds: scope.allowedResellerIds,
              allowedSubscriberUsernames: scope.allowedSubscriberUsernames,
            })
          )
        : rawClients;

      setScopedSubscribers(visibleClients);

      const todayYmd = new Date().toISOString().slice(0, 10);
      const invMap = new Map<
        string,
        { totalDue: number; earliestDueDate: string | null; hasOverdue: boolean }
      >();
      for (const inv of (invData || []) as SupabaseInvoice[]) {
        const st = String(inv.status || '').toUpperCase();
        const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
        if (st === 'PAID' || bal <= 0) continue;
        const uname = String(inv.subscriber_username || '').trim().toLowerCase();
        if (!uname) continue;
        const prev = invMap.get(uname) || {
          totalDue: 0,
          earliestDueDate: null,
          hasOverdue: false,
        };
        prev.totalDue += bal;
        if (inv.due_date && (!prev.earliestDueDate || inv.due_date < prev.earliestDueDate)) {
          prev.earliestDueDate = inv.due_date;
        }
        if (st === 'OVERDUE' || (inv.due_date && inv.due_date < todayYmd)) {
          prev.hasOverdue = true;
        }
        invMap.set(uname, prev);
      }
      setOpenInvoicesByUser(invMap);
    } catch {
      // keep existing state
    } finally {
      setLoadingSubscribers(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadTemplatesAndGroup();
    void loadBroadcastAudience();
  }, [loadTemplatesAndGroup, loadBroadcastAudience]);

  // --- Team Work Group Handlers ---
  const handleFetchConnectedGroups = async () => {
    setFetchingGroups(true);
    setGroupBanner(null);
    try {
      const res = await safeWhatsAppApiFetch<{
        success?: boolean;
        groups?: ConnectedGroupItem[];
        error?: string;
      }>('/api/whatsapp/groups', {
        method: 'GET',
        headers: buildPortalAuthHeaders(),
      });

      if (!res.ok || !res.data?.success) {
        setGroupBanner({
          type: 'error',
          text:
            res.data?.error ||
            res.error ||
            'Could not fetch WhatsApp groups. Ensure your WhatsApp session is CONNECTED above.',
        });
        return;
      }

      const list = res.data.groups || [];
      setConnectedGroups(list);
      if (list.length === 0) {
        setGroupBanner({
          type: 'info',
          text: 'No WhatsApp groups found on this linked account. Join your Team Work Group on WhatsApp first.',
        });
      } else {
        setGroupBanner({
          type: 'success',
          text: `Loaded ${list.length} connected WhatsApp group(s). Select your Team Work Group below and click Save.`,
        });
      }
    } finally {
      setFetchingGroups(false);
    }
  };

  const handleSaveTeamGroup = async () => {
    setSavingGroup(true);
    setGroupBanner(null);
    try {
      const trimmedJid = teamGroup.groupJid.trim();
      if (trimmedJid && !formatWhatsAppGroupJid(trimmedJid)) {
        setGroupBanner({
          type: 'error',
          text: 'Group JID must end with @g.us (e.g. 120363012345678901@g.us). Click "Fetch Connected Groups" to select it automatically.',
        });
        return;
      }
      const saved = await savePersistedTeamWorkGroupConfig(teamGroup, portalUserId, isMasterAdmin);
      await safeWhatsAppApiFetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({ teamGroup: saved.config }),
      });
      setTeamGroup(saved.config);
      setGroupBanner({
        type: 'success',
        text: saved.config.groupJid
          ? `Team Work Group "${saved.config.groupName || saved.config.groupJid}" saved! New complaints will auto-dispatch alerts to this group.`
          : 'Team Work Group cleared.',
      });
    } finally {
      setSavingGroup(false);
    }
  };

  const handleSendTestGroupAlert = async () => {
    const validJid = formatWhatsAppGroupJid(teamGroup.groupJid);
    if (!validJid) {
      setGroupBanner({
        type: 'error',
        text: 'Select or enter a valid Team Work Group JID ending in @g.us first.',
      });
      return;
    }
    setTestingGroup(true);
    setGroupBanner(null);
    try {
      const res = await triggerAutoWhatsAppNotification({
        eventType: 'COMPLAINT_CREATED_GROUP',
        manualTrigger: true,
        groupJid: validJid,
        messageVars: {
          ticketId: 'TKT-TEST-01',
          subscriberName: 'Test Client',
          username: 'test_fiber',
          area: 'Saddar Node',
          phone: '+923001234567',
          address: 'Test Dispatch Location',
          agentName: currentUser?.fullName || 'NOC Dispatcher',
          issue: 'Test Team Work Group complaint alert via Baileys Gateway',
        },
      });
      if (res.ok && res.status === 'SENT') {
        setGroupBanner({
          type: 'success',
          text: `Test complaint dispatch alert sent to "${teamGroup.groupName || validJid}"!`,
        });
        onMessageSent?.();
      } else {
        setGroupBanner({
          type: 'error',
          text: res.error || res.skippedReason || 'Failed to send test group alert.',
        });
      }
    } finally {
      setTestingGroup(false);
    }
  };

  // --- Template Editor Handlers ---
  const selectedTemplateDef = useMemo(
    () =>
      DEFAULT_WHATSAPP_TEMPLATES.find((t) => t.key === selectedTemplateKey) ||
      DEFAULT_WHATSAPP_TEMPLATES[0],
    [selectedTemplateKey]
  );

  const visibleTemplates = useMemo(() => {
    if (templateCategoryFilter === 'ALL') return DEFAULT_WHATSAPP_TEMPLATES;
    return DEFAULT_WHATSAPP_TEMPLATES.filter((t) => t.category === templateCategoryFilter);
  }, [templateCategoryFilter]);

  const insertPlaceholderIntoTextarea = (
    token: string,
    target: 'TEMPLATE' | 'BROADCAST'
  ) => {
    const ref = target === 'TEMPLATE' ? templateTextareaRef.current : broadcastTextareaRef.current;
    const currentValue =
      target === 'TEMPLATE' ? templates[selectedTemplateKey] || '' : customMessageText;

    if (!ref) {
      if (target === 'TEMPLATE') {
        setTemplates((prev) => ({ ...prev, [selectedTemplateKey]: `${currentValue}${token}` }));
      } else {
        setCustomMessageText(`${currentValue}${token}`);
      }
      return;
    }

    const start = ref.selectionStart ?? currentValue.length;
    const end = ref.selectionEnd ?? currentValue.length;
    const updated = `${currentValue.slice(0, start)}${token}${currentValue.slice(end)}`;

    if (target === 'TEMPLATE') {
      setTemplates((prev) => ({ ...prev, [selectedTemplateKey]: updated }));
    } else {
      setCustomMessageText(updated);
    }

    requestAnimationFrame(() => {
      ref.focus();
      const cursor = start + token.length;
      ref.setSelectionRange(cursor, cursor);
    });
  };

  const handleSaveTemplates = async () => {
    setSavingTemplates(true);
    setTemplateBanner(null);
    try {
      const saved = await savePersistedWhatsAppTemplates(templates, portalUserId, isMasterAdmin);
      await safeWhatsAppApiFetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: buildPortalAuthHeaders(),
        body: JSON.stringify({ templates: saved.templates }),
      });
      setTemplates(saved.templates);
      setTemplateBanner({
        type: 'success',
        text: saved.savedToSupabase
          ? 'All WhatsApp message templates saved to PostgreSQL & synced to Baileys Gateway!'
          : 'Templates saved locally & synced to Baileys Gateway.',
      });
    } catch (err: any) {
      setTemplateBanner({
        type: 'error',
        text: err?.message || 'Failed to save message templates.',
      });
    } finally {
      setSavingTemplates(false);
    }
  };

  const handleResetSelectedTemplate = () => {
    setTemplates((prev) => ({
      ...prev,
      [selectedTemplateKey]: DEFAULT_TEMPLATE_MAP[selectedTemplateKey],
    }));
    setTemplateBanner({
      type: 'success',
      text: `Reset "${selectedTemplateDef.shortTitle}" to default text. Click "Save Templates" to persist.`,
    });
  };

  const liveTemplatePreview = useMemo(() => {
    const body = templates[selectedTemplateKey] || selectedTemplateDef.defaultBody;
    return renderWhatsAppTemplate(
      body,
      getSampleTemplateValues({
        company_name: companyName || DEFAULT_MASTER_COMPANY_NAME,
        helpline: supportPhone || '+923234193599',
      })
    );
  }, [templates, selectedTemplateKey, selectedTemplateDef, companyName, supportPhone]);

  // --- Custom Broadcast Audience Resolution ---
  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    for (const s of scopedSubscribers) {
      const a = String(s.area || '').trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scopedSubscribers]);

  const searchableSingleSubscribers = useMemo(() => {
    const q = singleSubSearch.trim().toLowerCase();
    if (!q) return scopedSubscribers.slice(0, 60);
    return scopedSubscribers
      .filter(
        (s) =>
          String(s.username || '').toLowerCase().includes(q) ||
          String(s.full_name || '').toLowerCase().includes(q) ||
          String(s.phone || '').toLowerCase().includes(q) ||
          String(s.area || '').toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [scopedSubscribers, singleSubSearch]);

  const resolvedBroadcastRecipients = useMemo(() => {
    if (broadcastMode === 'SINGLE') {
      if (selectedSingleUsername) {
        const sub = scopedSubscribers.find(
          (s) => String(s.username || '').toLowerCase() === selectedSingleUsername.toLowerCase()
        );
        if (sub) {
          const phoneToUse = directPhoneOverride.trim() || sub.phone || '';
          return isValidWhatsAppPhone(phoneToUse)
            ? [{ subscriber: sub, phone: phoneToUse }]
            : [];
        }
      }
      if (isValidWhatsAppPhone(directPhoneOverride)) {
        return [{ subscriber: null, phone: directPhoneOverride.trim() }];
      }
      return [];
    }

    let pool = scopedSubscribers;
    if (broadcastMode === 'FILTERED') {
      pool = scopedSubscribers.filter((s) => {
        const uname = String(s.username || '').trim().toLowerCase();
        const inv = openInvoicesByUser.get(uname);
        const acct = String(s.account_status || 'ACTIVE').toUpperCase();
        if (broadcastFilter === 'DUE') {
          return Boolean(inv && inv.totalDue > 0);
        }
        if (broadcastFilter === 'OVERDUE') {
          return Boolean(
            inv?.hasOverdue ||
              acct === 'EXPIRED' ||
              acct === 'SUSPENDED' ||
              String(s.billing_status || '').toUpperCase() === 'GRACE_PERIOD'
          );
        }
        if (broadcastFilter === 'ACTIVE') {
          return acct === 'ACTIVE' && !s.is_suspended;
        }
        if (broadcastFilter === 'AREA') {
          if (!selectedArea) return true;
          return String(s.area || '').trim().toLowerCase() === selectedArea.trim().toLowerCase();
        }
        return true;
      });
    }

    return pool
      .filter((s) => isValidWhatsAppPhone(s.phone))
      .map((s) => ({ subscriber: s, phone: String(s.phone).trim() }));
  }, [
    broadcastMode,
    broadcastFilter,
    selectedArea,
    selectedSingleUsername,
    directPhoneOverride,
    scopedSubscribers,
    openInvoicesByUser,
  ]);

  const handleSendCustomBroadcast = async () => {
    const body = customMessageText.trim();
    if (!body) return;
    if (resolvedBroadcastRecipients.length === 0) return;

    setIsSendingBroadcast(true);
    cancelBroadcastRef.current = false;
    let sentCount = 0;
    let failedCount = 0;
    let lastErr: string | undefined;
    const total = resolvedBroadcastRecipients.length;
    setBroadcastProgress({ total, processed: 0, sent: 0, failed: 0 });

    for (let i = 0; i < total; i++) {
      if (cancelBroadcastRef.current) break;
      const target = resolvedBroadcastRecipients[i];
      const sub = target.subscriber;
      const uname = sub?.username ? String(sub.username).trim() : '';
      const invInfo = uname ? openInvoicesByUser.get(uname.toLowerCase()) : undefined;

      const res = await triggerAutoWhatsAppNotification({
        eventType: 'CUSTOM_MESSAGE',
        manualTrigger: true,
        subscriberUsername: uname || undefined,
        subscriber: sub ? { ...sub } : undefined,
        customMessage: body,
        messageVars: {
          subscriberName: sub?.full_name || uname || 'Valued Subscriber',
          username: uname || 'subscriber',
          phone: target.phone,
          packageName: sub?.package_profile_name || sub?.package_speed || 'Fiber Broadband',
          amountDue: invInfo?.totalDue || Number(sub?.monthly_fee) || 0,
          dueDate: invInfo?.earliestDueDate || sub?.next_billing_date || undefined,
          expiryDate: sub?.expiry_date ? String(sub.expiry_date).slice(0, 10) : undefined,
          area: sub?.area || undefined,
          address: sub?.address || undefined,
          customMessage: body,
        },
      });

      if (res.ok && res.status === 'SENT') {
        sentCount++;
      } else {
        failedCount++;
        lastErr = res.error || res.skippedReason || 'Delivery failed';
      }

      setBroadcastProgress({
        total,
        processed: i + 1,
        sent: sentCount,
        failed: failedCount,
        lastError: lastErr,
      });

      // Gentle throttle for multi-recipient broadcasts to prevent WhatsApp spam bans
      if (i < total - 1 && !cancelBroadcastRef.current) {
        await new Promise((r) => setTimeout(r, 650));
      }
    }

    setIsSendingBroadcast(false);
    onMessageSent?.();
  };

  return (
    <div className="space-y-6">
      {/* TEAM WHATSAPP WORK GROUP CONFIG (Complaint Dispatch Automation) */}
      <div className="bg-[#0d1117] border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-300">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Team WhatsApp Work Group (Automated Complaint Dispatch)
              </h3>
              <p className="text-[11px] text-slate-400">
                Every new complaint automatically notifies the Client AND dispatches full field details to this WhatsApp Group.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleFetchConnectedGroups}
              disabled={fetchingGroups}
              className="px-3 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/35 text-cyan-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {fetchingGroups ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Fetch Connected Groups
            </button>
            <button
              type="button"
              onClick={handleSendTestGroupAlert}
              disabled={testingGroup || !teamGroup.groupJid.trim()}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50"
            >
              {testingGroup ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Test Group Alert
            </button>
          </div>
        </div>

        {groupBanner && (
          <div
            className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center gap-2 ${
              groupBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                : groupBanner.type === 'info'
                ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-200'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
            }`}
          >
            {groupBanner.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{groupBanner.text}</span>
          </div>
        )}

        {connectedGroups.length > 0 && (
          <div className="bg-slate-900/70 border border-cyan-500/25 rounded-xl p-3">
            <label className="block text-[11px] font-semibold text-cyan-300 mb-1.5">
              Select from Live Connected WhatsApp Groups ({connectedGroups.length} found)
            </label>
            <select
              value={teamGroup.groupJid}
              onChange={(e) => {
                const chosen = connectedGroups.find((g) => g.id === e.target.value);
                setTeamGroup((prev) => ({
                  ...prev,
                  groupJid: e.target.value,
                  groupName: chosen ? chosen.subject : prev.groupName,
                }));
              }}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              <option value="">-- Choose your Team WhatsApp Work Group --</option>
              {connectedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.subject} ({g.participantsCount} members) — {g.id}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Team Work Group JID (@g.us)
            </label>
            <input
              type="text"
              value={teamGroup.groupJid}
              onChange={(e) => setTeamGroup((prev) => ({ ...prev, groupJid: e.target.value }))}
              placeholder="e.g. 120363012345678901@g.us"
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Group Display Name
            </label>
            <input
              type="text"
              value={teamGroup.groupName}
              onChange={(e) => setTeamGroup((prev) => ({ ...prev, groupName: e.target.value }))}
              placeholder="e.g. Youth Net Field Technicians"
              className="w-full bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-300 mb-1">
              Group Invite Link (Optional Reference)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={teamGroup.inviteLink || ''}
                onChange={(e) => setTeamGroup((prev) => ({ ...prev, inviteLink: e.target.value }))}
                placeholder="https://chat.whatsapp.com/..."
                className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
              />
              <button
                type="button"
                onClick={handleSaveTeamGroup}
                disabled={savingGroup}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0"
              >
                {savingGroup ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* DEDICATED MESSAGE TEMPLATES & CUSTOM BROADCAST PANEL */}
      <div className="bg-[#0d1117] border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 bg-gradient-to-r from-slate-900/90 via-[#0d1117] to-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-300">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                WhatsApp Message Templates &amp; Custom Broadcast
              </h3>
              <p className="text-xs text-slate-400">
                Edit all 10 automated Baileys templates with dynamic placeholders or compose custom new broadcasts.
              </p>
            </div>
          </div>

          <div className="inline-flex rounded-xl bg-slate-900 p-1 border border-slate-800 self-start lg:self-auto">
            <button
              type="button"
              onClick={() => setActiveSubTab('TEMPLATES')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                activeSubTab === 'TEMPLATES'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              10 Auto Templates
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('BROADCAST')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                activeSubTab === 'BROADCAST'
                  ? 'bg-cyan-500 text-slate-950 shadow'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Megaphone className="w-3.5 h-3.5" />
              Send Custom New Message
            </button>
          </div>
        </div>

        {/* SUB-TAB 1: 10 EDITABLE AUTOMATED TEMPLATES */}
        {activeSubTab === 'TEMPLATES' && (
          <div className="p-4 sm:p-5 space-y-4">
            {templateBanner && (
              <div
                className={`px-3.5 py-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                  templateBanner.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                    : 'bg-rose-500/10 border-rose-500/30 text-rose-200'
                }`}
              >
                {templateBanner.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{templateBanner.text}</span>
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              {/* Template List Sidebar */}
              <div className="xl:col-span-4 space-y-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'ONBOARDING', 'BILLING', 'COMPLAINTS'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTemplateCategoryFilter(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition ${
                        templateCategoryFilter === cat
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5 max-h-[540px] overflow-y-auto pr-1">
                  {visibleTemplates.map((tpl) => {
                    const isSelected = tpl.key === selectedTemplateKey;
                    const isCustomized =
                      (templates[tpl.key] || '').trim() !== tpl.defaultBody.trim();
                    return (
                      <button
                        key={tpl.key}
                        type="button"
                        onClick={() => setSelectedTemplateKey(tpl.key)}
                        className={`w-full text-left p-3 rounded-xl border transition ${
                          isSelected
                            ? 'bg-emerald-500/10 border-emerald-500/50 shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-bold ${
                              isSelected ? 'text-emerald-300' : 'text-slate-200'
                            }`}
                          >
                            {tpl.title}
                          </span>
                          {isCustomized && (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[9px] font-bold shrink-0">
                              Edited
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">
                          Recipient: <span className="text-slate-300">{tpl.recipientLabel}</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Template Editor + Live Preview */}
              <div className="xl:col-span-8 space-y-4">
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-100">
                        {selectedTemplateDef.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {selectedTemplateDef.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleResetSelectedTemplate}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reset Default
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveTemplates}
                        disabled={savingTemplates}
                        className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition disabled:opacity-50"
                      >
                        {savingTemplates ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Save className="w-3.5 h-3.5" />
                        )}
                        Save Templates
                      </button>
                    </div>
                  </div>

                  {/* Clickable Dynamic Placeholder Chips */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Click any dynamic placeholder to insert at cursor:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {WHATSAPP_TEMPLATE_PLACEHOLDERS.map((ph) => (
                        <button
                          key={ph.token}
                          type="button"
                          onClick={() => insertPlaceholderIntoTextarea(ph.token, 'TEMPLATE')}
                          title={`Insert ${ph.label} (e.g. ${ph.sample})`}
                          className="px-2 py-1 rounded-md bg-slate-950 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/50 text-[11px] font-mono text-cyan-300 transition cursor-pointer"
                        >
                          {ph.token}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Editable Textarea */}
                  <textarea
                    ref={templateTextareaRef}
                    rows={10}
                    value={templates[selectedTemplateKey] || ''}
                    onChange={(e) =>
                      setTemplates((prev) => ({
                        ...prev,
                        [selectedTemplateKey]: e.target.value,
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3.5 text-xs font-mono text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                {/* Live WhatsApp Message Preview */}
                <div className="bg-[#0b141a] border border-emerald-500/25 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" />
                      Live Rendered WhatsApp Preview
                    </span>
                    <span className="text-[10px] text-slate-400">
                      To: {selectedTemplateDef.recipientLabel}
                    </span>
                  </div>
                  <div className="bg-[#005c4b]/35 border border-emerald-500/20 rounded-xl p-3.5 text-xs text-slate-100 whitespace-pre-wrap leading-relaxed font-sans max-w-2xl">
                    {liveTemplatePreview}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 2: SEND CUSTOM NEW MESSAGE / BROADCAST COMPOSER */}
        {activeSubTab === 'BROADCAST' && (
          <div className="p-4 sm:p-5 space-y-5">
            {!isConnected && (
              <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
                Note: Your WhatsApp session currently shows disconnected. Pair via QR above before dispatching broadcasts.
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Target Audience Builder */}
              <div className="lg:col-span-5 bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Filter className="w-4 h-4 text-cyan-400" />
                    1. Select Recipients
                  </h4>
                  <button
                    type="button"
                    onClick={() => void loadBroadcastAudience()}
                    disabled={loadingSubscribers}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingSubscribers ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                </div>

                {/* Target Mode Selector */}
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: 'SINGLE', label: 'Single User' },
                      { id: 'FILTERED', label: 'Filtered Group' },
                      { id: 'ALL', label: 'All Clients' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setBroadcastMode(m.id)}
                      className={`px-2.5 py-2 rounded-lg text-xs font-bold border transition ${
                        broadcastMode === m.id
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {/* SINGLE SUBSCRIBER MODE */}
                {broadcastMode === 'SINGLE' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Search Subscriber
                      </label>
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={singleSubSearch}
                          onChange={(e) => setSingleSubSearch(e.target.value)}
                          placeholder="Search by username, name, phone, area..."
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Pick Subscriber ({searchableSingleSubscribers.length} shown)
                      </label>
                      <select
                        value={selectedSingleUsername}
                        onChange={(e) => {
                          setSelectedSingleUsername(e.target.value);
                          const found = scopedSubscribers.find(
                            (s) => s.username === e.target.value
                          );
                          if (found?.phone) setDirectPhoneOverride(found.phone);
                        }}
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500/60"
                      >
                        <option value="">-- Optional: Select a subscriber --</option>
                        {searchableSingleSubscribers.map((sub) => (
                          <option key={sub.id} value={sub.username}>
                            {sub.full_name} (@{sub.username}) — {sub.phone || 'No phone'}{' '}
                            {sub.area ? `• ${sub.area}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                        Or Direct WhatsApp Phone Number
                      </label>
                      <input
                        type="text"
                        value={directPhoneOverride}
                        onChange={(e) => setDirectPhoneOverride(e.target.value)}
                        placeholder="+923001234567"
                        className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/60"
                      />
                    </div>
                  </div>
                )}

                {/* FILTERED GROUP MODE */}
                {broadcastMode === 'FILTERED' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: 'DUE', label: 'Due Invoices' },
                          { id: 'OVERDUE', label: 'Overdue / Grace' },
                          { id: 'ACTIVE', label: 'Active Subscribers' },
                          { id: 'AREA', label: 'Specific Area' },
                        ] as const
                      ).map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setBroadcastFilter(f.id)}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold border transition ${
                            broadcastFilter === f.id
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                              : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>

                    {broadcastFilter === 'AREA' && (
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                          Select Coverage Area / Node
                        </label>
                        <select
                          value={selectedArea}
                          onChange={(e) => setSelectedArea(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500/60"
                        >
                          <option value="">All Coverage Areas ({uniqueAreas.length})</option>
                          {uniqueAreas.map((area) => (
                            <option key={area} value={area}>
                              {area}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* ALL SUBSCRIBERS MODE */}
                {broadcastMode === 'ALL' && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300">
                    Sends your personalized custom message to every subscriber inside your{' '}
                    <span className="font-bold text-cyan-300">
                      {effectiveTier === 'ADMIN' ? 'Master ISP' : effectiveTier}
                    </span>{' '}
                    account scope that has a valid WhatsApp phone number.
                  </div>
                )}

                {/* Live Recipient Summary */}
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-300">
                      Matched Valid Recipients
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-200 font-mono text-xs font-bold">
                      {resolvedBroadcastRecipients.length}
                    </span>
                  </div>
                  {resolvedBroadcastRecipients.length > 0 && (
                    <p className="text-[10px] text-slate-300 line-clamp-2">
                      {resolvedBroadcastRecipients
                        .slice(0, 5)
                        .map((r) =>
                          r.subscriber
                            ? `${r.subscriber.full_name} (${formatWhatsAppDisplayPhone(r.phone)})`
                            : formatWhatsAppDisplayPhone(r.phone)
                        )
                        .join(', ')}
                      {resolvedBroadcastRecipients.length > 5
                        ? ` +${resolvedBroadcastRecipients.length - 5} more`
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {/* Message Composer */}
              <div className="lg:col-span-7 bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-emerald-400" />
                  2. Compose Custom New Message
                </h4>

                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Personalize each recipient with placeholders:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      '{client_name}',
                      '{username}',
                      '{package}',
                      '{amount}',
                      '{due_date}',
                      '{expiry_date}',
                      '{area}',
                      '{company_name}',
                      '{helpline}',
                    ].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => insertPlaceholderIntoTextarea(tok, 'BROADCAST')}
                        className="px-2 py-1 rounded-md bg-slate-950 hover:bg-emerald-500/20 border border-slate-700 hover:border-emerald-500/50 text-[11px] font-mono text-emerald-300 transition cursor-pointer"
                      >
                        {tok}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  ref={broadcastTextareaRef}
                  rows={8}
                  value={customMessageText}
                  onChange={(e) => setCustomMessageText(e.target.value)}
                  placeholder="Write your announcement, outage update, or custom billing reminder..."
                  className="w-full bg-slate-950 border border-slate-700/80 rounded-xl p-3.5 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-cyan-500/60"
                />

                {broadcastProgress && (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        {isSendingBroadcast
                          ? `Dispatching ${broadcastProgress.processed} / ${broadcastProgress.total}...`
                          : `Broadcast finished (${broadcastProgress.processed} / ${broadcastProgress.total})`}
                      </span>
                      <span className="font-mono text-[11px]">
                        <span className="text-emerald-400 font-bold">
                          Sent: {broadcastProgress.sent}
                        </span>
                        {' · '}
                        <span className="text-rose-400 font-bold">
                          Failed: {broadcastProgress.failed}
                        </span>
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all"
                        style={{
                          width: `${
                            broadcastProgress.total > 0
                              ? Math.round(
                                  (broadcastProgress.processed / broadcastProgress.total) * 100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                    {broadcastProgress.lastError && broadcastProgress.failed > 0 && (
                      <p className="text-[11px] text-rose-400">{broadcastProgress.lastError}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-slate-400">
                    Dispatched in background via Baileys Gateway (zero wa.me tabs).
                  </span>
                  <div className="flex items-center gap-2">
                    {isSendingBroadcast && (
                      <button
                        type="button"
                        onClick={() => {
                          cancelBroadcastRef.current = true;
                        }}
                        className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-xs font-bold flex items-center gap-1.5"
                      >
                        <StopCircle className="w-4 h-4" />
                        Stop
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSendCustomBroadcast}
                      disabled={
                        isSendingBroadcast ||
                        !customMessageText.trim() ||
                        resolvedBroadcastRecipients.length === 0
                      }
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-2 transition disabled:opacity-50"
                    >
                      {isSendingBroadcast ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      Send to {resolvedBroadcastRecipients.length} Recipient
                      {resolvedBroadcastRecipients.length === 1 ? '' : 's'} via Baileys
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppTemplatesAndBroadcastPanel;
