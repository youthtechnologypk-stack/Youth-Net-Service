import { supabase, SupabasePortalUser } from './supabaseClient';
import { isMissingTableOrColumnError } from '../lib/expiryUtils';

export const FIELD_MATERIAL_ACTION_TYPES = ['INSTALLED', 'REMOVED', 'REPLACED'] as const;
export type FieldMaterialActionType = (typeof FIELD_MATERIAL_ACTION_TYPES)[number];

export const FIELD_MATERIAL_CATEGORIES = [
  'PLC Splitter 1:2',
  'PLC Splitter 1:4',
  'PLC Splitter 1:8',
  'PLC Splitter 1:16',
  'Drop Wire (1-Core / 2-Core)',
  'Main Fiber Cable (4/6/12/24/48-Core)',
  'Joint / Splicing Closure',
  'FAT / ODB Box',
  'Patch Cord / Pigtail',
  'ONT / Router',
  'Pole Clamp / Hardware',
  'Other',
] as const;

export type FieldMaterialCategory = (typeof FIELD_MATERIAL_CATEGORIES)[number];

export const FIELD_MATERIAL_UNITS = ['Pieces', 'Meters', 'Rolls', 'Boxes'] as const;
export type FieldMaterialUnit = (typeof FIELD_MATERIAL_UNITS)[number];

export const FIELD_MATERIAL_ROLES = ['AGENT', 'MANAGER', 'ADMIN'] as const;
export type FieldMaterialPerformerRole = (typeof FIELD_MATERIAL_ROLES)[number];

export interface SupabaseFieldMaterialLog {
  id: string;
  created_at: string;
  action_type: FieldMaterialActionType;
  material_category: string;
  quantity: number;
  unit: FieldMaterialUnit;
  pole_id_or_location: string;
  coverage_area: string;
  performed_by_user_id: string | null;
  performed_by_name: string;
  performed_by_role: FieldMaterialPerformerRole | string;
  remarks: string | null;
}

export interface CreateFieldMaterialItemInput {
  action_type: FieldMaterialActionType;
  material_category: string;
  quantity: number;
  unit: FieldMaterialUnit;
  pole_id_or_location: string;
  coverage_area: string;
  performed_by_user_id?: string | null;
  performed_by_name: string;
  performed_by_role: string;
  remarks?: string;
}

export interface UpdateFieldMaterialLogInput {
  action_type: FieldMaterialActionType;
  material_category: string;
  quantity: number;
  unit: FieldMaterialUnit;
  pole_id_or_location: string;
  coverage_area: string;
  performed_by_user_id?: string | null;
  performed_by_name: string;
  performed_by_role: string;
  created_at?: string;
  remarks?: string;
}

export const FIELD_MATERIAL_MIGRATION_SQL = `-- Youth Net Service Portal: Field Material & FTTH Pole Deployment Log
CREATE TABLE IF NOT EXISTS public.field_material_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action_type TEXT NOT NULL CHECK (action_type IN ('INSTALLED', 'REMOVED', 'REPLACED')),
  material_category TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'Pieces' CHECK (unit IN ('Pieces', 'Meters', 'Rolls', 'Boxes')),
  pole_id_or_location TEXT NOT NULL,
  coverage_area TEXT NOT NULL DEFAULT 'All Coverage Areas',
  performed_by_user_id TEXT NULL,
  performed_by_name TEXT NOT NULL,
  performed_by_role TEXT NOT NULL DEFAULT 'AGENT',
  remarks TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_field_material_logs_created_at ON public.field_material_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_material_logs_area ON public.field_material_logs (coverage_area);
CREATE INDEX IF NOT EXISTS idx_field_material_logs_performer ON public.field_material_logs (performed_by_user_id);
CREATE INDEX IF NOT EXISTS idx_field_material_logs_action ON public.field_material_logs (action_type);

ALTER TABLE public.field_material_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_field_material_logs" ON public.field_material_logs;
CREATE POLICY "allow_all_field_material_logs"
  ON public.field_material_logs FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_material_logs TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';`;

export function normalizeFieldMaterialActionType(raw?: string | null): FieldMaterialActionType {
  const clean = String(raw || '')
    .trim()
    .toUpperCase();
  if (clean === 'REMOVED') return 'REMOVED';
  if (clean === 'REPLACED') return 'REPLACED';
  return 'INSTALLED';
}

export function normalizeFieldMaterialUnit(raw?: string | null): FieldMaterialUnit {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'meters' || clean === 'meter' || clean === 'm') return 'Meters';
  if (clean === 'rolls' || clean === 'roll') return 'Rolls';
  if (clean === 'boxes' || clean === 'box') return 'Boxes';
  return 'Pieces';
}

export function normalizePerformerRole(raw?: string | null): FieldMaterialPerformerRole {
  const clean = String(raw || '').trim().toUpperCase();
  if (clean === 'ADMIN') return 'ADMIN';
  if (clean === 'MANAGER') return 'MANAGER';
  return 'AGENT';
}

export function getDefaultUnitForCategory(category: string): FieldMaterialUnit {
  const lower = String(category || '').toLowerCase();
  if (lower.includes('drop wire') || lower.includes('fiber cable')) {
    return 'Meters';
  }
  return 'Pieces';
}

export function formatActionTypeMeta(actionType?: string | null): {
  code: FieldMaterialActionType;
  label: string;
  urduHint: string;
  shortLabel: string;
} {
  const code = normalizeFieldMaterialActionType(actionType);
  if (code === 'REMOVED') {
    return {
      code,
      label: 'Removed (Purana Utara)',
      urduHint: 'Purana Utara',
      shortLabel: 'Removed',
    };
  }
  if (code === 'REPLACED') {
    return {
      code,
      label: 'Replaced (Utar Kar Naya Lagaya)',
      urduHint: 'Tabdeel Kiya',
      shortLabel: 'Replaced',
    };
  }
  return {
    code,
    label: 'Installed (New Lagaya)',
    urduHint: 'New Lagaya',
    shortLabel: 'Installed',
  };
}

export interface FieldMaterialKpiSummary {
  totalWireUsedMeters: number;
  totalSplittersAndBoxesInstalled: number;
  totalOtherInstalledPieces: number;
  totalRemovedPieces: number;
  totalRemovedMeters: number;
  totalRemovedRollsOrBoxes: number;
  totalRecords: number;
}

export function computeFieldMaterialKpis(rows: SupabaseFieldMaterialLog[]): FieldMaterialKpiSummary {
  let totalWireUsedMeters = 0;
  let totalSplittersAndBoxesInstalled = 0;
  let totalOtherInstalledPieces = 0;
  let totalRemovedPieces = 0;
  let totalRemovedMeters = 0;
  let totalRemovedRollsOrBoxes = 0;

  for (const row of rows || []) {
    const qty = Number(row.quantity) || 0;
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const action = normalizeFieldMaterialActionType(row.action_type);
    const unit = normalizeFieldMaterialUnit(row.unit);
    const catLower = String(row.material_category || '').toLowerCase();
    const isSplitterOrBox =
      catLower.includes('splitter') ||
      catLower.includes('fat') ||
      catLower.includes('odb') ||
      catLower.includes('closure') ||
      catLower.includes('joint') ||
      unit === 'Boxes';

    if (action === 'INSTALLED' || action === 'REPLACED') {
      if (unit === 'Meters') {
        totalWireUsedMeters += qty;
      } else if (isSplitterOrBox) {
        totalSplittersAndBoxesInstalled += qty;
      } else {
        totalOtherInstalledPieces += qty;
      }
    } else if (action === 'REMOVED') {
      if (unit === 'Meters') {
        totalRemovedMeters += qty;
      } else if (unit === 'Pieces') {
        totalRemovedPieces += qty;
      } else {
        totalRemovedRollsOrBoxes += qty;
      }
    }
  }

  return {
    totalWireUsedMeters: Math.round(totalWireUsedMeters * 100) / 100,
    totalSplittersAndBoxesInstalled: Math.round(totalSplittersAndBoxesInstalled * 100) / 100,
    totalOtherInstalledPieces: Math.round(totalOtherInstalledPieces * 100) / 100,
    totalRemovedPieces: Math.round(totalRemovedPieces * 100) / 100,
    totalRemovedMeters: Math.round(totalRemovedMeters * 100) / 100,
    totalRemovedRollsOrBoxes: Math.round(totalRemovedRollsOrBoxes * 100) / 100,
    totalRecords: (rows || []).length,
  };
}

export async function fetchFieldMaterialLogs(): Promise<{
  data: SupabaseFieldMaterialLog[];
  missingTable: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('field_material_logs')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingTableOrColumnError(error)) {
      return { data: [], missingTable: true, error: error.message };
    }
    return { data: [], missingTable: false, error: error.message };
  }

  return {
    data: Array.isArray(data) ? (data as SupabaseFieldMaterialLog[]) : [],
    missingTable: false,
  };
}

export async function fetchFieldStaffDirectory(): Promise<SupabasePortalUser[]> {
  const { data, error } = await supabase
    .from('portal_users')
    .select('*')
    .in('role', ['AGENT', 'MANAGER', 'ADMIN'])
    .order('full_name', { ascending: true });

  if (error || !Array.isArray(data)) {
    return [];
  }
  return data as SupabasePortalUser[];
}

export async function createFieldMaterialLogsBatch(
  items: CreateFieldMaterialItemInput[],
  actor: { id?: string | null; name: string; role: string }
): Promise<SupabaseFieldMaterialLog[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Please add at least one material item to save.');
  }

  const actorRole = normalizePerformerRole(actor.role);
  const canAssignOthers = actorRole === 'ADMIN' || actorRole === 'MANAGER';

  const sanitizedRows = items.map((item, idx) => {
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`Item #${idx + 1}: Quantity must be greater than 0.`);
    }
    const poleLocation = String(item.pole_id_or_location || '').trim();
    if (!poleLocation) {
      throw new Error(`Item #${idx + 1}: Pole ID / FAT / Location is required.`);
    }
    const category = String(item.material_category || '').trim() || 'Other';
    const area = String(item.coverage_area || '').trim() || 'General Coverage Area';

    const performerId = canAssignOthers
      ? item.performed_by_user_id || actor.id || null
      : actor.id || null;
    const performerName = canAssignOthers
      ? String(item.performed_by_name || actor.name || 'Field Technician').trim()
      : String(actor.name || 'Field Technician').trim();
    const performerRole = canAssignOthers
      ? normalizePerformerRole(item.performed_by_role || actorRole)
      : actorRole;

    return {
      action_type: normalizeFieldMaterialActionType(item.action_type),
      material_category: category.slice(0, 120),
      quantity: Math.round(qty * 100) / 100,
      unit: normalizeFieldMaterialUnit(item.unit),
      pole_id_or_location: poleLocation.slice(0, 180),
      coverage_area: area.slice(0, 120),
      performed_by_user_id: performerId,
      performed_by_name: performerName.slice(0, 120),
      performed_by_role: performerRole,
      remarks: String(item.remarks || '').trim().slice(0, 600) || null,
    };
  });

  const { data, error } = await supabase
    .from('field_material_logs')
    .insert(sanitizedRows)
    .select('*');

  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error('Supabase insert returned 0 rows (check RLS INSERT policy on field_material_logs).');
  }

  return data as SupabaseFieldMaterialLog[];
}

export async function updateFieldMaterialLog(
  id: string,
  updates: UpdateFieldMaterialLogInput,
  actorRole?: string | null
): Promise<SupabaseFieldMaterialLog> {
  if (String(actorRole || '').trim().toUpperCase() !== 'ADMIN') {
    throw new Error('Only Master Admin (ADMIN) users can edit field material logs.');
  }
  if (!id) {
    throw new Error('Missing material log ID.');
  }

  const qty = Number(updates.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error('Quantity must be a positive number.');
  }
  const poleLocation = String(updates.pole_id_or_location || '').trim();
  if (!poleLocation) {
    throw new Error('Pole ID / Location is required.');
  }

  const payload: Record<string, any> = {
    action_type: normalizeFieldMaterialActionType(updates.action_type),
    material_category: String(updates.material_category || 'Other').trim().slice(0, 120),
    quantity: Math.round(qty * 100) / 100,
    unit: normalizeFieldMaterialUnit(updates.unit),
    pole_id_or_location: poleLocation.slice(0, 180),
    coverage_area: String(updates.coverage_area || 'General Coverage Area').trim().slice(0, 120),
    performed_by_user_id: updates.performed_by_user_id || null,
    performed_by_name: String(updates.performed_by_name || 'Field Technician').trim().slice(0, 120),
    performed_by_role: normalizePerformerRole(updates.performed_by_role),
    remarks: String(updates.remarks || '').trim().slice(0, 600) || null,
  };

  if (updates.created_at) {
    const parsedDate = new Date(updates.created_at);
    if (!Number.isNaN(parsedDate.getTime())) {
      payload.created_at = parsedDate.toISOString();
    }
  }

  const { data, error } = await supabase
    .from('field_material_logs')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new Error('Supabase update returned 0 rows (check RLS UPDATE policy on field_material_logs).');
  }

  return data as SupabaseFieldMaterialLog;
}

export async function deleteFieldMaterialLog(
  id: string,
  actorRole?: string | null
): Promise<string> {
  if (String(actorRole || '').trim().toUpperCase() !== 'ADMIN') {
    throw new Error('Only Master Admin (ADMIN) users can delete field material logs.');
  }
  if (!id) {
    throw new Error('Missing material log ID.');
  }

  const { data, error } = await supabase
    .from('field_material_logs')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    throw new Error(error.message);
  }
  if (!data || data.length === 0) {
    throw new Error('Supabase delete returned 0 rows (check RLS DELETE policy or record may already be deleted).');
  }

  return id;
}
