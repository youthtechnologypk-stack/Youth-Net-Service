-- Global System Settings & Carrier Configuration persistence table
-- Stores all ISP branding, Baileys WhatsApp Gateway URL, Auto-Send switch,
-- Team WhatsApp Work Group, Billing/Grace rules, Currency, and Router/Carrier defaults.

CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default global row if not present (does not overwrite existing saved settings)
INSERT INTO public.system_settings (id, config, updated_at)
VALUES (
  'global',
  '{
    "companyDisplayName": "Youth Net Service",
    "ispName": "Youth Net Service",
    "supportHelpline": "+92 323 4193599",
    "baileysGatewayUrl": "",
    "autoSendMasterSwitch": true,
    "whatsAppGatewayEnabled": true,
    "teamWhatsAppGroupJid": "",
    "teamWhatsAppGroupName": "",
    "billingCycleDay": 1,
    "gracePeriodDays": 3,
    "expiryPppProfile": "EXPIRED-16-POOL",
    "autoWalledGarden": true,
    "currencyCode": "PKR",
    "currencySymbol": "Rs.",
    "defaultMikrotikApiPort": 8728,
    "defaultSnmpCommunity": "public",
    "slaAutoAssignMinutes": 5,
    "fiberCutSlaHours": 2
  }'::jsonb,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_read_system_settings" ON public.system_settings;
CREATE POLICY "allow_read_system_settings"
  ON public.system_settings
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "allow_write_system_settings" ON public.system_settings;
CREATE POLICY "allow_write_system_settings"
  ON public.system_settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.system_settings TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
