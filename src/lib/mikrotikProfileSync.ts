/**
 * Single-Source-of-Truth helpers for adopting exact MikroTik RouterOS PPPoE profiles
 * (e.g. "8 MB - Local", "6 MB - Local", "10 MB - TW") and preserving ORIG_PKG:<profile>
 * inside MikroTik secret comments without ever guessing or hardcoding package names.
 */

export function isExpiryOrBlockedProfile(
  profileName?: string | null,
  expiryProfileName?: string | null
): boolean {
  const clean = String(profileName || '').trim().toLowerCase();
  if (!clean) return true;
  const expiryLow = String(expiryProfileName || '').trim().toLowerCase();
  if (expiryLow && clean === expiryLow) return true;
  return (
    clean === 'expire' ||
    clean === 'expired' ||
    clean === 'expired-16-pool' ||
    clean === 'walled-garden' ||
    clean === 'walled_garden' ||
    clean.includes('expire') ||
    clean.includes('16-pool') ||
    clean.includes('16.16') ||
    clean.includes('walled')
  );
}

/**
 * Extracts `ORIG_PKG:<exact_profile>` from a MikroTik `/ppp/secret` comment string,
 * preserving spaces, hyphens, and casing (e.g. `ORIG_PKG:8 MB - Local` -> `8 MB - Local`).
 */
export function extractOrigPkgFromComment(
  comment?: string | null,
  expiryProfileName?: string | null
): string | null {
  const raw = String(comment || '');
  if (!raw) return null;
  const match = raw.match(/ORIG_PKG:\s*([^|\r\n;]+)/i);
  if (!match || !match[1]) return null;
  const extracted = match[1].trim();
  if (!extracted || isExpiryOrBlockedProfile(extracted, expiryProfileName)) {
    return null;
  }
  return extracted;
}

/**
 * Writes or updates `ORIG_PKG:<exact_profile>` inside a MikroTik `/ppp/secret` comment,
 * preserving any existing customer notes before or after it.
 */
export function upsertOrigPkgComment(
  existingComment: string | undefined | null,
  exactProfile: string
): string {
  const cleanProfile = String(exactProfile || '').trim();
  const base = String(existingComment || '').trim();
  if (!cleanProfile) return base;

  const tag = `ORIG_PKG:${cleanProfile}`;
  if (/ORIG_PKG:\s*[^|\r\n;]+/i.test(base)) {
    return base.replace(/ORIG_PKG:\s*[^|\r\n;]+/i, tag).trim();
  }
  return base ? `${base} | ${tag}` : tag;
}

/**
 * Matches a candidate profile string against live RouterOS `/ppp/profile` names so exact
 * RouterOS casing & spacing (e.g. "8 MB - Local") is preserved when available.
 */
export function matchExactMikrotikProfileName(
  candidate?: string | null,
  mikrotikProfiles: string[] = [],
  expiryProfileName?: string | null
): string | null {
  const clean = String(candidate || '').trim();
  if (!clean) return null;
  if (
    clean.toLowerCase() === 'fiber broadband' ||
    clean.toLowerCase() === 'standard' ||
    isExpiryOrBlockedProfile(clean, expiryProfileName)
  ) {
    return null;
  }

  const validRouterProfiles = mikrotikProfiles
    .map((p) => String(p || '').trim())
    .filter((p) => p && !isExpiryOrBlockedProfile(p, expiryProfileName));

  if (validRouterProfiles.length === 0) {
    return clean;
  }

  // 1. Exact match
  const exact = validRouterProfiles.find((p) => p === clean);
  if (exact) return exact;

  // 2. Case-insensitive exact match
  const cleanLower = clean.toLowerCase();
  const ci = validRouterProfiles.find((p) => p.toLowerCase() === cleanLower);
  if (ci) return ci;

  // 3. Normalized alphanumeric match (e.g. "8mb" / "8mb-local" -> "8 MB - Local")
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanNorm = norm(clean);
  if (cleanNorm) {
    const normMatch = validRouterProfiles.find((p) => norm(p) === cleanNorm);
    if (normMatch) return normMatch;
  }

  // 4. Speed-digit match only when candidate looks like a generic speed label (e.g. "8Mbps" or "8 MB")
  const digits = clean.match(/\d+/)?.[0];
  if (digits) {
    const digitMatches = validRouterProfiles.filter((p) => {
      const m = p.match(/\d+/)?.[0];
      return m === digits;
    });
    if (digitMatches.length === 1) {
      return digitMatches[0];
    }
    if (digitMatches.length > 1) {
      // Prefer "- Local" or exact prefix match if multiple profiles share speed digits
      const localMatch = digitMatches.find((p) => p.toLowerCase().includes('local'));
      if (localMatch) return localMatch;
      return digitMatches[0];
    }
  }

  // Preserve original string rather than discarding an unknown valid profile
  return clean;
}

/**
 * Resolves the authoritative exact MikroTik PPPoE profile for a subscriber in strict priority:
 * 1. Live MikroTik secret's active non-expiry profile
 * 2. `ORIG_PKG:<exact_profile>` tag stored in the live MikroTik secret's `comment`
 * 3. `original_package_profile`, `package_name`, `package_profile_name`, or `package_speed` in Supabase
 * 4. Optional fallback to a valid live MikroTik profile (never hardcoding "20Mbps")
 */
export function resolveExactSubscriberProfile(params: {
  liveSecret?: Record<string, any> | null;
  subscriber?: {
    original_package_profile?: string | null;
    package_name?: string | null;
    package_profile_name?: string | null;
    package_speed?: string | null;
  } | null;
  mikrotikProfiles?: string[];
  expiryProfileName?: string | null;
}): string {
  const { liveSecret, subscriber, mikrotikProfiles = [], expiryProfileName } = params;

  // 1. Live non-expiry MikroTik secret profile (Single Source of Truth)
  const secretProfile = String(liveSecret?.profile || '').trim();
  if (secretProfile && !isExpiryOrBlockedProfile(secretProfile, expiryProfileName)) {
    return (
      matchExactMikrotikProfileName(secretProfile, mikrotikProfiles, expiryProfileName) ||
      secretProfile
    );
  }

  // 2. ORIG_PKG:<exact_profile> inside MikroTik secret comment
  const origFromComment = extractOrigPkgFromComment(liveSecret?.comment, expiryProfileName);
  if (origFromComment) {
    return (
      matchExactMikrotikProfileName(origFromComment, mikrotikProfiles, expiryProfileName) ||
      origFromComment
    );
  }

  // 3. Supabase subscriber backup/package fields
  const dbCandidates = [
    subscriber?.original_package_profile,
    subscriber?.package_name,
    subscriber?.package_profile_name,
    subscriber?.package_speed,
  ];
  for (const cand of dbCandidates) {
    const matched = matchExactMikrotikProfileName(cand, mikrotikProfiles, expiryProfileName);
    if (matched) return matched;
  }

  // 4. Last-resort safe fallback from real MikroTik profiles (prefer 'default' or first real profile)
  const validProfiles = mikrotikProfiles
    .map((p) => String(p || '').trim())
    .filter((p) => p && !isExpiryOrBlockedProfile(p, expiryProfileName));
  if (validProfiles.length > 0) {
    const defaultProf = validProfiles.find((p) => p.toLowerCase() === 'default');
    if (defaultProf) return defaultProf;
    const nonBuiltin = validProfiles.find((p) => !p.toLowerCase().startsWith('default'));
    return nonBuiltin || validProfiles[0];
  }

  return 'default';
}
