import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { UserAccount } from '../types/auth';
import { haversineMeters } from '../lib/fiberOpticEngine';
import {
  markAgentLocationOffline,
  upsertAgentLiveLocation,
} from '../services/agentGpsService';
import {
  enqueueGpsBreadcrumb,
  reportSupabaseReachability,
} from '../lib/offlineFieldQueue';

interface FieldAgentGpsGuardProps {
  currentUser: UserAccount;
}

type GpsGuardStatus = 'checking' | 'active' | 'blocked';

export const FieldAgentGpsGuard: React.FC<FieldAgentGpsGuardProps> = ({
  currentUser,
}) => {
  const [status, setStatus] = useState<GpsGuardStatus>('checking');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [lastCoords, setLastCoords] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
    syncedAt: string;
    queuedOffline?: boolean;
  } | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const watchIdRef = useRef<number | null>(null);
  const lastSyncRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const lastBreadcrumbTsRef = useRef<number>(0);
  const latestPositionRef = useRef<{ lat: number; lng: number; accuracy: number; ts: number } | null>(null);

  const agentId = currentUser.linkedAgentId || currentUser.id || currentUser.username;
  const agentName = currentUser.fullName || currentUser.displayName || currentUser.username;

  const pushPosition = useCallback(
    async (pos: GeolocationPosition, force = false) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const accuracy = Math.round(pos.coords.accuracy || 0);
      const nowMs = Date.now();

      latestPositionRef.current = { lat, lng, accuracy, ts: nowMs };
      setStatus('active');
      setErrorDetail('');
      setBannerDismissed(false);

      const prev = lastSyncRef.current;
      const elapsedMs = prev ? nowMs - prev.ts : Infinity;
      const movedMeters = prev
        ? haversineMeters({ lat: prev.lat, lng: prev.lng }, { lat, lng })
        : Infinity;

      if (!force && prev && elapsedMs < 15000 && movedMeters <= 15) {
        return;
      }

      lastSyncRef.current = { lat, lng, ts: nowMs };
      const timeLabel = new Date(nowMs).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      const isDeviceOffline =
        typeof navigator !== 'undefined' && navigator.onLine === false;

      if (isDeviceOffline) {
        if (nowMs - lastBreadcrumbTsRef.current >= 55000 || force) {
          lastBreadcrumbTsRef.current = nowMs;
          enqueueGpsBreadcrumb({
            agent_id: agentId,
            agent_name: agentName,
            lat,
            lng,
            accuracy_meters: accuracy,
            recorded_at: new Date(nowMs).toISOString(),
          });
        }
        reportSupabaseReachability(false);
        setLastCoords({ lat, lng, accuracy, syncedAt: timeLabel, queuedOffline: true });
        return;
      }

      const res = await upsertAgentLiveLocation({
        agentId,
        agentName,
        lat,
        lng,
        accuracyMeters: accuracy,
        isOnline: true,
      });

      if (res.ok) {
        reportSupabaseReachability(true);
        setLastCoords({ lat, lng, accuracy, syncedAt: timeLabel, queuedOffline: false });
      } else if (!res.tableMissing) {
        // WhatsApp-only bundle or network drop where Supabase is unreachable
        reportSupabaseReachability(false);
        if (nowMs - lastBreadcrumbTsRef.current >= 55000 || force) {
          lastBreadcrumbTsRef.current = nowMs;
          enqueueGpsBreadcrumb({
            agent_id: agentId,
            agent_name: agentName,
            lat,
            lng,
            accuracy_meters: accuracy,
            recorded_at: new Date(nowMs).toISOString(),
          });
        }
        setLastCoords({ lat, lng, accuracy, syncedAt: timeLabel, queuedOffline: true });
      } else {
        setLastCoords({ lat, lng, accuracy, syncedAt: timeLabel, queuedOffline: false });
      }
    },
    [agentId, agentName]
  );

  const startWatch = useCallback((showBannerOnFail = false) => {
    if (showBannerOnFail) {
      setBannerDismissed(false);
    }

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
            'Location permission is denied or blocked by an active screen overlay.'
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
              ? 'Location permission is denied or blocked by an active screen overlay.'
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
    startWatch(false);

    // Compulsory 60-second GPS breadcrumb interval (works offline / on WhatsApp-only SIM bundles)
    const breadcrumbInterval = window.setInterval(() => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return;

      const recordOrPush = (lat: number, lng: number, accuracy: number) => {
        const nowMs = Date.now();
        latestPositionRef.current = { lat, lng, accuracy, ts: nowMs };
        lastBreadcrumbTsRef.current = nowMs;

        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        if (isOffline) {
          enqueueGpsBreadcrumb({
            agent_id: agentId,
            agent_name: agentName,
            lat,
            lng,
            accuracy_meters: accuracy,
            recorded_at: new Date(nowMs).toISOString(),
          });
          reportSupabaseReachability(false);
          setLastCoords({
            lat,
            lng,
            accuracy,
            syncedAt: new Date(nowMs).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            queuedOffline: true,
          });
          return;
        }

        void upsertAgentLiveLocation({
          agentId,
          agentName,
          lat,
          lng,
          accuracyMeters: accuracy,
          isOnline: true,
        }).then((res) => {
          if (res.ok) {
            reportSupabaseReachability(true);
            setLastCoords({
              lat,
              lng,
              accuracy,
              syncedAt: new Date(nowMs).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
              queuedOffline: false,
            });
          } else if (!res.tableMissing) {
            reportSupabaseReachability(false);
            enqueueGpsBreadcrumb({
              agent_id: agentId,
              agent_name: agentName,
              lat,
              lng,
              accuracy_meters: accuracy,
              recorded_at: new Date(nowMs).toISOString(),
            });
            setLastCoords({
              lat,
              lng,
              accuracy,
              syncedAt: new Date(nowMs).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
              queuedOffline: true,
            });
          }
        });
      };

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          recordOrPush(
            pos.coords.latitude,
            pos.coords.longitude,
            Math.round(pos.coords.accuracy || 0)
          );
        },
        () => {
          // If fresh GPS fix timed out, fall back to latest watchPosition coordinate if recent (< 3 min)
          const cached = latestPositionRef.current;
          if (cached && Date.now() - cached.ts <= 180000) {
            recordOrPush(cached.lat, cached.lng, cached.accuracy);
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 55000,
          timeout: 10000,
        }
      );
    }, 60000);

    const handleBeforeUnload = () => {
      void markAgentLocationOffline(agentId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(breadcrumbInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [agentId, agentName, startWatch]);

  if (status === 'blocked' && !bannerDismissed) {
    return (
      <div
        className="w-full rounded-xl bg-amber-950/85 border border-amber-500/60 shadow-lg px-3.5 py-3 text-xs"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="mt-0.5 w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>

            <div className="space-y-1.5 min-w-0">
              <p className="font-bold text-amber-100 leading-snug">
                📍 Field Duty GPS Inactive — Turn ON phone Location / GPS so NOC can view your live field position.
              </p>

              {errorDetail && (
                <p className="text-[11px] font-mono text-rose-200 bg-rose-950/60 border border-rose-700/50 rounded-md px-2.5 py-1">
                  {errorDetail}
                </p>
              )}

              <p className="text-[11px] text-amber-200/95 leading-relaxed">
                <strong>Tip:</strong> If Android says &apos;Close bubbles or overlays from other apps&apos;, close any floating chat bubbles / screen filters on your screen and tap Retry GPS.
              </p>

              <div className="pt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => startWatch(true)}
                  disabled={isRetrying}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                  <span>{isRetrying ? 'Checking GPS...' : 'Retry GPS'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-amber-600/40 text-amber-200 font-semibold text-xs cursor-pointer transition"
                >
                  Dismiss Banner
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss GPS warning banner"
            className="p-1 rounded-lg text-amber-300/80 hover:text-white hover:bg-amber-900/50 cursor-pointer shrink-0 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (status === 'blocked' && bannerDismissed) {
    return (
      <div className="w-full rounded-xl bg-slate-900/70 border border-amber-700/40 px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-2 text-amber-200">
          <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-bold text-white">Field Duty GPS:</span>
          <span className="text-amber-300">Paused / Blocked (Portal unlocked)</span>
        </div>

        <button
          type="button"
          onClick={() => startWatch(true)}
          disabled={isRetrying}
          className="px-2.5 py-1 rounded-lg bg-emerald-700/80 hover:bg-emerald-600 text-white font-semibold flex items-center gap-1 cursor-pointer transition"
        >
          <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
          <span>{isRetrying ? 'Checking...' : 'Retry GPS'}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`w-full rounded-xl border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs font-mono ${
        lastCoords?.queuedOffline
          ? 'bg-amber-950/60 border-amber-700/60'
          : 'bg-emerald-950/60 border-emerald-700/60'
      }`}
    >
      <div
        className={`flex items-center gap-2 ${
          lastCoords?.queuedOffline ? 'text-amber-200' : 'text-emerald-200'
        }`}
      >
        <Navigation
          className={`w-3.5 h-3.5 shrink-0 ${
            lastCoords?.queuedOffline ? 'text-amber-400' : 'text-emerald-400'
          }`}
        />
        <span className="font-bold text-white">Field Duty GPS:</span>
        {status === 'checking' ? (
          <span className="text-amber-300">Acquiring GPS lock...</span>
        ) : lastCoords ? (
          <span className="tabular-nums">
            {lastCoords.queuedOffline ? 'Offline Queue' : 'Live'} ({lastCoords.lat.toFixed(5)},{' '}
            {lastCoords.lng.toFixed(5)}) &bull; ±{lastCoords.accuracy}m &bull;{' '}
            {lastCoords.queuedOffline ? `Captured ${lastCoords.syncedAt}` : `Synced ${lastCoords.syncedAt}`}
          </span>
        ) : (
          <span>Tracking Active</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => startWatch(true)}
        className={`px-2.5 py-1 rounded-lg bg-slate-900 border flex items-center gap-1 cursor-pointer ${
          lastCoords?.queuedOffline
            ? 'border-amber-700/70 text-amber-300 hover:text-white'
            : 'border-emerald-700/70 text-emerald-300 hover:text-white'
        }`}
      >
        <MapPin className="w-3 h-3" />
        <span>Refresh GPS</span>
      </button>
    </div>
  );
};
