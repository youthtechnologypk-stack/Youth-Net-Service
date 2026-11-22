-- Youth Net Service NOC: Per-User Role-Based Fiber GIS & Map Access Control on portal_users
ALTER TABLE IF EXISTS public.portal_users
  ADD COLUMN IF NOT EXISTS can_access_gis_map BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE IF EXISTS public.portal_users
  ADD COLUMN IF NOT EXISTS gis_map_permission TEXT NOT NULL DEFAULT 'view'
  CHECK (gis_map_permission IN ('none', 'view', 'edit'));

-- Admin tier always retains full GIS edit & splice access
UPDATE public.portal_users
SET can_access_gis_map = TRUE,
    gis_map_permission = 'edit'
WHERE UPPER(COALESCE(role, '')) = 'ADMIN';

-- Client / Subscriber accounts do not have GIS map access
UPDATE public.portal_users
SET can_access_gis_map = FALSE,
    gis_map_permission = 'none'
WHERE UPPER(COALESCE(role, '')) = 'CLIENT';
