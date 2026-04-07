import { useState } from 'react';
import * as Location from 'expo-location';

const GEOFENCE_RADIUS_METERS = 200;
const METERS_PER_MILE = 1609.34;

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

function metersToMiles(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.round(meters)} feet away`;
  return `${miles.toFixed(1)} mile${miles.toFixed(1) === '1.0' ? '' : 's'} away`;
}

export function useLocationCheck() {
  const [checking, setChecking] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function verifyAtVenue(
    venueLat: number,
    venueLon: number
  ): Promise<boolean> {
    // DEV bypass — skips geofence in simulator / local builds
    if (__DEV__) {
      console.log('[useLocationCheck] DEV mode — skipping geofence check');
      return true;
    }

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
          `You must be at the venue to use this PIN. You are ${metersToMiles(dist)}.`
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
