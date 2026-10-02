import { OpticalSignalQuality, OnuStatus } from '../types/olt';

/**
 * Determine Optical Signal Quality based on carrier-grade PON thresholds:
 * - Good: -12 dBm to -23 dBm (Green 🟢)
 * - Warning / High Attenuation: -24 dBm to -27 dBm (Yellow 🟡)
 * - Critical / Dying Gasp / Fiber Cut: Below -28 dBm or Offline (Red 🔴)
 */
export function classifyOpticalSignal(rxPowerDbm: number, status: OnuStatus): OpticalSignalQuality {
  if (status === 'offline' || status === 'dying_gasp') {
    return 'critical';
  }
  if (rxPowerDbm >= -23.0 && rxPowerDbm <= -12.0) {
    return 'good';
  }
  if (rxPowerDbm < -23.0 && rxPowerDbm >= -27.5) {
    return 'warning';
  }
  return 'critical';
}

export function getSignalColorClass(quality: OpticalSignalQuality): {
  badge: string;
  text: string;
  border: string;
  bg: string;
  label: string;
  dot: string;
} {
  switch (quality) {
    case 'good':
      return {
        badge: 'bg-emerald-950 text-emerald-300 border-emerald-700',
        text: 'text-emerald-400',
        border: 'border-emerald-600',
        bg: 'bg-emerald-950/40',
        label: 'Optimal (-12 to -23 dBm)',
        dot: 'bg-emerald-400',
      };
    case 'warning':
      return {
        badge: 'bg-amber-950 text-amber-300 border-amber-700',
        text: 'text-amber-400',
        border: 'border-amber-600',
        bg: 'bg-amber-950/40',
        label: 'High Attenuation (-24 to -27 dBm)',
        dot: 'bg-amber-400',
      };
    case 'critical':
      return {
        badge: 'bg-rose-950 text-rose-300 border-rose-700 animate-pulse',
        text: 'text-rose-400',
        border: 'border-rose-600',
        bg: 'bg-rose-950/40',
        label: 'Critical / Fiber Cut (<-28 dBm)',
        dot: 'bg-rose-500',
      };
  }
}
