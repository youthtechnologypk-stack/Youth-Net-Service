import React, { useEffect, useState } from 'react';
import { Wallet, AlertTriangle, ShieldCheck, Loader2 } from 'lucide-react';
import { getStoredUser } from '../lib/auth';
import {
  previewResellerWalletGate,
  RESELLER_WALLET_UPDATED_EVENT,
  WalletGatePreviewResult,
} from '../lib/resellerEngine';

export interface ResellerWalletGatePreviewProps {
  resellerId?: string | null;
  subscriberUsername?: string | null;
  profileName: string;
  actionLabel?: string;
  compact?: boolean;
  onStatusChange?: (status: WalletGatePreviewResult | null) => void;
}

export const ResellerWalletGatePreview: React.FC<ResellerWalletGatePreviewProps> = ({
  resellerId,
  subscriberUsername,
  profileName,
  actionLabel,
  compact = false,
  onStatusChange,
}) => {
  const [preview, setPreview] = useState<WalletGatePreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cleanProfile = String(profileName || '').trim();
    if (!cleanProfile) {
      setPreview(null);
      onStatusChange?.(null);
      return;
    }

    const loadPreview = async () => {
      setIsLoading(true);
      try {
        const result = await previewResellerWalletGate({
          resellerId,
          subscriberUsername,
          profileName: cleanProfile,
          actingUser: getStoredUser(),
        });
        if (!cancelled) {
          setPreview(result);
          onStatusChange?.(result);
        }
      } catch {
        if (!cancelled) {
          setPreview(null);
          onStatusChange?.(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadPreview();

    const handleWalletRefresh = () => {
      void loadPreview();
    };
    window.addEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletRefresh);
    };
  }, [resellerId, subscriberUsername, profileName]);

  if (isLoading && !preview) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/90 px-3 py-2 text-xs text-slate-400 flex items-center gap-2 font-mono">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400 shrink-0" />
        <span>Checking prepaid reseller tariff &amp; wallet balance...</span>
      </div>
    );
  }

  if (!preview || !preview.applicable) {
    return null;
  }

  const isBlocked = preview.blocked;
  const wholesaleText = preview.tariffMissing
    ? 'Not Configured'
    : `Rs. ${Math.round(preview.wholesalePrice).toLocaleString()}`;
  const walletText = `Rs. ${Math.round(preview.walletBalance).toLocaleString()}`;

  return (
    <div
      className={`rounded-xl border ${compact ? 'p-2.5 space-y-1.5' : 'p-3 space-y-2'} ${
        isBlocked
          ? 'bg-rose-950/50 border-rose-500/60 text-rose-200'
          : 'bg-emerald-950/35 border-emerald-500/40 text-emerald-100'
      }`}
    >
      {/* Live Cost Preview Badge Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-bold">
          {isBlocked ? (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className={isBlocked ? 'text-rose-200' : 'text-emerald-200'}>
            Wallet Deduction Preview:{' '}
            <span className="font-mono text-white">{wholesaleText}</span>
            {' | '}
            Your Wallet:{' '}
            <span className="font-mono text-white">{walletText}</span>
          </span>
        </div>
        <span
          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
            isBlocked
              ? 'bg-rose-900/80 text-rose-200 border border-rose-500/50'
              : 'bg-emerald-900/70 text-emerald-300 border border-emerald-500/40'
          }`}
        >
          {isBlocked ? 'PAYMENT GATE BLOCKED' : 'PREPAID VERIFIED'}
        </span>
      </div>

      {/* Meta details */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-300">
        <span>
          Reseller:{' '}
          <strong className="text-white">
            {preview.resellerName} (@{preview.resellerUsername})
          </strong>
        </span>
        <span>
          Plan: <strong className="text-cyan-300">{preview.profileName}</strong>
        </span>
        {preview.creditLimit > 0 && (
          <span>
            Credit Limit: <strong className="text-slate-200">Rs. {Math.round(preview.creditLimit).toLocaleString()}</strong>
          </span>
        )}
        {!isBlocked && (
          <span className="text-emerald-300 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>
              After {actionLabel || 'activation'}: Rs.{' '}
              {Math.round(preview.projectedBalanceAfter).toLocaleString()}
            </span>
          </span>
        )}
      </div>

      {/* Clear Red Alert Banner when Blocked */}
      {isBlocked && preview.error && (
        <div className="rounded-lg bg-rose-950/90 border border-rose-500/70 px-3 py-2 text-xs font-semibold text-rose-200 leading-snug">
          {preview.error}
        </div>
      )}
    </div>
  );
};

export default ResellerWalletGatePreview;
