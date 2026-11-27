import { supabase, type WhatsAppEventType } from '../services/supabaseClient';

export type EditableWhatsAppTemplateKey =
  | 'WELCOME_CREDENTIALS'
  | 'INVOICE_GENERATED'
  | 'PRE_EXPIRY_3D'
  | 'GRACE_PERIOD_3D'
  | 'AUTO_SUSPENSION'
  | 'PAYMENT_RECEIPT_CLIENT'
  | 'AGENT_PAYMENT_RECEIPT'
  | 'COMPLAINT_CREATED_CLIENT'
  | 'COMPLAINT_CREATED_GROUP'
  | 'COMPLAINT_RESOLVED_CLIENT';

export interface WhatsAppTemplateDefinition {
  key: EditableWhatsAppTemplateKey;
  index: number;
  title: string;
  shortTitle: string;
  recipientLabel: string;
  category: 'ONBOARDING' | 'BILLING' | 'COMPLAINTS';
  eventTypes: WhatsAppEventType[];
  defaultBody: string;
  description: string;
}

export interface TeamWorkGroupConfig {
  groupJid: string;
  groupName: string;
  inviteLink?: string;
}

export const WHATSAPP_TEMPLATES_STORAGE_KEY = 'youthnet_whatsapp_message_templates_v1';
export const WHATSAPP_TEAM_GROUP_STORAGE_KEY = 'youthnet_whatsapp_team_group_v1';
export const WHATSAPP_TEMPLATES_SETTINGS_KEY = 'whatsapp_message_templates';
export const WHATSAPP_TEAM_GROUP_SETTINGS_KEY = 'whatsapp_team_group_config';

export const WHATSAPP_TEMPLATE_PLACEHOLDERS: Array<{
  token: string;
  label: string;
  sample: string;
}> = [
  { token: '{client_name}', label: 'Client Name', sample: 'Bilal Ahmed' },
  { token: '{username}', label: 'Username', sample: 'bilal_fiber' },
  { token: '{password}', label: 'Password', sample: 'Yn@4821' },
  { token: '{package}', label: 'Package', sample: '20Mbps-Fiber' },
  { token: '{amount}', label: 'Amount (Rs.)', sample: 'Rs. 2,500' },
  { token: '{due_date}', label: 'Due Date', sample: '2026-11-28' },
  { token: '{grace_date}', label: 'Grace End Date', sample: '2026-12-01' },
  { token: '{expiry_date}', label: 'Validity / Expiry', sample: '2026-12-26' },
  { token: '{ticket_id}', label: 'Ticket ID', sample: 'TKT-8842' },
  { token: '{issue}', label: 'Complaint Issue', sample: 'LOS Red Light on ONT' },
  { token: '{agent_name}', label: 'Recovery Agent', sample: 'Kamran Ali' },
  { token: '{company_name}', label: 'Company Name', sample: 'Youth Net Service' },
  { token: '{helpline}', label: 'Support Helpline', sample: '+923234193599' },
  { token: '{invoice_no}', label: 'Invoice #', sample: 'INV-202611-4821' },
  { token: '{area}', label: 'Area / Node', sample: 'Saddar Node' },
  { token: '{phone}', label: 'Client Phone', sample: '+923001234567' },
  { token: '{address}', label: 'Address', sample: 'House 14, Street 3, Saddar' },
  { token: '{agent_balance}', label: 'Agent Cash Balance', sample: 'Rs. 14,500' },
  { token: '{portal_url}', label: 'Portal Link', sample: 'https://portal.youthtechnology.pk' },
];

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplateDefinition[] = [
  {
    key: 'WELCOME_CREDENTIALS',
    index: 1,
    title: '1. Welcome Account & Credentials',
    shortTitle: 'Welcome & Credentials',
    recipientLabel: 'New Subscriber / Portal User',
    category: 'ONBOARDING',
    eventTypes: ['PROVISION_WELCOME', 'PORTAL_CREDENTIALS'],
    description: 'Sent automatically when creating a new portal account or provisioning a PPPoE broadband user.',
    defaultBody: `*Welcome to {company_name}!*

Dear *{client_name}*,
Your account is now *ACTIVE*.

• *Username:* {username}
• *Password:* {password}
• *Package / Role:* {package}
• *Portal Link:* {portal_url}
• *Valid Until:* {expiry_date}

Please keep your credentials secure.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'INVOICE_GENERATED',
    index: 2,
    title: '2. Monthly Invoice Generated (Pre-Expiry Bill)',
    shortTitle: 'Monthly Invoice (DUE)',
    recipientLabel: 'Client',
    category: 'BILLING',
    eventTypes: ['INVOICE_GENERATED'],
    description: 'Sent automatically 5 days before expiry or when a monthly DUE invoice is generated (package recharges for 31 days once Paid).',
    defaultBody: `*{company_name} — Monthly Bill Issued*

Dear *{client_name}* ({username}),
Your monthly broadband invoice has been generated.

• *Invoice #:* {invoice_no}
• *Package:* {package}
• *Amount Due:* {amount}
• *Due Date:* {due_date}

Kindly settle your bill on or before *{due_date}* to recharge your connection for *31 days* and avoid automatic movement to the Expiry Pool.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'PRE_EXPIRY_3D',
    index: 3,
    title: '3. 3-Day Pre-Expiry Reminder',
    shortTitle: '3-Day Pre-Expiry',
    recipientLabel: 'Client',
    category: 'BILLING',
    eventTypes: ['PRE_EXPIRY_3D'],
    description: 'Sent automatically 3 days before a subscriber billing due date / expiry date.',
    defaultBody: `*{company_name} — Renewal Reminder*

Dear *{client_name}* ({username}),
Your internet package (*{package}*) is due for renewal soon.

• *Amount Due:* {amount}
• *Due / Expiry Date:* {due_date}

Kindly clear your bill before the due date to avoid automatic disconnection.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'GRACE_PERIOD_3D',
    index: 4,
    title: '4. Post-Due 3-Day Grace Period Notice',
    shortTitle: '3-Day Grace Period',
    recipientLabel: 'Client',
    category: 'BILLING',
    eventTypes: ['GRACE_PERIOD_3D'],
    description: 'Sent automatically when an unpaid invoice passes its Due Date, granting 3 extra grace days before PPPoE suspension.',
    defaultBody: `*{company_name} — 3-Day Grace Period Notice*

Dear *{client_name}* ({username}),
Your monthly bill due date (*{due_date}*) has passed and your invoice is still unpaid.

To prevent sudden disruption, we have granted you a *3-day extra grace period*.
• *Package:* {package}
• *Amount Due:* {amount}
• *Grace Period Ends:* {grace_date}

Please clear your dues before *{grace_date}* to avoid automatic service suspension.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'AUTO_SUSPENSION',
    index: 5,
    title: '5. Auto-Suspension Notice',
    shortTitle: 'Auto-Suspension',
    recipientLabel: 'Client',
    category: 'BILLING',
    eventTypes: ['AUTO_SUSPENSION'],
    description: 'Sent automatically after the 3-day grace period expires and MikroTik PPPoE is isolated/disabled.',
    defaultBody: `*{company_name} — Service Temporarily Suspended*

Dear *{client_name}* ({username}),
Your broadband internet connection has been automatically suspended after the 3-day grace period due to unpaid dues.

• *Package:* {package}
• *Outstanding Due:* {amount}

Your connection will be *instantly restored* as soon as payment is received.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'PAYMENT_RECEIPT_CLIENT',
    index: 6,
    title: '6. Paid Receipt & 31-Day Recharge Confirmation (Client)',
    shortTitle: 'Paid Receipt (+31d)',
    recipientLabel: 'Client',
    category: 'BILLING',
    eventTypes: ['PAYMENT_RESTORED'],
    description: 'Sent automatically to the client whenever an invoice is marked PAID or a Manual Recharge extends validity by 31 days.',
    defaultBody: `*{company_name} — Paid Receipt & 31-Day Recharge Confirmed ✅*

Dear *{client_name}* ({username}),
Thank you! Your payment has been verified and your broadband package has been recharged for *31 days* on your active speed profile.

• *Receipt / Invoice #:* {invoice_no}
• *Active Package:* {package}
• *Amount Paid:* {amount}
• *Payment Method:* {payment_method}
• *Remaining Balance:* {remaining_balance}
• *Valid Until (+31 Days):* {expiry_date}

Thank you for staying connected with *{company_name}*!
Support Helpline: {helpline}`,
  },
  {
    key: 'AGENT_PAYMENT_RECEIPT',
    index: 7,
    title: '7. Agent Cash Collection Confirmation (Recovery Agent)',
    shortTitle: 'Agent Cash Confirmation',
    recipientLabel: 'Recovery Agent',
    category: 'BILLING',
    eventTypes: ['AGENT_PAYMENT_RECEIPT'],
    description: 'Sent simultaneously to the collecting Recovery Agent confirming subscriber payment and updated cash ledger balance.',
    defaultBody: `*{company_name} — Agent Collection Confirmed*

Dear *{agent_name}*,
Your payment collection has been recorded in the billing ledger.

• *Subscriber:* {client_name} ({username})
• *Invoice #:* {invoice_no}
• *Amount Collected:* {amount}
• *Payment Mode:* {payment_method}
• *Updated Cash-in-Hand Balance:* {agent_balance}

— *{company_name}* Accounts Desk`,
  },
  {
    key: 'COMPLAINT_CREATED_CLIENT',
    index: 8,
    title: '8. New Complaint Confirmation (Client)',
    shortTitle: 'Complaint Created (Client)',
    recipientLabel: 'Client',
    category: 'COMPLAINTS',
    eventTypes: ['COMPLAINT_CREATED_CLIENT'],
    description: 'Sent automatically to the client when a new support/fault complaint ticket is logged.',
    defaultBody: `*{company_name} — Support Ticket Registered*

Dear *{client_name}* ({username}),
We have received your complaint and assigned our technical support team to resolve it promptly.

• *Ticket ID:* {ticket_id}
• *Issue Reported:* {issue}
• *Area / Node:* {area}

We will notify you as soon as your connection is restored.
— *{company_name}*
Support Helpline: {helpline}`,
  },
  {
    key: 'COMPLAINT_CREATED_GROUP',
    index: 9,
    title: '9. New Complaint Dispatch Alert (Team Work Group)',
    shortTitle: 'Complaint Alert (Team Group)',
    recipientLabel: 'Team WhatsApp Work Group',
    category: 'COMPLAINTS',
    eventTypes: ['COMPLAINT_CREATED_GROUP'],
    description: 'Sent automatically to your configured Team WhatsApp Work Group with full subscriber details for immediate field dispatch.',
    defaultBody: `🚨 *NEW COMPLAINT DISPATCH — {ticket_id}*

• *Client Name:* {client_name}
• *PPPoE Username:* {username}
• *Coverage Area / Node:* {area}
• *Phone Number:* {phone}
• *Address:* {address}
• *Assigned Tech:* {agent_name}
• *Issue Details:* {issue}

Please attend urgently and mark Solved in the Field Portal once fixed.
— *{company_name}* NOC`,
  },
  {
    key: 'COMPLAINT_RESOLVED_CLIENT',
    index: 10,
    title: '10. Complaint Resolved Notice (Client)',
    shortTitle: 'Complaint Solved (Client)',
    recipientLabel: 'Client',
    category: 'COMPLAINTS',
    eventTypes: ['COMPLAINT_RESOLVED_CLIENT'],
    description: 'Sent automatically to the client when their complaint ticket is marked Solved / Resolved.',
    defaultBody: `*{company_name} — Complaint Resolved ✅*

Dear *{client_name}* ({username}),
Your support complaint has been marked *RESOLVED* by our technical team.

• *Ticket ID:* {ticket_id}
• *Issue:* {issue}
• *Resolved By:* {agent_name}

If you still experience any issue, please reply or call our support helpline.
— *{company_name}*
Support Helpline: {helpline}`,
  },
];

export const DEFAULT_TEMPLATE_MAP: Record<EditableWhatsAppTemplateKey, string> =
  DEFAULT_WHATSAPP_TEMPLATES.reduce((acc, def) => {
    acc[def.key] = def.defaultBody;
    return acc;
  }, {} as Record<EditableWhatsAppTemplateKey, string>);

export function mapEventTypeToTemplateKey(
  eventType: WhatsAppEventType | string
): EditableWhatsAppTemplateKey | null {
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

export interface TemplateRenderValues {
  client_name?: string | null;
  username?: string | null;
  password?: string | null;
  package?: string | null;
  amount?: string | number | null;
  due_date?: string | null;
  grace_date?: string | null;
  expiry_date?: string | null;
  ticket_id?: string | null;
  issue?: string | null;
  agent_name?: string | null;
  company_name?: string | null;
  helpline?: string | null;
  invoice_no?: string | null;
  area?: string | null;
  phone?: string | null;
  address?: string | null;
  agent_balance?: string | number | null;
  payment_method?: string | null;
  remaining_balance?: string | number | null;
  portal_url?: string | null;
}

function formatMoneyValue(val?: string | number | null): string {
  if (val === undefined || val === null || val === '') return 'Rs. 0';
  if (typeof val === 'number') {
    return `Rs. ${Math.round(val).toLocaleString()}`;
  }
  const s = String(val).trim();
  if (!s) return 'Rs. 0';
  if (/^rs\.?/i.test(s)) return s;
  const num = Number(s.replace(/,/g, ''));
  return Number.isFinite(num) ? `Rs. ${Math.round(num).toLocaleString()}` : s;
}

/**
 * Safely renders `{placeholder}` tokens without eval or dynamic RegExp compilation.
 */
export function renderWhatsAppTemplate(
  templateText: string,
  values: TemplateRenderValues
): string {
  const lookup: Record<string, string> = {
    client_name: String(values.client_name || values.username || 'Valued Subscriber').trim(),
    username: String(values.username || 'N/A').trim(),
    password: String(values.password || 'As configured').trim(),
    package: String(values.package || 'Fiber Broadband').trim(),
    amount: formatMoneyValue(values.amount),
    due_date: String(values.due_date || values.expiry_date || 'N/A').trim(),
    grace_date: String(values.grace_date || 'N/A').trim(),
    expiry_date: String(values.expiry_date || values.due_date || 'N/A').trim(),
    ticket_id: String(values.ticket_id || 'TKT-NEW').trim(),
    issue: String(values.issue || 'Connectivity / Service Support').trim(),
    agent_name: String(values.agent_name || 'Field Support Team').trim(),
    company_name: String(values.company_name || 'Youth Net Service').trim(),
    helpline: String(values.helpline || '+923234193599').trim(),
    invoice_no: String(values.invoice_no || 'N/A').trim(),
    area: String(values.area || 'Main Service Area').trim(),
    phone: String(values.phone || 'N/A').trim(),
    address: String(values.address || 'On file').trim(),
    agent_balance: formatMoneyValue(values.agent_balance),
    payment_method: String(values.payment_method || 'Cash').trim(),
    remaining_balance: formatMoneyValue(values.remaining_balance),
    portal_url: String(values.portal_url || '').trim() || 'Portal Login',
  };

  return String(templateText || '').replace(/\{([a-z_]+)\}/gi, (match, rawKey) => {
    const k = String(rawKey || '').toLowerCase();
    return k in lookup ? lookup[k] : match;
  });
}

export function getSampleTemplateValues(overrides?: Partial<TemplateRenderValues>): TemplateRenderValues {
  return {
    client_name: 'Bilal Ahmed',
    username: 'bilal_fiber',
    password: 'Yn@4821',
    package: '20Mbps-Fiber',
    amount: 2500,
    due_date: '2026-11-28',
    grace_date: '2026-12-01',
    expiry_date: '2026-12-26',
    ticket_id: 'TKT-8842',
    issue: 'LOS Red Light on ONT Router',
    agent_name: 'Kamran Ali',
    company_name: 'Youth Net Service',
    helpline: '+923234193599',
    invoice_no: 'INV-202611-4821',
    area: 'Saddar Node',
    phone: '+923001234567',
    address: 'House 14, Street 3, Saddar',
    agent_balance: 14500,
    payment_method: 'Cash Handover',
    remaining_balance: 0,
    portal_url: 'https://portal.youthtechnology.pk',
    ...(overrides || {}),
  };
}

function getScopedStorageKey(baseKey: string, portalUserId?: string | null): string {
  return portalUserId ? `${baseKey}:${portalUserId}` : baseKey;
}

export function getCachedWhatsAppTemplates(
  portalUserId?: string | null
): Record<EditableWhatsAppTemplateKey, string> {
  const merged: Record<EditableWhatsAppTemplateKey, string> = { ...DEFAULT_TEMPLATE_MAP };
  if (typeof window === 'undefined') return merged;

  const keysToRead = [WHATSAPP_TEMPLATES_STORAGE_KEY];
  if (portalUserId) keysToRead.push(getScopedStorageKey(WHATSAPP_TEMPLATES_STORAGE_KEY, portalUserId));

  for (const storageKey of keysToRead) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const def of DEFAULT_WHATSAPP_TEMPLATES) {
          if (typeof parsed[def.key] === 'string' && parsed[def.key].trim()) {
            merged[def.key] = parsed[def.key];
          }
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return merged;
}

export async function loadPersistedWhatsAppTemplates(
  portalUserId?: string | null
): Promise<Record<EditableWhatsAppTemplateKey, string>> {
  const merged = getCachedWhatsAppTemplates(portalUserId);
  try {
    const keys = [WHATSAPP_TEMPLATES_SETTINGS_KEY];
    if (portalUserId) {
      keys.push(`${WHATSAPP_TEMPLATES_SETTINGS_KEY}:${portalUserId}`);
    }
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', keys);

    if (!error && Array.isArray(data)) {
      // Apply global first, then tenant-specific override
      const globalRow = data.find((r: any) => r.key === WHATSAPP_TEMPLATES_SETTINGS_KEY);
      const scopedRow = portalUserId
        ? data.find((r: any) => r.key === `${WHATSAPP_TEMPLATES_SETTINGS_KEY}:${portalUserId}`)
        : null;

      for (const row of [globalRow, scopedRow]) {
        if (!row?.value) continue;
        try {
          const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          if (parsed && typeof parsed === 'object') {
            for (const def of DEFAULT_WHATSAPP_TEMPLATES) {
              if (typeof parsed[def.key] === 'string' && parsed[def.key].trim()) {
                merged[def.key] = parsed[def.key];
              }
            }
          }
        } catch {
          // ignore malformed JSON
        }
      }

      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            getScopedStorageKey(WHATSAPP_TEMPLATES_STORAGE_KEY, portalUserId),
            JSON.stringify(merged)
          );
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // Graceful fallback to localStorage + defaults
  }
  return merged;
}

export async function savePersistedWhatsAppTemplates(
  templates: Partial<Record<EditableWhatsAppTemplateKey, string>>,
  portalUserId?: string | null,
  isMasterAdmin = false
): Promise<{ ok: boolean; savedToSupabase: boolean; templates: Record<EditableWhatsAppTemplateKey, string> }> {
  const current = getCachedWhatsAppTemplates(portalUserId);
  const next: Record<EditableWhatsAppTemplateKey, string> = { ...current };
  for (const def of DEFAULT_WHATSAPP_TEMPLATES) {
    const val = templates[def.key];
    if (typeof val === 'string' && val.trim()) {
      next[def.key] = val.slice(0, 3000);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(next);
      window.localStorage.setItem(
        getScopedStorageKey(WHATSAPP_TEMPLATES_STORAGE_KEY, portalUserId),
        serialized
      );
      if (isMasterAdmin || !portalUserId) {
        window.localStorage.setItem(WHATSAPP_TEMPLATES_STORAGE_KEY, serialized);
      }
    } catch {
      // ignore storage errors
    }
  }

  let savedToSupabase = false;
  try {
    const rows: Array<{ key: string; value: string; updated_at: string }> = [];
    const nowIso = new Date().toISOString();
    const serialized = JSON.stringify(next);
    if (isMasterAdmin || !portalUserId) {
      rows.push({ key: WHATSAPP_TEMPLATES_SETTINGS_KEY, value: serialized, updated_at: nowIso });
    }
    if (portalUserId) {
      rows.push({
        key: `${WHATSAPP_TEMPLATES_SETTINGS_KEY}:${portalUserId}`,
        value: serialized,
        updated_at: nowIso,
      });
    }
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    if (!error) savedToSupabase = true;
  } catch {
    // fallback already saved in localStorage
  }

  return { ok: true, savedToSupabase, templates: next };
}

export function getCachedTeamWorkGroupConfig(portalUserId?: string | null): TeamWorkGroupConfig {
  const empty: TeamWorkGroupConfig = { groupJid: '', groupName: '', inviteLink: '' };
  if (typeof window === 'undefined') return empty;

  const keysToRead = [WHATSAPP_TEAM_GROUP_STORAGE_KEY];
  if (portalUserId) keysToRead.push(getScopedStorageKey(WHATSAPP_TEAM_GROUP_STORAGE_KEY, portalUserId));

  let result = { ...empty };
  for (const storageKey of keysToRead) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        result = {
          groupJid: String(parsed.groupJid || result.groupJid || '').trim(),
          groupName: String(parsed.groupName || result.groupName || '').trim(),
          inviteLink: String(parsed.inviteLink || result.inviteLink || '').trim(),
        };
      }
    } catch {
      // ignore
    }
  }
  return result;
}

export async function loadPersistedTeamWorkGroupConfig(
  portalUserId?: string | null
): Promise<TeamWorkGroupConfig> {
  let result = getCachedTeamWorkGroupConfig(portalUserId);
  try {
    const keys = [WHATSAPP_TEAM_GROUP_SETTINGS_KEY];
    if (portalUserId) keys.push(`${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:${portalUserId}`);
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', keys);

    if (!error && Array.isArray(data)) {
      const globalRow = data.find((r: any) => r.key === WHATSAPP_TEAM_GROUP_SETTINGS_KEY);
      const scopedRow = portalUserId
        ? data.find((r: any) => r.key === `${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:${portalUserId}`)
        : null;

      for (const row of [globalRow, scopedRow]) {
        if (!row?.value) continue;
        try {
          const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          if (parsed && typeof parsed === 'object') {
            result = {
              groupJid: String(parsed.groupJid || result.groupJid || '').trim(),
              groupName: String(parsed.groupName || result.groupName || '').trim(),
              inviteLink: String(parsed.inviteLink || result.inviteLink || '').trim(),
            };
          }
        } catch {
          // ignore
        }
      }

      if (typeof window !== 'undefined' && (result.groupJid || result.groupName)) {
        try {
          window.localStorage.setItem(
            getScopedStorageKey(WHATSAPP_TEAM_GROUP_STORAGE_KEY, portalUserId),
            JSON.stringify(result)
          );
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return result;
}

export async function savePersistedTeamWorkGroupConfig(
  config: TeamWorkGroupConfig,
  portalUserId?: string | null,
  isMasterAdmin = false
): Promise<{ ok: boolean; savedToSupabase: boolean; config: TeamWorkGroupConfig }> {
  const clean: TeamWorkGroupConfig = {
    groupJid: String(config.groupJid || '').trim().slice(0, 120),
    groupName: String(config.groupName || '').trim().slice(0, 140),
    inviteLink: String(config.inviteLink || '').trim().slice(0, 260),
  };

  if (typeof window !== 'undefined') {
    try {
      const serialized = JSON.stringify(clean);
      window.localStorage.setItem(
        getScopedStorageKey(WHATSAPP_TEAM_GROUP_STORAGE_KEY, portalUserId),
        serialized
      );
      if (isMasterAdmin || !portalUserId) {
        window.localStorage.setItem(WHATSAPP_TEAM_GROUP_STORAGE_KEY, serialized);
      }
    } catch {
      // ignore
    }
  }

  let savedToSupabase = false;
  try {
    const rows: Array<{ key: string; value: string; updated_at: string }> = [];
    const nowIso = new Date().toISOString();
    const serialized = JSON.stringify(clean);
    if (isMasterAdmin || !portalUserId) {
      rows.push({ key: WHATSAPP_TEAM_GROUP_SETTINGS_KEY, value: serialized, updated_at: nowIso });
    }
    if (portalUserId) {
      rows.push({
        key: `${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:${portalUserId}`,
        value: serialized,
        updated_at: nowIso,
      });
    }
    const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
    if (!error) savedToSupabase = true;
  } catch {
    // localStorage fallback already persisted
  }

  return { ok: true, savedToSupabase, config: clean };
}
