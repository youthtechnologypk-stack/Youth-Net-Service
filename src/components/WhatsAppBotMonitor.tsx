import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bot,
  Copy,
  Check,
  Send,
  RefreshCw,
  MessageSquare,
  Phone,
  UserCheck,
  Ticket,
  ShieldCheck,
  Sparkles,
  Search,
  Power,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  SupabasePortalUser,
  SupabaseWhatsappBillingConfig,
  SupabaseWhatsappBotSession,
  supabase,
} from '../services/supabaseClient';
import { DEFAULT_SUPPORT_WHATSAPP } from '../lib/whatsappBilling';

const PRODUCTION_WEBHOOK_URL =
  'https://youthnetw.netlify.app/.netlify/functions/whatsapp-webhook';
const DEFAULT_VERIFY_TOKEN = 'youthnet_noc_2026';

interface SimulatedTurn {
  id: string;
  senderPhone: string;
  userMessage: string;
  botReply: string;
  intent: string;
  subscriberUsername: string | null;
  subscriberName: string | null;
  createdTicketNo: string | null;
  assignedAgentName?: string | null;
  timestamp: string;
}

const QUICK_PROMPTS = [
  {
    label: 'Red Light / No Internet',
    text: 'Net nahi chal raha red light aa rahi hai',
  },
  {
    label: 'Billing & Payment Accounts',
    text: 'Mera bill kitna hai?',
  },
  {
    label: 'Slow Speed Complaint',
    text: 'Meri internet speed bohat slow aa rahi hai',
  },
  {
    label: 'Ticket Status Check',
    text: 'Mera ticket status kya hai?',
  },
  {
    label: 'Reply with @Username',
    text: '@bztahir72',
  },
];

export const WhatsAppBotMonitor: React.FC = () => {
  const [sessions, setSessions] = useState<SupabaseWhatsappBotSession[]>([]);
  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);
  const [waConfig, setWaConfig] = useState<SupabaseWhatsappBillingConfig | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true);
  const [isTogglingBot, setIsTogglingBot] = useState<boolean>(false);

  // Copy & Verification state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [verifyTestStatus, setVerifyTestStatus] = useState<string | null>(null);

  // Simulator state
  const [senderPhone, setSenderPhone] = useState<string>('+923174113715');
  const [messageInput, setMessageInput] = useState<string>(
    'Net nahi chal raha red light aa rahi hai'
  );
  const [isSending, setIsSending] = useState<boolean>(false);
  const [simulatorError, setSimulatorError] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<SimulatedTurn[]>([]);

  // Logs search filter
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchData = useCallback(async () => {
    setIsLoadingSessions(true);
    try {
      const [sessionsRes, clientsRes, configRes] = await Promise.all([
        supabase
          .from('whatsapp_bot_sessions')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(100),
        supabase
          .from('portal_users')
          .select('id, username, full_name, phone, area, account_status, expiry_date, package_speed, monthly_fee, role')
          .eq('role', 'CLIENT')
          .order('full_name', { ascending: true }),
        supabase.from('whatsapp_billing_config').select('*').limit(1).maybeSingle(),
      ]);

      if (Array.isArray(sessionsRes.data)) {
        setSessions(sessionsRes.data as SupabaseWhatsappBotSession[]);
      }
      if (Array.isArray(clientsRes.data)) {
        const list = clientsRes.data as SupabasePortalUser[];
        setSubscribers(list);
        // Default phone to first subscriber with a valid mobile number if user hasn't edited
        const withPhone = list.find(
          (c) => (c.phone || '').replace(/[^\d]/g, '').length >= 10
        );
        if (withPhone?.phone) {
          setSenderPhone((prev) =>
            prev === '+923174113715' ? withPhone.phone : prev
          );
        }
      }
      if (configRes.data) {
        setWaConfig(configRes.data as SupabaseWhatsappBillingConfig);
      }
    } catch (err) {
      console.warn('WhatsAppBotMonitor fetch error:', err);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const ch = supabase
      .channel('public:whatsapp_bot_sessions_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_bot_sessions' },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [fetchData]);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      // Fallback
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2200);
    }
  };

  const verifyToken =
    (waConfig?.webhook_verify_token || '').trim() || DEFAULT_VERIFY_TOKEN;
  const supportWhatsapp =
    (waConfig?.support_whatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP;
  const botEnabled = waConfig?.bot_enabled !== false;

  const handleToggleBotEnabled = async () => {
    if (isTogglingBot) return;
    setIsTogglingBot(true);
    try {
      const nextState = !botEnabled;
      if (waConfig?.id) {
        const { error } = await supabase
          .from('whatsapp_billing_config')
          .update({
            bot_enabled: nextState,
            updated_at: new Date().toISOString(),
          })
          .eq('id', waConfig.id);
        if (!error) {
          setWaConfig((prev) => (prev ? { ...prev, bot_enabled: nextState } : prev));
        }
      }
    } finally {
      setIsTogglingBot(false);
    }
  };

  const handleTestVerification = async () => {
    setVerifyTestStatus('Testing GET challenge...');
    try {
      const challenge = `YOUTHNET_${Date.now().toString().slice(-4)}`;
      const res = await fetch(
        `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(
          verifyToken
        )}&hub.challenge=${encodeURIComponent(challenge)}`
      );
      const txt = await res.text();
      if (res.ok && txt === challenge) {
        setVerifyTestStatus(`Verified (HTTP 200 • Challenge echoed: ${txt})`);
      } else {
        setVerifyTestStatus(`Failed (HTTP ${res.status}: ${txt})`);
      }
    } catch (err: any) {
      setVerifyTestStatus(`Error: ${err?.message || 'Unable to verify'}`);
    }
  };

  const handleSimulateSend = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const msg = (overrideText ?? messageInput).trim();
    const phone = senderPhone.trim();
    if (!phone || !msg || isSending) return;

    setIsSending(true);
    setSimulatorError(null);

    try {
      const res = await fetch('/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_phone: phone,
          message: msg,
          simulate: true,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Webhook returned HTTP ${res.status}`);
      }

      const turn: SimulatedTurn = {
        id: `turn-${Date.now()}`,
        senderPhone: data.normalized_phone || phone,
        userMessage: msg,
        botReply: data.reply || '',
        intent: data.intent || 'GENERAL_AI',
        subscriberUsername: data.subscriber_username || null,
        subscriberName: data.subscriber_name || null,
        createdTicketNo: data.created_ticket_no || null,
        assignedAgentName: data.assigned_agent_name || null,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setChatHistory((prev) => [...prev, turn]);
      if (!overrideText) {
        setMessageInput('');
      }
      await fetchData();
    } catch (err: any) {
      setSimulatorError(err?.message || 'Failed to invoke WhatsApp bot webhook.');
    } finally {
      setIsSending(false);
    }
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s.sender_phone || '').toLowerCase().includes(q) ||
        (s.subscriber_username || '').toLowerCase().includes(q) ||
        (s.last_message_in || '').toLowerCase().includes(q) ||
        (s.last_bot_reply || '').toLowerCase().includes(q) ||
        (s.created_ticket_no || '').toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const subscribersWithValidPhone = useMemo(
    () =>
      subscribers.filter(
        (s) => (s.phone || '').replace(/[^\d]/g, '').length >= 10
      ),
    [subscribers]
  );

  return (
    <div className="space-y-6">
      {/* 1. Webhook URL & Gateway Config Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-400 shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-white">
                  AI WhatsApp Complaint &amp; Billing Webhook
                </h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                    botEnabled
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-amber-950 text-amber-300 border-amber-800'
                  }`}
                >
                  {botEnabled ? 'AUTO-BOT ACTIVE' : 'BOT PAUSED'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  NOC: {supportWhatsapp}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Supports Meta WhatsApp Cloud API, UltraMsg &amp; Twilio payloads • Auto-checks 31-day expiry, Roman Urdu/English replies &amp; deduplicated ticket dispatch.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestVerification}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-xs font-mono font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Test Verify Handshake</span>
            </button>

            <button
              type="button"
              onClick={handleToggleBotEnabled}
              disabled={isTogglingBot}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 border transition cursor-pointer ${
                botEnabled
                  ? 'bg-emerald-950/70 hover:bg-emerald-900/70 border-emerald-700 text-emerald-300'
                  : 'bg-rose-950/70 hover:bg-rose-900/70 border-rose-700 text-rose-300'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{botEnabled ? 'Bot Enabled' : 'Bot Paused'}</span>
            </button>
          </div>
        </div>

        {/* Webhook URL + Verify Token Copy Boxes */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>Production Webhook URL (Paste in UltraMsg / Meta Cloud API)</span>
              <span className="text-cyan-400">GET &amp; POST</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-300 select-all">
                {PRODUCTION_WEBHOOK_URL}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('webhook', PRODUCTION_WEBHOOK_URL)}
                className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shrink-0 transition cursor-pointer"
              >
                {copiedKey === 'webhook' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>Meta Verify Token</span>
              <span className="text-slate-500">hub.verify_token</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-amber-300 select-all">
                {verifyToken}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('token', verifyToken)}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-xs flex items-center gap-1.5 shrink-0 transition cursor-pointer"
              >
                {copiedKey === 'token' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedKey === 'token' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>
        </div>

        {verifyTestStatus && (
          <div className="px-3 py-2 rounded-lg bg-slate-950 border border-cyan-800/70 text-cyan-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{verifyTestStatus}</span>
          </div>
        )}
      </div>

      {/* 2. Live Bot Chat Simulator + Quick Presets */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Controls */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <h4 className="text-sm font-bold text-white">Live Bot Chat Simulator</h4>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
              POST /api/whatsapp/webhook
            </span>
          </div>

          {/* Subscriber Quick Selector */}
          <div className="space-y-1.5 text-xs">
            <label className="block text-slate-300 font-semibold">
              Select Subscriber (or test Unknown Phone)
            </label>
            <select
              value={senderPhone}
              onChange={(e) => setSenderPhone(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="+923001234567">
                ❓ Unknown Phone (+923001234567) — Identity Prompt Test
              </option>
              {subscribersWithValidPhone.map((sub) => (
                <option key={sub.id} value={sub.phone}>
                  👤 {sub.full_name} (@{sub.username}) • {sub.phone} [{sub.account_status || 'ACTIVE'}]
                </option>
              ))}
            </select>
          </div>

          {/* Manual Phone Input */}
          <div className="space-y-1.5 text-xs">
            <label className="block text-slate-300 font-semibold">
              Sender WhatsApp Number
            </label>
            <div className="relative">
              <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
                placeholder="+923174113715 or 03174113715"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Message Input Form */}
          <form onSubmit={(e) => handleSimulateSend(e)} className="space-y-3 text-xs">
            <div className="space-y-1.5">
              <label className="block text-slate-300 font-semibold">
                Incoming Customer Message (Roman Urdu / English)
              </label>
              <textarea
                rows={3}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="e.g. Net nahi chal raha red light aa rahi hai"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            {simulatorError && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-[11px] font-mono flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>{simulatorError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSending || !messageInput.trim() || !senderPhone.trim()}
              className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-emerald-950/40"
            >
              {isSending ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              <span>{isSending ? 'Processing Webhook...' : 'Send Simulated WhatsApp Message'}</span>
            </button>
          </form>

          {/* Quick Scenario Presets */}
          <div className="pt-2 border-t border-slate-800 space-y-2">
            <span className="text-[11px] font-mono text-slate-400 block">
              Quick Test Prompts (1-Click Send):
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  disabled={isSending}
                  onClick={() => {
                    setMessageInput(qp.text);
                    handleSimulateSend(undefined, qp.text);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-cyan-300 text-[11px] font-mono transition cursor-pointer"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Chat Preview */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl shadow-lg flex flex-col overflow-hidden min-h-[420px]">
          <div className="bg-slate-950 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white">
                  Youth Net Service NOC Bot ({supportWhatsapp})
                </div>
                <div className="text-[10px] font-mono text-emerald-400">
                  Live Supabase + Deduplicated Ticket Engine
                </div>
              </div>
            </div>
            {chatHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setChatHistory([])}
                className="text-[11px] font-mono text-slate-400 hover:text-white px-2.5 py-1 rounded bg-slate-900 border border-slate-800 cursor-pointer"
              >
                Clear Preview
              </button>
            )}
          </div>

          <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[460px] bg-slate-950/60">
            {chatHistory.length === 0 ? (
              <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-center space-y-2 text-slate-500">
                <Bot className="w-10 h-10 text-slate-700" />
                <p className="text-xs font-medium text-slate-400">
                  Send a test message on the left to watch live bot classification, expiry verification &amp; ticket dispatch.
                </p>
                <p className="text-[11px] font-mono text-slate-500">
                  Real tickets are logged to Supabase `tickets` and conversations to `whatsapp_bot_sessions`.
                </p>
              </div>
            ) : (
              chatHistory.map((turn) => (
                <div key={turn.id} className="space-y-2.5">
                  {/* Incoming Customer Bubble */}
                  <div className="flex justify-end">
                    <div className="max-w-[82%] bg-cyan-950/80 border border-cyan-800/70 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-xs text-slate-100 shadow">
                      <div className="text-[10px] font-mono text-cyan-400 mb-1 flex items-center justify-between gap-3">
                        <span>{turn.senderPhone}</span>
                        <span>{turn.timestamp}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{turn.userMessage}</p>
                    </div>
                  </div>

                  {/* Bot Reply Bubble */}
                  <div className="flex justify-start">
                    <div className="max-w-[88%] bg-slate-900 border border-slate-700 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-xs text-slate-100 shadow space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                        <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                          {turn.intent}
                        </span>
                        {turn.subscriberUsername && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">
                            @{turn.subscriberUsername}
                          </span>
                        )}
                        {turn.createdTicketNo && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                            {turn.createdTicketNo}
                          </span>
                        )}
                        {turn.assignedAgentName && (
                          <span className="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                            Tech: {turn.assignedAgentName}
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap leading-relaxed text-slate-200">
                        {turn.botReply}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 3. Recent Bot Conversations Table (`whatsapp_bot_sessions`) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <span>Recent WhatsApp Bot Conversations (`whatsapp_bot_sessions`)</span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                {filteredSessions.length} sessions
              </span>
            </h4>
            <p className="text-xs text-slate-400">
              Live realtime log of incoming customer messages, automated replies, and linked SLA tickets.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter phone, username, TKT-..."
                className="bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
              />
            </div>

            <button
              type="button"
              onClick={fetchData}
              disabled={isLoadingSessions}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 font-mono text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-3">Sender Phone</th>
                <th className="py-2.5 px-3">Subscriber</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Last Message In</th>
                <th className="py-2.5 px-3">Last Bot Reply</th>
                <th className="py-2.5 px-3">Ticket #</th>
                <th className="py-2.5 px-3">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-slate-500 font-mono text-xs"
                  >
                    {isLoadingSessions
                      ? 'Loading whatsapp_bot_sessions from Supabase...'
                      : 'No WhatsApp bot sessions recorded yet. Send a test message using the simulator above.'}
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => (
                  <tr
                    key={session.id}
                    onClick={() => setSenderPhone(session.sender_phone)}
                    className="hover:bg-slate-800/40 cursor-pointer transition align-top"
                    title="Click to load this phone number into the simulator"
                  >
                    <td className="py-2.5 px-3 font-mono text-cyan-300 whitespace-nowrap">
                      {session.sender_phone}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      {session.subscriber_username ? (
                        <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                          <UserCheck className="w-3 h-3" />@{session.subscriber_username}
                        </span>
                      ) : (
                        <span className="text-slate-500">Unlinked</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-950 border border-slate-700 text-slate-300">
                        {session.conversation_state || 'IDENTIFIED'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-200 max-w-[220px]">
                      <div className="line-clamp-2">{session.last_message_in || '—'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 max-w-[300px]">
                      <div className="line-clamp-3 whitespace-pre-line">
                        {session.last_bot_reply || '—'}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                      {session.created_ticket_no ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold text-[11px]">
                          <Ticket className="w-3 h-3" />
                          {session.created_ticket_no}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                      {session.updated_at
                        ? new Date(session.updated_at).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppBotMonitor;
