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
 * Formats a Date object for RouterOS v7 scheduler:
 * - Target Date Format: "mmm/dd/yyyy" (e.g. "nov/02/2026")
 * - Target Time Format: "HH:MM:SS" (e.g. "14:30:00")
 */
export function formatRouterOSSchedule(dateObj: Date): {
  startDate: string;
  startTime: string;
  isoString: string;
  readable: string;
} {
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mmm = months[dateObj.getMonth()];
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const yyyy = dateObj.getFullYear();
  const HH = String(dateObj.getHours()).padStart(2, '0');
  const MM = String(dateObj.getMinutes()).padStart(2, '0');
  const SS = String(dateObj.getSeconds()).padStart(2, '0');

  const startDate = `${mmm}/${dd}/${yyyy}`;
  const startTime = `${HH}:${MM}:${SS}`;
  const readable = `${yyyy}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${dd} ${startTime}`;

  return {
    startDate,
    startTime,
    isoString: dateObj.toISOString(),
    readable,
  };
}

/**
 * Accurately calculates remaining time countdown or expired restricted state
 */
export function calculateRemainingTime(expiryDateInput?: string | Date): {
  isExpired: boolean;
  statusLabel: string;
  remainingText: string;
  badgeClass: string;
} {
  if (!expiryDateInput) {
    return {
      isExpired: false,
      statusLabel: 'Active',
      remainingText: 'No Expiry Set',
      badgeClass: 'bg-emerald-950 text-emerald-300 border border-emerald-800',
    };
  }

  const exp = typeof expiryDateInput === 'string' ? new Date(expiryDateInput) : expiryDateInput;
  if (isNaN(exp.getTime())) {
    return {
      isExpired: false,
      statusLabel: 'Active',
      remainingText: 'Active',
      badgeClass: 'bg-emerald-950 text-emerald-300 border border-emerald-800',
    };
  }

  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();

  if (diffMs <= 0) {
    return {
      isExpired: true,
      statusLabel: 'EXPIRED / RESTRICTED',
      remainingText: 'Expired',
      badgeClass: 'bg-rose-950 text-rose-300 border border-rose-800 font-bold',
    };
  }

  const totalSecs = Math.floor(diffMs / 1000);
  const totalMins = Math.floor(totalSecs / 60);
  const totalHours = Math.floor(totalMins / 60);
  const totalDays = Math.floor(totalHours / 24);

  let remainingText = '';
  if (totalDays > 0) {
    const remHours = totalHours % 24;
    remainingText = remHours > 0 ? `${totalDays}d ${remHours}h remaining` : `${totalDays} days remaining`;
  } else if (totalHours > 0) {
    const remMins = totalMins % 60;
    remainingText = remMins > 0 ? `${totalHours}h ${remMins}m remaining` : `${totalHours}h remaining`;
  } else if (totalMins > 0) {
    remainingText = `${totalMins}m remaining`;
  } else {
    remainingText = `${totalSecs}s remaining`;
  }

  return {
    isExpired: false,
    statusLabel: remainingText,
    remainingText,
    badgeClass:
      totalHours < 6
        ? 'bg-amber-950 text-amber-300 border border-amber-800'
        : 'bg-emerald-950 text-emerald-300 border border-emerald-800',
  };
}

/**
 * Calculates days remaining and expiration status based on expiry date string
 */
export function calculateExpirationMetrics(expiryDateStr?: string): {
  daysRemaining: number;
  isExpired: boolean;
  statusLabel: string;
  remainingText: string;
  badgeClass: string;
} {
  const timeInfo = calculateRemainingTime(expiryDateStr);
  const exp = expiryDateStr ? new Date(expiryDateStr) : null;
  const now = new Date();
  let diffDays = 30;
  if (exp && !isNaN(exp.getTime())) {
    diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }
  return {
    daysRemaining: diffDays,
    isExpired: timeInfo.isExpired,
    statusLabel: timeInfo.statusLabel,
    remainingText: timeInfo.remainingText,
    badgeClass: timeInfo.badgeClass,
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
  name?: string;
  phone: string;
  address?: string;
  cnic?: string;
  ponPort?: string;
  feederLine?: string;
  createdDate?: string;
  expiryDate?: string;
  validityDays?: number;
  validityLabel?: string;
  expiredPool?: string;
  plan?: string;
} {
  if (!comment || comment.trim() === '' || comment.trim() === 'YouthNet-App') {
    const formatted = (username || '')
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return { fullName: formatted || username || 'Subscriber', name: formatted || username || 'Subscriber', phone: '+92 ' };
  }

  const trimmed = comment.trim();

  // 1. JSON Structured Metadata parsing (RouterOS comment JSON)
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      const formattedName =
        obj.name ||
        obj.fullName ||
        (username || '')
          .replace(/[._-]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          .trim();
      return {
        fullName: formattedName || 'Subscriber',
        name: formattedName || 'Subscriber',
        phone: obj.phone || '+92 ',
        address: obj.address,
        cnic: obj.cnic,
        ponPort: obj.ponPort,
        feederLine: obj.feederLine,
        createdDate: obj.created || obj.createdDate,
        expiryDate: obj.expires || obj.expiryDate,
        validityDays: obj.days || obj.validityDays ? Number(obj.days || obj.validityDays) : undefined,
        validityLabel: obj.validityLabel,
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
