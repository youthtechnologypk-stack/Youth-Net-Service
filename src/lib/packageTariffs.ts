import { supabase } from '../services/supabaseClient';

export const PACKAGE_TARIFFS_STORAGE_KEY = 'youthnet_profile_pricing';
export const PACKAGE_TARIFFS_UPDATED_EVENT = 'youthnet:package-tariffs-updated';

/**
 * Default PKR monthly tariffs pre-populated for standard Youth Net MikroTik PPPoE profiles.
 * Admins can edit/add/remove any profile rate in System Settings or MikroTik Studio,
 * and changes persist durably in Supabase `system_settings` (`config.package_tariffs`).
 */
export const DEFAULT_PACKAGE_TARIFFS: Record<string, number> = {
  '2 MB': 1000,
  '3 MB': 1200,
  '4 MB': 1500,
  '4 MB - Local': 1500,
  '4 MB - TW': 1800,
  '5 MB': 1600,
  '6 MB': 1800,
  '6 MB - Local': 1800,
  '6 MB - TW': 2000,
  '8 MB': 2000,
  '8 MB - Local': 2000,
  '8 MB - TW': 2200,
  '10 MB': 2200,
  '10 MB - Local': 2200,
  '10 MB - TW': 2500,
  '12 MB': 2500,
  '12 MB - Local': 2500,
  '15 MB': 3000,
  '15 MB - Local': 3000,
  '20 MB': 3500,
  '20 MB - Local': 3500,
  '30 MB': 4500,
  '50 MB': 6000,
  '100 MB': 9000,
};

export function sanitizePackageTariffs(
  raw?: Record<string, any> | null,
  includeDefaults: boolean = false
): Record<string, number> {
  const result: Record<string, number> = includeDefaults ? { ...DEFAULT_PACKAGE_TARIFFS } : {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [k, v] of Object.entries(raw)) {
    const cleanKey = String(k || '').trim();
    const num = Math.round(Number(v));
    if (cleanKey && Number.isFinite(num) && num > 0 && num <= 1_000_000) {
      result[cleanKey] = num;
    }
  }
  return result;
}

export function getCachedPackageTariffs(): Record<string, number> {
  const merged: Record<string, number> = { ...DEFAULT_PACKAGE_TARIFFS };
  if (typeof window === 'undefined') return merged;

  try {
    const rawSettings = window.localStorage.getItem('youthnet_global_system_settings');
    if (rawSettings) {
      const parsedSettings = JSON.parse(rawSettings);
      const fromSettings = parsedSettings?.packageTariffs || parsedSettings?.package_tariffs;
      if (fromSettings && typeof fromSettings === 'object') {
        Object.assign(merged, sanitizePackageTariffs(fromSettings, false));
      }
    }
  } catch {
    // ignore corrupt cache
  }

  try {
    const raw = window.localStorage.getItem(PACKAGE_TARIFFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.assign(merged, sanitizePackageTariffs(parsed, false));
    }
  } catch {
    // ignore corrupt cache
  }

  return merged;
}

export function mirrorPackageTariffsLocally(tariffs: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = sanitizePackageTariffs(tariffs, false);
    window.localStorage.setItem(PACKAGE_TARIFFS_STORAGE_KEY, JSON.stringify(clean));
    window.dispatchEvent(
      new CustomEvent<Record<string, number>>(PACKAGE_TARIFFS_UPDATED_EVENT, { detail: clean })
    );
  } catch {
    // ignore storage errors
  }
}

/**
 * Loads authoritative Package Tariffs from Supabase:
 * 1. `package_tariffs` table (if present)
 * 2. `system_settings` (`id = 'global'` -> `config.package_tariffs` / `config.packageTariffs`)
 * 3. `app_settings` (`key = 'package_tariffs'`)
 * Merged cleanly over `DEFAULT_PACKAGE_TARIFFS`.
 */
export async function loadPackageTariffsFromSupabase(): Promise<Record<string, number>> {
  const merged = getCachedPackageTariffs();
  let updatedFromRemote = false;

  // 1. Optional dedicated `package_tariffs` table
  try {
    const { data, error } = await supabase
      .from('package_tariffs')
      .select('profile_name, monthly_price, price_pkr');
    if (!error && Array.isArray(data) && data.length > 0) {
      for (const row of data as Array<Record<string, any>>) {
        const name = String(row.profile_name || '').trim();
        const price = Math.round(Number(row.monthly_price ?? row.price_pkr));
        if (name && Number.isFinite(price) && price > 0) {
          merged[name] = price;
          updatedFromRemote = true;
        }
      }
    }
  } catch {
    // optional table may not exist
  }

  // 2. Primary store: `system_settings` (`id = 'global'`)
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();
    if (!error && data?.config && typeof data.config === 'object') {
      const cfg = data.config as Record<string, any>;
      const remoteMap = cfg.package_tariffs || cfg.packageTariffs;
      if (remoteMap && typeof remoteMap === 'object') {
        Object.assign(merged, sanitizePackageTariffs(remoteMap, false));
        updatedFromRemote = true;
      }
    }
  } catch {
    // ignore fallback
  }

  // 3. Auxiliary store: `app_settings` (`key = 'package_tariffs'`)
  if (!updatedFromRemote) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'package_tariffs')
        .maybeSingle();
      if (!error && data?.value) {
        const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        if (parsed && typeof parsed === 'object') {
          Object.assign(merged, sanitizePackageTariffs(parsed, false));
        }
      }
    } catch {
      // ignore
    }
  }

  mirrorPackageTariffsLocally(merged);
  return merged;
}

/**
 * Persists Package Tariffs durably into Supabase `system_settings` (`config.package_tariffs`),
 * plus best-effort mirrors into `app_settings` and `package_tariffs` table if present.
 */
export async function savePackageTariffsToSupabase(
  tariffs: Record<string, number>
): Promise<{ ok: boolean; tariffs: Record<string, number>; error?: string }> {
  const cleanTariffs = sanitizePackageTariffs(tariffs, false);
  const nowIso = new Date().toISOString();

  // Read existing global config first so we never clobber other system settings
  let existingConfig: Record<string, any> = {};
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('config')
      .eq('id', 'global')
      .maybeSingle();
    if (data?.config && typeof data.config === 'object') {
      existingConfig = { ...(data.config as Record<string, any>) };
    }
  } catch {
    // ignore
  }

  const nextConfig = {
    ...existingConfig,
    packageTariffs: cleanTariffs,
    package_tariffs: cleanTariffs,
  };

  const { error: sysErr } = await supabase
    .from('system_settings')
    .upsert(
      {
        id: 'global',
        config: nextConfig,
        updated_at: nowIso,
      },
      { onConflict: 'id' }
    );

  // Best-effort sync to `app_settings` & `package_tariffs` table
  await Promise.allSettled([
    Promise.resolve(
      supabase.from('app_settings').upsert(
        {
          key: 'package_tariffs',
          value: JSON.stringify(cleanTariffs),
          updated_at: nowIso,
        },
        { onConflict: 'key' }
      )
    ),
    Promise.resolve(
      supabase.from('package_tariffs').upsert(
        Object.entries(cleanTariffs).map(([profile_name, monthly_price]) => ({
          profile_name,
          monthly_price,
          updated_at: nowIso,
        })),
        { onConflict: 'profile_name' }
      )
    ),
  ]);

  mirrorPackageTariffsLocally(cleanTariffs);

  if (sysErr) {
    return {
      ok: false,
      tariffs: cleanTariffs,
      error: sysErr.message || 'Failed to save package tariffs to Supabase system_settings',
    };
  }

  return { ok: true, tariffs: cleanTariffs };
}

/**
 * Smart lookup for a MikroTik PPPoE profile's monthly PKR price:
 * 1. Exact key match in active tariff map
 * 2. Case-insensitive exact match
 * 3. Normalized alphanumeric match (e.g. "4mb-tw" -> "4 MB - TW")
 * 4. Exact / normalized match in DEFAULT_PACKAGE_TARIFFS
 * 5. Speed-digit fallback (e.g. "4 MB" -> 1500, "8 MB" -> 2000)
 */
export function lookupPackageTariffPrice(
  profileName?: string | null,
  tariffMap?: Record<string, number> | null
): {
  pricePkr: number;
  matchedKey: string | null;
  source: 'configured' | 'default_tariff' | 'speed_fallback';
} {
  const clean = String(profileName || '').trim();
  const cleanLow = clean.toLowerCase();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanNorm = norm(clean);

  const tryMap = (map: Record<string, number>): { key: string; price: number } | null => {
    if (!clean) return null;
    if (map[clean] && Number(map[clean]) > 0) {
      return { key: clean, price: Math.round(Number(map[clean])) };
    }
    const ci = Object.entries(map).find(
      ([k, v]) => k.trim().toLowerCase() === cleanLow && Number(v) > 0
    );
    if (ci) return { key: ci[0], price: Math.round(Number(ci[1])) };
    if (cleanNorm) {
      const nm = Object.entries(map).find(
        ([k, v]) => norm(k) === cleanNorm && Number(v) > 0
      );
      if (nm) return { key: nm[0], price: Math.round(Number(nm[1])) };
    }
    return null;
  };

  if (tariffMap && Object.keys(tariffMap).length > 0) {
    const hit = tryMap(tariffMap);
    if (hit) {
      return { pricePkr: hit.price, matchedKey: hit.key, source: 'configured' };
    }
  }

  const cachedHit = tryMap(getCachedPackageTariffs());
  if (cachedHit) {
    return {
      pricePkr: cachedHit.price,
      matchedKey: cachedHit.key,
      source: Object.prototype.hasOwnProperty.call(DEFAULT_PACKAGE_TARIFFS, cachedHit.key)
        ? 'default_tariff'
        : 'configured',
    };
  }

  const defaultHit = tryMap(DEFAULT_PACKAGE_TARIFFS);
  if (defaultHit) {
    return { pricePkr: defaultHit.price, matchedKey: defaultHit.key, source: 'default_tariff' };
  }

  // Speed-tier fallback
  const speedMatch = clean.match(/(\d+)\s*(?:m|mb|mbps)?/i);
  const mbps = speedMatch ? parseInt(speedMatch[1], 10) : 0;
  const isTw = /\btw\b/i.test(clean);
  let fallback = 2000;
  if (mbps >= 100) fallback = 9000;
  else if (mbps >= 50) fallback = 6000;
  else if (mbps >= 30) fallback = 4500;
  else if (mbps >= 20) fallback = 3500;
  else if (mbps >= 15) fallback = 3000;
  else if (mbps >= 12) fallback = 2500;
  else if (mbps >= 10) fallback = isTw ? 2500 : 2200;
  else if (mbps >= 8) fallback = isTw ? 2200 : 2000;
  else if (mbps >= 6) fallback = isTw ? 2000 : 1800;
  else if (mbps >= 5) fallback = 1600;
  else if (mbps >= 4) fallback = isTw ? 1800 : 1500;
  else if (mbps >= 3) fallback = 1200;
  else if (mbps >= 1) fallback = 1000;

  return { pricePkr: fallback, matchedKey: null, source: 'speed_fallback' };
}
