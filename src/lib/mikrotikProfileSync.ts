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

export interface LiveMikrotikPlanOption {
  profileName: string;
  rateLimit?: string;
  pricePkr: number;
  tariffSource: 'profilePriceMap' | 'package' | 'subscriber' | 'rate_fallback';
  isAssignedFallback?: boolean;
}

const DUMMY_PLAN_NAMES = new Set([
  '20 mbps home starter',
  '50 mbps turbo gamer',
  '100 mbps ultra stream',
  '300 mbps enterprise lease',
  'walled garden restricted (512kbps)',
  'standard-broadband',
  'fiber broadband',
  'standard',
]);

const DUMMY_PACKAGE_IDS = new Set(['pkg-1', 'pkg-2', 'pkg-3', 'pkg-4', 'pkg-wg']);

export function isDummyPackageNameOrId(name?: string | null, id?: string | null): boolean {
  const cleanName = String(name || '').trim().toLowerCase();
  const cleanId = String(id || '').trim().toLowerCase();
  if (cleanId && DUMMY_PACKAGE_IDS.has(cleanId)) return true;
  if (cleanName && DUMMY_PLAN_NAMES.has(cleanName)) return true;
  return false;
}

export function isInternalSystemMikrotikProfile(
  profileName?: string | null,
  expiryProfileName?: string | null
): boolean {
  const clean = String(profileName || '').trim().toLowerCase();
  if (!clean) return true;
  if (clean === 'default' || clean === 'default-encryption') return true;
  return isExpiryOrBlockedProfile(profileName, expiryProfileName);
}

/**
 * Resolves configured monthly PKR tariff for a MikroTik PPPoE profile name
 * from profilePriceMap, non-dummy packages table, subscriber monthly_fee, or speed fallback.
 */
export function resolvePkrTariffForProfile(
  profileName?: string | null,
  options?: {
    profilePriceMap?: Record<string, number>;
    packages?: Array<{
      id?: string;
      name?: string;
      mikrotikProfile?: string;
      priceMonthly?: number;
    }>;
    portalClients?: Array<{
      original_package_profile?: string | null;
      package_name?: string | null;
      package_profile_name?: string | null;
      package_speed?: string | null;
      monthly_fee?: number | null;
    }>;
  }
): {
  pricePkr: number;
  tariffSource: 'profilePriceMap' | 'package' | 'subscriber' | 'rate_fallback';
} {
  const clean = String(profileName || '').trim();
  const cleanLow = clean.toLowerCase();

  // 1. Explicit profilePriceMap from Package & Tariff Config (youthnet_profile_pricing)
  const priceMap = options?.profilePriceMap || {};
  if (clean && priceMap[clean] && Number(priceMap[clean]) > 0) {
    return { pricePkr: Number(priceMap[clean]), tariffSource: 'profilePriceMap' };
  }
  const mapCiEntry = Object.entries(priceMap).find(
    ([k, v]) => k.trim().toLowerCase() === cleanLow && Number(v) > 0
  );
  if (mapCiEntry) {
    return { pricePkr: Number(mapCiEntry[1]), tariffSource: 'profilePriceMap' };
  }

  // 2. Non-dummy configured packages (ignoring $25/$45/$75/$190 dummy USD seed items)
  const validPackages = (options?.packages || []).filter(
    (p) =>
      !isDummyPackageNameOrId(p?.name, p?.id) &&
      !isDummyPackageNameOrId(p?.mikrotikProfile, p?.id) &&
      Number(p?.priceMonthly) >= 100
  );
  const pkgMatch = validPackages.find(
    (p) =>
      String(p.mikrotikProfile || '').trim().toLowerCase() === cleanLow ||
      String(p.name || '').trim().toLowerCase() === cleanLow
  );
  if (pkgMatch && Number(pkgMatch.priceMonthly) > 0) {
    return { pricePkr: Number(pkgMatch.priceMonthly), tariffSource: 'package' };
  }

  // 3. Existing subscriber fees on this exact profile
  const matchingFees = (options?.portalClients || [])
    .filter((c) => {
      const fee = Number(c?.monthly_fee);
      if (!fee || fee <= 0) return false;
      const cands = [
        c.original_package_profile,
        c.package_name,
        c.package_profile_name,
        c.package_speed,
      ];
      return cands.some((v) => String(v || '').trim().toLowerCase() === cleanLow);
    })
    .map((c) => Number(c.monthly_fee));

  if (matchingFees.length > 0) {
    // Pick most common fee on that profile
    const freq = new Map<number, number>();
    for (const f of matchingFees) freq.set(f, (freq.get(f) || 0) + 1);
    let bestFee = matchingFees[0];
    let bestCount = 0;
    for (const [f, cnt] of freq.entries()) {
      if (cnt > bestCount) {
        bestCount = cnt;
        bestFee = f;
      }
    }
    return { pricePkr: bestFee, tariffSource: 'subscriber' };
  }

  // 4. Speed-based PKR fallback
  const speedMatch = clean.match(/(\d+)\s*(?:m|mb|mbps)?/i);
  const mbps = speedMatch ? parseInt(speedMatch[1], 10) : 0;
  let rateFallback = 2000;
  if (mbps >= 100) rateFallback = 5000;
  else if (mbps >= 50) rateFallback = 3500;
  else if (mbps >= 30) rateFallback = 3000;
  else if (mbps >= 20) rateFallback = 2500;
  else if (mbps >= 15) rateFallback = 2000;
  else if (mbps >= 12) rateFallback = 2000;
  else if (mbps >= 10) rateFallback = 1800;
  else if (mbps >= 8) rateFallback = 1500;
  else if (mbps > 0) rateFallback = 1200;

  return { pricePkr: rateFallback, tariffSource: 'rate_fallback' };
}

/**
 * Builds dropdown options for Package Plan strictly from live MikroTik `/ppp/profile`
 * (filtering out default, default-encryption, Expire, EXPIRED-16-POOL unless assigned to the invoice),
 * NEVER inserting hardcoded dummy USD plans.
 */
export function buildLiveMikrotikPlanOptions(params: {
  mikrotikProfiles: Array<{ name: string; rateLimit?: string } | string>;
  secrets?: Array<Record<string, any>>;
  portalClients?: Array<{
    original_package_profile?: string | null;
    package_name?: string | null;
    package_profile_name?: string | null;
    package_speed?: string | null;
    monthly_fee?: number | null;
  }>;
  expiryProfileName?: string | null;
  assignedProfileName?: string | null;
  profilePriceMap?: Record<string, number>;
  packages?: Array<{
    id?: string;
    name?: string;
    mikrotikProfile?: string;
    priceMonthly?: number;
  }>;
}): LiveMikrotikPlanOption[] {
  const {
    mikrotikProfiles,
    secrets = [],
    portalClients = [],
    expiryProfileName,
    assignedProfileName,
    profilePriceMap,
    packages,
  } = params;

  const cleanAssigned = String(assignedProfileName || '').trim();
  const cleanAssignedLow = cleanAssigned.toLowerCase();
  const seen = new Set<string>();
  const options: LiveMikrotikPlanOption[] = [];

  const pushProfile = (rawName: string, rateLimit?: string, isAssignedFallback = false) => {
    const trimmed = String(rawName || '').trim();
    if (!trimmed) return;
    if (isDummyPackageNameOrId(trimmed)) return;
    const low = trimmed.toLowerCase();
    const isAssigned = Boolean(cleanAssignedLow && low === cleanAssignedLow);
    if (!isAssigned && isInternalSystemMikrotikProfile(trimmed, expiryProfileName)) {
      return;
    }
    if (seen.has(low)) return;
    seen.add(low);

    const tariff = resolvePkrTariffForProfile(trimmed, {
      profilePriceMap,
      packages,
      portalClients,
    });

    options.push({
      profileName: trimmed,
      rateLimit,
      pricePkr: tariff.pricePkr,
      tariffSource: tariff.tariffSource,
      isAssignedFallback,
    });
  };

  // 1. Live MikroTik /ppp/profile list (primary source of truth)
  for (const item of mikrotikProfiles) {
    if (typeof item === 'string') {
      pushProfile(item);
    } else if (item && item.name) {
      pushProfile(item.name, item.rateLimit);
    }
  }

  // 2. If RouterOS /ppp/profile is temporarily unreachable, adopt real profiles seen on live secrets & Supabase subscribers
  if (options.length === 0) {
    for (const sec of secrets) {
      if (sec?.profile) pushProfile(String(sec.profile));
      const fromComment = extractOrigPkgFromComment(sec?.comment, expiryProfileName);
      if (fromComment) pushProfile(fromComment);
    }
    for (const client of portalClients) {
      const cand =
        client.original_package_profile ||
        client.package_name ||
        client.package_profile_name;
      if (cand) pushProfile(cand);
    }
  }

  // 3. Ensure an already-assigned profile (even if EXPIRED-16-POOL or custom) is selectable
  if (cleanAssigned && !isDummyPackageNameOrId(cleanAssigned) && !seen.has(cleanAssignedLow)) {
    pushProfile(cleanAssigned, undefined, true);
  }

  return options;
}

/**
 * Resolves which MikroTik profile should be auto-preselected when opening Edit/Generate Invoice
 * for a subscriber (live secret -> ORIG_PKG comment -> invoice's package -> Supabase original_package_profile).
 */
export function resolvePreselectedInvoiceProfile(params: {
  username?: string | null;
  invoicePackage?: string | null;
  secrets?: Array<Record<string, any>>;
  subscriber?: {
    original_package_profile?: string | null;
    package_name?: string | null;
    package_profile_name?: string | null;
    package_speed?: string | null;
  } | null;
  mikrotikProfiles?: Array<{ name: string; rateLimit?: string } | string>;
  expiryProfileName?: string | null;
}): {
  selectedProfile: string;
  liveSecretProfile: string | null;
  origPkgFromComment: string | null;
} {
  const {
    username,
    invoicePackage,
    secrets = [],
    subscriber,
    mikrotikProfiles = [],
    expiryProfileName,
  } = params;

  const cleanUser = String(username || '').trim().toLowerCase();
  const profileNames = mikrotikProfiles
    .map((p) => (typeof p === 'string' ? p : p?.name || ''))
    .filter(Boolean);

  const liveSecret = cleanUser
    ? secrets.find((s) => String(s?.name || '').trim().toLowerCase() === cleanUser) || null
    : null;

  const liveSecretProfile = liveSecret?.profile ? String(liveSecret.profile).trim() : null;
  const origPkgFromComment = extractOrigPkgFromComment(liveSecret?.comment, expiryProfileName);

  // 1. Live non-expiry MikroTik secret profile
  if (
    liveSecretProfile &&
    !isInternalSystemMikrotikProfile(liveSecretProfile, expiryProfileName) &&
    !isDummyPackageNameOrId(liveSecretProfile)
  ) {
    const matched =
      matchExactMikrotikProfileName(liveSecretProfile, profileNames, expiryProfileName) ||
      liveSecretProfile;
    return { selectedProfile: matched, liveSecretProfile, origPkgFromComment };
  }

  // 2. ORIG_PKG:<exact_profile> inside live secret comment (if currently in EXPIRED-16-POOL)
  if (origPkgFromComment && !isDummyPackageNameOrId(origPkgFromComment)) {
    const matched =
      matchExactMikrotikProfileName(origPkgFromComment, profileNames, expiryProfileName) ||
      origPkgFromComment;
    return { selectedProfile: matched, liveSecretProfile, origPkgFromComment };
  }

  // 3. Stored non-dummy invoice package
  const cleanInvPkg = String(invoicePackage || '').trim();
  if (
    cleanInvPkg &&
    !isDummyPackageNameOrId(cleanInvPkg) &&
    !isInternalSystemMikrotikProfile(cleanInvPkg, expiryProfileName)
  ) {
    const matched =
      matchExactMikrotikProfileName(cleanInvPkg, profileNames, expiryProfileName) || cleanInvPkg;
    return { selectedProfile: matched, liveSecretProfile, origPkgFromComment };
  }

  // 4. Subscriber's original_package_profile / package_name / package_profile_name / package_speed
  const dbCands = [
    subscriber?.original_package_profile,
    subscriber?.package_name,
    subscriber?.package_profile_name,
    subscriber?.package_speed,
  ];
  for (const cand of dbCands) {
    const trimCand = String(cand || '').trim();
    if (!trimCand || isDummyPackageNameOrId(trimCand)) continue;
    if (isInternalSystemMikrotikProfile(trimCand, expiryProfileName)) continue;
    const matched =
      matchExactMikrotikProfileName(trimCand, profileNames, expiryProfileName) || trimCand;
    return { selectedProfile: matched, liveSecretProfile, origPkgFromComment };
  }

  // 5. Fallback to first available non-system MikroTik profile (or stored invoice package if it was an expiry profile)
  const firstValid = profileNames.find(
    (p) => !isInternalSystemMikrotikProfile(p, expiryProfileName) && !isDummyPackageNameOrId(p)
  );
  if (firstValid) {
    return { selectedProfile: firstValid, liveSecretProfile, origPkgFromComment };
  }

  return {
    selectedProfile:
      cleanInvPkg && !isDummyPackageNameOrId(cleanInvPkg)
        ? cleanInvPkg
        : liveSecretProfile && !isDummyPackageNameOrId(liveSecretProfile)
        ? liveSecretProfile
        : '',
    liveSecretProfile,
    origPkgFromComment,
  };
}
