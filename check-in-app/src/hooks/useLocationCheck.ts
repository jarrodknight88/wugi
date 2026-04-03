import { useState } from 'react';
import * as Location from 'expo-location';

const GEOFENCE_RADIUS_METERS = 200;

function getDistanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useLocationCheck() {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verifyAtVenue(
    venueLat: number,
    venueLon: number
  ): Promise<boolean> {
    // ── DEV BYPASS ─────────────────────────────────────────────────
    // Location check is skipped in __DEV__ mode (simulator / local builds).
    // Remove this block or set SKIP_LOCATION_CHECK=false before production.
    if (__DEV__) {
      console.log('[useLocationCheck] DEV mode — skipping geofence check');
      return true;
    }
    // ───────────────────────────────────────────────────────────────
    setChecking(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is required to check in at this venue.');
        return false;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const dist = getDistanceMeters(
        pos.coords.latitude,
        pos.coords.longitude,
        venueLat,
        venueLon
      );
      if (dist > GEOFENCE_RADIUS_METERS) {
        setError(
          `You must be at the venue to use this PIN. You are ${Math.round(dist)}m away.`
        );
        return false;
      }
      return true;
    } catch (e) {
      setError('Could not determine your location. Please try again.');
      return false;
    } finally {
      setChecking(false);
    }
  }

  return { verifyAtVenue, checking, error, setError };
}
