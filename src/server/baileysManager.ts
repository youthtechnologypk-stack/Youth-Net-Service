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
  formatWhatsAppGroupJid,
  formatWhatsAppJid,
  resolveWhatsAppSender,
  type AutomatedMessageTemplateVars,
  type SubscriberOwnershipRef,
} from '../lib/whatsappRouting';
import {
  WHATSAPP_TEAM_GROUP_SETTINGS_KEY,
  WHATSAPP_TEMPLATES_SETTINGS_KEY,
  type EditableWhatsAppTemplateKey,
  type TeamWorkGroupConfig,
} from '../lib/whatsappTemplates';

const makeWASocket: any =
  (baileys as any).default?.default ??
  (baileys as any).default ??
  (baileys as any).makeWASocket;
const useMultiFileAuthState: any = (baileys as any).useMultiFileAuthState;
const DisconnectReason: any = (baileys as any).DisconnectReason ?? {
  loggedOut: 401,
  restartRequired: 515,
};
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
  private sentGraceNoticeCycles = new Set<string>();
  private settingsCache: {
    loadedAt: number;
    globalTemplates: Partial<Record<EditableWhatsAppTemplateKey, string>>;
    scopedTemplates: Map<string, Partial<Record<EditableWhatsAppTemplateKey, string>>>;
    globalTeamGroup: TeamWorkGroupConfig | null;
    scopedTeamGroups: Map<string, TeamWorkGroupConfig>;
  } = {
    loadedAt: 0,
    globalTemplates: {},
    scopedTemplates: new Map(),
    globalTeamGroup: null,
    scopedTeamGroups: new Map(),
  };
  private preExpirySweepTimer: ReturnType<typeof setInterval> | null = null;
  private isSweepingPreExpiry = false;

  public invalidateSettingsCache(): void {
    this.settingsCache.loadedAt = 0;
  }

  private async loadSettingsFromSupabase(supabase: SupabaseClient | null): Promise<void> {
    if (!supabase) return;
    if (Date.now() - this.settingsCache.loadedAt < 30_000) return;
    try {
      const [appRes, sysRes] = await Promise.all([
        supabase
          .from('app_settings')
          .select('key, value')
          .or(`key.like.${WHATSAPP_TEMPLATES_SETTINGS_KEY}%,key.like.${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}%`),
        supabase.from('system_settings').select('id, config').eq('id', 'global').maybeSingle(),
      ]);

      const globalTemplates: Partial<Record<EditableWhatsAppTemplateKey, string>> = {};
      const scopedTemplates = new Map<string, Partial<Record<EditableWhatsAppTemplateKey, string>>>();
      let globalTeamGroup: TeamWorkGroupConfig | null = null;
      const scopedTeamGroups = new Map<string, TeamWorkGroupConfig>();

      // Hydrate fallback Team Work Group from system_settings.config
      if (!sysRes.error && sysRes.data?.config && typeof sysRes.data.config === 'object') {
        const cfg = sysRes.data.config as Record<string, any>;
        const sysJid = String(
          cfg.team_work_group_jid || cfg.teamWhatsAppGroupJid || cfg.team_whatsapp_group_jid || ''
        ).trim();
        const sysName = String(
          cfg.team_work_group_name || cfg.teamWhatsAppGroupName || cfg.team_whatsapp_group_name || ''
        ).trim();
        if (sysJid) {
          globalTeamGroup = { groupJid: sysJid, groupName: sysName, inviteLink: '' };
        }
      }

      if (!appRes.error && Array.isArray(appRes.data)) {
        for (const row of appRes.data as Array<{ key?: string; value?: string }>) {
          const key = String(row.key || '').trim();
          if (!key || !row.value) continue;
          let parsed: any = null;
          try {
            parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
          } catch {
            continue;
          }
          if (!parsed || typeof parsed !== 'object') continue;

          if (key === WHATSAPP_TEMPLATES_SETTINGS_KEY) {
            Object.assign(globalTemplates, parsed);
          } else if (key.startsWith(`${WHATSAPP_TEMPLATES_SETTINGS_KEY}:`)) {
            const uid = key.slice(`${WHATSAPP_TEMPLATES_SETTINGS_KEY}:`.length);
            if (uid) scopedTemplates.set(uid, parsed);
          } else if (key === WHATSAPP_TEAM_GROUP_SETTINGS_KEY) {
            const jid = String(parsed.groupJid || '').trim();
            if (jid || !globalTeamGroup) {
              globalTeamGroup = {
                groupJid: jid,
                groupName: String(parsed.groupName || '').trim(),
                inviteLink: String(parsed.inviteLink || '').trim(),
              };
            }
          } else if (key.startsWith(`${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:`)) {
            const uid = key.slice(`${WHATSAPP_TEAM_GROUP_SETTINGS_KEY}:`.length);
            if (uid) {
              scopedTeamGroups.set(uid, {
                groupJid: String(parsed.groupJid || '').trim(),
                groupName: String(parsed.groupName || '').trim(),
                inviteLink: String(parsed.inviteLink || '').trim(),
              });
            }
          }
        }
      }

      this.settingsCache = {
        loadedAt: Date.now(),
        globalTemplates,
        scopedTemplates,
        globalTeamGroup,
        scopedTeamGroups,
      };
    } catch {
      this.settingsCache.loadedAt = Date.now();
    }
  }

  public async getTemplatesForUser(
    supabase: SupabaseClient | null,
    portalUserId?: string | null
  ): Promise<Partial<Record<EditableWhatsAppTemplateKey, string>>> {
    await this.loadSettingsFromSupabase(supabase);
    const scoped = portalUserId ? this.settingsCache.scopedTemplates.get(String(portalUserId)) : undefined;
    return {
      ...this.settingsCache.globalTemplates,
      ...(scoped || {}),
    };
  }

  public async getTeamGroupForUser(
    supabase: SupabaseClient | null,
    portalUserId?: string | null
  ): Promise<TeamWorkGroupConfig | null> {
    await this.loadSettingsFromSupabase(supabase);
    if (portalUserId) {
      const scoped = this.settingsCache.scopedTeamGroups.get(String(portalUserId));
      if (scoped && (scoped.groupJid || scoped.groupName)) return scoped;
    }
    return this.settingsCache.globalTeamGroup;
  }

  public async fetchConnectedGroups(
    portalUserId: string
  ): Promise<{
    ok: boolean;
    groups: Array<{ id: string; subject: string; participantsCount: number }>;
    error?: string;
  }> {
    const safeId = sanitizePortalUserIdForSession(portalUserId);
    if (!safeId) {
      return { ok: false, groups: [], error: 'Invalid session ID.' };
    }
    const sessionKey = `session_${safeId}`;
    const sock = this.sessions.get(sessionKey);
    const meta = this.sessionMeta.get(safeId);
    if (!sock || meta?.status !== 'CONNECTED') {
      return {
        ok: false,
        groups: [],
        error: 'WhatsApp session is not connected. Pair your WhatsApp via QR first to fetch groups.',
      };
    }
    try {
      const participating = await sock.groupFetchAllParticipating();
      const list = Object.values(participating || {})
        .map((g: any) => ({
          id: String(g?.id || '').trim(),
          subject: String(g?.subject || 'Unnamed Group').trim(),
          participantsCount: Array.isArray(g?.participants) ? g.participants.length : 0,
        }))
        .filter((g) => Boolean(formatWhatsAppGroupJid(g.id)))
        .sort((a, b) => a.subject.localeCompare(b.subject));
      return { ok: true, groups: list };
    } catch (err: any) {
      return {
        ok: false,
        groups: [],
        error: err?.message || 'Failed to fetch WhatsApp groups from connected session.',
      };
    }
  }

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
        browser: Browsers?.macOS ? Browsers.macOS('Desktop') : ['YouthNet Gateway', 'Chrome', '124.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 30_000,
        defaultQueryTimeoutMs: 30_000,
        keepAliveIntervalMs: 25_000,
      });

      this.sessions.set(sessionKey, sock);

      let pendingCredsSave = Promise.resolve();
      sock.ev.on('creds.update', () => {
        pendingCredsSave = pendingCredsSave
          .catch(() => {})
          .then(() => saveCreds())
          .catch(() => {
            // ignore transient creds write error
          });
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
          const isRestartRequired =
            statusCode === DisconnectReason.restartRequired || statusCode === 515;
          const errMsg = lastDisconnect?.error?.message || `Closed (code ${statusCode || 'unknown'})`;

          this.sessions.delete(sessionKey);

          // ONLY clear session files when statusCode === DisconnectReason.loggedOut (401)
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
              lastError: 'WhatsApp session logged out from device (401). Scan QR to reconnect.',
              reconnectAttempts: 0,
            });
            await this.updatePortalUserWhatsAppColumns(supabase, safeId, {
              whatsapp_status: 'DISCONNECTED',
              whatsapp_phone: null,
            });
          } else if (isRestartRequired) {
            // QR scan handoff (515): NEVER delete authDir / creds.json; flush creds & reconnect within 1 second
            try {
              await pendingCredsSave;
            } catch {
              // ignore
            }
            const currentMeta = this.getSessionState(safeId);
            const attempts = (currentMeta.reconnectAttempts || 0) + 1;

            if (attempts <= 6) {
              this.setSessionState(safeId, {
                status: 'CONNECTING',
                qrDataUrl: null,
                lastError: null,
                reconnectAttempts: attempts,
              });
              this.clearReconnectTimer(safeId);
              console.log(
                `[Baileys] Restart required (515) for ${sessionKey} (attempt ${attempts}/6) — reconnecting in 800ms with saved credentials...`
              );
              const timer = setTimeout(() => {
                this.reconnectTimers.delete(safeId);
                this.startSession(safeId, supabase).catch(() => {});
              }, 800);
              this.reconnectTimers.set(safeId, timer);
            } else {
              this.setSessionState(safeId, {
                status: 'DISCONNECTED',
                qrDataUrl: null,
                lastError: 'WhatsApp stream restart limit reached (515). Click Generate QR to reconnect.',
                reconnectAttempts: 0,
              });
            }
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

  private async hasAlreadySentGraceNotice(
    supabase: SupabaseClient | null,
    username: string,
    graceCycleTag: string
  ): Promise<boolean> {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return false;
    const key = `${clean}::${graceCycleTag}`;
    if (this.sentGraceNoticeCycles.has(key)) return true;

    if (supabase) {
      try {
        const sinceIso = new Date(Date.now() - 4 * 86_400_000).toISOString();
        const { data, error } = await supabase
          .from('whatsapp_logs')
          .select('id')
          .eq('event_type', 'GRACE_PERIOD_3D')
          .eq('status', 'SENT')
          .ilike('subscriber_username', clean)
          .gte('created_at', sinceIso)
          .limit(1);
        if (!error && Array.isArray(data) && data.length > 0) {
          this.sentGraceNoticeCycles.add(key);
          return true;
        }
      } catch {
        // ignore if whatsapp_logs table not ready
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
    to?: string | null;
    groupJid?: string | null;
    customMessage?: string | null;
    forceSenderPortalUserId?: string | null;
    manualTrigger?: boolean;
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

    // 3. Duplicate protection for automated 3-day pre-expiry & 3-day grace notices (bypassed on explicit manual clicks)
    if (eventType === 'PRE_EXPIRY_3D' && cleanSubUsername && !params.manualTrigger) {
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

    if (eventType === 'GRACE_PERIOD_3D' && cleanSubUsername && !params.manualTrigger) {
      const graceTag = String(params.messageVars?.graceDate || params.messageVars?.dueDate || getTodayYmdUtc()).slice(0, 10);
      const alreadySent = await this.hasAlreadySentGraceNotice(supabase, cleanSubUsername, graceTag);
      if (alreadySent) {
        return {
          ok: true,
          status: 'SKIPPED',
          senderCompanyName: DEFAULT_MASTER_COMPANY_NAME,
          senderPhone: null,
          senderPortalUserId: null,
          skippedReason: `3-day grace notice already sent for @${cleanSubUsername} (${graceTag})`,
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
        resolutionNote: 'Direct send from active session',
      };
    }

    // Load saved custom templates & team group config for resolved sender
    const [customTemplates, teamGroupConfig] = await Promise.all([
      this.getTemplatesForUser(supabase, senderResolution.senderPortalUserId),
      eventType === 'COMPLAINT_CREATED_GROUP'
        ? this.getTeamGroupForUser(supabase, senderResolution.senderPortalUserId)
        : Promise.resolve(null),
    ]);

    const recipientPhoneRaw = String(
      params.messageVars?.phone || resolvedSubscriber?.phone || ''
    ).trim();
    const explicitTarget = String(params.to || params.groupJid || '').trim();
    const explicitTargetIsGroup = Boolean(formatWhatsAppGroupJid(explicitTarget));

    let jid: string | null = null;
    let loggedRecipient = recipientPhoneRaw || 'MISSING_PHONE';

    if (explicitTargetIsGroup || params.groupJid || eventType === 'COMPLAINT_CREATED_GROUP') {
      const candidateGroupJid = explicitTargetIsGroup
        ? explicitTarget
        : params.groupJid || teamGroupConfig?.groupJid || '';
      jid = formatWhatsAppGroupJid(candidateGroupJid);
      loggedRecipient = jid
        ? teamGroupConfig?.groupName && teamGroupConfig?.groupJid?.toLowerCase() === jid
          ? `${teamGroupConfig.groupName} (${jid})`
          : jid
        : candidateGroupJid || 'UNCONFIGURED_TEAM_GROUP';
    } else if (explicitTarget) {
      jid = formatWhatsAppJid(explicitTarget);
      loggedRecipient = jid || explicitTarget;
    } else {
      jid = formatWhatsAppJid(recipientPhoneRaw);
      loggedRecipient = jid || recipientPhoneRaw || 'MISSING_PHONE';
    }

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
      portalUrl: params.messageVars?.portalUrl,
      accountRole: params.messageVars?.accountRole,
      packageName: params.messageVars?.packageName,
      monthlyFee: params.messageVars?.monthlyFee,
      amountDue: params.messageVars?.amountDue,
      amountPaid: params.messageVars?.amountPaid,
      totalAmount: params.messageVars?.totalAmount,
      remainingBalance: params.messageVars?.remainingBalance,
      dueDate: params.messageVars?.dueDate,
      graceDate: params.messageVars?.graceDate,
      expiryDate: params.messageVars?.expiryDate,
      daysRemaining: params.messageVars?.daysRemaining,
      invoiceNo: params.messageVars?.invoiceNo,
      paymentMethod: params.messageVars?.paymentMethod,
      ticketId: params.messageVars?.ticketId,
      issue: params.messageVars?.issue,
      agentName: params.messageVars?.agentName,
      agentBalance: params.messageVars?.agentBalance,
      area: params.messageVars?.area,
      address: params.messageVars?.address,
      phone: recipientPhoneRaw,
      paymentAccounts:
        params.messageVars?.paymentAccounts?.length
          ? params.messageVars.paymentAccounts
          : paymentAccounts,
      customNote: params.messageVars?.customNote,
      customMessage: params.customMessage || params.messageVars?.customMessage,
      customTemplates,
    });

    const loggedMessageBody =
      eventType === 'PORTAL_CREDENTIALS' || eventType === 'PROVISION_WELCOME'
        ? messageBody.replace(/(\*(?:PPPoE\s+)?Password:\*\s*)(.+)/gi, '$1••••••••')
        : messageBody;

    const baseLog = {
      sender_portal_user_id: senderResolution.senderPortalUserId,
      sender_company_name: senderResolution.companyName,
      sender_phone: senderResolution.senderPhone,
      sender_tier: senderResolution.senderTier,
      subscriber_id: resolvedSubscriber?.id ? String(resolvedSubscriber.id) : null,
      subscriber_username: cleanSubUsername || null,
      recipient_phone: loggedRecipient,
      dealer_id: resolvedSubscriber?.dealer_id ? String(resolvedSubscriber.dealer_id) : null,
      sub_dealer_id: resolvedSubscriber?.sub_dealer_id
        ? String(resolvedSubscriber.sub_dealer_id)
        : null,
      event_type: eventType,
      message_body: loggedMessageBody,
    };

    // Respect sender's Auto-Send master toggle (except explicit manual clicks, manual test, custom broadcast, or credential dispatch)
    if (
      !params.manualTrigger &&
      eventType !== 'MANUAL_TEST' &&
      eventType !== 'CUSTOM_MESSAGE' &&
      eventType !== 'PORTAL_CREDENTIALS' &&
      !senderResolution.autoSendEnabled
    ) {
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
      const errMsg =
        eventType === 'COMPLAINT_CREATED_GROUP' || params.groupJid
          ? 'Team WhatsApp Work Group JID is not configured. Select your Team Group in WhatsApp & Branding.'
          : `Invalid or missing recipient phone number ("${recipientPhoneRaw || 'empty'}")`;
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
      if (eventType === 'GRACE_PERIOD_3D' && cleanSubUsername) {
        const graceTag = String(params.messageVars?.graceDate || params.messageVars?.dueDate || getTodayYmdUtc()).slice(0, 10);
        this.sentGraceNoticeCycles.add(`${cleanSubUsername}::${graceTag}`);
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
   * Hourly / Manual 5-Day Pre-Expiry Auto-Billing & Automated WhatsApp Invoice Delivery:
   * Scans active subscribers whose expiry_date is <= 5 days away with no open DUE invoice,
   * generates their monthly DUE invoice (`due_date = subscriber.expiry_date`) in Supabase,
   * and immediately delivers it via the hierarchical Baileys sender.
   */
  public async runDailyPreExpiryAutoReminders(
    supabase: SupabaseClient | null,
    allowedSubscriberUsernames?: Set<string> | null
  ): Promise<{
    scanned: number;
    invoicesGenerated: number;
    sent: number;
    whatsappSent: number;
    skipped: number;
    skippedExisting: number;
    failed: number;
    totalBilled: number;
  }> {
    if (!supabase || this.isSweepingPreExpiry) {
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

    this.isSweepingPreExpiry = true;
    try {
      const { runFiveDayPreExpiryAutoBilling } = await import('./expirySweepEngine');
      const result = await runFiveDayPreExpiryAutoBilling({
        supabaseClient: supabase,
        allowedSubscriberUsernames,
        daysBeforeExpiry: 5,
      });
      return {
        scanned: result.scanned,
        invoicesGenerated: result.invoicesGenerated,
        sent: result.whatsappSent,
        whatsappSent: result.whatsappSent,
        skipped: result.skippedExisting,
        skippedExisting: result.skippedExisting,
        failed: result.failed,
        totalBilled: result.totalBilled,
      };
    } finally {
      this.isSweepingPreExpiry = false;
    }
  }

  public startPreExpiryScheduler(supabase: SupabaseClient | null): void {
    if (this.preExpirySweepTimer) return;
    // Run every 60 minutes to auto-generate & auto-deliver monthly DUE invoices 5 days before expiry
    this.preExpirySweepTimer = setInterval(() => {
      this.runDailyPreExpiryAutoReminders(supabase).catch(() => {});
    }, 60 * 60 * 1000);
  }
}

export const baileysManager = new MultiTenantBaileysManager();
