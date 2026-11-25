/**
 * Standalone Multi-Session (Multi-Tenant) Baileys WhatsApp Gateway Server
 *
 * Run with:
 *   node baileys-server.js
 *
 * Environment variables (.env):
 *   WA_GATEWAY_PORT=3001           (or PORT=3001)
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=xxx  (or SUPABASE_KEY / VITE_SUPABASE_ANON_KEY)
 *   ALLOWED_ORIGINS=*              (optional comma-separated origins, defaults to *)
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import * as baileys from '@whiskeysockets/baileys';

dotenv.config();

const makeWASocket =
  baileys.default?.default ?? baileys.default ?? baileys.makeWASocket;
const useMultiFileAuthState = baileys.useMultiFileAuthState;
const DisconnectReason = baileys.DisconnectReason ?? { loggedOut: 401 };
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
const Browsers = baileys.Browsers;

const PORT = Number(process.env.WA_GATEWAY_PORT || process.env.PORT || 3001);
const DEFAULT_MASTER_COMPANY_NAME = 'Youth Net Service';
const BAILEYS_AUTH_ROOT = path.resolve(process.cwd(), 'baileys_auth');
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://qstqegwpibztpirncpga.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  '';

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

if (!supabase) {
  console.warn(
    `[Baileys-Gateway] SUPABASE_URL is set to ${SUPABASE_URL}, but SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) is not set in .env. Set SUPABASE_SERVICE_ROLE_KEY in .env to enable multi-tenant database lookups & WhatsApp logs.`
  );
}

// ============================================================================
// PATH CONFINEMENT & PHONE FORMATTING HELPERS
// ============================================================================

function sanitizePortalUserId(rawId) {
  const clean = String(rawId || '').trim();
  if (!clean || !SESSION_ID_PATTERN.test(clean)) return null;
  return clean;
}

function resolveSafeAuthDir(portalUserId) {
  const safeId = sanitizePortalUserId(portalUserId);
  if (!safeId) throw new Error('Invalid session identifier.');
  const resolvedRoot = path.resolve(BAILEYS_AUTH_ROOT);
  const resolvedTarget = path.resolve(resolvedRoot, `session_${safeId}`);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Session directory escapes baileys_auth root.');
  }
  return resolvedTarget;
}

function formatWhatsAppDigits(rawPhone) {
  let digits = String(rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('03') && digits.length === 11) {
    digits = `92${digits.slice(1)}`;
  } else if (digits.startsWith('3') && digits.length === 10) {
    digits = `92${digits}`;
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

function formatWhatsAppJid(rawPhone) {
  const digits = formatWhatsAppDigits(rawPhone);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function getEffectiveTier(u) {
  if (!u) return 'OTHER';
  const tier = String(u.tier_level || '').trim().toUpperCase();
  const role = String(u.role || '').trim().toUpperCase();
  if (tier === 'SUB_DEALER' || role === 'SUB_DEALER') return 'SUB_DEALER';
  if (tier === 'DEALER' || role === 'DEALER') return 'DEALER';
  if (role === 'ADMIN' || tier === 'MASTER' || tier === 'ADMIN') return 'ADMIN';
  return 'OTHER';
}

function canSubDealerUseOwnWhatsApp(subDealer, parentDealer) {
  if (!subDealer) return false;
  if (subDealer.allow_subdealer_whatsapp === true) return true;
  if (subDealer.allow_subdealer_whatsapp === false) return false;
  if (parentDealer && parentDealer.allow_subdealer_whatsapp === true) return true;
  return false;
}

function resolveDisplayCompanyName(u, fallback = DEFAULT_MASTER_COMPANY_NAME) {
  const custom = String(u?.company_name || '').trim();
  if (custom) return custom;
  if (getEffectiveTier(u) === 'ADMIN') return DEFAULT_MASTER_COMPANY_NAME;
  return String(u?.full_name || '').trim() || fallback;
}

function buildAutomatedMessage(eventType, vars = {}) {
  const company = String(vars.companyName || DEFAULT_MASTER_COMPANY_NAME).trim();
  const clientName = String(vars.subscriberName || vars.username || 'Valued Subscriber').trim();
  const uname = String(vars.username || '').trim();
  const supportLine = vars.supportPhone ? `\nSupport Helpline: ${vars.supportPhone}` : '';
  const activeAccounts = Array.isArray(vars.paymentAccounts)
    ? vars.paymentAccounts.filter((a) => a && a.is_active !== false)
    : [];
  const paymentBlock =
    activeAccounts.length > 0
      ? `\n\n*Payment Methods:*\n${activeAccounts
          .map((acc) => `• *${acc.provider_name}:* ${acc.account_number_or_iban} (${acc.account_title})`)
          .join('\n')}`
      : '';

  switch (eventType) {
    case 'PROVISION_WELCOME':
      return (
        `*Welcome to ${company}!*\n\n` +
        `Dear *${clientName}*,\n` +
        `Your fiber broadband connection is now *ACTIVE*.\n\n` +
        `• *PPPoE Username:* \`${uname}\`\n` +
        (vars.password ? `• *PPPoE Password:* \`${vars.password}\`\n` : '') +
        `• *Package:* ${vars.packageName || 'Fiber Broadband'}` +
        (Number(vars.monthlyFee) > 0
          ? `\n• *Monthly Fee:* Rs. ${Math.round(Number(vars.monthlyFee)).toLocaleString()}`
          : '') +
        `\n\nThank you for choosing *${company}*!` +
        supportLine
      );

    case 'PORTAL_CREDENTIALS': {
      const roleText = vars.accountRole ? `\n• *Account Role:* ${vars.accountRole}` : '';
      const portalLink = vars.portalUrl ? `\n• *Portal Link:* ${vars.portalUrl}` : '';
      return (
        `*Welcome to ${company}!*\n\n` +
        `Dear *${clientName}*,\n` +
        `Your portal login account has been created and is now active.\n\n` +
        `• *Username:* ${uname || 'N/A'}\n` +
        `• *Password:* ${vars.password || 'As configured'}` +
        roleText +
        portalLink +
        `\n\nPlease keep your login details secure.\n— *${company}*` +
        supportLine
      );
    }

    case 'INVOICE_GENERATED':
      return (
        `*${company} — Monthly Broadband Bill*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your monthly broadband invoice has been generated.\n\n` +
        (vars.invoiceNo ? `• *Invoice #:* ${vars.invoiceNo}\n` : '') +
        `• *Package:* ${vars.packageName || 'Fiber Broadband'}\n` +
        `• *Amount Due:* Rs. ${Math.round(Number(vars.amountDue ?? vars.totalAmount ?? 0)).toLocaleString()}\n` +
        `• *Due Date:* ${vars.dueDate || vars.expiryDate || 'Current Cycle'}` +
        paymentBlock +
        `\n\nPlease settle your bill before the due date to enjoy uninterrupted internet.\n— *${company}*` +
        supportLine
      );

    case 'PRE_EXPIRY_3D':
      return (
        `*${company} — Renewal Reminder*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your internet package is scheduled to expire soon.\n\n` +
        `• *Package:* ${vars.packageName || 'Fiber Broadband'}\n` +
        `• *Amount Due:* Rs. ${Math.round(Number(vars.amountDue ?? vars.totalAmount ?? 0)).toLocaleString()}\n` +
        `• *Expiry Date:* ${vars.expiryDate || vars.dueDate || 'Upcoming'}` +
        paymentBlock +
        `\n\nPlease pay before expiry to prevent automatic service suspension.\n— *${company}*` +
        supportLine
      );

    case 'AUTO_SUSPENSION':
      return (
        `*${company} — Service Temporarily Suspended*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Your broadband connection has been automatically isolated due to unpaid dues.\n\n` +
        `• *Outstanding Due:* Rs. ${Math.round(Number(vars.amountDue ?? vars.totalAmount ?? 0)).toLocaleString()}\n` +
        `• *Package:* ${vars.packageName || 'Fiber Broadband'}` +
        paymentBlock +
        `\n\nYour connection will be *instantly restored* as soon as payment is received.\n— *${company}*` +
        supportLine
      );

    case 'PAYMENT_RESTORED': {
      const paid = Math.round(Number(vars.amountPaid ?? vars.totalAmount ?? 0));
      const remaining = Math.max(0, Math.round(Number(vars.remainingBalance ?? 0)));
      return (
        `*${company} — Payment Receipt & Service Confirmation*\n\n` +
        `Dear *${clientName}* (${uname}),\n` +
        `Thank you! Your payment has been confirmed.\n` +
        (vars.invoiceNo ? `• *Receipt / Invoice #:* ${vars.invoiceNo}\n` : '') +
        `• *Amount Paid:* Rs. ${paid.toLocaleString()}\n` +
        `• *Remaining Balance:* Rs. ${remaining.toLocaleString()}\n` +
        `• *Account Status:* ${remaining <= 0 ? 'PAID IN FULL & INTERNET ACTIVE' : 'PARTIAL PAYMENT RECEIVED'}\n` +
        (vars.expiryDate || vars.dueDate ? `• *Next Renewal Date:* ${vars.expiryDate || vars.dueDate}\n` : '') +
        `\nThank you for staying connected with *${company}*!` +
        supportLine
      );
    }

    case 'MANUAL_TEST':
    default:
      return (
        `*${company} — WhatsApp Gateway Active*\n\n` +
        `${vars.customNote || 'Automated multi-tenant Baileys WhatsApp Gateway is connected and ready.'}\n\n` +
        `— *${company}*` +
        supportLine
      );
  }
}

// ============================================================================
// MULTI-SESSION BAILEYS SOCKET ENGINE
// ============================================================================

const sockets = new Map(); // sessionKey -> WASocket
const states = new Map(); // sessionKey -> { portalUserId, sessionKey, status, qrDataUrl, phone, lastError, updatedAt, reconnectAttempts }
const pendingQrWaiters = new Map(); // sessionKey -> Array<() => void>
const memoryLogs = [];
const dedupeKeys = new Set();

function getOrCreateState(portalUserId) {
  const safeId = sanitizePortalUserId(portalUserId);
  if (!safeId) throw new Error('Invalid portalUserId.');
  const sessionKey = `session_${safeId}`;
  if (!states.has(sessionKey)) {
    states.set(sessionKey, {
      portalUserId: safeId,
      sessionKey,
      status: 'DISCONNECTED',
      qrDataUrl: null,
      phone: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      reconnectAttempts: 0,
    });
  }
  return states.get(sessionKey);
}

function notifyQrWaiters(sessionKey) {
  const list = pendingQrWaiters.get(sessionKey);
  if (list && list.length > 0) {
    pendingQrWaiters.delete(sessionKey);
    for (const fn of list) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }
}

async function syncUserStatusInSupabase(portalUserId, status, phone) {
  if (!supabase) return;
  try {
    const patch = { whatsapp_status: status };
    if (phone !== undefined) patch.whatsapp_phone = phone;
    await supabase.from('portal_users').update(patch).eq('id', portalUserId);
  } catch {
    // ignore if columns not migrated yet
  }
}

async function startBaileysSession(portalUserId, waitMs = 12000) {
  const safeId = sanitizePortalUserId(portalUserId);
  if (!safeId) throw new Error('Invalid portalUserId.');
  const sessionKey = `session_${safeId}`;
  const state = getOrCreateState(safeId);

  if (state.status === 'CONNECTED' && sockets.has(sessionKey)) {
    return { ...state };
  }
  if (state.status === 'QR_READY' && state.qrDataUrl && sockets.has(sessionKey)) {
    return { ...state };
  }

  const authDir = resolveSafeAuthDir(safeId);
  fs.mkdirSync(authDir, { recursive: true });

  // Clean up any stale socket
  const existingSock = sockets.get(sessionKey);
  if (existingSock) {
    try {
      existingSock.end(undefined);
    } catch {
      // ignore
    }
    sockets.delete(sessionKey);
  }

  state.status = 'CONNECTING';
  state.lastError = null;
  state.updatedAt = new Date().toISOString();

  const { state: authState, saveCreds } = await useMultiFileAuthState(authDir);
  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched?.version;
  } catch {
    version = undefined;
  }

  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: authState,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers?.ubuntu ? Browsers.ubuntu('ISP WhatsApp Gateway') : ['ISP Gateway', 'Chrome', '120.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sockets.set(sessionKey, sock);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        state.qrDataUrl = dataUrl;
        state.status = 'QR_READY';
        state.lastError = null;
        state.updatedAt = new Date().toISOString();
        notifyQrWaiters(sessionKey);
      } catch (qrErr) {
        state.lastError = qrErr?.message || 'Failed to render QR code';
      }
    }

    if (connection === 'open') {
      const rawJid = sock.user?.id || '';
      const phoneDigits = rawJid.split(':')[0]?.split('@')[0] || null;
      state.status = 'CONNECTED';
      state.qrDataUrl = null;
      state.phone = phoneDigits ? `+${phoneDigits}` : null;
      state.lastError = null;
      state.reconnectAttempts = 0;
      state.updatedAt = new Date().toISOString();
      await syncUserStatusInSupabase(safeId, 'CONNECTED', state.phone);
      notifyQrWaiters(sessionKey);
      console.log(`[Baileys-Gateway] Connected ${sessionKey} (${state.phone || 'active'})`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
      sockets.delete(sessionKey);

      if (loggedOut) {
        state.status = 'DISCONNECTED';
        state.qrDataUrl = null;
        state.phone = null;
        state.lastError = 'Device unlinked / logged out from WhatsApp.';
        state.updatedAt = new Date().toISOString();
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
        await syncUserStatusInSupabase(safeId, 'DISCONNECTED', null);
        notifyQrWaiters(sessionKey);
      } else {
        state.status = 'DISCONNECTED';
        state.qrDataUrl = null;
        state.lastError = lastDisconnect?.error?.message || `Connection closed (${statusCode || 'network'})`;
        state.updatedAt = new Date().toISOString();
        notifyQrWaiters(sessionKey);

        if (state.reconnectAttempts < 4) {
          state.reconnectAttempts += 1;
          const delay = Math.min(15000, 2500 * state.reconnectAttempts);
          setTimeout(() => {
            if (!sockets.has(sessionKey) && fs.existsSync(authDir)) {
              startBaileysSession(safeId, 0).catch(() => {});
            }
          }, delay);
        }
      }
    }
  });

  if (waitMs > 0 && state.status === 'CONNECTING') {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      const list = pendingQrWaiters.get(sessionKey) || [];
      list.push(() => {
        clearTimeout(timer);
        resolve();
      });
      pendingQrWaiters.set(sessionKey, list);
    });
  }

  return { ...state };
}

async function logoutBaileysSession(portalUserId) {
  const safeId = sanitizePortalUserId(portalUserId);
  if (!safeId) throw new Error('Invalid portalUserId.');
  const sessionKey = `session_${safeId}`;
  const state = getOrCreateState(safeId);
  const authDir = resolveSafeAuthDir(safeId);

  const sock = sockets.get(sessionKey);
  if (sock) {
    try {
      await sock.logout();
    } catch {
      try {
        sock.end(undefined);
      } catch {
        // ignore
      }
    }
    sockets.delete(sessionKey);
  }

  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  state.status = 'DISCONNECTED';
  state.qrDataUrl = null;
  state.phone = null;
  state.lastError = null;
  state.reconnectAttempts = 0;
  state.updatedAt = new Date().toISOString();
  await syncUserStatusInSupabase(safeId, 'DISCONNECTED', null);
  return { ...state };
}

function getConnectedUserIds() {
  const set = new Set();
  for (const [key, st] of states.entries()) {
    if (st.status === 'CONNECTED' && sockets.has(key)) {
      set.add(st.portalUserId);
    }
  }
  return set;
}

function resolveSenderHierarchy(subscriber, allPortalUsers) {
  const connected = getConnectedUserIds();
  const byId = new Map();
  for (const u of allPortalUsers) {
    if (u?.id) byId.set(String(u.id), u);
  }

  const subDealer = subscriber?.sub_dealer_id ? byId.get(String(subscriber.sub_dealer_id)) || null : null;
  const effDealerId = subscriber?.dealer_id || subDealer?.parent_dealer_id || null;
  const dealer = effDealerId ? byId.get(String(effDealerId)) || null : null;
  const admins = allPortalUsers.filter((u) => getEffectiveTier(u) === 'ADMIN');
  const masterAdmin = admins.find((a) => connected.has(String(a.id))) || admins[0] || null;

  if (subDealer && canSubDealerUseOwnWhatsApp(subDealer, dealer) && connected.has(String(subDealer.id))) {
    return {
      senderUser: subDealer,
      senderPortalUserId: String(subDealer.id),
      senderTier: 'SUB_DEALER',
      companyName: resolveDisplayCompanyName(subDealer),
      supportPhone: String(subDealer.whatsapp_support_phone || subDealer.whatsapp_phone || subDealer.phone || '').trim(),
      senderPhone: states.get(`session_${subDealer.id}`)?.phone || subDealer.whatsapp_phone || null,
      isConnected: true,
      autoSendEnabled: subDealer.whatsapp_auto_send !== false,
    };
  }

  if (dealer && connected.has(String(dealer.id))) {
    return {
      senderUser: dealer,
      senderPortalUserId: String(dealer.id),
      senderTier: 'DEALER',
      companyName: resolveDisplayCompanyName(dealer),
      supportPhone: String(dealer.whatsapp_support_phone || dealer.whatsapp_phone || dealer.phone || '').trim(),
      senderPhone: states.get(`session_${dealer.id}`)?.phone || dealer.whatsapp_phone || null,
      isConnected: true,
      autoSendEnabled: dealer.whatsapp_auto_send !== false,
    };
  }

  const adminId = masterAdmin?.id ? String(masterAdmin.id) : null;
  return {
    senderUser: masterAdmin,
    senderPortalUserId: adminId,
    senderTier: 'ADMIN',
    companyName: resolveDisplayCompanyName(masterAdmin, DEFAULT_MASTER_COMPANY_NAME),
    supportPhone: String(masterAdmin?.whatsapp_support_phone || masterAdmin?.whatsapp_phone || masterAdmin?.phone || '').trim(),
    senderPhone: (adminId && states.get(`session_${adminId}`)?.phone) || masterAdmin?.whatsapp_phone || null,
    isConnected: Boolean(adminId && connected.has(adminId)),
    autoSendEnabled: masterAdmin ? masterAdmin.whatsapp_auto_send !== false : true,
  };
}

async function logDelivery(entry) {
  const row = {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date().toISOString(),
    ...entry,
  };
  memoryLogs.unshift(row);
  if (memoryLogs.length > 300) memoryLogs.length = 300;

  if (supabase) {
    try {
      await supabase.from('whatsapp_logs').insert([entry]);
    } catch {
      // keep in-memory ring buffer fallback if whatsapp_logs table is not created yet
    }
  }
}

async function sendAutomatedMessage({ subscriber, subscriberUsername, eventType, messageVars = {}, forceSenderPortalUserId, manualTrigger = false }) {
  let allUsers = [];
  let paymentAccounts = [];
  if (supabase) {
    const [usersRes, accountsRes] = await Promise.all([
      supabase.from('portal_users').select('*'),
      supabase.from('payment_accounts').select('*').eq('is_active', true),
    ]);
    if (Array.isArray(usersRes.data)) allUsers = usersRes.data;
    if (Array.isArray(accountsRes.data)) paymentAccounts = accountsRes.data;
  }

  let resolvedSub = subscriber ? { ...subscriber } : null;
  if (subscriberUsername && allUsers.length > 0) {
    const lower = String(subscriberUsername).trim().toLowerCase();
    const matched = allUsers.find((u) => String(u.username || '').trim().toLowerCase() === lower) || null;
    if (matched) {
      resolvedSub = {
        ...matched,
        ...(resolvedSub || {}),
        id: matched.id,
        username: matched.username,
        full_name: resolvedSub?.full_name || matched.full_name,
        phone: resolvedSub?.phone || matched.phone,
        dealer_id: resolvedSub?.dealer_id ?? matched.dealer_id ?? null,
        sub_dealer_id: resolvedSub?.sub_dealer_id ?? matched.sub_dealer_id ?? null,
      };
    }
  }

  let sender;
  if (forceSenderPortalUserId) {
    const forced = allUsers.find((u) => String(u.id) === String(forceSenderPortalUserId)) || null;
    const connected = getConnectedUserIds().has(String(forceSenderPortalUserId));
    const tier = getEffectiveTier(forced);
    sender = {
      senderUser: forced,
      senderPortalUserId: String(forceSenderPortalUserId),
      senderTier: tier === 'OTHER' ? 'ADMIN' : tier,
      companyName: resolveDisplayCompanyName(forced, DEFAULT_MASTER_COMPANY_NAME),
      supportPhone: String(forced?.whatsapp_support_phone || forced?.whatsapp_phone || forced?.phone || '').trim(),
      senderPhone: states.get(`session_${forceSenderPortalUserId}`)?.phone || forced?.whatsapp_phone || null,
      isConnected: connected,
      autoSendEnabled: true,
    };
  } else {
    sender = resolveSenderHierarchy(resolvedSub, allUsers);
  }

  const rawPhone = messageVars.phone || resolvedSub?.phone || '';
  const jid = formatWhatsAppJid(rawPhone);
  const recipientDigits = formatWhatsAppDigits(rawPhone) || String(rawPhone || 'unknown');
  const messageBody = buildAutomatedMessage(eventType, {
    ...messageVars,
    companyName: sender.companyName,
    supportPhone: messageVars.supportPhone || sender.supportPhone,
    subscriberName: messageVars.subscriberName || resolvedSub?.full_name || subscriberUsername,
    username: messageVars.username || resolvedSub?.username || subscriberUsername,
    paymentAccounts:
      Array.isArray(messageVars.paymentAccounts) && messageVars.paymentAccounts.length > 0
        ? messageVars.paymentAccounts
        : paymentAccounts,
  });

  const loggedMessageBody =
    eventType === 'PORTAL_CREDENTIALS' || eventType === 'PROVISION_WELCOME'
      ? messageBody.replace(/(\*(?:PPPoE\s+)?Password:\*\s*)(.+)/gi, '$1••••••••')
      : messageBody;

  if (!manualTrigger && !sender.autoSendEnabled && eventType !== 'MANUAL_TEST' && eventType !== 'PORTAL_CREDENTIALS') {
    await logDelivery({
      sender_portal_user_id: sender.senderPortalUserId,
      sender_company_name: sender.companyName,
      sender_phone: sender.senderPhone,
      sender_tier: sender.senderTier,
      subscriber_id: resolvedSub?.id || null,
      subscriber_username: resolvedSub?.username || subscriberUsername || null,
      recipient_phone: recipientDigits,
      dealer_id: resolvedSub?.dealer_id || null,
      sub_dealer_id: resolvedSub?.sub_dealer_id || null,
      event_type: eventType,
      message_body: loggedMessageBody,
      status: 'SKIPPED',
      error_message: 'Auto-send master switch is OFF for resolved sender.',
    });
    return { ok: false, status: 'SKIPPED', senderCompanyName: sender.companyName, skippedReason: 'Auto-send is turned OFF.' };
  }

  if (!jid) {
    await logDelivery({
      sender_portal_user_id: sender.senderPortalUserId,
      sender_company_name: sender.companyName,
      sender_phone: sender.senderPhone,
      sender_tier: sender.senderTier,
      subscriber_id: resolvedSub?.id || null,
      subscriber_username: resolvedSub?.username || subscriberUsername || null,
      recipient_phone: recipientDigits,
      dealer_id: resolvedSub?.dealer_id || null,
      sub_dealer_id: resolvedSub?.sub_dealer_id || null,
      event_type: eventType,
      message_body: loggedMessageBody,
      status: 'FAILED',
      error_message: 'Missing or invalid subscriber WhatsApp phone number.',
    });
    return { ok: false, status: 'FAILED', senderCompanyName: sender.companyName, error: 'Invalid recipient phone number.' };
  }

  const sock = sender.senderPortalUserId ? sockets.get(`session_${sender.senderPortalUserId}`) : null;
  if (!sender.isConnected || !sock) {
    await logDelivery({
      sender_portal_user_id: sender.senderPortalUserId,
      sender_company_name: sender.companyName,
      sender_phone: sender.senderPhone,
      sender_tier: sender.senderTier,
      subscriber_id: resolvedSub?.id || null,
      subscriber_username: resolvedSub?.username || subscriberUsername || null,
      recipient_phone: recipientDigits,
      dealer_id: resolvedSub?.dealer_id || null,
      sub_dealer_id: resolvedSub?.sub_dealer_id || null,
      event_type: eventType,
      message_body: loggedMessageBody,
      status: 'FAILED',
      error_message: `No connected Baileys WhatsApp session available for ${sender.companyName}.`,
    });
    return {
      ok: false,
      status: 'FAILED',
      senderCompanyName: sender.companyName,
      error: `WhatsApp session not connected for ${sender.companyName}. Pair your WhatsApp QR first.`,
    };
  }

  try {
    await sock.sendMessage(jid, { text: messageBody });
    await logDelivery({
      sender_portal_user_id: sender.senderPortalUserId,
      sender_company_name: sender.companyName,
      sender_phone: sender.senderPhone,
      sender_tier: sender.senderTier,
      subscriber_id: resolvedSub?.id || null,
      subscriber_username: resolvedSub?.username || subscriberUsername || null,
      recipient_phone: recipientDigits,
      dealer_id: resolvedSub?.dealer_id || null,
      sub_dealer_id: resolvedSub?.sub_dealer_id || null,
      event_type: eventType,
      message_body: loggedMessageBody,
      status: 'SENT',
      error_message: null,
    });
    return {
      ok: true,
      status: 'SENT',
      senderCompanyName: sender.companyName,
      senderPhone: sender.senderPhone,
    };
  } catch (err) {
    const errMsg = err?.message || 'WhatsApp socket send failed';
    await logDelivery({
      sender_portal_user_id: sender.senderPortalUserId,
      sender_company_name: sender.companyName,
      sender_phone: sender.senderPhone,
      sender_tier: sender.senderTier,
      subscriber_id: resolvedSub?.id || null,
      subscriber_username: resolvedSub?.username || subscriberUsername || null,
      recipient_phone: recipientDigits,
      dealer_id: resolvedSub?.dealer_id || null,
      sub_dealer_id: resolvedSub?.sub_dealer_id || null,
      event_type: eventType,
      message_body: loggedMessageBody,
      status: 'FAILED',
      error_message: errMsg,
    });
    return { ok: false, status: 'FAILED', senderCompanyName: sender.companyName, error: errMsg };
  }
}

// ============================================================================
// AUTHENTICATION & TENANT SCOPE RESOLUTION
// ============================================================================

async function resolveActor(req) {
  const callerId = String(req.headers['x-portal-user-id'] || '').trim();
  const callerUsername = String(req.headers['x-portal-username'] || '').trim().toLowerCase();

  let allUsers = [];
  if (supabase) {
    const { data } = await supabase.from('portal_users').select('*');
    if (Array.isArray(data)) allUsers = data;
  }

  let actor = null;
  if (allUsers.length > 0) {
    actor =
      allUsers.find((u) => callerId && String(u.id) === callerId) ||
      allUsers.find((u) => callerUsername && String(u.username || '').trim().toLowerCase() === callerUsername) ||
      null;
  }

  if (!actor || !actor.id) {
    return {
      ok: false,
      statusCode: 401,
      error: 'Authentication required. Please log into the ISP portal first.',
      actor: null,
      allUsers,
      effectiveTier: 'OTHER',
      canPairOwnWhatsapp: false,
    };
  }

  const effectiveTier = getEffectiveTier(actor);
  let canPairOwnWhatsapp = effectiveTier === 'ADMIN' || effectiveTier === 'DEALER';
  if (effectiveTier === 'SUB_DEALER') {
    const parentDealer = actor.parent_dealer_id
      ? allUsers.find((u) => String(u.id) === String(actor.parent_dealer_id)) || null
      : null;
    canPairOwnWhatsapp = canSubDealerUseOwnWhatsApp(actor, parentDealer);
  }

  return {
    ok: true,
    actor,
    allUsers,
    effectiveTier,
    canPairOwnWhatsapp,
  };
}

// ============================================================================
// EXPRESS SERVER + CORS + ROUTES
// ============================================================================

const app = express();

const allowedOriginsEnv = String(process.env.ALLOWED_ORIGINS || '*').trim();
const corsOptions =
  allowedOriginsEnv === '*'
    ? { origin: '*', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }
    : {
        origin: allowedOriginsEnv
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      };

app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

// 1. Health Check
app.get('/api/whatsapp/health', (_req, res) => {
  const connectedCount = getConnectedUserIds().size;
  res.json({
    success: true,
    status: 'online',
    engine: 'baileys-standalone-multi-session',
    activeSessionsCount: states.size,
    connectedSessionsCount: connectedCount,
    supabaseConfigured: Boolean(supabase),
    timestamp: new Date().toISOString(),
  });
});

// 2. Session Status + Branding + Tenant Overview
app.get('/api/whatsapp/session/status', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }

    const runtime = getOrCreateState(String(ctx.actor.id));
    const visibleTenants = ctx.allUsers
      .filter((u) => {
        const tier = getEffectiveTier(u);
        if (tier === 'OTHER') return false;
        if (ctx.effectiveTier === 'ADMIN') return true;
        if (ctx.effectiveTier === 'DEALER') {
          return String(u.id) === String(ctx.actor.id) || String(u.parent_dealer_id || '') === String(ctx.actor.id);
        }
        return String(u.id) === String(ctx.actor.id);
      })
      .map((u) => {
        const tier = getEffectiveTier(u);
        const st = states.get(`session_${u.id}`);
        return {
          portalUserId: String(u.id),
          username: u.username,
          fullName: u.full_name,
          tier,
          companyName: resolveDisplayCompanyName(u),
          status: st?.status || 'DISCONNECTED',
          phone: st?.phone || u.whatsapp_phone || null,
          autoSend: u.whatsapp_auto_send !== false,
          allowSubdealerWhatsapp: Boolean(u.allow_subdealer_whatsapp),
        };
      });

    const missingColumns =
      ctx.actor.company_name === undefined &&
      ctx.actor.whatsapp_status === undefined &&
      ctx.actor.allow_subdealer_whatsapp === undefined;

    return res.json({
      success: true,
      portalUserId: String(ctx.actor.id),
      effectiveTier: ctx.effectiveTier,
      canPairOwnWhatsapp: ctx.canPairOwnWhatsapp,
      session: {
        ...runtime,
        phone: runtime.phone || ctx.actor.whatsapp_phone || null,
      },
      branding: {
        companyName: resolveDisplayCompanyName(ctx.actor),
        supportPhone: String(ctx.actor.whatsapp_support_phone || ctx.actor.phone || ''),
        autoSend: ctx.actor.whatsapp_auto_send !== false,
      },
      tenantSessions: visibleTenants,
      schemaWarning: missingColumns,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to read session status.' });
  }
});

// 3. Start Session & Generate Live QR Data URL
app.post('/api/whatsapp/session/start', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    if (!ctx.canPairOwnWhatsapp) {
      return res.status(403).json({
        success: false,
        error:
          'Own WhatsApp pairing is disabled for this Sub-Dealer. Ask your Parent Dealer or Master ISP Admin to enable "Allow Sub-Dealer Own WhatsApp".',
      });
    }

    const requestedId = String(req.body?.portalUserId || '').trim();
    let targetId = String(ctx.actor.id);
    if (requestedId && requestedId !== targetId) {
      if (ctx.effectiveTier === 'ADMIN') {
        const safe = sanitizePortalUserId(requestedId);
        if (!safe) return res.status(400).json({ success: false, error: 'Invalid portalUserId.' });
        targetId = safe;
      } else {
        return res.status(403).json({ success: false, error: 'You can only pair your own WhatsApp session.' });
      }
    }

    const session = await startBaileysSession(targetId, 12000);
    return res.json({
      success: true,
      qrDataUrl: session.qrDataUrl || null,
      status: session.status,
      session,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to start WhatsApp session.' });
  }
});

// 4. Logout / Disconnect Session
app.post('/api/whatsapp/session/logout', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }

    const requestedId = String(req.body?.portalUserId || '').trim();
    let targetId = String(ctx.actor.id);
    if (requestedId && requestedId !== targetId) {
      if (ctx.effectiveTier === 'ADMIN') {
        const safe = sanitizePortalUserId(requestedId);
        if (!safe) return res.status(400).json({ success: false, error: 'Invalid portalUserId.' });
        targetId = safe;
      } else {
        return res.status(403).json({ success: false, error: 'You can only disconnect your own WhatsApp session.' });
      }
    }

    const session = await logoutBaileysSession(targetId);
    return res.json({ success: true, status: session.status, session });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to logout WhatsApp session.' });
  }
});

// 5. Save Company Branding & Auto-Send Switch
app.post('/api/whatsapp/branding', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    if (ctx.effectiveTier === 'OTHER') {
      return res.status(403).json({ success: false, error: 'Only Admin, Dealers, and Sub-Dealers can update branding.' });
    }
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on Baileys server.' });
    }

    const companyName = String(req.body?.companyName ?? '').trim().slice(0, 100);
    const supportPhone = String(req.body?.supportPhone ?? '').trim().slice(0, 40);
    const autoSend = req.body?.autoSend !== undefined ? Boolean(req.body.autoSend) : true;

    const patch = {
      company_name: companyName || (ctx.effectiveTier === 'ADMIN' ? DEFAULT_MASTER_COMPANY_NAME : ctx.actor.full_name),
      whatsapp_auto_send: autoSend,
      whatsapp_support_phone: supportPhone || null,
    };

    const stripped = [];
    let lastError = null;
    for (let i = 0; i < 5; i++) {
      if (Object.keys(patch).length === 0) break;
      const { error } = await supabase.from('portal_users').update(patch).eq('id', ctx.actor.id);
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      const m =
        String(error.message || '').match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
        String(error.message || '').match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+/i);
      if (m?.[1] && m[1] in patch) {
        stripped.push(m[1]);
        delete patch[m[1]];
        continue;
      }
      break;
    }

    if (lastError) {
      return res.status(500).json({ success: false, error: lastError.message });
    }

    return res.json({
      success: true,
      schemaWarning: stripped.length > 0,
      branding: {
        companyName: companyName || DEFAULT_MASTER_COMPANY_NAME,
        supportPhone,
        autoSend,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save branding.' });
  }
});

// 6. Zero-Click Automated Send (Sub-Dealer -> Dealer -> Master Admin Routing)
async function handleWhatsAppSend(req, res) {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ ok: false, status: 'FAILED', error: ctx.error });
    }

    const body = req.body || {};
    const validEvents = new Set([
      'PROVISION_WELCOME',
      'PORTAL_CREDENTIALS',
      'INVOICE_GENERATED',
      'PRE_EXPIRY_3D',
      'AUTO_SUSPENSION',
      'PAYMENT_RESTORED',
      'MANUAL_TEST',
    ]);
    let eventType = String(body.eventType || '').trim().toUpperCase();
    if (!eventType) {
      if (body.password || body.portalUrl || body.messageVars?.password || body.messageVars?.portalUrl) {
        eventType = 'PORTAL_CREDENTIALS';
      } else if (body.message || body.messageVars?.customNote) {
        eventType = 'MANUAL_TEST';
      }
    }
    if (!validEvents.has(eventType)) {
      return res.status(400).json({ ok: false, status: 'FAILED', error: 'Unsupported WhatsApp eventType.' });
    }

    const subscriberUsername = body.subscriberUsername
      ? String(body.subscriberUsername).trim().toLowerCase()
      : body.username
      ? String(body.username).trim().toLowerCase()
      : undefined;

    const mergedMessageVars = {
      ...(body.messageVars || {}),
      ...(body.phone && !body.messageVars?.phone ? { phone: String(body.phone).trim() } : {}),
      ...(body.message && !body.messageVars?.customNote ? { customNote: String(body.message).slice(0, 2000) } : {}),
    };

    const isNewAccountEvent = eventType === 'PROVISION_WELCOME' || eventType === 'PORTAL_CREDENTIALS';
    let effectiveSubscriber = body.subscriber || null;

    // Enforce multi-tenant scope for Dealers & Sub-Dealers
    if (ctx.effectiveTier === 'DEALER' || ctx.effectiveTier === 'SUB_DEALER') {
      if (eventType !== 'MANUAL_TEST') {
        const subRow =
          ctx.allUsers.find(
            (u) => subscriberUsername && String(u.username || '').trim().toLowerCase() === subscriberUsername
          ) || body.subscriber || null;
        const ownsSub =
          ctx.effectiveTier === 'SUB_DEALER'
            ? String(subRow?.sub_dealer_id || '') === String(ctx.actor.id) ||
              (isNewAccountEvent && !subRow?.dealer_id && !subRow?.sub_dealer_id)
            : String(subRow?.dealer_id || '') === String(ctx.actor.id) ||
              (isNewAccountEvent && !subRow?.dealer_id && !subRow?.sub_dealer_id) ||
              ctx.allUsers.some(
                (sd) =>
                  String(sd.parent_dealer_id || '') === String(ctx.actor.id) &&
                  String(sd.id) === String(subRow?.sub_dealer_id || '')
              );
        if (!ownsSub) {
          return res.status(403).json({
            ok: false,
            status: 'FAILED',
            error: 'Access Denied: Subscriber is outside your Dealer/Sub-Dealer scope.',
          });
        }
        if (isNewAccountEvent) {
          effectiveSubscriber = {
            ...(body.subscriber || {}),
            username: subscriberUsername || body.subscriber?.username || null,
            phone: mergedMessageVars.phone || body.subscriber?.phone || null,
            sub_dealer_id: ctx.effectiveTier === 'SUB_DEALER' ? String(ctx.actor.id) : body.subscriber?.sub_dealer_id || null,
            dealer_id:
              ctx.effectiveTier === 'DEALER'
                ? String(ctx.actor.id)
                : ctx.actor.parent_dealer_id || body.subscriber?.dealer_id || null,
          };
        }
      }
    }

    const result = await sendAutomatedMessage({
      subscriber: effectiveSubscriber,
      subscriberUsername,
      eventType,
      messageVars: mergedMessageVars,
      manualTrigger: Boolean(body.manualTrigger),
      forceSenderPortalUserId: eventType === 'MANUAL_TEST' ? String(ctx.actor.id) : undefined,
    });

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, status: 'FAILED', error: err?.message || 'Send failed.' });
  }
}

app.post('/api/whatsapp/send', handleWhatsAppSend);
app.post('/api/whatsapp/send-auto', handleWhatsAppSend);

// 7. Scoped Delivery Logs
app.get('/api/whatsapp/logs', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }

    const limit = Math.min(250, Math.max(10, Number(req.query.limit) || 120));
    let rows = [];
    let tableMissing = false;

    if (supabase) {
      const { data, error } = await supabase
        .from('whatsapp_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        tableMissing = true;
        rows = [...memoryLogs];
      } else {
        rows = data || [];
      }
    } else {
      rows = [...memoryLogs];
    }

    const scoped = rows.filter((log) => {
      if (ctx.effectiveTier === 'ADMIN') return true;
      if (ctx.effectiveTier === 'SUB_DEALER') {
        return (
          String(log.sub_dealer_id || '') === String(ctx.actor.id) ||
          String(log.sender_portal_user_id || '') === String(ctx.actor.id)
        );
      }
      if (ctx.effectiveTier === 'DEALER') {
        return (
          String(log.dealer_id || '') === String(ctx.actor.id) ||
          String(log.sender_portal_user_id || '') === String(ctx.actor.id)
        );
      }
      return false;
    });

    return res.json({ success: true, logs: scoped.slice(0, limit), tableMissing });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch logs.' });
  }
});

// 8. 3-Day Pre-Expiry Auto-Reminder Sweep
async function runPreExpirySweep(actorCtx = null) {
  if (!supabase || getConnectedUserIds().size === 0) {
    return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
  }
  const [{ data: clients }, { data: invoices }] = await Promise.all([
    supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
    supabase.from('invoices').select('*').neq('status', 'PAID'),
  ]);

  const unpaidByUser = new Map();
  for (const inv of invoices || []) {
    const st = String(inv.status || '').toUpperCase();
    const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (st === 'PAID' || st === 'CANCELLED' || bal <= 0) continue;
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    const prev = unpaidByUser.get(uname) || { totalDue: 0, earliestDueDate: null };
    prev.totalDue += bal;
    if (inv.due_date && (!prev.earliestDueDate || inv.due_date < prev.earliestDueDate)) {
      prev.earliestDueDate = inv.due_date;
    }
    unpaidByUser.set(uname, prev);
  }

  const nowMs = Date.now();
  const threeDaysMs = 3 * 86_400_000;
  const todayKey = new Date().toISOString().slice(0, 10);
  let scanned = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of clients || []) {
    const acct = String(sub.account_status || 'ACTIVE').toUpperCase();
    if (acct === 'SUSPENDED' || acct === 'EXPIRED' || acct === 'DELETED') continue;
    if (actorCtx && actorCtx.effectiveTier === 'DEALER') {
      if (String(sub.dealer_id || '') !== String(actorCtx.actor.id)) continue;
    }
    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname || !sub.phone) continue;

    const unpaid = unpaidByUser.get(uname);
    const dueDateRaw = unpaid?.earliestDueDate || sub.next_billing_date || sub.expiry_date;
    if (!dueDateRaw) continue;
    const dueMs = Date.parse(`${String(dueDateRaw).slice(0, 10)}T23:59:59Z`);
    if (Number.isNaN(dueMs)) continue;

    const diffMs = dueMs - nowMs;
    if (diffMs < 0 || diffMs > threeDaysMs) continue;
    const amountDue = unpaid?.totalDue || Number(sub.monthly_fee) || 0;
    if (amountDue <= 0) continue;

    scanned++;
    const dedupe = `${todayKey}:PRE_EXPIRY_3D:${uname}`;
    if (dedupeKeys.has(dedupe)) {
      skipped++;
      continue;
    }

    const res = await sendAutomatedMessage({
      subscriber: sub,
      subscriberUsername: uname,
      eventType: 'PRE_EXPIRY_3D',
      messageVars: {
        subscriberName: sub.full_name || sub.username,
        username: uname,
        phone: sub.phone,
        packageName: sub.package_speed || sub.package_profile_name || 'Fiber Broadband',
        amountDue,
        expiryDate: String(dueDateRaw).slice(0, 10),
      },
    });

    if (res.ok && res.status === 'SENT') {
      dedupeKeys.add(dedupe);
      sent++;
    } else if (res.status === 'SKIPPED') {
      skipped++;
    } else {
      failed++;
    }
  }

  return { scanned, sent, skipped, failed };
}

app.post('/api/whatsapp/cron/pre-expiry', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    if (ctx.effectiveTier !== 'ADMIN' && ctx.effectiveTier !== 'DEALER') {
      return res.status(403).json({ success: false, error: 'Only Master Admin or Dealers can trigger pre-expiry sweep.' });
    }
    const summary = await runPreExpirySweep(ctx);
    return res.json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Pre-expiry sweep failed.' });
  }
});

// JSON catch-all so clients NEVER receive HTML <!doctype html>
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Baileys WhatsApp Gateway route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use((err, _req, res, _next) => {
  res.status(500).json({
    success: false,
    error: err?.message || 'Internal Baileys WhatsApp Gateway error.',
  });
});

// ============================================================================
// BOOT & AUTO-RESTORE PERSISTED MULTI-TENANT SESSIONS
// ============================================================================

async function restorePersistedSessions() {
  if (!fs.existsSync(BAILEYS_AUTH_ROOT)) return;
  const entries = fs.readdirSync(BAILEYS_AUTH_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('session_')) continue;
    const portalUserId = sanitizePortalUserId(entry.name.slice('session_'.length));
    if (!portalUserId) continue;
    const credsPath = path.join(BAILEYS_AUTH_ROOT, entry.name, 'creds.json');
    if (fs.existsSync(credsPath)) {
      console.log(`[Baileys-Gateway] Restoring persisted session_${portalUserId}...`);
      startBaileysSession(portalUserId, 0).catch((err) => {
        console.warn(`[Baileys-Gateway] Restore skipped for ${portalUserId}:`, err?.message);
      });
    }
  }
}

function startGatewayServer(targetPort, allowFallbackTo3001 = true) {
  const server = app.listen(targetPort, '0.0.0.0', () => {
    console.log(`[Baileys-Gateway] Multi-Session WhatsApp Gateway listening on http://0.0.0.0:${targetPort}`);
    console.log(`[Baileys-Gateway] Health check: http://localhost:${targetPort}/api/whatsapp/health`);
    restorePersistedSessions().catch(() => {});
    setInterval(() => {
      runPreExpirySweep().catch(() => {});
    }, 60 * 60 * 1000);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && allowFallbackTo3001 && targetPort !== 3001) {
      console.warn(
        `[Baileys-Gateway] Port ${targetPort} is already in use; falling back to default gateway port 3001...`
      );
      startGatewayServer(3001, false);
      return;
    }
    console.error('[Baileys-Gateway] Fatal listen error:', err?.message || err);
    process.exit(1);
  });
}

startGatewayServer(PORT, !process.env.WA_GATEWAY_PORT);
