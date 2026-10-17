import React from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { SystemRole } from '../types/auth';
import { FeatureKey, FEATURE_CATALOG } from '../types/permissions';
import { usePermissions } from '../context/PermissionContext';
import { getStoredUser } from '../lib/auth';

export interface FeatureGateProps {
  feature: FeatureKey;
  role?: SystemRole;
  userId?: string;
  mode?: 'hide' | 'disable' | 'banner';
  disabledMessage?: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  role,
  userId,
  mode = 'hide',
  disabledMessage,
  fallback = null,
  children,
}) => {
  const { hasPermission } = usePermissions();
  const currentUser = getStoredUser();
  const effectiveRole = role || currentUser?.role || 'ADMIN';
  const effectiveUserId = userId || currentUser?.id;

  const isAllowed = hasPermission(feature, effectiveRole, effectiveUserId);

  if (isAllowed) {
    return <>{children}</>;
  }

  // Feature is disabled
  if (fallback) {
    return <>{fallback}</>;
  }

  const meta = FEATURE_CATALOG.find((f) => f.key === feature);
  const featureLabel = meta ? meta.name : feature;
  const message =
    disabledMessage ||
    `This feature (${featureLabel}) is disabled for your role (${effectiveRole}) by Administrator policy.`;

  if (mode === 'hide') {
    return null;
  }

  if (mode === 'banner') {
    return (
      <div className="bg-slate-900/90 border border-amber-800/60 rounded-xl p-3.5 my-2 text-xs flex items-center justify-between gap-3 text-amber-200">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-amber-950 border border-amber-700/80 text-amber-400 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-white block">{featureLabel} Unavailable</span>
            <span className="text-[11px] text-amber-300/80">{message}</span>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded bg-slate-950 border border-amber-900 text-[10px] font-mono text-amber-400 font-bold">
          ADMIN LOCKED
        </span>
      </div>
    );
  }

  if (mode === 'disable') {
    return (
      <div className="relative group select-none">
        <div className="opacity-40 pointer-events-none filter grayscale contrast-75">
          {children}
        </div>
        <div className="absolute inset-0 bg-slate-950/40 rounded-xl flex items-center justify-center pointer-events-none opacity-0 group-hover:opacity-100 transition duration-150">
          <div className="bg-slate-900 border border-slate-700 text-slate-200 text-[11px] font-mono px-3 py-1.5 rounded-lg shadow-xl flex items-center gap-1.5 backdrop-blur-sm">
            <Lock className="w-3.5 h-3.5 text-amber-400" />
            <span>Disabled by Admin Matrix</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
