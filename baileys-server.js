/**
 * Standalone Multi-Session (Multi-Tenant) Baileys WhatsApp Gateway Server
 *
 * Persists all Admin, Dealer, and Sub-Dealer WhatsApp auth credentials and
 * Signal keys directly in Supabase PostgreSQL (`whatsapp_auth_sessions`) so
 * ephemeral deployments (Railway, Render, Docker) never lose linked sessions.
 *
 * Run with:
 *   node baileys-server.js
 *
 * Environment variables (.env):
 *   WA_GATEWAY_PORT=3001           (or PORT=3001)
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=xxx  (required for backend persistence & RLS bypass)
 *   ALLOWED_ORIGINS=*              (optional comma-separated origins, defaults to *)
 */

import fs from 'fs';
import path from 'path';
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
const initAuthCreds = baileys.initAuthCreds;
const useMultiFileAuthState = baileys.useMultiFileAuthState;
const BufferJSON = baileys.BufferJSON;
const proto = baileys.proto;
const DisconnectReason = baileys.DisconnectReason ?? {
  loggedOut: 401,
  restartRequired: 515,
};
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
const Browsers = baileys.Browsers;

const LOCAL_AUTH_INFO_ROOT = path.resolve(process.cwd(), 'auth_info');
const PORT = Number(process.env.WA_GATEWAY_PORT || process.env.PORT || 3001);
const DEFAULT_MASTER_COMPANY_NAME = 'Youth Net Service';
const WHATSAPP_AUTH_SESSIONS_TABLE = 'whatsapp_auth_sessions';
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

const WHATSAPP_AUTH_SESSIONS_DDL = `CREATE TABLE IF NOT EXISTS public.whatsapp_auth_sessions (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key_id)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_tenant_id
  ON public.whatsapp_auth_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_creds_lookup
  ON public.whatsapp_auth_sessions (key_id, tenant_id);
ALTER TABLE public.whatsapp_auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_auth_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_auth_sessions TO service_role;`;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://qstqegwpibztpirncpga.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  '';
const SUPABASE_KEY =
  SUPABASE_SERVICE_ROLE_KEY ||
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
    `[Baileys-Gateway] SUPABASE_URL is set to ${SUPABASE_URL}, but SUPABASE_SERVICE_ROLE_KEY is not set in environment. Set SUPABASE_SERVICE_ROLE_KEY to enable persistent PostgreSQL WhatsApp sessions, multi-tenant lookups, and delivery logs.`
  );
} else if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[Baileys-Gateway] WARNING: SUPABASE_SERVICE_ROLE_KEY is not set (falling back to anon key). Set SUPABASE_SERVICE_ROLE_KEY on Railway so backend writes to whatsapp_auth_sessions succeed under RLS.'
  );
}

// ============================================================================
// TENANT ID VALIDATION & PHONE FORMATTING HELPERS
// ============================================================================

function sanitizePortalUserId(rawId) {
  const clean = String(rawId || '').trim();
  if (!clean || !SESSION_ID_PATTERN.test(clean)) return null;
  return clean;
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

const WHATSAPP_TEMPLATES_SETTINGS_KEY = 'whatsapp_message_templates';
const WHATSAPP_TEAM_GROUP_SETTINGS_KEY = 'whatsapp_team_group_config';

const DEFAULT_TEMPLATE_MAP = {
  WELCOME_CREDENTIALS: `*Welcome to {company_name}!*\n\nDear *{client_name}*,\nYour account is now *ACTIVE*.\n\n• *Username:* {username}\n• *Password:* {password}\n• *Package / Role:* {package}\n• *Portal Link:* {portal_url}\n• *Valid Until:* {expiry_date}\n\nPlease keep your credentials secure.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  INVOICE_GENERATED: `*{company_name} — Monthly Bill Issued*\n\nDear *{client_name}* ({username}),\nYour monthly broadband invoice has been generated.\n\n• *Invoice #:* {invoice_no}\n• *Package:* {package}\n• *Amount Due:* {amount}\n• *Due Date:* {due_date}\n\nKindly settle your bill on or before *{due_date}* to recharge your connection for *31 days* and avoid automatic movement to the Expiry Pool.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  PRE_EXPIRY_3D: `*{company_name} — Renewal Reminder*\n\nDear *{client_name}* ({username}),\nYour internet package (*{package}*) is due for renewal soon.\n\n• *Amount Due:* {amount}\n• *Due / Expiry Date:* {due_date}\n\nKindly clear your bill before the due date to avoid automatic disconnection.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  GRACE_PERIOD_3D: `*{company_name} — 3-Day Grace Period Notice*\n\nDear *{client_name}* ({username}),\nYour monthly bill due date (*{due_date}*) has passed and your invoice is still unpaid.\n\nTo prevent sudden disruption, we have granted you a *3-day extra grace period*.\n• *Package:* {package}\n• *Amount Due:* {amount}\n• *Grace Period Ends:* {grace_date}\n\nPlease clear your dues before *{grace_date}* to avoid automatic service suspension.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  AUTO_SUSPENSION: `*{company_name} — Service Temporarily Suspended*\n\nDear *{client_name}* ({username}),\nYour broadband internet connection has been automatically suspended after the 3-day grace period due to unpaid dues.\n\n• *Package:* {package}\n• *Outstanding Due:* {amount}\n\nYour connection will be *instantly restored* as soon as payment is received.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  PAYMENT_RECEIPT_CLIENT: `*{company_name} — Paid Receipt & 31-Day Recharge Confirmed ✅*\n\nDear *{client_name}* ({username}),\nThank you! Your payment has been verified and your broadband package has been recharged for *31 days* on your active speed profile.\n\n• *Receipt / Invoice #:* {invoice_no}\n• *Active Package:* {package}\n• *Amount Paid:* {amount}\n• *Payment Method:* {payment_method}\n• *Remaining Balance:* {remaining_balance}\n• *Valid Until (+31 Days):* {expiry_date}\n\nThank you for staying connected with *{company_name}*!\nSupport Helpline: {helpline}`,
  AGENT_PAYMENT_RECEIPT: `*{company_name} — Agent Collection Confirmed*\n\nDear *{agent_name}*,\nYour payment collection has been recorded in the billing ledger.\n\n• *Subscriber:* {client_name} ({username})\n• *Invoice #:* {invoice_no}\n• *Amount Collected:* {amount}\n• *Payment Mode:* {payment_method}\n• *Updated Cash-in-Hand Balance:* {agent_balance}\n\n— *{company_name}* Accounts Desk`,
  COMPLAINT_CREATED_CLIENT: `*{company_name} — Support Ticket Registered*\n\nDear *{client_name}* ({username}),\nWe have received your complaint and assigned our technical support team to resolve it promptly.\n\n• *Ticket ID:* {ticket_id}\n• *Issue Reported:* {issue}\n• *Area / Node:* {area}\n\nWe will notify you as soon as your connection is restored.\n— *{company_name}*\nSupport Helpline: {helpline}`,
  COMPLAINT_CREATED_GROUP: `🚨 *NEW COMPLAINT DISPATCH — {ticket_id}*\n\n• *Client Name:* {client_name}\n• *PPPoE Username:* {username}\n• *Coverage Area / Node:* {area}\n• *Phone Number:* {phone}\n• *Address:* {address}\n• *Assigned Tech:* {agent_name}\n• *Issue Details:* {issue}\n\nPlease attend urgently and mark Solved in the Field Portal once fixed.\n— *{company_name}* NOC`,
  COMPLAINT_RESOLVED_CLIENT: `*{company_name} — Complaint Resolved ✅*\n\nDear *{client_name}* ({username}),\nYour support complaint has been marked *RESOLVED* by our technical team.\n\n• *Ticket ID:* {ticket_id}\n• *Issue:* {issue}\n• *Resolved By:* {agent_name}\n\nIf you still experience any issue, please reply or call our support helpline.\n— *{company_name}*\nSupport Helpline: {helpline}`,
};

function mapEventTypeToTemplateKey(eventType) {
  switch (String(eventType || '').toUpperCase()) {
    case 'PROVISION_WELCOME':
    case 'PORTAL_CREDENTIALS':
      return 'WELCOME_CREDENTIALS';
    case 'INVOICE_GENERATED':
      return 'INVOICE_GENERATED';
    case 'PRE_EXPIRY_3D':
      return 'PRE_EXPIRY_3D';
    case 'GRACE_PERIOD_3D':
      return 'GRACE_PERIOD_3D';
    case 'AUTO_SUSPENSION':
      return 'AUTO_SUSPENSION';
    case 'PAYMENT_RESTORED':
      return 'PAYMENT_RECEIPT_CLIENT';
    case 'AGENT_PAYMENT_RECEIPT':
      return 'AGENT_PAYMENT_RECEIPT';
    case 'COMPLAINT_CREATED_CLIENT':
      return 'COMPLAINT_CREATED_CLIENT';
    case 'COMPLAINT_CREATED_GROUP':
      return 'COMPLAINT_CREATED_GROUP';
    case 'COMPLAINT_RESOLVED_CLIENT':
      return 'COMPLAINT_RESOLVED_CLIENT';
    default:
      return null;
  }
}

function formatWhatsAppGroupJid(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  if (/^[0-9-]{6,36}@g\.us$/i.test(clean)) return clean.toLowerCase();
  return null;
}

function formatMoneyValue(val) {
  if (val === undefined || val === null || val === '') return 'Rs. 0';
  if (typeof val === 'number') return `Rs. ${Math.round(val).toLocaleString()}`;
  const s = String(val).trim();
  if (!s) return 'Rs. 0';
  if (/^rs\.?/i.test(s)) return s;
  const num = Number(s.replace(/,/g, ''));
  return Number.isFinite(num) ? `Rs. ${Math.round(num).toLocaleString()}` : s;
}

function renderTemplateText(templateText, values) {
  return String(templateText || '').replace(/\{([a-z_]+)\}/gi, (match, rawKey) => {
    const k = String(rawKey || '').toLowerCase();
    return k in values ? values[k] : match;
  });
}

const settingsCache = {
  loadedAt: 0,
  globalTemplates: {},
  scopedTemplates: new Map(),
  globalTeamGroup: null,
  scopedTeamGroups: new Map(),
};

async function loadAppSettingsCache() {
  if (!supabase) return;
  if (Date.now() - settingsCache.loadedAt < 30_000) return;
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .or(`key.like.${WHATSAPP_TEMPLATES_SETTINGS_KEY}%,key.like.${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}%`);
    if (error || !Array.isArray(data)) {
      settingsCache.loadedAt = Date.now();
      return;
    }
    const globalTemplates = {};
    const scopedTemplates = new Map();
    let globalTeamGroup = null;
    const scopedTeamGroups = new Map();
    for (const row of data) {
      const key = String(row.key || '').trim();
      if (!key || !row.value) continue;
      let parsed;
      try {
        parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      if (key === WHATSAPP_TEMPLATES_SETTINGS_KEY) {
        Object.assign(globalTemplates, parsed);
      } else if (key.startsWith(`${WHATSAPP_TEMPLATES_SETTINGS_KEY}:`)) {
        scopedTemplates.set(key.slice(`${WHATSAPP_TEMPLATES_SETTINGS_KEY}:`.length), parsed);
      } else if (key === WHATSAPP_TEAM_GROUP_SETTINGS_KEY) {
        globalTeamGroup = {
          groupJid: String(parsed.groupJid || '').trim(),
          groupName: String(parsed.groupName || '').trim(),
          inviteLink: String(parsed.inviteLink || '').trim(),
        };
      } else if (key.startsWith(`${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:`)) {
        scopedTeamGroups.set(key.slice(`${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:`.length), {
          groupJid: String(parsed.groupJid || '').trim(),
          groupName: String(parsed.groupName || '').trim(),
          inviteLink: String(parsed.inviteLink || '').trim(),
        });
      }
    }
    settingsCache.loadedAt = Date.now();
    settingsCache.globalTemplates = globalTemplates;
    settingsCache.scopedTemplates = scopedTemplates;
    settingsCache.globalTeamGroup = globalTeamGroup;
    settingsCache.scopedTeamGroups = scopedTeamGroups;
  } catch {
    settingsCache.loadedAt = Date.now();
  }
}

function buildAutomatedMessage(eventType, vars = {}) {
  const company = String(vars.companyName || DEFAULT_MASTER_COMPANY_NAME).trim();
  const clientName = String(vars.subscriberName || vars.username || 'Valued Subscriber').trim();
  const uname = String(vars.username || '').trim();
  const supportPhone = String(vars.supportPhone || '+923234193599').trim();
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

  const primaryAmount =
    eventType === 'PAYMENT_RESTORED' || eventType === 'AGENT_PAYMENT_RECEIPT'
      ? Math.round(Number(vars.amountPaid ?? vars.totalAmount ?? vars.amountDue ?? 0))
      : Math.round(Number(vars.amountDue ?? vars.totalAmount ?? vars.monthlyFee ?? 0));

  const renderValues = {
    client_name: clientName,
    username: uname || 'N/A',
    password: vars.password || 'As configured',
    package: vars.packageName || vars.accountRole || 'Fiber Broadband',
    amount: formatMoneyValue(primaryAmount),
    due_date: vars.dueDate || vars.expiryDate || 'Current Cycle',
    grace_date: vars.graceDate || vars.dueDate || 'Within 3 days',
    expiry_date: vars.expiryDate || vars.dueDate || 'Active',
    ticket_id: vars.ticketId || 'TKT-NEW',
    issue: vars.issue || vars.customNote || 'Technical / Connectivity Support',
    agent_name: vars.agentName || 'Field Support Team',
    company_name: company,
    helpline: supportPhone,
    invoice_no: vars.invoiceNo || 'N/A',
    area: vars.area || 'Main Service Area',
    phone: vars.phone || 'N/A',
    address: vars.address || 'On file',
    agent_balance: formatMoneyValue(vars.agentBalance ?? 0),
    payment_method: vars.paymentMethod || 'Cash',
    remaining_balance: formatMoneyValue(Math.max(0, Math.round(Number(vars.remainingBalance ?? 0)))),
    portal_url: vars.portalUrl || 'Portal Login',
  };

  if (eventType === 'CUSTOM_MESSAGE') {
    const rawCustom = String(vars.customMessage || vars.customNote || '').trim();
    if (rawCustom) return renderTemplateText(rawCustom, renderValues);
  }

  const tplKey = mapEventTypeToTemplateKey(eventType);
  if (tplKey) {
    const customText = vars.customTemplates?.[tplKey];
    const tplBody =
      typeof customText === 'string' && customText.trim()
        ? customText
        : DEFAULT_TEMPLATE_MAP[tplKey];
    const rendered = renderTemplateText(tplBody, renderValues);
    const shouldAppendPaymentBlock =
      (eventType === 'INVOICE_GENERATED' ||
        eventType === 'PRE_EXPIRY_3D' ||
        eventType === 'GRACE_PERIOD_3D' ||
        eventType === 'AUTO_SUSPENSION') &&
      Boolean(paymentBlock) &&
      !rendered.includes('*Payment Methods:*');
    return shouldAppendPaymentBlock ? `${rendered}${paymentBlock}` : rendered;
  }

  return (
    `*${company} — WhatsApp Gateway Active*\n\n` +
    `${vars.customNote || vars.customMessage || 'Automated multi-tenant Baileys WhatsApp Gateway is connected and ready.'}\n\n` +
    `— *${company}*` +
    supportLine
  );
}

// ============================================================================
// SUPABASE POSTGRESQL AUTH STATE PERSISTENCE (whatsapp_auth_sessions)
// ============================================================================

function serializeAuthData(value) {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function deserializeAuthData(raw) {
  if (raw === null || raw === undefined) return null;
  const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return JSON.parse(serialized, BufferJSON.reviver);
}

/**
 * Persists Baileys `creds` and Signal `keys` in Supabase PostgreSQL
 * (`whatsapp_auth_sessions` with PK `(tenant_id, key_id)`).
 */
async function useSupabaseAuthState(supabaseClient, tenantId) {
  if (!supabaseClient) {
    throw new Error(
      'Supabase client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  const safeTenantId = sanitizePortalUserId(tenantId);
  if (!safeTenantId) {
    throw new Error('Invalid tenantId for WhatsApp auth state.');
  }

  let writeQueue = Promise.resolve();
  const enqueueWrite = (task) => {
    writeQueue = writeQueue
      .catch(() => {})
      .then(task);
    return writeQueue;
  };

  const readData = async (keyId) => {
    const { data, error } = await supabaseClient
      .from(WHATSAPP_AUTH_SESSIONS_TABLE)
      .select('key_data')
      .eq('tenant_id', safeTenantId)
      .eq('key_id', keyId)
      .maybeSingle();

    if (error) {
      console.error(
        `[Baileys-Auth] Failed reading key "${keyId}" for tenant ${safeTenantId}:`,
        error.message
      );
      return null;
    }
    if (!data || data.key_data === null || data.key_data === undefined) {
      return null;
    }
    try {
      return deserializeAuthData(data.key_data);
    } catch (err) {
      console.error(
        `[Baileys-Auth] Failed deserializing key "${keyId}" for tenant ${safeTenantId}:`,
        err?.message
      );
      return null;
    }
  };

  const writeBatch = async (rows) => {
    if (!rows.length) return;
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabaseClient
        .from(WHATSAPP_AUTH_SESSIONS_TABLE)
        .upsert(chunk, { onConflict: 'tenant_id,key_id' });
      if (error) {
        console.error(
          `[Baileys-Auth] Failed upserting ${chunk.length} auth key(s) for tenant ${safeTenantId}:`,
          error.message
        );
        throw new Error(`Supabase auth write failed: ${error.message}`);
      }
    }
  };

  const removeBatch = async (keyIds) => {
    if (!keyIds.length) return;
    const chunkSize = 100;
    for (let i = 0; i < keyIds.length; i += chunkSize) {
      const chunk = keyIds.slice(i, i + chunkSize);
      const { error } = await supabaseClient
        .from(WHATSAPP_AUTH_SESSIONS_TABLE)
        .delete()
        .eq('tenant_id', safeTenantId)
        .in('key_id', chunk);
      if (error) {
        console.error(
          `[Baileys-Auth] Failed deleting ${chunk.length} auth key(s) for tenant ${safeTenantId}:`,
          error.message
        );
      }
    }
  };

  const existingCreds = await readData('creds');
  const creds = existingCreds || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          if (!Array.isArray(ids) || ids.length === 0) return result;

          const keyIdToRawId = new Map();
          const keyIds = [];
          for (const id of ids) {
            const keyId = `${type}-${id}`;
            keyIdToRawId.set(keyId, id);
            keyIds.push(keyId);
          }

          const chunkSize = 200;
          for (let i = 0; i < keyIds.length; i += chunkSize) {
            const chunk = keyIds.slice(i, i + chunkSize);
            const { data, error } = await supabaseClient
              .from(WHATSAPP_AUTH_SESSIONS_TABLE)
              .select('key_id, key_data')
              .eq('tenant_id', safeTenantId)
              .in('key_id', chunk);

            if (error) {
              console.error(
                `[Baileys-Auth] Failed reading "${type}" keys for tenant ${safeTenantId}:`,
                error.message
              );
              continue;
            }

            if (Array.isArray(data)) {
              for (const row of data) {
                const rawId = keyIdToRawId.get(row.key_id);
                if (rawId === undefined) continue;
                try {
                  let value = deserializeAuthData(row.key_data);
                  if (
                    type === 'app-state-sync-key' &&
                    value &&
                    proto?.Message?.AppStateSyncKeyData?.fromObject
                  ) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                  }
                  if (value !== null && value !== undefined) {
                    result[rawId] = value;
                  }
                } catch (err) {
                  console.error(
                    `[Baileys-Auth] Corrupt key "${row.key_id}" for tenant ${safeTenantId}:`,
                    err?.message
                  );
                }
              }
            }
          }

          return result;
        },
        set: async (data) => {
          const nowIso = new Date().toISOString();
          const rowsToUpsert = [];
          const keysToDelete = [];

          for (const category of Object.keys(data || {})) {
            const entries = data[category] || {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const keyId = `${category}-${id}`;
              if (value !== null && value !== undefined) {
                rowsToUpsert.push({
                  tenant_id: safeTenantId,
                  key_id: keyId,
                  key_data: serializeAuthData(value),
                  updated_at: nowIso,
                });
              } else {
                keysToDelete.push(keyId);
              }
            }
          }

          await enqueueWrite(async () => {
            if (rowsToUpsert.length > 0) {
              await writeBatch(rowsToUpsert);
            }
            if (keysToDelete.length > 0) {
              await removeBatch(keysToDelete);
            }
          });
        },
      },
    },
    saveCreds: async () => {
      const nowIso = new Date().toISOString();
      const row = {
        tenant_id: safeTenantId,
        key_id: 'creds',
        key_data: serializeAuthData(creds),
        updated_at: nowIso,
      };
      await enqueueWrite(() => writeBatch([row]));
    },
    flushWrites: async () => {
      await writeQueue.catch(() => {});
    },
  };
}

function resolveSafeLocalAuthDir(tenantId) {
  const safeId = sanitizePortalUserId(tenantId);
  if (!safeId) throw new Error('Invalid tenantId for local auth_info.');
  const resolvedRoot = path.resolve(LOCAL_AUTH_INFO_ROOT);
  const resolvedTarget = path.resolve(resolvedRoot, `session_${safeId}`);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Unsafe local auth_info path rejected.');
  }
  return resolvedTarget;
}

async function loadTenantAuthState(safeTenantId) {
  if (supabase && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { error: probeErr } = await supabase
        .from(WHATSAPP_AUTH_SESSIONS_TABLE)
        .select('tenant_id')
        .limit(1);
      if (!probeErr) {
        const res = await useSupabaseAuthState(supabase, safeTenantId);
        return { ...res, storageMode: 'supabase-postgresql' };
      }
    } catch (err) {
      console.warn(
        `[Baileys-Auth] Falling back to local auth_info for tenant ${safeTenantId}:`,
        err?.message
      );
    }
  }

  // Fallback to persistent local auth_info folder when Supabase service key / table isn't configured
  const authDir = resolveSafeLocalAuthDir(safeTenantId);
  fs.mkdirSync(authDir, { recursive: true });
  let localWriteQueue = Promise.resolve();
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  return {
    state,
    saveCreds: async () => {
      localWriteQueue = localWriteQueue.catch(() => {}).then(() => saveCreds());
      return localWriteQueue;
    },
    flushWrites: async () => {
      await localWriteQueue.catch(() => {});
    },
    storageMode: 'local-auth-info',
  };
}

async function deleteTenantAuthState(supabaseClient, tenantId) {
  const safeTenantId = sanitizePortalUserId(tenantId);
  if (!safeTenantId) return;

  // Clear local auth_info folder if present (ONLY called on 401 loggedOut or explicit logout)
  try {
    const localDir = resolveSafeLocalAuthDir(safeTenantId);
    if (fs.existsSync(localDir)) {
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[Baileys-Auth] Failed clearing local auth_info for ${safeTenantId}:`, err?.message);
  }

  if (!supabaseClient) return;
  const { error } = await supabaseClient
    .from(WHATSAPP_AUTH_SESSIONS_TABLE)
    .delete()
    .eq('tenant_id', safeTenantId);
  if (error) {
    console.error(
      `[Baileys-Auth] Failed clearing auth rows for tenant ${safeTenantId}:`,
      error.message
    );
  }
}

async function hasPersistedTenantCreds(supabaseClient, tenantId) {
  const safeTenantId = sanitizePortalUserId(tenantId);
  if (!safeTenantId) return false;

  try {
    const localDir = resolveSafeLocalAuthDir(safeTenantId);
    if (fs.existsSync(path.join(localDir, 'creds.json'))) {
      return true;
    }
  } catch {
    // ignore
  }

  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient
    .from(WHATSAPP_AUTH_SESSIONS_TABLE)
    .select('tenant_id')
    .eq('tenant_id', safeTenantId)
    .eq('key_id', 'creds')
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.tenant_id);
}

async function listPersistedTenantIds(supabaseClient) {
  if (!supabaseClient) return [];
  const tenantSet = new Set();

  // Primary query: every linked tenant has a 'creds' row (fast, avoids hitting 1000-row cap on Signal keys)
  const { data: credsRows, error: credsErr } = await supabaseClient
    .from(WHATSAPP_AUTH_SESSIONS_TABLE)
    .select('tenant_id')
    .eq('key_id', 'creds');

  if (credsErr) {
    console.error(
      `[Baileys-Gateway] Unable to query ${WHATSAPP_AUTH_SESSIONS_TABLE}: ${credsErr.message}`
    );
    if (/relation .* does not exist|does not exist|schema cache/i.test(credsErr.message)) {
      console.warn(
        `[Baileys-Gateway] Run this SQL once in Supabase SQL Editor to create the session table:\n${WHATSAPP_AUTH_SESSIONS_DDL}`
      );
    }
    return [];
  }

  for (const row of credsRows || []) {
    const safeId = sanitizePortalUserId(row?.tenant_id);
    if (safeId) tenantSet.add(safeId);
  }

  return Array.from(tenantSet);
}

async function ensureAuthSessionsTable() {
  if (!supabase) return false;
  const { error } = await supabase
    .from(WHATSAPP_AUTH_SESSIONS_TABLE)
    .select('tenant_id')
    .limit(1);

  if (!error) return true;

  // If direct PostgreSQL DATABASE_URL is also provided (e.g. Railway / Supabase Pooler), auto-bootstrap the table
  if (
    process.env.DATABASE_URL &&
    /relation .* does not exist|does not exist|schema cache/i.test(error.message)
  ) {
    try {
      const pgMod = await import('pg');
      const Pool = pgMod.default?.Pool ?? pgMod.Pool;
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
      });
      await pool.query(WHATSAPP_AUTH_SESSIONS_DDL);
      await pool.end();
      console.log(
        `[Baileys-Gateway] Auto-created PostgreSQL table public.${WHATSAPP_AUTH_SESSIONS_TABLE}.`
      );
      return true;
    } catch (pgErr) {
      console.warn(
        `[Baileys-Gateway] Auto-DDL via DATABASE_URL failed: ${pgErr?.message}`
      );
    }
  }

  console.warn(
    `[Baileys-Gateway] Table public.${WHATSAPP_AUTH_SESSIONS_TABLE} check returned: ${error.message}`
  );
  if (/relation .* does not exist|does not exist|schema cache/i.test(error.message)) {
    console.warn(
      `[Baileys-Gateway] Please run the migration SQL once in Supabase SQL Editor:\n${WHATSAPP_AUTH_SESSIONS_DDL}`
    );
  }
  return false;
}

// ============================================================================
// MULTI-SESSION BAILEYS SOCKET ENGINE
// ============================================================================

const sockets = new Map(); // sessionKey -> WASocket
const states = new Map(); // sessionKey -> { portalUserId, sessionKey, status, qrDataUrl, phone, lastError, updatedAt, reconnectAttempts, restart515Attempts }
const pendingQrWaiters = new Map(); // sessionKey -> Array<() => void>
const reconnectTimers = new Map(); // sessionKey -> Timeout
const manualLogoutInProgress = new Set(); // sessionKey
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
      restart515Attempts: 0,
    });
  }
  return states.get(sessionKey);
}

function clearPendingReconnect(sessionKey) {
  const timer = reconnectTimers.get(sessionKey);
  if (timer) {
    clearTimeout(timer);
    reconnectTimers.delete(sessionKey);
  }
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

async function startBaileysSession(portalUserId, waitMs = 12000, options = {}) {
  const safeId = sanitizePortalUserId(portalUserId);
  if (!safeId) throw new Error('Invalid portalUserId.');

  const sessionKey = `session_${safeId}`;
  const state = getOrCreateState(safeId);
  const { forceReconnect = false } = options;

  if (!forceReconnect && state.status === 'CONNECTED' && sockets.has(sessionKey)) {
    return { ...state };
  }
  if (!forceReconnect && state.status === 'QR_READY' && state.qrDataUrl && sockets.has(sessionKey)) {
    return { ...state };
  }

  manualLogoutInProgress.delete(sessionKey);
  clearPendingReconnect(sessionKey);

  // Clean up any stale socket before opening a new one
  const existingSock = sockets.get(sessionKey);
  if (existingSock) {
    sockets.delete(sessionKey);
    try {
      existingSock.ev.removeAllListeners('connection.update');
      existingSock.ev.removeAllListeners('creds.update');
      existingSock.end(undefined);
    } catch {
      // ignore
    }
  }

  state.status = 'CONNECTING';
  state.lastError = null;
  state.updatedAt = new Date().toISOString();

  const {
    state: authState,
    saveCreds,
    flushWrites,
    storageMode,
  } = await loadTenantAuthState(safeId);

  let version = [2, 3000, 1015901307];
  try {
    const fetched = await fetchLatestBaileysVersion();
    if (Array.isArray(fetched?.version) && fetched.version.length === 3) {
      version = fetched.version;
      console.log(
        `[Baileys-Gateway] Tenant ${safeId} using WA Web v${version.join('.')} (latest=${Boolean(fetched.isLatest)}, auth=${storageMode})`
      );
    }
  } catch (vErr) {
    console.warn(
      `[Baileys-Gateway] fetchLatestBaileysVersion warning (using fallback ${version.join('.')}):`,
      vErr?.message
    );
  }

  const sock = makeWASocket({
    version,
    auth: authState,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers?.macOS
      ? Browsers.macOS('Desktop')
      : ['Youth Net Service', 'Chrome', '124.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 30_000,
    defaultQueryTimeoutMs: 30_000,
    keepAliveIntervalMs: 25_000,
  });

  // Close any socket that may have raced while awaiting auth state
  const racedSock = sockets.get(sessionKey);
  if (racedSock && racedSock !== sock) {
    try {
      racedSock.ev.removeAllListeners('connection.update');
      racedSock.ev.removeAllListeners('creds.update');
      racedSock.end(undefined);
    } catch {
      // ignore
    }
  }
  sockets.set(sessionKey, sock);

  let pendingCredsSave = Promise.resolve();
  sock.ev.on('creds.update', () => {
    pendingCredsSave = pendingCredsSave
      .catch(() => {})
      .then(() => saveCreds())
      .catch((err) => {
        console.error(
          `[Baileys-Gateway] Failed saving creds (${storageMode}) for tenant ${safeId}:`,
          err?.message
        );
      });
  });

  sock.ev.on('connection.update', async (update) => {
    // Ignore events from superseded sockets
    if (sockets.get(sessionKey) !== sock) return;

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
      state.restart515Attempts = 0;
      state.updatedAt = new Date().toISOString();
      await syncUserStatusInSupabase(safeId, 'CONNECTED', state.phone);
      notifyQrWaiters(sessionKey);
      console.log(
        `[Baileys-Gateway] Connected tenant ${safeId} (${state.phone || 'active'}) [${storageMode}]`
      );
    }

    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.statusCode;
      const loggedOut =
        statusCode === DisconnectReason.loggedOut || statusCode === 401;
      const restartRequired =
        statusCode === DisconnectReason.restartRequired || statusCode === 515;

      sockets.delete(sessionKey);

      // If this close was triggered by an explicit logout call, do not reconnect
      if (manualLogoutInProgress.has(sessionKey)) {
        manualLogoutInProgress.delete(sessionKey);
        return;
      }

      // ONLY purge auth credentials when explicitly logged out (401)
      if (loggedOut) {
        clearPendingReconnect(sessionKey);
        state.status = 'DISCONNECTED';
        state.qrDataUrl = null;
        state.phone = null;
        state.reconnectAttempts = 0;
        state.restart515Attempts = 0;
        state.lastError =
          'Device unlinked / logged out from WhatsApp (401). Scan a fresh QR code to pair again.';
        state.updatedAt = new Date().toISOString();
        console.log(
          `[Baileys-Gateway] Tenant ${safeId} logged out (401) — clearing saved session credentials...`
        );
        await deleteTenantAuthState(supabase, safeId);
        await syncUserStatusInSupabase(safeId, 'DISCONNECTED', null);
        notifyQrWaiters(sessionKey);
        return;
      }

      // Handle WhatsApp QR pairing handoff (515 restartRequired):
      // NEVER delete auth_info / whatsapp_auth_sessions; flush creds and reconnect within 1 second
      if (restartRequired) {
        state.qrDataUrl = null;
        state.status = 'CONNECTING';
        state.lastError = null;
        state.updatedAt = new Date().toISOString();
        state.restart515Attempts = (state.restart515Attempts || 0) + 1;

        try {
          await pendingCredsSave;
          await flushWrites();
        } catch {
          // ignore
        }

        if (state.restart515Attempts <= 6) {
          const delayMs = 800; // Re-initialize makeWASocket within 1 second using saved credentials
          console.log(
            `[Baileys-Gateway] Restart required (515) for tenant ${safeId} (attempt ${state.restart515Attempts}/6) — credentials preserved & flushed; reconnecting in ${delayMs}ms...`
          );
          clearPendingReconnect(sessionKey);
          const timer = setTimeout(() => {
            reconnectTimers.delete(sessionKey);
            if (!sockets.has(sessionKey) && !manualLogoutInProgress.has(sessionKey)) {
              startBaileysSession(safeId, 0, { forceReconnect: true }).catch((err) => {
                console.warn(
                  `[Baileys-Gateway] 515 reconnect failed for tenant ${safeId}:`,
                  err?.message
                );
              });
            }
          }, delayMs);
          reconnectTimers.set(sessionKey, timer);
        } else {
          state.status = 'DISCONNECTED';
          state.lastError =
            'WhatsApp stream restart limit reached (515). Click Generate QR to reconnect.';
          state.updatedAt = new Date().toISOString();
          notifyQrWaiters(sessionKey);
        }
        return;
      }

      // Transient network / stream disconnect — attempt clean backoff reconnect if persisted creds exist
      state.status = 'DISCONNECTED';
      state.qrDataUrl = null;
      state.lastError =
        lastDisconnect?.error?.message ||
        `Connection closed (${statusCode || 'network'})`;
      state.updatedAt = new Date().toISOString();
      notifyQrWaiters(sessionKey);

      if (state.reconnectAttempts < 5) {
        state.reconnectAttempts += 1;
        const delay = Math.min(20000, 2500 * state.reconnectAttempts);
        clearPendingReconnect(sessionKey);
        const timer = setTimeout(async () => {
          reconnectTimers.delete(sessionKey);
          if (sockets.has(sessionKey) || manualLogoutInProgress.has(sessionKey)) return;
          const stillHasCreds = await hasPersistedTenantCreds(supabase, safeId);
          if (stillHasCreds) {
            startBaileysSession(safeId, 0, { forceReconnect: true }).catch((err) => {
              console.warn(
                `[Baileys-Gateway] Auto-reconnect failed for tenant ${safeId}:`,
                err?.message
              );
            });
          }
        }, delay);
        reconnectTimers.set(sessionKey, timer);
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

  manualLogoutInProgress.add(sessionKey);
  clearPendingReconnect(sessionKey);

  try {
    const sock = sockets.get(sessionKey);
    if (sock) {
      sockets.delete(sessionKey);
      try {
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
      } catch {
        // ignore
      }
      try {
        await sock.logout();
      } catch {
        try {
          sock.end(undefined);
        } catch {
          // ignore
        }
      }
    }

    await deleteTenantAuthState(supabase, safeId);
  } finally {
    manualLogoutInProgress.delete(sessionKey);
  }

  state.status = 'DISCONNECTED';
  state.qrDataUrl = null;
  state.phone = null;
  state.lastError = null;
  state.reconnectAttempts = 0;
  state.restart515Attempts = 0;
  state.updatedAt = new Date().toISOString();
  await syncUserStatusInSupabase(safeId, 'DISCONNECTED', null);
  notifyQrWaiters(sessionKey);
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

async function sendAutomatedMessage({
  subscriber,
  subscriberUsername,
  eventType,
  messageVars = {},
  groupJid = null,
  customMessage = null,
  forceSenderPortalUserId,
  manualTrigger = false,
}) {
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

  await loadAppSettingsCache();
  const customTemplates = {
    ...settingsCache.globalTemplates,
    ...(sender.senderPortalUserId ? settingsCache.scopedTemplates.get(String(sender.senderPortalUserId)) || {} : {}),
  };
  const teamGroupCfg =
    (sender.senderPortalUserId && settingsCache.scopedTeamGroups.get(String(sender.senderPortalUserId))) ||
    settingsCache.globalTeamGroup ||
    null;

  const rawPhone = messageVars.phone || resolvedSub?.phone || '';
  let jid = null;
  let recipientDigits = formatWhatsAppDigits(rawPhone) || String(rawPhone || 'unknown');

  if (groupJid || eventType === 'COMPLAINT_CREATED_GROUP') {
    const candidateGroup = groupJid || teamGroupCfg?.groupJid || '';
    jid = formatWhatsAppGroupJid(candidateGroup);
    recipientDigits = jid
      ? teamGroupCfg?.groupName
        ? `${teamGroupCfg.groupName} (${jid})`
        : jid
      : candidateGroup || 'UNCONFIGURED_TEAM_GROUP';
  } else {
    jid = formatWhatsAppJid(rawPhone);
  }

  const messageBody = buildAutomatedMessage(eventType, {
    ...messageVars,
    companyName: sender.companyName,
    supportPhone: messageVars.supportPhone || sender.supportPhone,
    subscriberName: messageVars.subscriberName || resolvedSub?.full_name || subscriberUsername,
    username: messageVars.username || resolvedSub?.username || subscriberUsername,
    phone: rawPhone,
    customMessage: customMessage || messageVars.customMessage,
    customTemplates,
    paymentAccounts:
      Array.isArray(messageVars.paymentAccounts) && messageVars.paymentAccounts.length > 0
        ? messageVars.paymentAccounts
        : paymentAccounts,
  });

  const loggedMessageBody =
    eventType === 'PORTAL_CREDENTIALS' || eventType === 'PROVISION_WELCOME'
      ? messageBody.replace(/(\*(?:PPPoE\s+)?Password:\*\s*)(.+)/gi, '$1••••••••')
      : messageBody;

  if (
    !manualTrigger &&
    !sender.autoSendEnabled &&
    eventType !== 'MANUAL_TEST' &&
    eventType !== 'CUSTOM_MESSAGE' &&
    eventType !== 'PORTAL_CREDENTIALS'
  ) {
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
    const errMsg =
      eventType === 'COMPLAINT_CREATED_GROUP' || groupJid
        ? 'Team WhatsApp Work Group JID is not configured. Select your Team Group in WhatsApp & Branding.'
        : 'Missing or invalid subscriber WhatsApp phone number.';
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
    authStorage: supabase ? 'supabase-postgresql' : 'unconfigured',
    authTable: WHATSAPP_AUTH_SESSIONS_TABLE,
    activeSessionsCount: states.size,
    connectedSessionsCount: connectedCount,
    supabaseConfigured: Boolean(supabase),
    serviceRoleConfigured: Boolean(SUPABASE_SERVICE_ROLE_KEY),
    timestamp: new Date().toISOString(),
  });
});

// 2. Session Status + Branding + Tenant Overview (exposed on both /api/whatsapp/status & /api/whatsapp/session/status)
async function handleGetSessionStatus(req, res) {
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

    const normalizedStatus = String(runtime.status || 'DISCONNECTED').toLowerCase();

    return res.json({
      success: true,
      status: normalizedStatus,
      qrDataUrl: runtime.qrDataUrl || null,
      phone: runtime.phone || ctx.actor.whatsapp_phone || null,
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
}

app.get('/api/whatsapp/status', handleGetSessionStatus);
app.get('/api/whatsapp/session/status', handleGetSessionStatus);

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

// 5B. Fetch Connected WhatsApp Groups (for Team Work Group selector)
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, groups: [], error: ctx.error });
    }
    const safeId = sanitizePortalUserId(ctx.actor.id);
    const sessionKey = `session_${safeId}`;
    const sock = sockets.get(sessionKey);
    const st = states.get(sessionKey);
    if (!sock || st?.status !== 'CONNECTED') {
      return res.status(400).json({
        success: false,
        groups: [],
        error: 'WhatsApp session is not connected. Pair your WhatsApp via QR first to fetch groups.',
      });
    }
    const participating = await sock.groupFetchAllParticipating();
    const groups = Object.values(participating || {})
      .map((g) => ({
        id: String(g?.id || '').trim(),
        subject: String(g?.subject || 'Unnamed Group').trim(),
        participantsCount: Array.isArray(g?.participants) ? g.participants.length : 0,
      }))
      .filter((g) => Boolean(formatWhatsAppGroupJid(g.id)))
      .sort((a, b) => a.subject.localeCompare(b.subject));
    return res.json({ success: true, groups });
  } catch (err) {
    return res.status(500).json({ success: false, groups: [], error: err?.message || 'Failed to fetch WhatsApp groups.' });
  }
});

// 5C. Load & Save Editable Message Templates + Team Work Group Config
app.get('/api/whatsapp/templates', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    await loadAppSettingsCache();
    const actorId = String(ctx.actor.id);
    const templates = {
      ...DEFAULT_TEMPLATE_MAP,
      ...settingsCache.globalTemplates,
      ...(settingsCache.scopedTemplates.get(actorId) || {}),
    };
    const teamGroup =
      settingsCache.scopedTeamGroups.get(actorId) ||
      settingsCache.globalTeamGroup || { groupJid: '', groupName: '', inviteLink: '' };
    return res.json({ success: true, templates, teamGroup });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to load templates.' });
  }
});

app.post('/api/whatsapp/templates', async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    const body = req.body || {};
    const nowIso = new Date().toISOString();
    const rows = [];
    const actorId = String(ctx.actor.id);
    const isAdmin = ctx.effectiveTier === 'ADMIN';

    if (body.templates && typeof body.templates === 'object') {
      const sanitized = {};
      for (const k of Object.keys(DEFAULT_TEMPLATE_MAP)) {
        const val = body.templates[k];
        if (typeof val === 'string' && val.trim()) sanitized[k] = val.slice(0, 3000);
      }
      const serialized = JSON.stringify(sanitized);
      if (isAdmin) rows.push({ key: WHATSAPP_TEMPLATES_SETTINGS_KEY, value: serialized, updated_at: nowIso });
      rows.push({ key: `${WHATSAPP_TEMPLATES_SETTINGS_KEY}:${actorId}`, value: serialized, updated_at: nowIso });
    }

    if (body.teamGroup && typeof body.teamGroup === 'object') {
      const cleanGroup = {
        groupJid: String(body.teamGroup.groupJid || '').trim().slice(0, 120),
        groupName: String(body.teamGroup.groupName || '').trim().slice(0, 140),
        inviteLink: String(body.teamGroup.inviteLink || '').trim().slice(0, 260),
      };
      const serialized = JSON.stringify(cleanGroup);
      if (isAdmin) rows.push({ key: WHATSAPP_TEAM_GROUP_SETTINGS_KEY, value: serialized, updated_at: nowIso });
      rows.push({ key: `${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:${actorId}`, value: serialized, updated_at: nowIso });
    }

    if (supabase && rows.length > 0) {
      await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
      settingsCache.loadedAt = 0;
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save templates.' });
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
      'GRACE_PERIOD_3D',
      'AUTO_SUSPENSION',
      'PAYMENT_RESTORED',
      'AGENT_PAYMENT_RECEIPT',
      'COMPLAINT_CREATED_CLIENT',
      'COMPLAINT_CREATED_GROUP',
      'COMPLAINT_RESOLVED_CLIENT',
      'CUSTOM_MESSAGE',
      'MANUAL_TEST',
    ]);
    let eventType = String(body.eventType || '').trim().toUpperCase();
    if (!eventType) {
      if (body.password || body.portalUrl || body.messageVars?.password || body.messageVars?.portalUrl) {
        eventType = 'PORTAL_CREDENTIALS';
      } else if (body.customMessage) {
        eventType = 'CUSTOM_MESSAGE';
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
      ...(body.message && !body.messageVars?.customNote ? { customNote: String(body.message).slice(0, 2500) } : {}),
      ...(body.customMessage && !body.messageVars?.customMessage
        ? { customMessage: String(body.customMessage).slice(0, 3000) }
        : {}),
    };

    const isNewAccountEvent = eventType === 'PROVISION_WELCOME' || eventType === 'PORTAL_CREDENTIALS';
    const isDirectBroadcast =
      eventType === 'MANUAL_TEST' ||
      (eventType === 'CUSTOM_MESSAGE' && !subscriberUsername) ||
      eventType === 'COMPLAINT_CREATED_GROUP';
    let effectiveSubscriber = body.subscriber || null;

    // Enforce multi-tenant scope for Dealers & Sub-Dealers
    if (ctx.effectiveTier === 'DEALER' || ctx.effectiveTier === 'SUB_DEALER') {
      if (!isDirectBroadcast) {
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
      groupJid: body.groupJid ? String(body.groupJid).trim() : null,
      customMessage: body.customMessage ? String(body.customMessage).slice(0, 3000) : null,
      manualTrigger: Boolean(body.manualTrigger) || eventType === 'CUSTOM_MESSAGE',
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

// 8. 5-Day Pre-Expiry Auto-Billing & Automated WhatsApp Invoice Delivery
function resolveStandalonePackageRate(pkgName) {
  const s = String(pkgName || '').toUpperCase();
  if (s.includes('100')) return 5000;
  if (s.includes('50')) return 3500;
  if (s.includes('30')) return 3000;
  if (s.includes('20')) return 2500;
  if (s.includes('15')) return 2000;
  if (s.includes('10')) return 1500;
  return 2000;
}

async function safeInsertDueInvoiceStandalone(payload) {
  const working = { ...payload };
  const optionalCols = new Set([
    'package_profile',
    'package_name',
    'shifted_to_next_month',
    'sub_dealer_id',
    'dealer_id',
    'created_by_id',
  ]);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabase.from('invoices').insert([working]).select().maybeSingle();
    if (!error) return { data, error: null };
    const msg = String(error.message || error.details || '');
    const m =
      msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
      msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:of relation|does not exist)/i);
    if (m?.[1] && m[1] in working && optionalCols.has(m[1])) {
      delete working[m[1]];
      continue;
    }
    return { data, error };
  }
  return { data: null, error: new Error('Failed to insert invoice') };
}

async function runPreExpirySweep(actorCtx = null, daysBeforeExpiry = 5) {
  if (!supabase) {
    return {
      scanned: 0,
      invoicesGenerated: 0,
      sent: 0,
      whatsappSent: 0,
      skipped: 0,
      skippedExisting: 0,
      failed: 0,
      totalBilled: 0,
    };
  }
  const [{ data: clients }, { data: invoices }] = await Promise.all([
    supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
    supabase
      .from('invoices')
      .select('id, invoice_no, subscriber_username, amount, paid_amount, status, due_date, created_at'),
  ]);

  const openNonMaterialByUser = new Set();
  const existingDueKeys = new Set();
  for (const inv of invoices || []) {
    const uname = String(inv.subscriber_username || '').trim().toLowerCase();
    if (!uname) continue;
    if (String(inv.invoice_no || '').trim().toUpperCase().startsWith('INV-MAT-')) continue;
    const st = String(inv.status || '').toUpperCase();
    const bal = Math.max(0, (Number(inv.amount) || 0) - (Number(inv.paid_amount) || 0));
    if (st !== 'PAID' && st !== 'CANCELLED' && bal > 0) {
      openNonMaterialByUser.add(uname);
    }
    const dueYmd = String(inv.due_date || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueYmd)) {
      existingDueKeys.add(`${uname}::${dueYmd}`);
    }
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const todayYmd = nowIso.slice(0, 10);
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  const todayUtcMs = Date.UTC(ty, (tm || 1) - 1, td || 1);
  const leadDays = Math.max(1, Math.min(15, Number(daysBeforeExpiry || 5)));

  let scanned = 0;
  let invoicesGenerated = 0;
  let whatsappSent = 0;
  let skippedExisting = 0;
  let failed = 0;
  let totalBilled = 0;

  for (const sub of clients || []) {
    const acct = String(sub.account_status || 'ACTIVE').toUpperCase();
    const bil = String(sub.billing_status || 'ACTIVE').toUpperCase();
    if (sub.is_suspended === true) continue;
    if (['SUSPENDED', 'EXPIRED', 'DELETED', 'PENDING_RECHARGE'].includes(acct)) continue;
    if (['SUSPENDED_EXPIRED', 'PENDING_RECHARGE'].includes(bil)) continue;
    if (actorCtx && actorCtx.effectiveTier === 'DEALER') {
      if (String(sub.dealer_id || '') !== String(actorCtx.actor.id)) continue;
    }

    const uname = String(sub.username || '').trim().toLowerCase();
    if (!uname) continue;
    scanned++;

    const expiryRaw = String(sub.expiry_date || sub.next_billing_date || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryRaw)) continue;

    const [ey, em, ed] = expiryRaw.split('-').map(Number);
    const expUtcMs = Date.UTC(ey, (em || 1) - 1, ed || 1);
    const daysUntilExpiry = Math.round((expUtcMs - todayUtcMs) / 86_400_000);
    if (daysUntilExpiry > leadDays || daysUntilExpiry < -30) continue;

    if (openNonMaterialByUser.has(uname) || existingDueKeys.has(`${uname}::${expiryRaw}`)) {
      skippedExisting++;
      continue;
    }

    const pkgName =
      String(
        sub.original_package_profile ||
          sub.package_profile_name ||
          sub.package_name ||
          sub.package_speed ||
          'Fiber Broadband'
      ).trim() || 'Fiber Broadband';

    const amount =
      Number(sub.monthly_fee) > 0 ? Number(sub.monthly_fee) : resolveStandalonePackageRate(pkgName);
    if (amount <= 0) continue;

    const compactYm = expiryRaw.slice(0, 7).replace('-', '');
    const invoiceNo = `INV-${compactYm}-${Math.floor(1000 + Math.random() * 9000)}`;
    const anchorDay = Number(sub.billing_anchor_day) || ed || now.getUTCDate();

    const { error: insertErr } = await safeInsertDueInvoiceStandalone({
      invoice_no: invoiceNo,
      subscriber_username: uname,
      assigned_agent_id: null,
      assigned_agent_name: null,
      amount,
      paid_amount: 0,
      status: 'DUE',
      due_date: expiryRaw,
      cycle_day: anchorDay,
      package_profile: pkgName,
      package_name: pkgName,
      dealer_id: sub.dealer_id || null,
      sub_dealer_id: sub.sub_dealer_id || null,
      created_at: nowIso,
    });

    if (insertErr) {
      failed++;
      continue;
    }

    invoicesGenerated++;
    totalBilled += amount;
    openNonMaterialByUser.add(uname);
    existingDueKeys.add(`${uname}::${expiryRaw}`);

    if (sub.phone) {
      const res = await sendAutomatedMessage({
        subscriber: sub,
        subscriberUsername: uname,
        eventType: 'INVOICE_GENERATED',
        messageVars: {
          subscriberName: sub.full_name || sub.username || uname,
          username: uname,
          phone: sub.phone,
          packageName: pkgName,
          invoiceNo,
          amountDue: amount,
          totalAmount: amount,
          dueDate: expiryRaw,
          expiryDate: expiryRaw,
        },
      });

      if (res.ok && res.status === 'SENT') {
        whatsappSent++;
      } else if (res.status === 'FAILED') {
        failed++;
      }
    }
  }

  return {
    scanned,
    invoicesGenerated,
    sent: whatsappSent,
    whatsappSent,
    skipped: skippedExisting,
    skippedExisting,
    failed,
    totalBilled,
  };
}

const handlePreExpiryAutoBilling = async (req, res) => {
  try {
    const ctx = await resolveActor(req);
    if (!ctx.ok || !ctx.actor) {
      return res.status(ctx.statusCode || 401).json({ success: false, error: ctx.error });
    }
    if (ctx.effectiveTier !== 'ADMIN' && ctx.effectiveTier !== 'DEALER') {
      return res
        .status(403)
        .json({ success: false, error: 'Only Master Admin or Dealers can trigger 5-day pre-expiry auto-billing.' });
    }
    const daysBeforeExpiry = Number(req.body?.daysBeforeExpiry || 5);
    const summary = await runPreExpirySweep(ctx, daysBeforeExpiry);
    return res.json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || '5-day pre-expiry auto-billing failed.' });
  }
};

app.post('/api/whatsapp/cron/pre-expiry', handlePreExpiryAutoBilling);
app.post('/api/billing/run-5day-pre-expiry-billing', handlePreExpiryAutoBilling);

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
// BOOT & AUTO-RESTORE PERSISTED MULTI-TENANT SESSIONS FROM SUPABASE POSTGRESQL
// ============================================================================

async function restorePersistedSessions() {
  const tenantSet = new Set();

  if (supabase && SUPABASE_SERVICE_ROLE_KEY) {
    const ready = await ensureAuthSessionsTable();
    if (ready) {
      const dbTenants = await listPersistedTenantIds(supabase);
      for (const id of dbTenants) tenantSet.add(id);
    }
  }

  // Also restore any locally stored auth_info/session_* credentials
  try {
    if (fs.existsSync(LOCAL_AUTH_INFO_ROOT)) {
      const entries = fs.readdirSync(LOCAL_AUTH_INFO_ROOT, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory() || !ent.name.startsWith('session_')) continue;
        const rawId = ent.name.slice('session_'.length);
        const safeId = sanitizePortalUserId(rawId);
        if (!safeId) continue;
        const credsPath = path.join(resolveSafeLocalAuthDir(safeId), 'creds.json');
        if (fs.existsSync(credsPath)) {
          tenantSet.add(safeId);
        }
      }
    }
  } catch {
    // ignore local auth_info scan errors
  }

  const tenantIds = Array.from(tenantSet);
  if (tenantIds.length === 0) {
    console.log(
      '[Baileys-Gateway] No persisted WhatsApp sessions found yet. Ready for QR pairing.'
    );
    return;
  }

  console.log(
    `[Baileys-Gateway] Found ${tenantIds.length} persisted tenant session(s) — restoring in background...`
  );

  for (let i = 0; i < tenantIds.length; i++) {
    const tenantId = tenantIds[i];
    // Stagger reconnects slightly so Railway startup stays smooth under many tenants
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    console.log(`[Baileys-Gateway] Auto-restoring WhatsApp session for tenant ${tenantId}...`);
    startBaileysSession(tenantId, 0, { forceReconnect: true }).catch((err) => {
      console.warn(
        `[Baileys-Gateway] Restore skipped for tenant ${tenantId}:`,
        err?.message
      );
    });
  }
}

function startGatewayServer(targetPort, allowFallbackTo3001 = true) {
  const server = app.listen(targetPort, '0.0.0.0', () => {
    console.log(`[Baileys-Gateway] Multi-Session WhatsApp Gateway listening on http://0.0.0.0:${targetPort}`);
    console.log(`[Baileys-Gateway] Auth persistence: Supabase PostgreSQL (${WHATSAPP_AUTH_SESSIONS_TABLE})`);
    console.log(`[Baileys-Gateway] Health check: http://localhost:${targetPort}/api/whatsapp/health`);
    restorePersistedSessions().catch((err) => {
      console.warn('[Baileys-Gateway] Startup restore error:', err?.message);
    });
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
