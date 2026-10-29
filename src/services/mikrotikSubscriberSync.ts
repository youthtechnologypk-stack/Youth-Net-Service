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
}

/**
 * Intelligent comment parser for MikroTik RouterOS PPPoE secrets
 * Handles formats like:
 * - "Asad Ullah Khan | +92 300 1234567 | Sector G-11"
 * - "Tariq Mehmood - 03019876543"
 * - "Apex Digital Corp | 03215551234"
 * - "+92 300 1234567"
 * - "YouthNet-App"
 */
export function parseMikrotikComment(comment?: string, username?: string): { fullName: string; phone: string } {
  if (!comment || comment.trim() === '' || comment.trim() === 'YouthNet-App') {
    const formatted = (username || '')
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { fullName: formatted || username || 'Subscriber', phone: '+92 ' };
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
