// ─────────────────────────────────────────────────────────────────────
// Wugi — WeatherBadge
//
// Small "temp °F + condition icon" chip for the Home and Discover headers.
// Data source: Open-Meteo (no API key, no new packages) — current temp +
// WMO weather code for Atlanta (33.749, -84.388). The app has no existing
// location-access plumbing (no expo-location usage anywhere in src/), so
// this always renders the Atlanta fallback rather than prompting for a
// permission the app isn't otherwise wired to request.
//
// Fetch is deduped + cached in module scope (30 min TTL) so mounting this
// on both Home and Discover — which RootNavigator keeps mounted
// simultaneously (tabs stay alive behind `display:none`) — fires at most
// one network request per cache window. Fails silent: any fetch/parse
// error just leaves the badge unrendered.
// ─────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Theme } from '../constants/colors';
import { MONO } from '../constants/fonts';

const ATLANTA_LAT = 33.749;
const ATLANTA_LON = -84.388;
const CACHE_TTL_MS = 30 * 60 * 1000;

type WeatherData = { tempF: number; code: number };

let cache: { data: WeatherData; ts: number } | null = null;
let inFlight: Promise<WeatherData | null> | null = null;

async function getWeather(): Promise<WeatherData | null> {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<WeatherData | null> => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${ATLANTA_LAT}&longitude=${ATLANTA_LON}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`weather fetch status ${res.status}`);
      const json = await res.json();
      const temp = json?.current?.temperature_2m;
      const code = json?.current?.weather_code;
      if (typeof temp !== 'number' || typeof code !== 'number') throw new Error('malformed weather response');
      const data: WeatherData = { tempF: Math.round(temp), code };
      cache = { data, ts: Date.now() };
      return data;
    } catch (e) {
      console.log('WeatherBadge: fetch failed', e);
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

// WMO weather-code → condition icon (per Open-Meteo's code table).
function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

export function WeatherBadge({ theme }: { theme: Theme }) {
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWeather().then(w => { if (!cancelled) setWeather(w); });
    return () => { cancelled = true; };
  }, []);

  if (!weather) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.icon}>{weatherIcon(weather.code)}</Text>
      <Text style={[styles.temp, { color: theme.subtext, fontFamily: MONO }]}>{weather.tempF}°</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    fontSize: 14,
  },
  temp: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
});
