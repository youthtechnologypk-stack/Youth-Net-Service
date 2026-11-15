import type { MikrotikRouter } from '../types/isp';
import { supabase } from './supabaseClient';

export const MIKROTIK_ROUTERS_MIGRATION_SQL = `-- Youth Net Service: Multi-Device MikroTik Router Sync
CREATE TABLE IF NOT EXISTS public.mikrotik_routers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 81,
    username TEXT NOT NULL DEFAULT 'admin',
    password TEXT NOT NULL DEFAULT '',
    use_ssl BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    model TEXT DEFAULT 'MikroTik CCR2004-16G-2S+',
    version TEXT DEFAULT 'RouterOS v7.16.2',
    location TEXT DEFAULT 'Saddar Core NOC',
    wan_interface TEXT DEFAULT 'WAN3',
    walled_garden_pool TEXT DEFAULT '16.16.16.0/24',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS host TEXT;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS port INTEGER NOT NULL DEFAULT 81;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS use_ssl BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS public.mikrotik_routers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.mikrotik_routers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mikrotik_routers TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='mikrotik_routers' AND policyname='mikrotik_routers_full_access'
    ) THEN
        CREATE POLICY mikrotik_routers_full_access ON public.mikrotik_routers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    END IF;
END $$;

ALTER TABLE public.mikrotik_routers REPLICA IDENTITY FULL;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='mikrotik_routers') THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.mikrotik_routers;
        END IF;
    END IF;
END $$;`;

export interface SupabaseMikrotikRouterRow {
  id: string;
  name: string;
  host?: string | null;
  ip_address?: string | null;
  port?: number | null;
  api_port?: number | null;
  username?: string | null;
  password?: string | null;
  use_ssl?: boolean | null;
  is_default?: boolean | null;
  model?: string | null;
  version?: string | null;
  location?: string | null;
  wan_interface?: string | null;
  walled_garden_pool?: string | null;
  updated_at?: string | null;
}

export function normalizeRouterPort(
  host: string,
  rawPort?: number | null,
  rawUseSsl?: boolean | null
): { port: number; useSsl: boolean } {
  const cleanHost = (host || '').trim();
  const isSaddarHost = cleanHost === '202.142.186.150';
  let port = Number(rawPort || 0);
  let useSsl = rawUseSsl !== undefined && rawUseSsl !== null ? Boolean(rawUseSsl) : port === 443;

  if (isSaddarHost && (!port || port === 443 || port === 8728 || port === 8729)) {
    port = 81;
    useSsl = false;
  } else if (!port || port === 8728 || port === 8729) {
    port = useSsl ? 443 : 80;
  }
  return { port, useSsl };
}

export function mapSupabaseRowToRouter(row: SupabaseMikrotikRouterRow): MikrotikRouter {
  const host = String(row.host || row.ip_address || '').trim();
  const rawPort = row.port ?? row.api_port;
  const { port, useSsl } = normalizeRouterPort(host, rawPort, row.use_ssl);
  const rawName = String(row.name || '').trim();
  const displayName =
    rawName && rawName !== 'BRAS-CCR2004-CORE-NOC'
      ? rawName
      : host === '202.142.186.150'
      ? 'SADDAR'
      : rawName || host || 'MikroTik-BNG';

  return {
    id: String(row.id),
    name: displayName,
    model: String(row.model || 'MikroTik CCR2004-16G-2S+'),
    ipAddress: host,
    ip: host,
    apiPort: port,
    port,
    username: String(row.username || 'admin'),
    password: String(row.password || ''),
    useSsl,
    version: String(row.version || 'RouterOS v7.16.2'),
    location: String(row.location || (host === '202.142.186.150' ? 'Saddar Core NOC' : 'Distribution Node')),
    cpuLoad: 0,
    memoryUsageMb: 0,
    totalMemoryMb: 4096,
    uptime: '0s',
    status: 'unreachable',
    wanInterface: String(row.wan_interface || 'WAN3'),
    currentWanRxMbps: 0,
    currentWanTxMbps: 0,
    activePppoeCount: 0,
    walledGardenPool: String(row.walled_garden_pool || '16.16.16.0/24'),
    proxyMode: 'proxy',
    isDefault: Boolean(row.is_default),
  };
}

export function pickPreferredRouterId(
  routers: MikrotikRouter[],
  storedId?: string | null
): string {
  if (!Array.isArray(routers) || routers.length === 0) return '';
  if (storedId && routers.some((r) => r.id === storedId)) {
    return storedId;
  }
  const defaultMatch = routers.find((r) => Boolean(r.isDefault));
  return defaultMatch?.id || routers[0].id;
}

export async function fetchSupabaseRouters(): Promise<{
  routers: MikrotikRouter[];
  tableMissing: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('mikrotik_routers')
    .select('*')
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });

  if (error) {
    const msg = error.message || '';
    const tableMissing =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      msg.toLowerCase().includes('mikrotik_routers') &&
        (msg.toLowerCase().includes('does not exist') ||
          msg.toLowerCase().includes('schema cache'));
    return { routers: [], tableMissing, error: msg };
  }

  const rows = Array.isArray(data) ? (data as SupabaseMikrotikRouterRow[]) : [];
  const mapped = rows
    .filter((r) => Boolean(r && r.id && (r.host || r.ip_address)))
    .map(mapSupabaseRowToRouter);
  return { routers: mapped, tableMissing: false };
}

export async function upsertSupabaseRouter(
  router: MikrotikRouter,
  options?: { setAsDefault?: boolean }
): Promise<{ success: boolean; tableMissing?: boolean; error?: string }> {
  const host = (router.ipAddress || router.ip || '').trim();
  if (!router.id || !host) {
    return { success: false, error: 'Router id and host are required' };
  }
  const { port, useSsl } = normalizeRouterPort(
    host,
    router.port ?? router.apiPort,
    router.useSsl
  );
  const isDefault =
    options?.setAsDefault !== undefined
      ? Boolean(options.setAsDefault)
      : Boolean(router.isDefault);

  if (isDefault) {
    // Clear existing default flag before marking this router default
    await supabase
      .from('mikrotik_routers')
      .update({ is_default: false })
      .neq('id', router.id);
  }

  const nowIso = new Date().toISOString();
  const fullPayload = {
    id: router.id,
    name: router.name,
    host,
    port,
    username: router.username || 'admin',
    password: router.password || '',
    use_ssl: useSsl,
    is_default: isDefault,
    model: router.model || 'MikroTik CCR2004-16G-2S+',
    version: router.version || 'RouterOS v7.16.2',
    location: router.location || 'Saddar Core NOC',
    wan_interface: router.wanInterface || 'WAN3',
    walled_garden_pool: router.walledGardenPool || '16.16.16.0/24',
    updated_at: nowIso,
  };

  let { error } = await supabase
    .from('mikrotik_routers')
    .upsert(fullPayload, { onConflict: 'id' });

  // Retry with lean 9-column payload if user's table only has core columns
  if (error && (error.code === 'PGRST204' || error.message?.includes('column'))) {
    const corePayload = {
      id: router.id,
      name: router.name,
      host,
      port,
      username: router.username || 'admin',
      password: router.password || '',
      use_ssl: useSsl,
      is_default: isDefault,
      updated_at: nowIso,
    };
    const retryRes = await supabase
      .from('mikrotik_routers')
      .upsert(corePayload, { onConflict: 'id' });
    error = retryRes.error;
  }

  if (error) {
    const msg = error.message || '';
    const tableMissing =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      msg.toLowerCase().includes('does not exist');
    return { success: false, tableMissing, error: msg };
  }

  return { success: true };
}

export async function deleteSupabaseRouter(
  routerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!routerId) return { success: false, error: 'Router id required' };
  const { error } = await supabase
    .from('mikrotik_routers')
    .delete()
    .eq('id', routerId);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

export async function setDefaultSupabaseRouter(
  routerId: string
): Promise<{ success: boolean; error?: string }> {
  if (!routerId) return { success: false, error: 'Router id required' };
  await supabase
    .from('mikrotik_routers')
    .update({ is_default: false })
    .neq('id', routerId);

  const { error } = await supabase
    .from('mikrotik_routers')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', routerId);

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

export function subscribeToSupabaseRouters(onChanged: () => void): () => void {
  const channel = supabase
    .channel('isp-mikrotik-routers-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'mikrotik_routers' },
      () => {
        onChanged();
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
