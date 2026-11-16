import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, RefreshCw, ShieldAlert, LogOut } from 'lucide-react';
import type { UserAccount } from '../types/auth';
import { haversineMeters } from '../lib/fiberOpticEngine';
import {
  markAgentLocationOffline,
  upsertAgentLiveLocation,
} from '../services/agentGpsService';

interface FieldAgentGpsGuardProps {
  currentUser: UserAccount;
  isAdminPreview?: boolean;
  onLogout?: () => void;
}

type GpsGuardStatus = 'checking' | 'active' | 'blocked';

export const FieldAgentGpsGuard: React.FC<FieldAgentGpsGuardProps> = ({
  currentUser,
  isAdminPreview = false,
  onLogout,
}) => {
  const [status, setStatus] = useState<GpsGuardStatus>('checking');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [lastCoords, setLastCoords] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    syncedAt: string;
  } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [previewDismissed, setPreviewDismissed] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastSyncRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const agentId = currentUser.linkedAgentId || currentUser.id || currentUser.username;
  const agentName = currentUser.fullName || currentUser.displayName || currentUser.username;

  const pushPosition = useCallback(
    async (pos: GeolocationPosition, force = false) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 0);
      const nowMs = Date.now();

      setStatus('active');
      setErrorDetail('');

      const prev = lastSyncRef.current;
      const elapsedMs = prev ? nowMs - prev.ts : Infinity;
      const movedMeters = prev
        ? haversineMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng })
        : Infinity;

      if (!force && prev && elapsedMs < 15000 && movedMeters <= 15) {
        return;
      }

      lastSyncRef.current = { lat, lng, ts: nowMs };
      setLastCoords({
        lat,
        lng,
        accuracy,
        syncedAt: new Date(nowMs).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });

      await upsertAgentLiveLocation({
        agentId,
        agentName,
        lat,
        lng,
        accuracyMeters: accuracy,
        isOnline: true,
      });
    },
    [agentId, agentName]
  );

  const startWatch = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('blocked');
      setErrorDetail('GPS / Geolocation is not supported by this browser.');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setIsRetrying(true);

    // Immediate fix attempt so the agent unlocks quickly on tap
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsRetrying(false);
        void pushPosition(pos, true);
      },
      (err) => {
        setIsRetrying(false);
        if (err.code === 1) {
          setStatus('blocked');
          setErrorDetail(
            'Location permission is denied. Allow Location access in your browser/app settings.'
          );
        } else if (err.code === 2) {
          setStatus('blocked');
          setErrorDetail(
            'Phone GPS / Location Services appear to be turned OFF or unavailable.'
          );
        } else {
          setStatus((prev) => (prev === 'active' ? 'active' : 'blocked'));
          setErrorDetail(
            'Unable to acquire a GPS lock yet. Move outdoors or turn ON High-Accuracy Location.'
          );
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setIsRetrying(false);
        void pushPosition(pos, false);
      },
      (err) => {
        setIsRetrying(false);
        if (err.code === 1 || err.code === 2) {
          setStatus('blocked');
          setErrorDetail(
            err.code === 1
              ? 'Location permission is denied. Please allow Location access to continue.'
              : 'Phone GPS / Location Services turned OFF. Please enable GPS.'
          );
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      }
    );
  }, [pushPosition]);

  useEffect(() => {
    startWatch();

    const handleBeforeUnload = () => {
      void markAgentLocationOffline(agentId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [agentId, startWatch]);

  if (status === 'blocked' && !(isAdminPreview && previewDismissed)) {
    return (
      <div
        className="fixed inset-0 z-[120] bg-slate-950/92 backdrop-blur-md flex items-center justify-center p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="gps-duty-guard-title"
      >
        <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-rose-500/60 shadow-2xl p-6 space-y-5 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h2
              id="gps-duty-guard-title"
              className="text-base sm:text-lg font-bold text-white leading-snug"
            >
              📍 GPS Location Required for Field Duty — Please turn ON your phone Location / GPS and tap &apos;Enable GPS&apos; to continue.
            </h2>
            {errorDetail && (
              <p className="text-xs font-mono text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
                {errorDetail}
              </p>
            )}
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => startWatch()}
              disabled={isRetrying}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg transition"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              <span>{isRetrying ? 'Checking GPS Lock...' : 'Enable / Retry GPS'}</span>
            </button>

            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            )}

            {isAdminPreview && (
              <button
                type="button"
                onClick={() => setPreviewDismissed(true)}
                className="w-full py-2 text-[11px] font-mono text-slate-400 hover:text-slate-200 underline cursor-pointer"
              >
                Continue Admin Role Preview Without GPS
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-xl bg-emerald-950/60 border border-emerald-700/60 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
      <div className="flex items-center gap-2 text-emerald-200">
        <Navigation className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="font-bold text-white">Field Duty GPS:</span>
        {status === 'checking' ? (
          <span className="text-amber-300">Acquiring GPS lock...</span>
        ) : lastCoords ? (
          <span className="tabular-nums">
            Live ({lastCoords.lat.toFixed(5)}, {lastCoords.lng.toFixed(5)}) &bull; ±
            {lastCoords.accuracy}m &bull; Synced {lastCoords.syncedAt}
          </span>
        ) : (
          <span>Tracking Active</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => startWatch()}
        className="px-2.5 py-1 rounded-lg bg-slate-900 border border-emerald-700/70 text-emerald-300 hover:text-white flex items-center gap-1 cursor-pointer"
      >
        <MapPin className="w-3 h-3" />
        <span>Refresh GPS</span>
      </button>
    </div>
  );
};
