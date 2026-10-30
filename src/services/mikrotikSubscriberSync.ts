import { MikrotikRouter } from '../types/isp';
import { fetchMikrotikLiveTelemetry, fetchMikrotikPppSecrets } from './mikrotikRestClient';

export interface RealMikrotikSubscriber {
  id: string;
  username: string;       // Primary Text: Subscriber PPPoE Username (e.g., user.name or user.user)
  address?: string;       // Secondary Badge: Assigned IP (e.g., user.address or user['remote-address'])
  callerId?: string;      // Caller ID / MAC: user['caller-id'] or user.mac
  profile?: string;       // Profile: user.profile
  comment?: string;       // user.comment
  phone?: string;         // Parsed phone number
  fullName?: string;      // Parsed subscriber name
  isActiveNow?: boolean;  // Whether currently in /ppp/active
  uptime?: string;        // Live uptime if connected
  service?: string;       // Service type (pppoe)
  createdDate?: string;   // YYYY-MM-DD
  expiryDate?: string;    // YYYY-MM-DD
  validityDays?: number;  // e.g. 30
  expiredPool?: string;   // e.g. EXPIRED-POOL or 16.16.16.0/24
  daysRemaining?: number; // Days until expiration (negative if expired)
  isExpired?: boolean;    // true if today > expiryDate
}

/**
 * Calculates days remaining and expiration status based on expiry date string
 */
export function calculateExpirationMetrics(expiryDateStr?: string): {
  daysRemaining: number;
  isExpired: boolean;
  statusLabel: string;
} {
  if (!expiryDateStr) {
    return { daysRemaining: 30, isExpired: false, statusLabel: 'Active' };
  }
  const exp = new Date(expiryDateStr);
  if (isNaN(exp.getTime())) {
    return { daysRemaining: 30, isExpired: false, statusLabel: 'Active' };
  }
  const now = new Date();
  const expMid = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate()).getTime();
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.ceil((expMid - nowMid) / (1000 * 60 * 60 * 24));
  const isExpired = diffDays <= 0;
  return {
    daysRemaining: diffDays,
    isExpired,
    statusLabel: isExpired ? 'Expired' : `${diffDays} days left`,
  };
}

/**
 * Intelligent comment parser for MikroTik RouterOS PPPoE secrets
 * Handles formats like:
 * - JSON: '{"created":"2026-10-30","expires":"2026-11-29","plan":"10M","phone":"+923001234567","name":"Asad"}'
 * - "Asad Ullah Khan | +92 300 1234567 | Sector G-11"
 * - "Tariq Mehmood - 03019876543"
 * - "Apex Digital Corp | 03215551234"
 * - "+92 300 1234567"
 * - "YouthNet-App"
 */
export function parseMikrotikComment(comment?: string, username?: string): {
  fullName: string;
  phone: string;
  createdDate?: string;
  expiryDate?: string;
  validityDays?: number;
  expiredPool?: string;
  plan?: string;
} {
  if (!comment || comment.trim() === '' || comment.trim() === 'YouthNet-App') {
    const formatted = (username || '')
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { fullName: formatted || username || 'Subscriber', phone: '+92 ' };
  }

  const trimmed = comment.trim();

  // 1. JSON Structured Metadata parsing (RouterOS comment JSON)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      const formattedName =
        obj.name ||
        (username || '')
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim();
      return {
        fullName: formattedName || 'Subscriber',
        phone: obj.phone || '+92 ',
        createdDate: obj.created || obj.createdDate,
        expiryDate: obj.expires || obj.expiryDate,
        validityDays: obj.days || obj.validityDays ? Number(obj.days || obj.validityDays) : undefined,
        expiredPool: obj.expiredPool || obj.pool,
        plan: obj.plan,
      };
    } catch {
      // Fall through to regular text parser
    }
  }

  let extractedName = '';
  let extractedPhone = '';

  // 1. Pipe separated: "Name | Phone | Address/Notes"
  if (comment.includes('|')) {
    const parts = comment.split('|').map((p) => p.trim());
    if (parts[0] && parts[0] !== 'YouthNet-App' && !/^(\+?\d[\d\s-]{7,})$/.test(parts[0])) {
      extractedName = parts[0];
    }
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (/(\+?92|0)?3\d{2}[-.\s]?\d{7}/.test(part) || /^\+?\d{10,13}$/.test(part.replace(/[\s-]/g, ''))) {
        extractedPhone = part;
        break;
      }
    }
  }

  // 2. Dash or colon separated: "Name - Phone"
  if (!extractedName && (comment.includes('-') || comment.includes(':'))) {
    const parts = comment.split(/[-:]/).map((p) => p.trim());
    if (parts[0] && !/^(\+?\d[\d\s-]{7,})$/.test(parts[0]) && parts[0] !== 'YouthNet-App') {
      extractedName = parts[0];
    }
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (/(\+?92|0)?3\d{2}[-.\s]?\d{7}/.test(part) || /^\+?\d{10,13}$/.test(part.replace(/[\s-]/g, ''))) {
        if (!extractedPhone) extractedPhone = part;
      }
    }
  }

  // 3. Fallback phone regex
  if (!extractedPhone) {
    const phoneMatch = comment.match(/(?:\+?92|0)?3\d{2}[-.\s]?\d{7}/) || comment.match(/\+?\d{10,13}/);
    if (phoneMatch) {
      extractedPhone = phoneMatch[0];
    }
  }

  // 4. Fallback name from remaining comment or username
  if (!extractedName) {
    const cleaned = comment
      .replace(/(?:\+?92|0)?3\d{2}[-.\s]?\d{7}/g, '')
      .replace(/\+?\d{10,13}/g, '')
      .replace(/[|:-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned && cleaned !== 'YouthNet-App' && cleaned.length > 2) {
      extractedName = cleaned;
    } else {
      extractedName = (username || '')
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    }
  }

  return {
    fullName: extractedName || username || 'Subscriber',
    phone: extractedPhone || '+92 ',
  };
}

const CACHE_KEY_SUBSCRIBERS = 'netpulse_cached_live_subscribers';

export function getCachedSubscribers(): RealMikrotikSubscriber[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CACHE_KEY_SUBSCRIBERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Fetches real subscribers by querying /api/mikrotik/ppp/active and /api/mikrotik/ppp/secret
 * Combines active sessions and secrets into a unified subscriber list
 */
export async function fetchLiveMikrotikSubscribers(
  targetRouter?: MikrotikRouter | null
): Promise<RealMikrotikSubscriber[]> {
  try {
    const router = targetRouter || {
      ipAddress: '202.142.186.150',
      port: 81,
      apiPort: 81,
      username: 'admin',
      password: '',
    };

    // Concurrently fetch active sessions (/api/mikrotik/ppp/active) and secrets (/api/mikrotik/ppp/secret)
    const [telemetryRes, secretsRes] = await Promise.all([
      fetchMikrotikLiveTelemetry(router, { pollSessions: true, pollTraffic: false }).catch(() => null),
      fetchMikrotikPppSecrets(router).catch(() => null),
    ]);

    const activeList = telemetryRes?.success ? telemetryRes.activeSessions : [];
    const rawSecrets = secretsRes?.success && Array.isArray(secretsRes.secrets) ? secretsRes.secrets : [];

    const map = new Map<string, RealMikrotikSubscriber>();

    // 1. Ingest secrets (all registered PPPoE secrets on the router)
    rawSecrets.forEach((sec: any, idx: number) => {
      const uname = String(sec.name || sec.user || '').trim();
      if (!uname) return;
      const key = uname.toLowerCase();
      const comment = sec.comment || '';
      const parsed = parseMikrotikComment(comment, uname);
      const ip = sec['remote-address'] || sec.remoteAddress || sec.address || '';
      const callerId = sec['caller-id'] || sec.callerId || '';
      const profile = sec.profile || 'default';

      const expMetrics = calculateExpirationMetrics(parsed.expiryDate);

      map.set(key, {
        id: sec['.id'] || sec.id || `sec-${idx}-${key}`,
        username: uname,
        address: ip,
        callerId,
        profile,
        comment,
        phone: parsed.phone,
        fullName: parsed.fullName,
        isActiveNow: false,
        service: sec.service || 'pppoe',
        createdDate: parsed.createdDate,
        expiryDate: parsed.expiryDate,
        validityDays: parsed.validityDays,
        expiredPool: parsed.expiredPool,
        daysRemaining: expMetrics.daysRemaining,
        isExpired: expMetrics.isExpired,
      });
    });

    // 2. Merge active sessions (users currently online on the BRAS)
    activeList.forEach((sess: any, idx: number) => {
      const uname = String(sess.username || sess.name || sess.user || '').trim();
      if (!uname) return;
      const key = uname.toLowerCase();
      const existing = map.get(key);

      const ip = sess.address || sess['remote-address'] || existing?.address || '';
      const callerId = sess.callerId || sess['caller-id'] || existing?.callerId || '';
      const profile = sess.profileName || sess.profile || existing?.profile || 'default';

      if (existing) {
        existing.isActiveNow = true;
        if (ip) existing.address = ip;
        if (callerId) existing.callerId = callerId;
        if (profile) existing.profile = profile;
        if (sess.uptime) existing.uptime = sess.uptime;
      } else {
        const parsed = parseMikrotikComment('', uname);
        map.set(key, {
          id: sess.id || sess['.id'] || `act-${idx}-${key}`,
          username: uname,
          address: ip,
          callerId,
          profile,
          comment: '',
          phone: parsed.phone,
          fullName: parsed.fullName,
          isActiveNow: true,
          uptime: sess.uptime,
          service: sess.service || 'pppoe',
        });
      }
    });

    const result = Array.from(map.values());

    // Sort: Active users first, then alphabetically by username
    result.sort((a, b) => {
      if (a.isActiveNow && !b.isActiveNow) return -1;
      if (!a.isActiveNow && b.isActiveNow) return 1;
      return a.username.localeCompare(b.username);
    });

    if (result.length > 0 && typeof window !== 'undefined') {
      try {
        localStorage.setItem(CACHE_KEY_SUBSCRIBERS, JSON.stringify(result));
      } catch {}
    }

    return result;
  } catch (err) {
    console.warn('Could not fetch live subscribers from MikroTik:', err);
    return getCachedSubscribers();
  }
}
