-- ============================================================================
-- Granular RBAC Feature Permission Switches on public.portal_users
-- Stores per-user Network/GIS, Billing/Cash, and Subscriber Privacy switches
-- in a JSONB `permissions` column while keeping `can_access_gis_map` and
-- `gis_map_permission` synchronized for backward compatibility.
-- ============================================================================

ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS can_access_gis_map BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS gis_map_permission TEXT NOT NULL DEFAULT 'view';

ALTER TABLE public.portal_users
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill Administrators with unrestricted full permissions
UPDATE public.portal_users
SET
  can_access_gis_map = true,
  gis_map_permission = 'edit',
  permissions = jsonb_build_object(
    'gis_map', 'edit',
    'mikrotik_panel', true,
    'olt_panel', true,
    'outage_broadcast', true,
    'collect_fee', true,
    'edit_delete_invoice', true,
    'grace_and_shift', true,
    'bulk_billing', true,
    'expenses_ledger', true,
    'provision_pppoe', true,
    'view_passwords', true,
    'export_reports', true
  )
WHERE UPPER(COALESCE(role, '')) = 'ADMIN';

-- Ensure Clients have zero staff permissions
UPDATE public.portal_users
SET
  can_access_gis_map = false,
  gis_map_permission = 'none',
  permissions = jsonb_build_object(
    'gis_map', 'none',
    'mikrotik_panel', false,
    'olt_panel', false,
    'outage_broadcast', false,
    'collect_fee', false,
    'edit_delete_invoice', false,
    'grace_and_shift', false,
    'bulk_billing', false,
    'expenses_ledger', false,
    'provision_pppoe', false,
    'view_passwords', false,
    'export_reports', false
  )
WHERE UPPER(COALESCE(role, '')) = 'CLIENT'
  AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- Seed sensible defaults for existing Managers when permissions JSONB is empty
UPDATE public.portal_users
SET
  permissions = jsonb_build_object(
    'gis_map', COALESCE(NULLIF(LOWER(gis_map_permission), ''), CASE WHEN can_access_gis_map = false THEN 'none' ELSE 'view' END),
    'mikrotik_panel', false,
    'olt_panel', true,
    'outage_broadcast', true,
    'collect_fee', true,
    'edit_delete_invoice', true,
    'grace_and_shift', true,
    'bulk_billing', true,
    'expenses_ledger', true,
    'provision_pppoe', false,
    'view_passwords', false,
    'export_reports', true
  )
WHERE UPPER(COALESCE(role, '')) = 'MANAGER'
  AND (permissions IS NULL OR permissions = '{}'::jsonb);

-- Seed sensible defaults for existing Field Agents / Technicians when permissions JSONB is empty
UPDATE public.portal_users
SET
  permissions = jsonb_build_object(
    'gis_map', COALESCE(NULLIF(LOWER(gis_map_permission), ''), CASE WHEN can_access_gis_map = false THEN 'none' ELSE 'view' END),
    'mikrotik_panel', false,
    'olt_panel', false,
    'outage_broadcast', false,
    'collect_fee', true,
    'edit_delete_invoice', false,
    'grace_and_shift', false,
    'bulk_billing', false,
    'expenses_ledger', false,
    'provision_pppoe', false,
    'view_passwords', false,
    'export_reports', false
  )
WHERE UPPER(COALESCE(role, '')) IN ('AGENT', 'FIELD_AGENT', 'TECHNICIAN', 'RECOVERY', 'NOC', 'NOC_OPERATOR')
  AND (permissions IS NULL OR permissions = '{}'::jsonb);

CREATE INDEX IF NOT EXISTS idx_portal_users_permissions_gin
  ON public.portal_users USING gin (permissions);
