import fs from 'fs';
import path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as baileys from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import type {
  SupabasePaymentAccount,
  SupabasePortalUser,
  SupabaseWhatsappLog,
  WhatsAppEventType,
} from '../services/supabaseClient';
import {
  buildAutomatedWhatsAppMessage,
  DEFAULT_MASTER_COMPANY_NAME,
  formatWhatsAppJid,
  resolveWhatsAppSender,
  type AutomatedMessageTemplateVars,
  type SubscriberOwnershipRef,
} from '../lib/whatsappRouting';

const makeWASocket: any =
  (baileys as any).default?.default ??
  (baileys as any).default ??
  (baileys as any).makeWASocket;
const useMultiFileAuthState: any = (baileys as any).useMultiFileAuthState;
const DisconnectReason: any = (baileys as any).DisconnectReason ?? { loggedOut: 401 };
const fetchLatestBaileysVersion: any = (baileys as any).fetchLatestBaileysVersion;
const Browsers: any = (baileys as any).Browsers;

const BAILEYS_AUTH_ROOT = path.resolve(process.cwd(), 'baileys_auth');
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export type BaileysSessionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';

export interface SessionRuntimeState {
  portalUserId: string;
  sessionKey: string;
  status: BaileysSessionStatus;
  qrDataUrl: string | null;
  phone: string | null;
  lastError: string | null;
  updatedAt: string;
  reconnectAttempts: number;
}

export function sanitizePortalUserIdForSession(rawId: string): string | null {
  const clean = String(rawId || '').trim();
  if (!clean || !SESSION_ID_PATTERN.test(clean)) return null;
  return clean;
}

export function resolveSafeBaileysAuthDir(portalUserId: string): string {
  const safeId = sanitizePortalUserIdForSession(portalUserId);
  if (!safeId) {
    throw new Error('Invalid session identifier.');
  }
  const dirName = `session_${safeId}`;
  const resolvedRoot = path.resolve(BAILEYS_AUTH_ROOT);
  const resolvedTarget = path.resolve(resolvedRoot, dirName);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error('Unsafe session path rejected.');
  }
  return resolvedTarget;
}

function formatConnectedPhoneFromJid(jid?: string | null): string | null {
  if (!jid) return null;
  const base = String(jid).split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  if (!base) return null;
  return `+${base}`;
}

function getTodayYmdUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

class MultiTenantBaileysManager {
  private sessions = new Map<string, any>();
  private sessionMeta = new Map<string, SessionRuntimeState>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private inMemoryLogs: SupabaseWhatsappLog[] = [];
  private sentPreExpiryToday = new Set<string>();
  private preExpirySweepTimer: ReturnType<typeof setInterval> | null = null;
  private isSweepingPreExpiry = false;

  private ensureRootDir(): void {
    if (!fs.existsSync(BAILEYS_AUTH_ROOT)) {
      fs.mkdirSync(BAILEYS_AUTH_ROOT, { recursive: true });
    }
  }

  public getSessionKey(portalUserId: string): string {
    const safeId = sanitizePortalUserIdForSession(portalUserId);
    if (!safeId) throw new Error('Invalid session identifier.');
    return `session_${safeId}`;
  }

  public getSessionState(portalUserId: string): SessionRuntimeState {
    const safeId = sanitizePortalUserIdForSession(portalUserId);
    if (!safeId) {
      return {
        portalUserId: '',
        sessionKey: '',
        status: 'DISCONNECTED',
        qrDataUrl: null,
        phone: null,
        lastError: 'Invalid session ID',
        updatedAt: new Date().toISOString(),
        reconnectAttempts: 0,
      };
    }
    const existing = this.sessionMeta.get(safeId);
    if (existing) return { ...existing };
    return {
      portalUserId: safeId,
      sessionKey: `session_${safeId}`,
      status: 'DISCONNECTED',
      qrDataUrl: null,
      phone: null,
      lastError: null,
      updatedAt: new Date().toISOString(),
      reconnectAttempts: 0,
    };
  }

  public getConnectedPortalUserIds(): Set<string> {
    const connected = new Set<string>();
    for (const [uid, meta] of this.sessionMeta.entries()) {
      if (meta.status === 'CONNECTED' && this.sessions.has(meta.sessionKey)) {
        connected.add(uid);
      }
    }
    return connected;
  }

  public listActiveSessions(): SessionRuntimeState[] {
    return Array.from(this.sessionMeta.values()).map((m) => ({ ...m }));
  }

  private setSessionState(portalUserId: string, patch: Partial<SessionRuntimeState>): SessionRuntimeState {
    const prev = this.getSessionState(portalUserId);
    const next: SessionRuntimeState = {
      ...prev,
      ...patch,
      portalUserId,
      sessionKey: `session_${portalUserId}`,
      updatedAt: new Date().toISOString(),
    };
    this.sessionMeta.set(portalUserId, next);
    return next;
  }

  private async updatePortalUserWhatsAppColumns(
    supabase: SupabaseClient | null,
    portalUserId: string,
    patch: Record<string, any>
  ): Promise<void> {
    if (!supabase || !portalUserId) return;
    const working = { ...patch };
    for (let attempt = 0; attempt < 6; attempt++) {
      if (Object.keys(working).length === 0) return;
      const { error } = await supabase
        .from('portal_users')
        .update(working)
        .eq('id', portalUserId);
      if (!error) return;
      const msg = String(error.message || '');
      const colMatch =
        msg.match(/Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i) ||
        msg.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+/i);
      if (colMatch?.[1] && colMatch[1] in working) {
        delete working[colMatch[1]];
        continue;
      }
      return;
    }
  }

  private clearReconnectTimer(portalUserId: string): void {
    const t = this.reconnectTimers.get(portalUserId);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(portalUserId);
    }
  }

  private closeSocketSilently(sessionKey: string): void {
    const sock = this.sessions.get(sessionKey);
    if (!sock) return;
    this.sessions.delete(sessionKey);
    try {
      sock.ev?.removeAllListeners?.('connection.update');
      sock.ev?.removeAllListeners?.('creds.update');
      sock.ws?.close?.();
      sock.end?.(undefined);
    } catch {
      // ignore socket teardown errors
    }
  }

  public async startSession(
    portalUserId: string,
    supabase: SupabaseClient | null
  ): Promise<SessionRuntimeState> {
    const safeId = sanitizePortalUserIdForSession(portalUserId);
    if (!safeId) {
      throw new Error('Invalid portal_user ID for WhatsApp session.');
    }

    this.ensureRootDir();
    this.clearReconnectTimer(safeId);

    const sessionKey = `session_${safeId}`;
    const existingMeta = this.sessionMeta.get(safeId);
    if (existingMeta?.status === 'CONNECTED' && this.sessions.has(sessionKey)) {
      return { ...existingMeta };
    }

    this.closeSocketSilently(sessionKey);

    const authDir = resolveSafeBaileysAuthDir(safeId);
    fs.mkdirSync(authDir, { recursive: true });

    this.setSessionState(safeId, {
      status: 'CONNECTING',
      qrDataUrl: null,
      lastError: null,
    });

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      let version: [number, number, number] = [2, 3000, 1015901307];
      try {
        const fetched = await fetchLatestBaileysVersion();
        if (Array.isArray(fetched?.version) && fetched.version.length === 3) {
          version = fetched.version;
        }
      } catch {
        // Fallback version tuple is safe if upstream WA version check fails
      }

      const silentLogger = pino({ level: 'silent' });
      const sock = makeWASocket({
        version,
        auth: state,
        logger: silentLogger,
        printQRInTerminal: false,
        browser: Browsers?.ubuntu ? Browsers.ubuntu('YouthNet Gateway') : ['YouthNet Gateway', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 25_000,
        defaultQueryTimeoutMs: 25_000,
      });

      this.sessions.set(sessionKey, sock);

      sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch {
          // ignore transient creds write error
        }
      });

      sock.ev.on('connection.update', async (update: any) => {
        // Ignore events from superseded sockets
        if (this.sessions.get(sessionKey) !== sock) return;

        const { connection, lastDisconnect, qr } = update || {};

        if (qr) {
          try {
            const qrDataUrl = await QRCode.toDataURL(qr, {
              width: 280,
              margin: 2,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
            this.setSessionState(safeId, {
              status: 'QR_READY',
              qrDataUrl,
              lastError: null,
            });
            await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
              whatsapp_status: 'QR_READY',
            });
          } catch (qrErr: any) {
            this.setSessionState(safeId, {
              lastError: qrErr?.message || 'Failed to render QR code',
            });
          }
        }

        if (connection === 'open') {
          const phone = formatConnectedPhoneFromJid(sock.user?.id);
          this.setSessionState(safeId, {
            status: 'CONNECTED',
            qrDataUrl: null,
            phone,
            lastError: null,
            reconnectAttempts: 0,
          });
          await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
            whatsapp_status: 'CONNECTED',
            whatsapp_phone: phone,
          });
          console.log(`[Baileys] Session ${sessionKey} CONNECTED (${phone || 'unknown phone'})`);
        }

        if (connection === 'close') {
          const statusCode =
            lastDisconnect?.error?.output?.statusCode ??
            lastDisconnect?.error?.statusCode ??
            0;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
          const errMsg = lastDisconnect?.error?.message || `Closed (code ${statusCode || 'unknown'})`;

          this.sessions.delete(sessionKey);

          if (isLoggedOut) {
            try {
              const dir = resolveSafeBaileysAuthDir(safeId);
              if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
              }
            } catch {
              // ignore cleanup errors
            }
            this.setSessionState(safeId, {
              status: 'DISCONNECTED',
              qrDataUrl: null,
              phone: null,
              lastError: 'WhatsApp session logged out from device. Scan QR to reconnect.',
              reconnectAttempts: 0,
            });
            await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
              whatsapp_status: 'DISCONNECTED',
              whatsapp_phone: null,
            });
          } else {
            const currentMeta = this.getSessionState(safeId);
            const attempts = (currentMeta.reconnectAttempts || 0) + 1;
            const hasCreds = fs.existsSync(path.join(authDir, 'creds.json'));

            if (attempts <= 5 && hasCreds) {
              const delayMs = Math.min(25_000, attempts * 3500);
              this.setSessionState(safeId, {
                status: 'CONNECTING',
                qrDataUrl: null,
                lastError: `Reconnecting (${attempts}/5): ${errMsg}`,
                reconnectAttempts: attempts,
              });
              this.clearReconnectTimer(safeId);
              const timer = setTimeout(() => {
                this.reconnectTimers.delete(safeId);
                this.startSession(safeId, supabase).catch(() => {});
              }, delayMs);
              this.reconnectTimers.set(safeId, timer);
            } else {
              this.setSessionState(safeId, {
                status: 'DISCONNECTED',
                qrDataUrl: null,
                lastError: errMsg,
                reconnectAttempts: 0,
              });
              await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
                whatsapp_status: 'DISCONNECTED',
              });
            }
          }
        }
      });

      // Wait briefly (up to 3.5s) for either QR_READY or immediate CONNECTED so first API response carries QR immediately
      const waitUntil = Date.now() + 3500;
      while (Date.now() < waitUntil) {
        const cur = this.getSessionState(safeId);
        if (cur.status === 'QR_READY' || cur.status === 'CONNECTED' || cur.status === 'DISCONNECTED') {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      return this.getSessionState(safeId);
    } catch (err: any) {
      this.setSessionState(safeId, {
        status: 'DISCONNECTED',
        qrDataUrl: null,
        lastError: err?.message || 'Failed to start Baileys WhatsApp session',
      });
      return this.getSessionState(safeId);
    }
  }

  public async logoutSession(
    portalUserId: string,
    supabase: SupabaseClient | null
  ): Promise<SessionRuntimeState> {
    const safeId = sanitizePortalUserIdForSession(portalUserId);
    if (!safeId) {
      throw new Error('Invalid portal_user ID for WhatsApp logout.');
    }

    this.clearReconnectTimer(safeId);
    const sessionKey = `session_${safeId}`;
    const sock = this.sessions.get(sessionKey);

    if (sock) {
      try {
        await Promise.race([
          sock.logout?.(),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch {
        // ignore logout error if already closed
      }
      this.closeSocketSilently(sessionKey);
    }

    try {
      const authDir = resolveSafeBaileysAuthDir(safeId);
      if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } catch {
      // ignore fs cleanup error
    }

    const nextState = this.setSessionState(safeId, {
      status: 'DISCONNECTED',
      qrDataUrl: null,
      phone: null,
      lastError: null,
      reconnectAttempts: 0,
    });

    await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
      whatsapp_status: 'DISCONNECTED',
      whatsapp_phone: null,
    });

    return nextState;
  }

  public async restorePersistedSessions(supabase: SupabaseClient | null): Promise<void> {
    this.ensureRootDir();
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(BAILEYS_AUTH_ROOT, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('session_')) continue;
      const rawId = entry.name.slice('session_'.length);
      const safeId = sanitizePortalUserIdForSession(rawId);
      if (!safeId) continue;

      const credsPath = path.join(resolveSafeBaileysAuthDir(safeId), 'creds.json');
      if (!fs.existsSync(credsPath)) continue;

      console.log(`[Baileys] Auto-restoring persisted WhatsApp session_${safeId}...`);
      this.startSession(safeId, supabase).catch((err) => {
        console.warn(`[Baileys] Auto-restore failed for session_${safeId}:`, err?.message);
      });
    }
  }

  private async persistWhatsappLog(
    supabase: SupabaseClient | null,
    entry: Omit<SupabaseWhatsappLog, 'id' | 'created_at'>
  ): Promise<SupabaseWhatsappLog> {
    const localRecord: SupabaseWhatsappLog = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...entry,
      created_at: new Date().toISOString(),
    };

    this.inMemoryLogs.unshift(localRecord);
    if (this.inMemoryLogs.length > 250) {
      this.inMemoryLogs.length = 250;
    }

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('whatsapp_logs')
          .insert([entry])
          .select('*')
          .maybeSingle();
        if (!error && data) {
          return data as SupabaseWhatsappLog;
        }
      } catch {
        // Table might not be migrated yet; in-memory ring buffer preserves delivery logs
      }
    }

    return localRecord;
  }

  private async hasAlreadySentPreExpiryToday(
    supabase: SupabaseClient | null,
    username: string
  ): Promise<boolean> {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return false;
    const today = getTodayYmdUtc();
    const key = `${clean}::${today}`;
    if (this.sentPreExpiryToday.has(key)) return true;

    if (supabase) {
      try {
        const todayStart = `${today}T00:00:00.000Z`;
        const { data, error } = await supabase
          .from('whatsapp_logs')
          .select('id')
          .eq('event_type', 'PRE_EXPIRY_3D')
          .eq('status', 'SENT')
          .ilike('subscriber_username', clean)
          .gte('created_at', todayStart)
          .limit(1);
        if (!error && Array.isArray(data) && data.length > 0) {
          this.sentPreExpiryToday.add(key);
          return true;
        }
      } catch {
        // ignore if whatsapp_logs doesn't exist yet
      }
    }
    return false;
  }

  public async sendAutomatedMessage(params: {
    supabase: SupabaseClient | null;
    subscriber?: SubscriberOwnershipRef | null;
    subscriberUsername?: string | null;
    eventType: WhatsAppEventType;
    messageVars?: Partial<AutomatedMessageTemplateVars> & { phone?: string | null };
    forceSenderPortalUserId?: string | null;
  }): Promise<{
    ok: boolean;
    status: 'SENT' | 'FAILED' | 'SKIPPED';
    senderCompanyName: string;
    senderPhone: string | null;
    senderPortalUserId: string | null;
    error?: string;
    skippedReason?: string;
    log?: SupabaseWhatsappLog;
  }> {
    const { supabase, eventType } = params;

    // 1. Load portal_users + active payment_accounts for routing & branding
    let allPortalUsers: SupabasePortalUser[] = [];
    let paymentAccounts: SupabasePaymentAccount[] = [];

    if (supabase) {
      const [usersRes, accountsRes] = await Promise.all([
        supabase.from('portal_users').select('*'),
        supabase.from('payment_accounts').select('*').eq('is_active', true),
      ]);
      if (!usersRes.error && Array.isArray(usersRes.data)) {
        allPortalUsers = usersRes.data as SupabasePortalUser[];
      }
      if (!accountsRes.error && Array.isArray(accountsRes.data)) {
        paymentAccounts = accountsRes.data as SupabasePaymentAccount[];
      }
    }

    // 2. Resolve full subscriber row
    const cleanSubUsername = String(
      params.subscriberUsername ||
        params.subscriber?.username ||
        params.messageVars?.username ||
        ''
    )
      .trim()
      .toLowerCase();

    let resolvedSubscriber: SubscriberOwnershipRef | null = params.subscriber
      ? { ...params.subscriber }
      : null;

    if (cleanSubUsername && allPortalUsers.length > 0) {
      const matchedSub = allPortalUsers.find(
        (u) => String(u.username || '').trim().toLowerCase() === cleanSubUsername
      );
      if (matchedSub) {
        resolvedSubscriber = {
          ...matchedSub,
          ...resolvedSubscriber,
          id: matchedSub.id,
          username: matchedSub.username,
          full_name: resolvedSubscriber?.full_name || matchedSub.full_name,
          phone: resolvedSubscriber?.phone || matchedSub.phone,
          dealer_id: resolvedSubscriber?.dealer_id ?? matchedSub.dealer_id ?? null,
          sub_dealer_id: resolvedSubscriber?.sub_dealer_id ?? matchedSub.sub_dealer_id ?? null,
        };
      }
    }

    // 3. Duplicate same-day protection for 3-day pre-expiry reminders
    if (eventType === 'PRE_EXPIRY_3D' && cleanSubUsername) {
      const alreadySent = await this.hasAlreadySentPreExpiryToday(supabase, cleanSubUsername);
      if (alreadySent) {
        return {
          ok: true,
          status: 'SKIPPED',
          senderCompanyName: DEFAULT_MASTER_COMPANY_NAME,
          senderPhone: null,
          senderPortalUserId: null,
          skippedReason: `Pre-expiry reminder already sent today for @${cleanSubUsername}`,
        };
      }
    }

    // 4. Resolve hierarchical WhatsApp sender (Sub-Dealer -> Dealer -> Master Admin)
    const connectedIds = this.getConnectedPortalUserIds();

    let senderResolution = resolveWhatsAppSender(
      resolvedSubscriber,
      allPortalUsers,
      connectedIds
    );

    if (params.forceSenderPortalUserId) {
      const forcedUser = allPortalUsers.find(
        (u) => String(u.id) === String(params.forceSenderPortalUserId)
      );
      const forcedId = String(params.forceSenderPortalUserId);
      const forcedMeta = this.getSessionState(forcedId);
      const forcedTier =
        String(forcedUser?.tier_level || forcedUser?.role || '').toUpperCase() === 'SUB_DEALER'
          ? 'SUB_DEALER'
          : String(forcedUser?.tier_level || forcedUser?.role || '').toUpperCase() === 'DEALER'
          ? 'DEALER'
          : 'ADMIN';
      senderResolution = {
        senderUser: forcedUser || null,
        senderPortalUserId: forcedId,
        senderTier: forcedTier,
        companyName:
          String(forcedUser?.company_name || '').trim() ||
          (forcedTier === 'ADMIN'
            ? DEFAULT_MASTER_COMPANY_NAME
            : forcedUser?.full_name || DEFAULT_MASTER_COMPANY_NAME),
        supportPhone: String(
          forcedUser?.whatsapp_support_phone ||
            forcedMeta.phone ||
            forcedUser?.phone ||
            ''
        ).trim(),
        senderPhone: forcedMeta.phone || forcedUser?.whatsapp_phone || null,
        isConnected: connectedIds.has(forcedId),
        autoSendEnabled: forcedUser ? forcedUser.whatsapp_auto_send !== false : true,
        resolutionNote: 'Direct test send from active session',
      };
    }

    const recipientPhoneRaw = String(
      params.messageVars?.phone || resolvedSubscriber?.phone || ''
    ).trim();
    const jid = formatWhatsAppJid(recipientPhoneRaw);

    const messageBody = buildAutomatedWhatsAppMessage({
      eventType,
      companyName: senderResolution.companyName,
      supportPhone: senderResolution.supportPhone,
      subscriberName:
        params.messageVars?.subscriberName ||
        resolvedSubscriber?.full_name ||
        cleanSubUsername ||
        'Subscriber',
      username: cleanSubUsername || params.messageVars?.username || '',
      password: params.messageVars?.password,
      packageName: params.messageVars?.packageName,
      monthlyFee: params.messageVars?.monthlyFee,
      amountDue: params.messageVars?.amountDue,
      amountPaid: params.messageVars?.amountPaid,
      totalAmount: params.messageVars?.totalAmount,
      remainingBalance: params.messageVars?.remainingBalance,
      dueDate: params.messageVars?.dueDate,
      expiryDate: params.messageVars?.expiryDate,
      daysRemaining: params.messageVars?.daysRemaining,
      invoiceNo: params.messageVars?.invoiceNo,
      paymentMethod: params.messageVars?.paymentMethod,
      paymentAccounts:
        params.messageVars?.paymentAccounts?.length
          ? params.messageVars.paymentAccounts
          : paymentAccounts,
      customNote: params.messageVars?.customNote,
    });

    const baseLog = {
      sender_portal_user_id: senderResolution.senderPortalUserId,
      sender_company_name: senderResolution.companyName,
      sender_phone: senderResolution.senderPhone,
      sender_tier: senderResolution.senderTier,
      subscriber_id: resolvedSubscriber?.id ? String(resolvedSubscriber.id) : null,
      subscriber_username: cleanSubUsername || null,
      recipient_phone: recipientPhoneRaw || 'MISSING_PHONE',
      dealer_id: resolvedSubscriber?.dealer_id ? String(resolvedSubscriber.dealer_id) : null,
      sub_dealer_id: resolvedSubscriber?.sub_dealer_id
        ? String(resolvedSubscriber.sub_dealer_id)
        : null,
      event_type: eventType,
      message_body: messageBody,
    };

    // Respect sender's Auto-Send master toggle (except explicit manual test)
    if (eventType !== 'MANUAL_TEST' && !senderResolution.autoSendEnabled) {
      const log = await this.persistWhatsappLog(supabase, {
        ...baseLog,
        status: 'SKIPPED',
        error_message: `Auto-Send is turned OFF for ${senderResolution.companyName}`,
      });
      return {
        ok: true,
        status: 'SKIPPED',
        senderCompanyName: senderResolution.companyName,
        senderPhone: senderResolution.senderPhone,
        senderPortalUserId: senderResolution.senderPortalUserId,
        skippedReason: log.error_message || undefined,
        log,
      };
    }

    if (!jid) {
      const errMsg = `Invalid or missing recipient phone number ("${recipientPhoneRaw || 'empty'}")`;
      const log = await this.persistWhatsappLog(supabase, {
        ...baseLog,
        status: 'FAILED',
        error_message: errMsg,
      });
      return {
        ok: false,
        status: 'FAILED',
        senderCompanyName: senderResolution.companyName,
        senderPhone: senderResolution.senderPhone,
        senderPortalUserId: senderResolution.senderPortalUserId,
        error: errMsg,
        log,
      };
    }

    const senderKey = senderResolution.senderPortalUserId
      ? `session_${senderResolution.senderPortalUserId}`
      : null;
    const sock = senderKey ? this.sessions.get(senderKey) : null;

    if (!sock || !senderResolution.isConnected) {
      const errMsg =
        'No connected WhatsApp session available (pair Master Admin, Dealer, or Sub-Dealer WhatsApp via QR in WhatsApp & Branding).';
      const log = await this.persistWhatsappLog(supabase, {
        ...baseLog,
        status: 'FAILED',
        error_message: errMsg,
      });
      return {
        ok: false,
        status: 'FAILED',
        senderCompanyName: senderResolution.companyName,
        senderPhone: senderResolution.senderPhone,
        senderPortalUserId: senderResolution.senderPortalUserId,
        error: errMsg,
        log,
      };
    }

    try {
      await sock.sendMessage(jid, { text: messageBody });

      if (eventType === 'PRE_EXPIRY_3D' && cleanSubUsername) {
        this.sentPreExpiryToday.add(`${cleanSubUsername}::${getTodayYmdUtc()}`);
      }

      const log = await this.persistWhatsappLog(supabase, {
        ...baseLog,
        status: 'SENT',
        error_message: null,
      });

      return {
        ok: true,
        status: 'SENT',
        senderCompanyName: senderResolution.companyName,
        senderPhone: senderResolution.senderPhone,
        senderPortalUserId: senderResolution.senderPortalUserId,
        log,
      };
    } catch (sendErr: any) {
      const errMsg = sendErr?.message || 'Baileys sendMessage failed';
      const log = await this.persistWhatsappLog(supabase, {
        ...baseLog,
        status: 'FAILED',
        error_message: errMsg,
      });
      return {
        ok: false,
        status: 'FAILED',
        senderCompanyName: senderResolution.companyName,
        senderPhone: senderResolution.senderPhone,
        senderPortalUserId: senderResolution.senderPortalUserId,
        error: errMsg,
        log,
      };
    }
  }

  public async fetchScopedLogs(
    supabase: SupabaseClient | null,
    scope: {
      isIsolated: boolean;
      tier: 'DEALER' | 'SUB_DEALER' | null;
      portalUserId: string | null;
      allowedResellerIds: Set<string> | null;
      allowedSubscriberUsernames: Set<string> | null;
    },
    limit = 150
  ): Promise<{ logs: SupabaseWhatsappLog[]; tableMissing: boolean }> {
    let rows: SupabaseWhatsappLog[] = [];
    let tableMissing = false;

    if (supabase) {
      const { data, error } = await supabase
        .from('whatsapp_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Math.min(Math.max(10, limit), 300));

      if (error) {
        const code = String(error.code || '').toUpperCase();
        const msg = String(error.message || '').toLowerCase();
        if (
          code === '42P01' ||
          code === 'PGRST205' ||
          msg.includes('could not find the table') ||
          msg.includes('does not exist')
        ) {
          tableMissing = true;
        }
        rows = [...this.inMemoryLogs];
      } else {
        rows = (data || []) as SupabaseWhatsappLog[];
      }
    } else {
      rows = [...this.inMemoryLogs];
    }

    if (!scope.isIsolated || !scope.portalUserId) {
      return { logs: rows.slice(0, limit), tableMissing };
    }

    const uid = String(scope.portalUserId);
    const filtered = rows.filter((r) => {
      if (r.sender_portal_user_id && String(r.sender_portal_user_id) === uid) return true;
      const uname = String(r.subscriber_username || '').trim().toLowerCase();

      if (scope.tier === 'SUB_DEALER') {
        if (r.sub_dealer_id && String(r.sub_dealer_id) === uid) return true;
        if (uname && scope.allowedSubscriberUsernames?.has(uname)) return true;
        return false;
      }

      if (scope.tier === 'DEALER') {
        if (r.dealer_id && String(r.dealer_id) === uid) return true;
        if (r.sub_dealer_id && scope.allowedResellerIds?.has(String(r.sub_dealer_id))) return true;
        if (r.sender_portal_user_id && scope.allowedResellerIds?.has(String(r.sender_portal_user_id))) {
          return true;
        }
        if (uname && scope.allowedSubscriberUsernames?.has(uname)) return true;
        return false;
      }

      return false;
    });

    return { logs: filtered.slice(0, limit), tableMissing };
  }

  /**
   * Daily / Periodic 3-Day Pre-Expiry Automated Reminder Sweep:
   * Scans active subscribers expiring within 0-3 days with unpaid dues and automatically
   * dispatches PRE_EXPIRY_3D via the hierarchical Baileys sender without sending same-day duplicates.
   */
  public async runDailyPreExpiryAutoReminders(
    supabase: SupabaseClient | null,
    allowedSubscriberUsernames?: Set<string> | null
  ): Promise<{
    scanned: number;
    sent: number;
    skipped: number;
    failed: number;
  }> {
    if (!supabase || this.isSweepingPreExpiry) {
      return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    }
    if (this.getConnectedPortalUserIds().size === 0) {
      return { scanned: 0, sent: 0, skipped: 0, failed: 0 };
    }

    this.isSweepingPreExpiry = true;
    try {
      const [{ data: clients }, { data: invoices }] = await Promise.all([
        supabase.from('portal_users').select('*').eq('role', 'CLIENT'),
        supabase.from('invoices').select('*').neq('status', 'PAID'),
      ]);

      const unpaidByUser = new Map<string, { totalDue: number; earliestDueDate: string | null }>();
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
      let scanned = 0;
      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const sub of (clients || []) as SupabasePortalUser[]) {
        const acct = String(sub.account_status || 'ACTIVE').toUpperCase();
        if (acct === 'SUSPENDED' || acct === 'EXPIRED' || acct === 'DELETED') continue;
        const uname = String(sub.username || '').trim().toLowerCase();
        if (!uname || !sub.phone) continue;
        if (allowedSubscriberUsernames && !allowedSubscriberUsernames.has(uname)) continue;

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
        const daysRemaining = Math.max(0, Math.ceil(diffMs / 86_400_000));
        const res = await this.sendAutomatedMessage({
          supabase,
          subscriber: sub,
          subscriberUsername: uname,
          eventType: 'PRE_EXPIRY_3D',
          messageVars: {
            subscriberName: sub.full_name,
            username: uname,
            phone: sub.phone,
            packageName: sub.package_profile_name || sub.package_speed || 'Fiber Broadband',
            amountDue,
            expiryDate: String(dueDateRaw).slice(0, 10),
            daysRemaining,
          },
        });

        if (res.status === 'SENT') sent++;
        else if (res.status === 'SKIPPED') skipped++;
        else failed++;
      }

      return { scanned, sent, skipped, failed };
    } finally {
      this.isSweepingPreExpiry = false;
    }
  }

  public startPreExpiryScheduler(supabase: SupabaseClient | null): void {
    if (this.preExpirySweepTimer) return;
    // Run every 60 minutes (same-day dedupe ensures each subscriber gets at most 1 reminder per day)
    this.preExpirySweepTimer = setInterval(() => {
      this.runDailyPreExpiryAutoReminders(supabase).catch(() => {});
    }, 60 * 60 * 1000);
  }
}

export const baileysManager = new MultiTenantBaileysManager();
