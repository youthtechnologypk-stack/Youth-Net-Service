-- Multi-Tenant Baileys WhatsApp Auth Session Persistence (PostgreSQL / Supabase)
-- Stores Baileys auth credentials ('creds') and Signal encryption keys per tenant_id
-- so deployments on ephemeral filesystems (Railway, Render, Fly.io, Docker) never log out sessions.

CREATE TABLE IF NOT EXISTS public.whatsapp_auth_sessions (
  tenant_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_tenant_id
  ON public.whatsapp_auth_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_sessions_creds_lookup
  ON public.whatsapp_auth_sessions (key_id, tenant_id);

-- Strictly restrict access to backend service_role only (never expose private Signal/WhatsApp keys to browser clients)
ALTER TABLE public.whatsapp_auth_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_auth_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_auth_sessions TO service_role;

NOTIFY pgrst, 'reload schema';
