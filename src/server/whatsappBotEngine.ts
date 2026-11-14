import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const DEFAULT_SUPABASE_URL = 'https://qstqegwpibztpirncpga.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_Ce_QIF3wHFISjJtTiYGY-Q_qs6miPTU';
export const DEFAULT_VERIFY_TOKEN = 'youthnet_noc_2026';
export const DEFAULT_SUPPORT_WHATSAPP = '+923234193599';

function getServerSupabase(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface IncomingWebhookExtraction {
  provider: 'meta' | 'ultramsg' | 'twilio' | 'simulator';
  senderPhone: string;
  normalizedPhone: string;
  messageText: string;
  senderName?: string;
  isFromMe?: boolean;
  isStatusEvent?: boolean;
  simulate?: boolean;
}

export interface BotProcessResult {
  success: boolean;
  ignored?: boolean;
  provider: string;
  sender_phone: string;
  normalized_phone: string;
  subscriber_username: string | null;
  subscriber_name: string | null;
  intent:
    | 'AWAITING_IDENTITY'
    | 'IDENTITY_VERIFIED'
    | 'BILLING_INQUIRY'
    | 'EXPIRED_ACCOUNT'
    | 'COMPLAINT_CREATED'
    | 'COMPLAINT_EXISTING'
    | 'TICKET_STATUS'
    | 'GENERAL_AI'
    | 'BOT_DISABLED'
    | 'IGNORED';
  conversation_state: string;
  reply: string;
  created_ticket_no: string | null;
  assigned_agent_id?: string | null;
  assigned_agent_name?: string | null;
  outbound_dispatched?: boolean;
}

/**
 * Extracts a canonical 10-digit Pakistani mobile core (e.g. "3174113715") when applicable,
 * or full stripped digits for comparison across 03xx, +923xx, 923xx, 00923xx formats.
 */
export function extractPhoneComparisonKey(raw?: string | null): string {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits || digits.length < 7) return '';
  if (digits.startsWith('0092') && digits.length >= 14) {
    return digits.slice(4);
  }
  if (digits.startsWith('92') && digits.length >= 12) {
    return digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length >= 11) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Normalizes a phone string into E.164-style "+923xxxxxxxxx" (or "+<digits>" for non-PK).
 */
export function normalizeToPlus92(raw?: string | null): string {
  const digits = String(raw || '')
    .replace(/@c\.us|@s\.whatsapp\.net|whatsapp:/gi, '')
    .replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0092') && digits.length >= 14) {
    return `+${digits.slice(2)}`;
  }
  if (digits.startsWith('92') && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith('03') && digits.length >= 11) {
    return `+92${digits.slice(1)}`;
  }
  if (digits.startsWith('3') && digits.length === 10) {
    return `+92${digits}`;
  }
  return `+${digits}`;
}

export function extractIncomingMessage(rawBody: any): IncomingWebhookExtraction {
  const body = rawBody || {};

  // 1. Meta WhatsApp Cloud API webhook structure
  const metaValue = body?.entry?.[0]?.changes?.[0]?.value;
  if (metaValue) {
    if (Array.isArray(metaValue.statuses) && !Array.isArray(metaValue.messages)) {
      return {
        provider: 'meta',
        senderPhone: '',
        normalizedPhone: '',
        messageText: '',
        isStatusEvent: true,
      };
    }
    const msg = metaValue.messages?.[0];
    if (msg) {
      const sender = String(msg.from || '');
      const text =
        msg.text?.body ||
        msg.button?.text ||
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        msg.caption ||
        '';
      const profileName = metaValue.contacts?.[0]?.profile?.name;
      return {
        provider: 'meta',
        senderPhone: sender,
        normalizedPhone: normalizeToPlus92(sender),
        messageText: String(text).trim(),
        senderName: profileName,
      };
    }
  }

  // 2. UltraMsg webhook structure
  if (body?.data && (body?.event_type || body?.instanceId || body?.data?.from)) {
    const data = body.data;
    const isFromMe = Boolean(data.fromMe);
    const sender = String(data.from || data.author || '').replace(
      /@c\.us|@s\.whatsapp\.net/gi,
      ''
    );
    const text = String(data.body || data.caption || '').trim();
    return {
      provider: 'ultramsg',
      senderPhone: sender,
      normalizedPhone: normalizeToPlus92(sender),
      messageText: text,
      senderName: data.pushname || data.notifyName,
      isFromMe,
    };
  }

  // 3. Twilio WhatsApp webhook structure (From="whatsapp:+923...", Body="...")
  if (body?.From !== undefined || body?.Body !== undefined) {
    const sender = String(body.From || '').replace(/^whatsapp:/i, '');
    return {
      provider: 'twilio',
      senderPhone: sender,
      normalizedPhone: normalizeToPlus92(sender),
      messageText: String(body.Body || '').trim(),
      senderName: body.ProfileName,
    };
  }

  // 4. Direct / Simulator JSON payload
  const sender = String(
    body.sender_phone || body.phone || body.from || body.senderPhone || ''
  ).trim();
  const text = String(
    body.message || body.text || body.body || body.last_message_in || ''
  ).trim();

  return {
    provider: 'simulator',
    senderPhone: sender,
    normalizedPhone: normalizeToPlus92(sender),
    messageText: text,
    senderName: body.sender_name,
    simulate: Boolean(body.simulate),
  };
}

function getTodayPktDate(): string {
  // Pakistan Standard Time is UTC+5
  return new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatCurrencyRs(amount: number): string {
  return `Rs. ${Math.round(Number(amount) || 0).toLocaleString('en-US')}`;
}

function resolveAreaTechnician(
  subscriber: any,
  invoices: any[],
  agents: any[]
): { id: string | null; full_name: string } {
  const validAgents = (agents || []).filter((a) => a && a.id && a.full_name);

  // 1. Check most recent invoice assigned agent for this subscriber
  for (const inv of invoices || []) {
    if (inv?.assigned_agent_id) {
      const matched = validAgents.find((a) => a.id === inv.assigned_agent_id);
      if (matched) return { id: matched.id, full_name: matched.full_name };
      if (inv.assigned_agent_name) {
        return { id: inv.assigned_agent_id, full_name: inv.assigned_agent_name };
      }
    }
  }

  // 2. Match by area tokens between subscriber.area and agent.area
  const subArea = String(subscriber?.area || '').toLowerCase();
  if (subArea && validAgents.length > 0) {
    const subTokens = subArea
      .split(/[\s,&/()-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !['node', 'sector', 'zone', 'north', 'south', 'area'].includes(t));

    for (const agent of validAgents) {
      const agArea = String(agent.area || '').toLowerCase();
      if (!agArea) continue;
      if (agArea === subArea || agArea.includes(subArea) || subArea.includes(agArea)) {
        return { id: agent.id, full_name: agent.full_name };
      }
      if (subTokens.some((tok) => agArea.includes(tok))) {
        return { id: agent.id, full_name: agent.full_name };
      }
    }
  }

  // 3. Fallback to first active Saddar / general technician
  if (validAgents.length > 0) {
    return { id: validAgents[0].id, full_name: validAgents[0].full_name };
  }
  return { id: null, full_name: 'Youth Net NOC Field Team' };
}

function formatPaymentAccountsBlock(accounts: any[], waConfig: any): string {
  const active = (accounts || []).filter((a) => a && a.is_active !== false);
  if (active.length > 0) {
    return active
      .map(
        (acc) =>
          `• *${acc.provider_name}:* ${acc.account_number_or_iban} (${acc.account_title})`
      )
      .join('\n');
  }

  const lines: string[] = [];
  if (waConfig?.bank_name && waConfig?.bank_iban_or_acc) {
    lines.push(
      `• *${waConfig.bank_name}:* ${waConfig.bank_iban_or_acc} (${waConfig.bank_account_title || 'Youth Technology'})`
    );
  }
  if (waConfig?.jazzcash_number) {
    lines.push(
      `• *JazzCash:* ${waConfig.jazzcash_number} (${waConfig.jazzcash_title || 'Ahsan Amin'})`
    );
  }
  if (waConfig?.easypaisa_number) {
    lines.push(
      `• *EasyPaisa:* ${waConfig.easypaisa_number} (${waConfig.easypaisa_title || 'Ahsan Amin'})`
    );
  }
  return lines.length > 0
    ? lines.join('\n')
    : '• *Bank Alfalah:* PK00ALFH0000000000000000 (Youth Technology)\n• *JazzCash / EasyPaisa:* 0300-0000000 (Ahsan Amin)';
}

function detectIntent(
  messageText: string,
  justMatchedIdentity: boolean
): 'IDENTITY_ONLY' | 'BILLING' | 'TICKET_STATUS' | 'COMPLAINT' | 'GENERAL' {
  const lower = messageText.toLowerCase().trim();

  const billingKeywords = [
    'bill',
    'dues',
    'balance',
    'amount',
    'kitna',
    'kitni',
    'pay',
    'payment',
    'paid',
    'unpaid',
    'expire',
    'expiry',
    'package',
    'mbps',
    'plan',
    'renew',
    'renewal',
    'recharge',
    'account',
    'jazzcash',
    'easypaisa',
    'bank',
    'iban',
    'raast',
    'invoice',
    'challan',
    'paisa',
    'paise',
    'fee',
    'fees',
    'tarikh',
    'date',
  ];

  const statusKeywords = [
    'ticket status',
    'status',
    'tkt-',
    'update',
    'kab tak',
    'kahan tak',
    'team kab',
    'technician kab',
    'mera ticket',
  ];

  const complaintKeywords = [
    'net',
    'internet',
    'wifi',
    'wi-fi',
    'nahi chal',
    'nhi chal',
    'nahe chal',
    'ni chal',
    'band',
    'down',
    'offline',
    'red light',
    'red',
    'los',
    'light',
    'blink',
    'slow',
    'speed',
    'ping',
    'lag',
    'disconnect',
    'drop',
    'router',
    'ont',
    'onu',
    'modem',
    'wire',
    'cable',
    'fiber',
    'cut',
    'toot',
    'kharab',
    'kharaab',
    'problem',
    'issue',
    'masla',
    'complaint',
    'complain',
    'shikayat',
    'fault',
    'broken',
    'not working',
    'no connection',
  ];

  const hasBilling = billingKeywords.some((k) => lower.includes(k));
  const hasStatus = statusKeywords.some((k) => lower.includes(k));
  const hasComplaint = complaintKeywords.some((k) => lower.includes(k));

  // If message explicitly mentions red light / no internet / complaint, prioritize complaint
  if (hasComplaint && !hasBilling) return 'COMPLAINT';
  if (hasBilling && !hasComplaint) return 'BILLING';
  if (hasStatus && !hasComplaint) return 'TICKET_STATUS';
  if (hasComplaint && hasBilling) {
    // e.g. "mera net band hai bill check karein" vs "net nahi chal raha"
    if (lower.includes('bill') || lower.includes('expiry') || lower.includes('pay')) {
      return 'BILLING';
    }
    return 'COMPLAINT';
  }

  // Check if message is solely an identifier (@username or phone number)
  if (justMatchedIdentity && lower.split(/\s+/).length <= 3) {
    return 'IDENTITY_ONLY';
  }

  return 'GENERAL';
}

function isHighPriorityComplaint(messageText: string): boolean {
  const lower = messageText.toLowerCase();
  return [
    'red light',
    'red',
    'los',
    'no internet',
    'net nahi',
    'net nhi',
    'internet nahi',
    'band hai',
    'fiber cut',
    'wire cut',
    'toot',
    'offline',
  ].some((kw) => lower.includes(kw));
}

async function generateOptionalGeminiReply(params: {
  systemPrompt?: string | null;
  userMessage: string;
  subscriber: any;
  expiryDate: string;
  isExpired: boolean;
  totalDue: number;
  technicianName: string;
  supportWhatsapp: string;
}): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const contextSummary = [
      `Subscriber Name: ${params.subscriber.full_name}`,
      `PPPoE Username: @${params.subscriber.username}`,
      `Package: ${params.subscriber.package_speed || params.subscriber.package_profile_name || 'Fiber Broadband'}`,
      `Area: ${params.subscriber.area || 'Service Zone'}`,
      `Account Status: ${params.isExpired ? 'EXPIRED / DUE' : params.subscriber.account_status || 'ACTIVE'}`,
      `Expiry Date: ${params.expiryDate || 'N/A'}`,
      `Unpaid Balance: Rs. ${params.totalDue}`,
      `Assigned Area Technician: ${params.technicianName}`,
      `Official Support WhatsApp: ${params.supportWhatsapp}`,
    ].join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Customer WhatsApp message: "${params.userMessage}"\n\nVerified Subscriber Context:\n${contextSummary}`,
      config: {
        systemInstruction: `${
          params.systemPrompt ||
          'You are Youth Net Service NOC Assistant in Pakistan. Reply politely in concise Roman Urdu/English.'
        } Keep the reply under 450 characters. Never invent prices, tickets, or promises. If they need a complaint logged, tell them to describe the fault (e.g. "red light" or "net nahi chal raha"). End with: — Youth Net Service NOC (${params.supportWhatsapp})`,
      },
    });

    const text = response?.text?.trim();
    return text || null;
  } catch (err) {
    console.warn('[WhatsAppBot] Gemini optional reply skipped:', (err as any)?.message || err);
    return null;
  }
}

async function upsertBotSession(
  supabase: SupabaseClient,
  payload: {
    sender_phone: string;
    subscriber_username: string | null;
    conversation_state: string;
    last_message_in: string;
    last_bot_reply: string;
    created_ticket_no: string | null;
  }
): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const cleanPhone = payload.sender_phone;
    const key = extractPhoneComparisonKey(cleanPhone);

    const { data: existingRows } = await supabase
      .from('whatsapp_bot_sessions')
      .select('id, sender_phone, created_ticket_no')
      .order('updated_at', { ascending: false })
      .limit(100);

    const existing = (existingRows || []).find(
      (r: any) =>
        r.sender_phone === cleanPhone ||
        (key && extractPhoneComparisonKey(r.sender_phone) === key)
    );

    if (existing?.id) {
      await supabase
        .from('whatsapp_bot_sessions')
        .update({
          sender_phone: cleanPhone,
          subscriber_username: payload.subscriber_username,
          conversation_state: payload.conversation_state,
          last_message_in: payload.last_message_in,
          last_bot_reply: payload.last_bot_reply,
          created_ticket_no: payload.created_ticket_no ?? existing.created_ticket_no ?? null,
          updated_at: nowIso,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('whatsapp_bot_sessions').insert([
        {
          sender_phone: cleanPhone,
          subscriber_username: payload.subscriber_username,
          conversation_state: payload.conversation_state,
          last_message_in: payload.last_message_in,
          last_bot_reply: payload.last_bot_reply,
          created_ticket_no: payload.created_ticket_no,
          updated_at: nowIso,
        },
      ]);
    }
  } catch (err) {
    console.warn('[WhatsAppBot] Failed to log whatsapp_bot_sessions:', err);
  }
}

export async function dispatchOutboundWhatsAppReply(
  provider: string,
  toPhone: string,
  replyText: string,
  waConfig: any
): Promise<boolean> {
  try {
    // 1. Meta WhatsApp Cloud API if configured via env or whatsapp_billing_config
    const metaToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN || waConfig?.api_token;
    const metaPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || waConfig?.phone_number_id;
    if (provider === 'meta' && metaToken && metaPhoneId) {
      const recipientDigits = toPhone.replace(/[^\d]/g, '');
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${encodeURIComponent(metaPhoneId)}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipientDigits,
            type: 'text',
            text: { body: replyText },
          }),
        }
      );
      return res.ok;
    }

    // 2. UltraMsg / Custom Gateway if enabled
    const gatewayUrl = waConfig?.api_gateway_url || process.env.ULTRAMSG_API_URL;
    const gatewayToken = waConfig?.api_token || process.env.ULTRAMSG_TOKEN;
    if (waConfig?.auto_api_enabled && gatewayUrl && gatewayToken) {
      const res = await fetch(gatewayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: gatewayToken,
          to: toPhone,
          body: replyText,
        }),
      });
      return res.ok;
    }
  } catch (err) {
    console.warn('[WhatsAppBot] Outbound gateway dispatch notice:', err);
  }
  return false;
}

export async function verifyWebhookChallenge(query: Record<string, string | undefined>): Promise<{
  statusCode: number;
  body: string;
}> {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'] || '';

  let expectedToken = process.env.WHATSAPP_VERIFY_TOKEN || DEFAULT_VERIFY_TOKEN;
  try {
    const supabase = getServerSupabase();
    const { data } = await supabase
      .from('whatsapp_billing_config')
      .select('webhook_verify_token')
      .limit(1)
      .maybeSingle();
    if (data?.webhook_verify_token) {
      expectedToken = String(data.webhook_verify_token).trim();
    }
  } catch {}

  if (token && token === expectedToken && (!mode || mode === 'subscribe')) {
    return { statusCode: 200, body: challenge || 'verified' };
  }
  return { statusCode: 403, body: 'Forbidden: Invalid verify token' };
}

export async function processIncomingWhatsAppMessage(
  rawBody: any
): Promise<BotProcessResult> {
  const extracted = extractIncomingMessage(rawBody);

  if (extracted.isStatusEvent || extracted.isFromMe || !extracted.messageText) {
    return {
      success: true,
      ignored: true,
      provider: extracted.provider,
      sender_phone: extracted.senderPhone,
      normalized_phone: extracted.normalizedPhone,
      subscriber_username: null,
      subscriber_name: null,
      intent: 'IGNORED',
      conversation_state: 'IGNORED',
      reply: '',
      created_ticket_no: null,
    };
  }

  const supabase = getServerSupabase();
  const normalizedPhone = extracted.normalizedPhone || extracted.senderPhone || 'Unknown';
  const phoneKey = extractPhoneComparisonKey(normalizedPhone);
  const userMessage = extracted.messageText.trim();

  // Fetch config, clients, agents, payment_accounts, and existing bot session in parallel
  const [waConfigRes, usersRes, paymentAccRes, sessionRes] = await Promise.all([
    supabase.from('whatsapp_billing_config').select('*').limit(1).maybeSingle(),
    supabase
      .from('portal_users')
      .select(
        'id, username, role, full_name, phone, area, account_status, package_speed, package_profile_name, monthly_fee, expiry_date'
      ),
    supabase.from('payment_accounts').select('*').eq('is_active', true),
    supabase
      .from('whatsapp_bot_sessions')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100),
  ]);

  const waConfig = waConfigRes.data || {};
  const supportWhatsapp =
    String(waConfig?.support_whatsapp || '').trim() || DEFAULT_SUPPORT_WHATSAPP;

  if (waConfig?.bot_enabled === false && !extracted.simulate) {
    return {
      success: true,
      ignored: true,
      provider: extracted.provider,
      sender_phone: normalizedPhone,
      normalized_phone: normalizedPhone,
      subscriber_username: null,
      subscriber_name: null,
      intent: 'BOT_DISABLED',
      conversation_state: 'DISABLED',
      reply: 'Bot is currently paused in NOC settings.',
      created_ticket_no: null,
    };
  }

  const allUsers = (usersRes.data || []) as any[];
  const clients = allUsers.filter((u) => String(u.role || '').toUpperCase() === 'CLIENT');
  const agents = allUsers.filter((u) => String(u.role || '').toUpperCase() === 'AGENT');
  const activePaymentAccounts = (paymentAccRes.data || []) as any[];

  const existingSession = ((sessionRes.data || []) as any[]).find(
    (s) =>
      s.sender_phone === normalizedPhone ||
      (phoneKey && extractPhoneComparisonKey(s.sender_phone) === phoneKey)
  );

  // 1. Identify Subscriber in portal_users
  let subscriber: any = null;
  let justMatchedIdentity = false;

  // 1a. Direct phone number match (require valid >=10-digit PK key so "+92" doesn't falsely match)
  if (phoneKey && phoneKey.length >= 10) {
    subscriber = clients.find((c) => {
      const cKey = extractPhoneComparisonKey(c.phone);
      return cKey && cKey.length >= 10 && cKey === phoneKey;
    });
  }

  // 1b. Check if message contains an explicit @username or registered username / mobile number
  if (!subscriber) {
    const atUsernameMatch = userMessage.match(/@([a-zA-Z0-9._-]{3,})/);
    if (atUsernameMatch?.[1]) {
      const target = atUsernameMatch[1].toLowerCase();
      subscriber = clients.find((c) => String(c.username || '').toLowerCase() === target);
      if (subscriber) justMatchedIdentity = true;
    }
  }

  if (!subscriber) {
    // Check standalone username token(s) in message
    const tokens = userMessage
      .toLowerCase()
      .split(/[\s,;:!?]+/)
      .map((t) => t.replace(/^@/, '').trim())
      .filter((t) => t.length >= 4);

    for (const tok of tokens) {
      const found = clients.find((c) => String(c.username || '').toLowerCase() === tok);
      if (found) {
        subscriber = found;
        justMatchedIdentity = true;
        break;
      }
    }
  }

  if (!subscriber) {
    // Check if user replied with a registered Pakistani mobile number inside message
    const phoneInTextMatch = userMessage.match(/(?:\+?92|0)?3\d{2}[-\s]?\d{7}/);
    if (phoneInTextMatch?.[0]) {
      const replyKey = extractPhoneComparisonKey(phoneInTextMatch[0]);
      if (replyKey && replyKey.length >= 10) {
        subscriber = clients.find((c) => {
          const cKey = extractPhoneComparisonKey(c.phone);
          return cKey && cKey.length >= 10 && cKey === replyKey;
        });
        if (subscriber) justMatchedIdentity = true;
      }
    }
  }

  // 1c. Fallback to linked subscriber_username from previous whatsapp_bot_sessions turn
  if (!subscriber && existingSession?.subscriber_username) {
    const linkedUsername = String(existingSession.subscriber_username).toLowerCase();
    subscriber = clients.find((c) => String(c.username || '').toLowerCase() === linkedUsername);
  }

  // Unknown subscriber flow -> Ask for PPPoE Username or Registered Mobile Number
  if (!subscriber) {
    const askIdentityReply =
      `Assalam-o-Alaikum! *Youth Net Service NOC* mein khush aamdeed 🌐\n\n` +
      `Apka WhatsApp number hamare subscriber record se match nahi hua. Baraye meherbani apna *PPPoE Username* (maslan \`@bztahir72\`) ya *Registered Mobile Number* (\`03xx-xxxxxxx\`) reply karein taake hum apki billing aur technical madad kar sakein.\n\n` +
      `— Youth Net Service NOC (${supportWhatsapp})`;

    await upsertBotSession(supabase, {
      sender_phone: normalizedPhone,
      subscriber_username: null,
      conversation_state: 'AWAITING_IDENTITY',
      last_message_in: userMessage,
      last_bot_reply: askIdentityReply,
      created_ticket_no: null,
    });

    const outboundDispatched = extracted.simulate
      ? false
      : await dispatchOutboundWhatsAppReply(
          extracted.provider,
          normalizedPhone,
          askIdentityReply,
          waConfig
        );

    return {
      success: true,
      provider: extracted.provider,
      sender_phone: normalizedPhone,
      normalized_phone: normalizedPhone,
      subscriber_username: null,
      subscriber_name: null,
      intent: 'AWAITING_IDENTITY',
      conversation_state: 'AWAITING_IDENTITY',
      reply: askIdentityReply,
      created_ticket_no: null,
      outbound_dispatched: outboundDispatched,
    };
  }

  // 2. Subscriber Found -> Load their invoices & tickets
  const [invoicesRes, ticketsRes] = await Promise.all([
    supabase
      .from('invoices')
      .select('*')
      .eq('subscriber_username', subscriber.username)
      .order('created_at', { ascending: false }),
    supabase
      .from('tickets')
      .select('*')
      .eq('subscriber_username', subscriber.username)
      .order('created_at', { ascending: false }),
  ]);

  const subscriberInvoices = (invoicesRes.data || []) as any[];
  const subscriberTickets = (ticketsRes.data || []) as any[];
  const technician = resolveAreaTechnician(subscriber, subscriberInvoices, agents);

  const unpaidInvoices = subscriberInvoices.filter((inv) => {
    const st = String(inv.status || '').toUpperCase();
    const balance = (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0);
    return st !== 'PAID' && balance > 0;
  });

  const unpaidBalance = unpaidInvoices.reduce(
    (sum, inv) => sum + Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0)),
    0
  );

  const todayPkt = getTodayPktDate();
  const expiryDateStr = String(subscriber.expiry_date || '').slice(0, 10);
  const accountStatusUpper = String(subscriber.account_status || 'ACTIVE').toUpperCase();
  const isExpired =
    accountStatusUpper === 'EXPIRED' ||
    accountStatusUpper === 'SUSPENDED' ||
    (Boolean(expiryDateStr) && expiryDateStr < todayPkt);

  const payableAmount =
    unpaidBalance > 0 ? unpaidBalance : isExpired ? Number(subscriber.monthly_fee) || 2500 : 0;

  const packageLabel =
    subscriber.package_speed || subscriber.package_profile_name || 'Fiber Broadband';
  const greetingHeader = `Assalam-o-Alaikum *${subscriber.full_name}* (\`@${subscriber.username}\`) 👋`;
  const accountsBlock = formatPaymentAccountsBlock(activePaymentAccounts, waConfig);

  const intent = detectIntent(userMessage, justMatchedIdentity);

  let finalIntent: BotProcessResult['intent'] = 'GENERAL_AI';
  let conversationState = 'IDENTIFIED';
  let reply = '';
  let createdTicketNo: string | null = null;

  // 3A. Identity Verified Only
  if (intent === 'IDENTITY_ONLY') {
    finalIntent = 'IDENTITY_VERIFIED';
    conversationState = 'IDENTIFIED';
    reply =
      `${greetingHeader}\n` +
      `Apka account verify ho gaya hai ✅\n` +
      `• *Package:* ${packageLabel}\n` +
      `• *Status:* ${isExpired ? '⚠️ EXPIRED' : accountStatusUpper}\n` +
      `• *Expiry Date:* ${expiryDateStr || '31-Day Cycle'}\n` +
      `• *Payable Dues:* ${formatCurrencyRs(payableAmount)}\n\n` +
      `Apna masla likhein (maslan *"Net nahi chal raha red light aa rahi hai"* ya *"Mera bill kitna hai?"*) — hum foran madad karenge.\n` +
      `— Youth Net Service NOC (${supportWhatsapp})`;
  }
  // 3B. Billing / Expiry / Payment Inquiry
  else if (intent === 'BILLING') {
    finalIntent = 'BILLING_INQUIRY';
    conversationState = 'BILLING_CHECKED';
    const latestUnpaid = unpaidInvoices[0];
    reply =
      `${greetingHeader}\n` +
      `📋 *Billing & Package Details:*\n` +
      `• *Package:* ${packageLabel}\n` +
      `• *Status:* ${isExpired ? '⚠️ EXPIRED / RENEWAL DUE' : '✅ ACTIVE'}\n` +
      `• *Expiry Date:* ${expiryDateStr || 'Not set'}\n` +
      `• *Payable Balance:* *${formatCurrencyRs(payableAmount)}*${
        latestUnpaid?.invoice_no ? ` (Invoice: ${latestUnpaid.invoice_no})` : ''
      }\n\n` +
      (payableAmount > 0 || isExpired
        ? `*Online Payment Accounts:*\n${accountsBlock}\n\nPayment transfer karne ke baad screenshot *${supportWhatsapp}* par send karein taake apka 31-day cycle foran renew kiya jaye.`
        : `Apka billing account clear hai (Rs. 0 dues). Shukriya!`) +
      `\n— Youth Net Service NOC (${supportWhatsapp})`;
  }
  // 3C. Ticket Status Check
  else if (intent === 'TICKET_STATUS') {
    finalIntent = 'TICKET_STATUS';
    conversationState = 'STATUS_CHECKED';
    const openTkt = subscriberTickets.find((t) =>
      ['OPEN', 'IN_PROGRESS', 'ASSIGNED'].includes(String(t.status || '').toUpperCase())
    );
    if (openTkt) {
      createdTicketNo = openTkt.ticket_no;
      reply =
        `${greetingHeader}\n` +
        `🎫 Apka existing support ticket active hai:\n` +
        `• *Ticket #:* ${openTkt.ticket_no}\n` +
        `• *Status:* ${openTkt.status}\n` +
        `• *Priority:* ${openTkt.priority || 'MEDIUM'}\n` +
        `• *Area Technician:* ${openTkt.assigned_agent_name || technician.full_name}\n\n` +
        `Hamari technical team is par kaam kar rahi hai.\n— Youth Net Service NOC (${supportWhatsapp})`;
    } else {
      reply =
        `${greetingHeader}\n` +
        `Filhal apke account par koi open complaint ticket nahi hai. Agar internet mein koi masla aa raha hai to apni complaint likh kar bhejein (maslan *"Net nahi chal raha"*), hum foran naya ticket register kar denge.\n— Youth Net Service NOC (${supportWhatsapp})`;
    }
  }
  // 3D. Technical Complaint -> Expired Auto-Check FIRST, then Deduplicated Ticket Insert
  else if (intent === 'COMPLAINT') {
    if (isExpired) {
      finalIntent = 'EXPIRED_ACCOUNT';
      conversationState = 'EXPIRED_NOTICE_SENT';
      const expiryDetail =
        expiryDateStr && expiryDateStr < todayPkt
          ? `*${expiryDateStr}* ko expire ho chuka hai`
          : `non-payment ki wajah se disabled/expired hai${
              expiryDateStr ? ` (Cycle Date: *${expiryDateStr}*)` : ''
            }`;
      reply =
        `${greetingHeader}\n` +
        `⚠️ *Service Notice — 31-Day Cycle Expired*\n` +
        `Apka *${packageLabel}* internet package ${expiryDetail}, is liye line fault ticket register nahi kiya gaya.\n\n` +
        `• *Payable Amount:* *${formatCurrencyRs(payableAmount || 2500)}*\n\n` +
        `*Online Payment Accounts:*\n${accountsBlock}\n\n` +
        `Baraye meherbani payment submit kar ke screenshot *${supportWhatsapp}* par bhejein — apka internet foran restore ho jayega.\n— Youth Net Service NOC (${supportWhatsapp})`;
    } else {
      // Check for existing OPEN or IN_PROGRESS ticket to strictly prevent duplicates
      const existingOpenTicket = subscriberTickets.find((t) =>
        ['OPEN', 'IN_PROGRESS', 'ASSIGNED'].includes(String(t.status || '').toUpperCase())
      );

      if (existingOpenTicket) {
        finalIntent = 'COMPLAINT_EXISTING';
        conversationState = 'TICKET_EXISTING';
        createdTicketNo = existingOpenTicket.ticket_no;
        reply =
          `${greetingHeader}\n` +
          `Apki pehle se ek complaint open hai (duplicate ticket nahi banaya gaya) ✅\n` +
          `• *Existing Ticket #:* *${existingOpenTicket.ticket_no}*\n` +
          `• *Status:* ${existingOpenTicket.status}\n` +
          `• *Area Technician:* *${
            existingOpenTicket.assigned_agent_name || technician.full_name
          }*\n\n` +
          `Hamari team jald apse rabta karegi. — Youth Net Service NOC (${supportWhatsapp})`;
      } else {
        // Insert ONE single ticket into Supabase tickets
        const newTicketNo = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
        const priority = isHighPriorityComplaint(userMessage) ? 'HIGH' : 'MEDIUM';

        const { data: insertedTicket, error: insertErr } = await supabase
          .from('tickets')
          .insert([
            {
              ticket_no: newTicketNo,
              subscriber_username: subscriber.username,
              issue: `[WHATSAPP_AI] ${userMessage}`,
              priority,
              status: 'OPEN',
              assigned_agent_id: technician.id,
              assigned_agent_name: technician.full_name,
              created_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        if (insertErr) {
          throw new Error(`Supabase ticket insert failed: ${insertErr.message}`);
        }

        createdTicketNo = insertedTicket?.ticket_no || newTicketNo;
        finalIntent = 'COMPLAINT_CREATED';
        conversationState = 'TICKET_CREATED';
        reply =
          `${greetingHeader}\n` +
          `Apki complaint register ho gayi hai ✅\n` +
          `Ticket #: *${createdTicketNo}*\n` +
          `Area Technician: *${technician.full_name}*\n` +
          `Hamari team jald apse rabta karegi. — Youth Net Service NOC (${supportWhatsapp})`;
      }
    }
  }
  // 3E. General / Greeting / AI Conversational Reply
  else {
    finalIntent = 'GENERAL_AI';
    conversationState = 'IDENTIFIED';
    const aiReply = await generateOptionalGeminiReply({
      systemPrompt: waConfig?.ai_bot_system_prompt,
      userMessage,
      subscriber,
      expiryDate: expiryDateStr,
      isExpired,
      totalDue: payableAmount,
      technicianName: technician.full_name,
      supportWhatsapp,
    });

    reply =
      aiReply ||
      `${greetingHeader}\n` +
        `Youth Net Service NOC Bot apki madad ke liye hazir hai 🌐\n` +
        `• *Package:* ${packageLabel} (${isExpired ? 'EXPIRED' : accountStatusUpper})\n` +
        `• *Payable Dues:* ${formatCurrencyRs(payableAmount)}\n\n` +
        `Aap pooch sakte hain:\n` +
        `1️⃣ *"Mera bill kitna hai?"*\n` +
        `2️⃣ *"Net nahi chal raha red light aa rahi hai"*\n` +
        `3️⃣ *"Mera ticket status kya hai?"*\n\n` +
        `— Youth Net Service NOC (${supportWhatsapp})`;
  }

  await upsertBotSession(supabase, {
    sender_phone: normalizedPhone,
    subscriber_username: subscriber.username,
    conversation_state: conversationState,
    last_message_in: userMessage,
    last_bot_reply: reply,
    created_ticket_no: createdTicketNo,
  });

  const outboundDispatched = extracted.simulate
    ? false
    : await dispatchOutboundWhatsAppReply(
        extracted.provider,
        normalizedPhone,
        reply,
        waConfig
      );

  return {
    success: true,
    provider: extracted.provider,
    sender_phone: normalizedPhone,
    normalized_phone: normalizedPhone,
    subscriber_username: subscriber.username,
    subscriber_name: subscriber.full_name || subscriber.username,
    intent: finalIntent,
    conversation_state: conversationState,
    reply,
    created_ticket_no: createdTicketNo,
    assigned_agent_id: technician.id,
    assigned_agent_name: technician.full_name,
    outbound_dispatched: outboundDispatched,
  };
}
